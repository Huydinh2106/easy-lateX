import Fastify from 'fastify';
import { z } from 'zod';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Account } from '@easy-latex/shared-types';
import { ApiError } from './store';
import type { GitHubStore } from './github-store';
import type { GitHubAuth } from './github-auth';
import type { LegacyMigration } from './legacy-migration';
import { ProjectUpdates } from './project-updates';
const uuid=z.uuid();const sha=z.string().regex(/^[a-f0-9]{40}$/);
export function createGitHubServer(store:GitHubStore,auth:GitHubAuth,updates=new ProjectUpdates(store.pool),legacy?:LegacyMigration){
  // Node 22 can retain hijacked SSE sockets on close. Clients reconnect after
  // a deploy; close those connections so shutdown does not wait indefinitely.
  const app=Fastify({logger:false,bodyLimit:1024*1024,forceCloseConnections:true});
  const users=new WeakMap<object,Account>();const user=(r:object)=>users.get(r)!;
  const id=(v:unknown)=>z.object({id:uuid}).parse(v).id;
  app.setErrorHandler((e,_r,reply)=>{if(e instanceof ApiError)return reply.code(e.statusCode).send({message:e.message,...(e.statusCode===428||e.statusCode===404?{installationUrl:auth.github.installationUrl()}: {})});if(e instanceof z.ZodError)return reply.code(400).send({message:'Invalid request'});return reply.code(500).send({message:'The operation could not be completed. Retry; your draft is preserved.'});});
  app.addHook('preHandler',async r=>{if(r.routeOptions.url==='/health'||r.routeOptions.url?.startsWith('/auth/')||r.routeOptions.url==='/github/webhook')return;const h=r.headers.authorization;if(!h?.startsWith('Bearer ')||h.length>8192)throw new ApiError(401,'Please sign in with GitHub');users.set(r,await auth.verify(h.slice(7)));});
  auth.register(app);app.get('/health',()=>({status:'ok',collaboration:'github'}));
  const legacyBridge=()=>{if(!legacy)throw new ApiError(503,'Legacy migration bridge is not configured');return legacy;};
  app.post('/legacy/confirmation',async r=>{await legacyBridge().sendCode(z.object({email:z.email()}).parse(r.body).email);return {ok:true};});
  app.post('/legacy/link',async r=>{const b=z.object({email:z.email(),code:z.string().regex(/^\d{6}$/)}).parse(r.body);await legacyBridge().link(user(r),b.email,b.code);return {ok:true};});
  app.get('/legacy/projects',r=>legacyBridge().projects(user(r)));
  app.post('/legacy/export',r=>{const b=z.object({projectId:uuid,requestId:uuid}).parse(r.body);return legacyBridge().export(user(r),b.projectId,b.requestId);});
  app.get('/projects',r=>store.projects(user(r).id));
  app.post('/projects',r=>store.create(user(r),z.object({name:z.string().trim().min(1).max(80),requestId:uuid,legacyProjectId:uuid.optional()}).strict().parse(r.body)));
  app.get('/projects/:id',async r=>{await store.reconcile(id(r.params),user(r).id);const p=(await store.projects(user(r).id)).find(p=>p.id===id(r.params));if(!p)throw new ApiError(403,'Project unavailable');return p;});
  app.get('/projects/:id/files',r=>store.files(id(r.params),user(r).id));
  app.post('/projects/:id/git-credentials',r=>{const v=z.object({write:z.boolean(),requestId:uuid.optional()}).parse(r.body);return store.credentials(id(r.params),user(r).id,v.write,v.requestId);});
  app.post('/files/:id/edit',r=>{const b=z.object({blobSha:sha,version:z.number().int().positive()}).strict().parse(r.body);return store.acquire(id(r.params),user(r).id,b.blobSha,b.version);});
  app.post('/files/:id/renew',r=>store.renew(id(r.params),user(r).id,z.object({token:uuid}).parse(r.body).token));
  app.post('/files/:id/release',async r=>{await store.release(id(r.params),user(r).id,z.object({token:uuid}).parse(r.body).token);return {ok:true};});
  app.post('/projects/:id/publications',r=>store.prepare(id(r.params),user(r).id,z.object({requestId:uuid,baseSha:sha.nullable(),changes:z.array(z.object({path:z.string().min(1).max(512),blobSha:sha,encoding:z.enum(['utf8','base64'])}).strict()).min(1).max(1000),leases:z.record(uuid,uuid)}).strict().parse(r.body)));
  app.get('/projects/:id/publications/:requestId',r=>{const p=z.object({id:uuid,requestId:uuid}).parse(r.params);return store.ticket(p.id,p.requestId,user(r).id);});
  app.post('/projects/:id/publications/:requestId/commit',r=>{const p=z.object({id:uuid,requestId:uuid}).parse(r.params);return store.attach(p.id,user(r).id,p.requestId,z.object({sha}).strict().parse(r.body).sha);});
  app.post('/projects/:id/publications/:requestId/confirm',r=>{const p=z.object({id:uuid,requestId:uuid}).parse(r.params);return store.confirm(p.id,user(r).id,p.requestId);});
  app.post('/projects/:id/invitations',async r=>{const b=z.object({login:z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9-]{0,38}$/),role:z.enum(['editor','viewer'])}).parse(r.body);await store.invite(id(r.params),user(r).id,b.login,b.role);return {ok:true};});
  app.get('/invitations',r=>store.invitations(user(r)));
  app.post('/invitations/:id/accept',async r=>{await store.accept(id(r.params),user(r));return {ok:true};});
  app.get('/projects/:id/events',async(r,reply)=>{
    const projectId=id(r.params),account=user(r);await store.access(projectId,account.id);await updates.start();
    if(r.raw.destroyed)return;
    reply.hijack();reply.raw.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache, no-transform','X-Accel-Buffering':'no'});
    let closed=false,busy=false,pending=false;let stop=()=>{};
    const close=()=>{if(closed)return;closed=true;clearInterval(heartbeat);clearInterval(authorization);stop();reply.raw.end();};
    const send=async(event:string)=>{const p=await store.row(projectId);if(!closed&&!reply.raw.write(`event: ${event}\ndata: ${JSON.stringify({projectId,commitSha:p.head_sha})}\n\n`))close();};
    const changed=()=>{pending=true;if(busy||closed)return;busy=true;void(async()=>{try{while(pending&&!closed){pending=false;await store.access(projectId,account.id);await send('changed');}}catch{close();}finally{busy=false;}})();};
    stop=updates.subscribe(projectId,{changed,disconnected:close});r.raw.once('close',close);r.raw.once('error',close);
    const heartbeat=setInterval(()=>{if(!closed&&!reply.raw.write(': keepalive\n\n'))close();},15000);
    const authorization=setInterval(()=>{void auth.verify(r.headers.authorization!.slice(7)).then(()=>store.access(projectId,account.id)).catch(close);},60000);
    await send('ready');
  });
  // Verify the exact raw bytes before parsing a webhook. Never trust an unsigned repository ID.
  app.removeContentTypeParser('application/json');
  app.addContentTypeParser('application/json',{parseAs:'buffer'},(r,body,done)=>{
    if(r.url==='/github/webhook'){done(null,body);return;}
    try{done(null,JSON.parse(body.toString()));}catch{done(new ApiError(400,'Invalid JSON'),undefined);}
  });
  app.post('/github/webhook',{config:{rawBody:true}},async r=>{
    const raw=r.body;if(!Buffer.isBuffer(raw))throw new ApiError(415,'Use application/json for the GitHub webhook');
    const expected=Buffer.from(`sha256=${createHmac('sha256',auth.github.config.webhookSecret).update(raw).digest('hex')}`);
    const actual=Buffer.from(String(r.headers['x-hub-signature-256']??''));if(expected.length!==actual.length||!timingSafeEqual(expected,actual))throw new ApiError(401,'Invalid webhook signature');
    const payload=JSON.parse(raw.toString()) as {sender?:{id:number};repository?:{id:number;name?:string;owner?:{login?:string}};action?:string};
    if(r.headers['x-github-event']==='github_app_authorization'&&payload.action==='revoked')await store.pool.query('update collaboration.github_sessions set revoked=true where user_id in(select id from collaboration.profiles where github_id=$1)',[payload.sender?.id]);
    if(payload.repository?.id)await store.reconcileWebhook(payload.repository);
    return {ok:true};
  });
  app.addHook('preClose',async()=>updates.close());return app;
}
