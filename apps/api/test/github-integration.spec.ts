import { randomUUID, randomBytes, createHash, createHmac } from 'node:crypto';
import { Pool } from 'pg';
import { beforeAll, beforeEach, afterAll, describe, it, expect, vi } from 'vitest';
import type { Account, SharedProject, PublishTicket } from '@easy-latex/shared-types';
import { GitHub, hash, type Repository, type TreeEntry } from '../src/github';
import { GitHubAuth } from '../src/github-auth';
import { GitHubStore } from '../src/github-store';
import { createGitHubServer } from '../src/github-server';
import { LegacyMigration } from '../src/legacy-migration';
import { ApiError } from '../src/store';
const sha=(n:number)=>n.toString(16).padStart(40,'0');
const config={clientId:'id',clientSecret:'server-only',callbackUrl:'http://127.0.0.1:4318/auth/github/callback',appId:'123',privateKey:'test-only',slug:'easy-latex',encryptionKey:Buffer.alloc(32,7).toString('base64'),webhookSecret:'webhook-secret'};
describe.skipIf(!process.env.GITHUB_INTEGRATION_DATABASE_URL)('GitHub collaboration: real PostgreSQL, mocked GitHub',()=>{
  const pool=new Pool({connectionString:process.env.GITHUB_INTEGRATION_DATABASE_URL,max:20});
  const github=new GitHub(config),auth=new GitHubAuth(pool,github),store=new GitHubStore(auth),app=createGitHubServer(store,auth);
  let users:Account[],project:SharedProject,repo:Repository,head:string|null,trees:Map<string,TreeEntry[]>,commit:{sha:string;parents:{sha:string}[];message:string};
  let address='';
  beforeAll(async()=>{await pool.query('select 1');address=await app.listen({host:'127.0.0.1',port:0});});
  beforeEach(async()=>{
    vi.restoreAllMocks();
    await pool.query(`truncate collaboration.profiles,collaboration.github_legacy_links,collaboration.github_migrations,collaboration.github_invitations,collaboration.github_publications,collaboration.github_leases,collaboration.github_files,collaboration.github_members,collaboration.github_projects,collaboration.github_sessions,collaboration.github_auth_flows,collaboration.github_handoffs cascade`);
    users=['Alice','Bob','Outsider'].map((displayName,i)=>({id:randomUUID(),email:`${i+10}+${displayName}@users.noreply.github.com`,displayName,githubId:String(i+10),githubLogin:displayName.toLowerCase()}));
    for(const u of users){await pool.query('insert into collaboration.profiles(id,email,display_name,github_id,github_login) values($1,$2,$3,$4,$5) on conflict(github_id) do update set id=excluded.id',[u.id,u.email,u.displayName,u.githubId,u.githubLogin]);await pool.query(`insert into collaboration.github_sessions(token_hash,user_id,credentials,expires_at,refresh_hash,access_expires_at) values($1,$2,$3,now()+interval '30 days',$4,now()+interval '15 minutes')`,[hash(u.id),u.id,auth.box.seal({access_token:u.githubLogin,expiresAt:Date.now()+900000}),hash(`refresh-${u.id}`)]);}
    repo={id:42,name:'paper',private:true,owner:{id:10,login:'alice',type:'User'},default_branch:'main',description:null,permissions:{pull:true,push:true,admin:true}};
    vi.spyOn(github,'user').mockImplementation(token=>Promise.resolve({id:Number(users.find(u=>u.githubLogin===token)?.githubId??10),login:token,name:token}));
    vi.spyOn(github,'isAncestor').mockResolvedValue(false);vi.spyOn(github,'repo').mockResolvedValue(repo);vi.spyOn(github,'installations').mockResolvedValue();
    vi.spyOn(github,'gitToken').mockResolvedValue({token:'short-lived-repository-token',expires_at:new Date(Date.now()+3600000).toISOString()});
    vi.spyOn(github,'api').mockImplementation(<T>()=>Promise.resolve(commit as T));
    head=sha(1);trees=new Map([[head,[{path:'main.tex',sha:sha(101),mode:'100644',type:'blob'},{path:'chapters/one.tex',sha:sha(102),mode:'100644',type:'blob'}]]]);
    vi.spyOn(github,'head').mockImplementation(()=>Promise.resolve(head));vi.spyOn(github,'tree').mockImplementation((_t,_r,h)=>Promise.resolve(h?trees.get(h)??[]:[]));
    const id=randomUUID();await pool.query(`insert into collaboration.github_projects(id,owner_id,request_id,name,repo_id,repo_owner,repo_name,status) values($1,$2,$3,'Paper',42,'alice','paper','ready')`,[id,users[0]!.id,randomUUID()]);
    await pool.query(`insert into collaboration.github_members values($1,$2,'owner'),($1,$3,'editor')`,[id,users[0]!.id,users[1]!.id]);
    project={id,name:'Paper',role:'owner'};await store.reconcile(id,users[0]!.id);
  });
  afterAll(async()=>{await app.close();await pool.end();});
  const files=()=>store.files(project.id,users[0]!.id);
  const prepare=async(index:number,fileIndex:number,newBlob:string,requestId=randomUUID())=>{
    const file=(await files())[fileIndex]!;const lease=await store.acquire(file.id,users[index]!.id,file.blobSha,file.version);
    return {file,lease,ticket:await store.prepare(project.id,users[index]!.id,{requestId,baseSha:head,changes:[{path:file.path,blobSha:newBlob,encoding:'utf8'}],leases:{[file.id]:lease.token}})};
  };
  const pushed=(ticket:PublishTicket,next:string)=>{const before=trees.get(ticket.baseSha!)!;trees.set(next,before.map(f=>({...f,sha:ticket.changes.find(c=>c.path===f.path)?.blobSha??f.sha})));head=next;commit={sha:next,parents:ticket.baseSha?[{sha:ticket.baseSha}]:[],message:`Publish\n\nEasy-LaTeX-Request: ${ticket.requestId}\n`};};
  it('allows one simultaneous Edit on one file, concurrent Edit on separate files, rejects stale clients',async()=>{
    const [a,b]=(await files());
    const results=await Promise.allSettled(users.slice(0,2).map(u=>store.acquire(a!.id,u.id,a!.blobSha,a!.version)));
    expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
    expect(await store.acquire(b!.id,users[1]!.id,b!.blobSha,b!.version)).toHaveProperty('token');
    await expect(store.acquire(b!.id,users[0]!.id,sha(999),b!.version)).rejects.toMatchObject({statusCode:409});
  });
  it('serializes concurrent Done on different files without blocking their edit leases',async()=>{
    const f=await files();const leases=await Promise.all(f.map((file,i)=>store.acquire(file.id,users[i]!.id,file.blobSha,file.version)));
    const inputs=f.map((file,i)=>({requestId:randomUUID(),baseSha:head,changes:[{path:file.path,blobSha:sha(200+i),encoding:'utf8' as const}],leases:{[file.id]:leases[i]!.token}}));
    const results=await Promise.allSettled(inputs.map((input,i)=>store.prepare(project.id,users[i]!.id,input)));
    const win=results.findIndex(r=>r.status==='fulfilled');const result=results[win] as PromiseFulfilledResult<PublishTicket>;
    expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
    await store.attach(project.id,users[win]!.id,result.value.requestId,sha(2));pushed(result.value,sha(2));await store.confirm(project.id,users[win]!.id,result.value.requestId);
    const loser=1-win;const next=await store.prepare(project.id,users[loser]!.id,{...inputs[loser]!,baseSha:head});
    await store.attach(project.id,users[loser]!.id,next.requestId,sha(3));pushed(next,sha(3));await store.confirm(project.id,users[loser]!.id,next.requestId);
    expect((await files()).map(f=>f.blobSha)).toEqual([sha(200),sha(201)]);
  });
  it('recovers successful push after a lost HTTP response, including expiry, without another version',async()=>{
    const {ticket,file,lease}=await prepare(0,0,sha(300));await store.attach(project.id,users[0]!.id,ticket.requestId,sha(2));pushed(ticket,sha(2));
    await pool.query("update collaboration.github_publications set expires_at=now()-interval '1 second' where project_id=$1",[project.id]);
    await store.recoverExpired(project.id,users[1]!.id);expect((await store.ticket(project.id,ticket.requestId,users[0]!.id))!.status).toBe('confirmed');
    await store.confirm(project.id,users[0]!.id,ticket.requestId);expect((await store.file(file.id)).version).toBe(2);await expect(store.renew(file.id,users[0]!.id,lease.token)).rejects.toMatchObject({statusCode:409});
  });
  it('confirms an already pushed request after another GitHub commit advances the head',async()=>{
    const {ticket,file}=await prepare(0,0,sha(300));await store.attach(project.id,users[0]!.id,ticket.requestId,sha(2));pushed(ticket,sha(2));
    const published=commit;head=sha(3);trees.set(head,[...trees.get(sha(2))!,{path:'external.tex',sha:sha(301),mode:'100644',type:'blob'}]);
    vi.spyOn(github,'isAncestor').mockResolvedValue(true);vi.spyOn(github,'api').mockImplementation(<T>()=>Promise.resolve(published as T));
    await pool.query("update collaboration.github_publications set expires_at=now()-interval '1 second' where project_id=$1",[project.id]);
    await store.recoverExpired(project.id,users[1]!.id);
    expect((await store.ticket(project.id,ticket.requestId,users[0]!.id))!.status).toBe('confirmed');expect((await store.row(project.id)).head_sha).toBe(sha(3));expect((await store.file(file.id)).version).toBe(2);
  });
  it('keeps failed pushes pending, refuses changed remote and waits for old credentials before replacing a turn',async()=>{
    const {ticket}=await prepare(0,0,sha(300));await store.attach(project.id,users[0]!.id,ticket.requestId,sha(2));await store.credentials(project.id,users[0]!.id,true,ticket.requestId);
    await expect(store.confirm(project.id,users[0]!.id,ticket.requestId)).rejects.toMatchObject({statusCode:409});
    await pool.query("update collaboration.github_publications set expires_at=now()-interval '1 second' where project_id=$1",[project.id]);
    await expect(store.recoverExpired(project.id,users[0]!.id)).rejects.toMatchObject({statusCode:409});
    await pool.query("update collaboration.github_publications set fence_until=now()-interval '1 second' where project_id=$1",[project.id]);await store.recoverExpired(project.id,users[0]!.id);
    await expect(store.attach(project.id,users[0]!.id,ticket.requestId,sha(2))).rejects.toMatchObject({statusCode:409});
  });
  it('rejects changed content under a reused request ID, forged leases and extra files in pushed commits',async()=>{
    const {ticket,file,lease}=await prepare(0,0,sha(300));
    await expect(store.prepare(project.id,users[0]!.id,{requestId:ticket.requestId,baseSha:head,changes:[{path:file.path,blobSha:sha(301),encoding:'utf8'}],leases:{[file.id]:lease.token}})).rejects.toMatchObject({statusCode:409});
    await store.attach(project.id,users[0]!.id,ticket.requestId,sha(2));pushed(ticket,sha(2));trees.get(head!)!.push({path:'unexpected.tex',sha:sha(999),mode:'100644',type:'blob'});
    await expect(store.confirm(project.id,users[0]!.id,ticket.requestId)).rejects.toMatchObject({statusCode:409});expect((await store.file(file.id)).version).toBe(1);
  });
  it('denies direct API calls by outsiders and checks actual GitHub write permission',async()=>{
    expect((await app.inject({url:`/projects/${project.id}/files`,headers:{authorization:`Bearer ${users[2]!.id}`}})).statusCode).toBe(403);
    const file=(await files())[0]!;vi.spyOn(github,'repo').mockResolvedValue({...repo,permissions:{pull:true,push:false,admin:false}});
    await expect(store.acquire(file.id,users[1]!.id,file.blobSha,file.version)).rejects.toMatchObject({statusCode:403});
    expect((await app.inject({method:'POST',url:'/projects',headers:{authorization:`Bearer ${users[0]!.id}`},payload:{name:'Leak',requestId:randomUUID(),files:[{path:'main.tex',content:'must-not-be-stored'}]}})).statusCode).toBe(400);
  });
  it('invalidates the lease and synchronizes the tree when a file is deleted directly on GitHub',async()=>{
    const file=(await files())[0]!;const lease=await store.acquire(file.id,users[0]!.id,file.blobSha,file.version);
    trees.set(sha(2),trees.get(head!)!.filter(e=>e.path!==file.path));head=sha(2);await store.reconcile(project.id,users[1]!.id);
    expect((await files()).some(f=>f.id===file.id)).toBe(false);
    await expect(store.renew(file.id,users[0]!.id,lease.token)).rejects.toMatchObject({statusCode:409});
    await expect(store.prepare(project.id,users[0]!.id,{requestId:randomUUID(),baseSha:head,changes:[{path:file.path,blobSha:sha(800),encoding:'utf8'}],leases:{[file.id]:lease.token}})).rejects.toMatchObject({statusCode:409});
  });
  it('holds metadata only in the new schema and never enqueues legacy worker jobs or uploads content',async()=>{
    const columns=(await pool.query<{column_name:string}>(`select column_name from information_schema.columns where table_schema='collaboration' and table_name in ('github_projects','github_files','github_publications','github_migrations')`)).rows.map(c=>c.column_name);
    expect(columns).not.toContain('content');expect(columns).not.toContain('snapshot');expect(Number((await pool.query<{count:string}>('select count(*) from collaboration.git_jobs')).rows[0]!.count)).toBe(0);
  });
  it('activation retry, simultaneous activation and lost creation response produce one private repository',async()=>{
    let created:Repository|null=null;let creationCount=0;
    vi.spyOn(github,'head').mockImplementation((_t,r)=>Promise.resolve(r.id===42?head:null));
    vi.spyOn(github,'api').mockImplementation(<T>(_token:string,route:string,method?:string,body?:unknown)=>{
      if(route==='/user/repos'&&method==='POST'){
        if(created)return Promise.reject(new ApiError(409,'Already exists'));
        const input=body as {name:string;description:string;private:boolean};expect(input.private).toBe(true);
        created={...repo,id:999,name:input.name,description:input.description};creationCount++;return Promise.resolve(created as T);
      }
      if(route.startsWith('/repos/alice/'))return created?Promise.resolve(created as T):Promise.reject(new ApiError(404,'Not found'));
      return Promise.reject(new Error('Unexpected mock API route'));
    });
    const input={name:'My paper',requestId:randomUUID()};
    const [a,b]=await Promise.all([store.create(users[0]!,input),store.create(users[0]!,input)]);
    expect(a.id).toBe(b.id);expect(creationCount).toBe(1);expect((await store.create(users[0]!,input)).id).toBe(a.id);
    // Simulate losing the database binding after GitHub creation; retry adopts only our empty marked repo.
    await pool.query('update collaboration.github_projects set repo_id=null where id=$1',[a.id]);
    expect((await store.create(users[0]!,input)).repository?.id).toBe(999);expect(creationCount).toBe(1);
  });
  it('does not adopt an existing populated or unrelated repository during activation recovery',async()=>{
    vi.spyOn(github,'api').mockImplementation(<T>()=>Promise.resolve({...repo,description:'unrelated'} as T));
    await expect(store.create(users[0]!,{name:'Paper',requestId:randomUUID()})).rejects.toMatchObject({statusCode:409});
  });
  it('SSE reports the confirmed SHA and reconnect reports the latest head without source bytes',async()=>{
    const controller=new AbortController();const response=await fetch(`${address}/projects/${project.id}/events`,{headers:{Authorization:`Bearer ${users[1]!.id}`},signal:controller.signal});
    const reader=response.body!.getReader(),decoder=new TextDecoder();
    try{
      const first=decoder.decode((await reader.read()).value);expect(first).toContain('event: ready');expect(first).toContain(sha(1));
      const {ticket}=await prepare(0,0,sha(500));await store.attach(project.id,users[0]!.id,ticket.requestId,sha(2));pushed(ticket,sha(2));await store.confirm(project.id,users[0]!.id,ticket.requestId);
      let changed='';for(let n=0;n<5&&!changed.includes(sha(2));n++)changed+=decoder.decode((await reader.read()).value);
      expect(changed).toContain('event: changed');expect(changed).toContain(sha(2));expect(changed).not.toContain('content');
    }finally{controller.abort();await reader.cancel().catch(()=>undefined);}
    const reconnect=new AbortController();const stream=await fetch(`${address}/projects/${project.id}/events`,{headers:{Authorization:`Bearer ${users[1]!.id}`},signal:reconnect.signal});const fresh=stream.body!.getReader();
    try{expect(decoder.decode((await fresh.read()).value)).toContain(sha(2));}finally{reconnect.abort();await fresh.cancel().catch(()=>undefined);}
  });
  it('requires explicit legacy ownership proof and preserves source, binary resources and every readable revision',async()=>{
    const legacyId=randomUUID(),legacyProject=randomUUID(),fileId=randomUUID(),assetId=randomUUID();
    await pool.query('insert into collaboration.profiles(id,email,display_name) values($1,$2,$3)',[legacyId,users[0]!.email,'Old account']);
    await pool.query(`insert into collaboration.projects(id,name,owner_id) values($1,'Legacy', $2)`,[legacyProject,legacyId]);await pool.query(`insert into collaboration.members values($1,$2,'owner')`,[legacyProject,legacyId]);
    await pool.query(`insert into collaboration.files(id,project_id,path,content) values($1,$2,'main.tex','Original')`,[fileId,legacyProject]);await pool.query(`insert into collaboration.files(project_id,path,content,encoding) values($1,'plot.png',$2,'base64')`,[legacyProject,assetId]);
    await pool.query(`insert into collaboration.revisions(file_id,version,content,author_id,request_id) values($1,1,'Earlier',$2,$3)`,[fileId,legacyId,randomUUID()]);
    const bytes=Buffer.from([0,255,1]);const legacy=new LegacyMigration(store,{auth:{signInWithOtp:()=>Promise.resolve({error:null}),verifyOtp:input=>Promise.resolve({error:input.token==='123456'?null:'invalid',data:{user:input.token==='123456'?{id:legacyId}:null}})}},{read:()=>Promise.resolve(bytes),upload:()=>Promise.resolve(),remove:()=>Promise.resolve()});
    expect(await legacy.projects(users[0]!)).toEqual([]);await expect(legacy.link(users[0]!,users[0]!.email,'wrong')).rejects.toMatchObject({statusCode:401});
    await legacy.link(users[0]!,users[0]!.email,'123456');
    vi.spyOn(store,'create').mockImplementation(()=>Promise.resolve(project));
    const requestId=randomUUID();const exported=await legacy.export(users[0]!,legacyProject,requestId);expect(exported.files).toEqual(expect.arrayContaining([{path:'main.tex',content:'Original',encoding:'utf8'},{path:'plot.png',content:bytes.toString('base64'),encoding:'base64'}]));
    expect(exported.files.some(f=>f.path.startsWith('legacy-history-')&&f.content.includes('Earlier'))).toBe(true);
    expect((await legacy.export(users[0]!,legacyProject,requestId)).files).toEqual(exported.files);
    expect((await pool.query<{content:string}>('select content from collaboration.files where id=$1',[fileId])).rows[0]!.content).toBe('Original');
    expect(JSON.stringify((await pool.query('select manifest from collaboration.github_migrations')).rows)).not.toContain('Earlier');
  });
  it('rotates expiring GitHub user credentials and rejects expired refresh credentials',async()=>{
    const session=await pool.query<{token_hash:string}>('select token_hash from collaboration.github_sessions where user_id=$1',[users[0]!.id]);
    await pool.query('update collaboration.github_sessions set credentials=$2 where token_hash=$1',[session.rows[0]!.token_hash,auth.box.seal({access_token:'old',refresh_token:'github-refresh',expiresAt:0})]);
    const oauth=vi.spyOn(github,'oauth').mockResolvedValue({access_token:'alice',refresh_token:'next-refresh',expiresAt:Date.now()+900000});
    expect(await auth.verify(users[0]!.id)).toMatchObject({githubId:'10'});expect(oauth).toHaveBeenCalledWith({grant_type:'refresh_token',refresh_token:'github-refresh'});
    await pool.query('update collaboration.github_sessions set expires_at=now()-interval \'1 second\' where user_id=$1',[users[0]!.id]);
    expect((await app.inject({method:'POST',url:'/auth/refresh',payload:{refreshToken:`refresh-${users[0]!.id}`}})).statusCode).toBe(401);
  });
  it('requires GitHub and desktop PKCE state, rejects replay, refreshes application session and handles revocation',async()=>{
    const verifier=randomBytes(32).toString('base64url'),challenge=createHash('sha256').update(verifier).digest('base64url');
    vi.spyOn(github,'oauth').mockResolvedValue({access_token:'alice',expiresAt:Date.now()+900000});
    const start=await app.inject({method:'POST',url:'/auth/github/start',payload:{returnUrl:'http://127.0.0.1:5555/auth/callback/'+ 'a'.repeat(48),challenge}});
    const v=start.json<{state:string;url:string}>();expect(new URL(v.url).searchParams.get('code_challenge_method')).toBe('S256');
    expect((await app.inject({url:'/auth/github/callback?state=invalid-state-that-has-enough-characters&code=x'})).statusCode).toBe(400);
    const callback=await app.inject({url:`/auth/github/callback?state=${v.state}&code=github-code`});expect(callback.statusCode).toBe(302);const target=new URL(String(callback.headers.location));
    const proof={state:v.state,code:target.searchParams.get('code')!,verifier};
    expect((await app.inject({method:'POST',url:'/auth/github/exchange',payload:{...proof,verifier:'b'.repeat(43)}})).statusCode).toBe(401);
    const session=(await app.inject({method:'POST',url:'/auth/github/exchange',payload:proof})).json<{token:string;refreshToken:string}>();
    expect((await app.inject({method:'POST',url:'/auth/github/exchange',payload:proof})).statusCode).toBe(401);
    await pool.query('update collaboration.github_sessions set access_expires_at=now()-interval \'1 second\' where token_hash=$1',[hash(session.token)]);await expect(auth.verify(session.token)).rejects.toMatchObject({statusCode:401});
    const refreshed=await app.inject({method:'POST',url:'/auth/refresh',payload:{refreshToken:session.refreshToken}});expect(refreshed.statusCode).toBe(200);
    vi.spyOn(github,'user').mockRejectedValue(new ApiError(401,'Revoked'));
    await expect(auth.verify(refreshed.json<{token:string}>().token)).rejects.toMatchObject({statusCode:401});
  });
  it('reconciles signed repository webhooks after every owner session was revoked',async()=>{
    await pool.query('update collaboration.github_sessions set revoked=true');
    const credentials=vi.spyOn(auth,'credentials');
    const installation=vi.spyOn(github,'gitToken');
    head=sha(2);trees.set(head,[{path:'main.tex',sha:sha(900),mode:'100644',type:'blob'}]);
    const payload=JSON.stringify({repository:{id:repo.id,name:repo.name,owner:{login:repo.owner.login}}});
    const signature=`sha256=${createHmac('sha256',config.webhookSecret).update(payload).digest('hex')}`;
    const response=await app.inject({method:'POST',url:'/github/webhook',headers:{'content-type':'application/json','x-github-event':'push','x-hub-signature-256':signature},payload});
    expect(response.statusCode).toBe(200);
    expect((await store.row(project.id)).head_sha).toBe(head);
    expect(credentials).not.toHaveBeenCalled();
    expect(installation).toHaveBeenCalledWith(expect.objectContaining({id:repo.id}),false);
  });
  it('authenticates webhook bytes and revokes sessions on GitHub authorization removal',async()=>{
    const payload=JSON.stringify({action:'revoked',sender:{id:10}});const signature=`sha256=${createHmac('sha256',config.webhookSecret).update(payload).digest('hex')}`;
    expect((await app.inject({method:'POST',url:'/github/webhook',headers:{'content-type':'application/json','x-github-event':'github_app_authorization','x-hub-signature-256':'sha256=wrong'},payload})).statusCode).toBe(401);
    expect((await app.inject({method:'POST',url:'/github/webhook',headers:{'content-type':'application/json','x-github-event':'github_app_authorization','x-hub-signature-256':signature},payload})).statusCode).toBe(200);
    await expect(auth.verify(users[0]!.id)).rejects.toMatchObject({statusCode:401});
  });
});
