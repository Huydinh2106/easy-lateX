import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { config } from 'dotenv';
import { Pool } from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Account, EditLease, SharedFile, SharedProject } from '@easy-latex/shared-types';
import { ApiError, CollaborationStore, validateDirectoryPath, validateFilePath } from '../src/store';
import { createServer } from '../src/server';
import { createAssetStore } from '../src/assets';
import { GitWorker } from '../src/git-worker';
config({path:['../../.env.local','.env.local'],quiet:true});

describe('Shared source paths',()=>{
  it('rejects traversal, internal directories, non-source files and unsafe names',()=>{
    for(const p of ['../secret.tex','/secret.tex','x/../secret.tex','.git/a.tex','.easy-latex/a.tex','a\\b.tex','a//b.tex','a/CON.tex','image.exe','a\0.tex']) expect(()=>validateFilePath(p)).toThrow();
    expect(validateFilePath('chapters/tiếng Việt.tex')).toBe('chapters/tiếng Việt.tex');
    expect(validateDirectoryPath('figures/empty')).toBe('figures/empty');
    for(const p of ['../folder','/folder','.git','folder//child','folder/CON','folder\\child'])expect(()=>validateDirectoryPath(p)).toThrow();
  });
});

describe.skipIf(process.env.COLLABORATION_INTEGRATION!=='1')('PostgreSQL collaboration integration',()=>{
  const pool=new Pool({connectionString:process.env.DATABASE_URL,max:20});
  const assets=createAssetStore(process.env.EASY_LATEX_SUPABASE_URL??'http://127.0.0.1:54321',process.env.EASY_LATEX_SUPABASE_SERVICE_KEY??'test-key');
  const queue=randomUUID();
  const store=new CollaborationStore(pool,90,assets,queue);
  let users:Account[]=[];let project:SharedProject;let file:SharedFile;
  const app=createServer(store,token=>{const u=users.find(x=>x.id===token);if(!u)return Promise.reject(new ApiError(401,'Please sign in'));return Promise.resolve(u);});
  let address:string;
  beforeAll(async()=>{await pool.query('select 1');address=await app.listen({host:'127.0.0.1',port:0});});
  beforeEach(async()=>{
    users=['Owner','Editor','Reader','Outsider'].map(name=>({id:randomUUID(),email:`${name}-${randomUUID()}@example.test`,displayName:name}));
    for(const u of users){await pool.query(`insert into auth.users(id,email) values($1,$2)`,[u.id,u.email]);await store.profile(u);}
    project=await store.create(users[0]!,{name:'Collaboration integration'});
    await pool.query(`insert into collaboration.members values($1,$2,'editor'),($1,$3,'viewer')`,[project.id,users[1]!.id,users[2]!.id]);
    file=(await store.files(project.id,users[0]!.id))[0]!;
  });
  afterEach(async()=>{const keys=(await pool.query<{content:string}>("select content from collaboration.files where encoding='base64' and project_id in (select id from collaboration.projects where owner_id=any($1::uuid[]))",[users.map(x=>x.id)])).rows.map(x=>x.content);await assets.remove(keys);await pool.query('delete from collaboration.projects where owner_id=any($1::uuid[])',[users.map(x=>x.id)]);await pool.query('delete from auth.users where id=any($1::uuid[])',[users.map(x=>x.id)]);});
  afterAll(async()=>{await app.close();await pool.end();});
  it('pushes committed Done to every subscribed project member without sharing source in notifications',async()=>{
    const control=new AbortController();
    try {
      const denied=await fetch(`${address}/projects/${project.id}/events`,{headers:{Authorization:`Bearer ${users[3]!.id}`}});
      expect(denied.status).toBe(403);
      const stream=async(actor:Account)=>{
        const response=await fetch(`${address}/projects/${project.id}/events`,{headers:{Authorization:`Bearer ${actor.id}`},signal:AbortSignal.any([control.signal,AbortSignal.timeout(5000)])});
        expect(response.status).toBe(200);const reader=response.body!.getReader();const decoder=new TextDecoder();let buffer='';
        return async()=>{while(!buffer.includes('\n\n')){const chunk=await reader.read();if(chunk.done)throw new Error('Stream ended');buffer+=decoder.decode(chunk.value,{stream:true});}const end=buffer.indexOf('\n\n');const frame=buffer.slice(0,end);buffer=buffer.slice(end+2);return frame;};
      };
      const first=await stream(users[1]!);const second=await stream(users[2]!);
      expect(await first()).toContain('event: ready');expect(await second()).toContain('event: ready');
      const lease=await store.acquire(file.id,users[0]!.id);
      expect(await first()).toContain('event: changed');expect(await second()).toContain('event: changed');
      // Publish through another store instance: delivery must come from PostgreSQL, not a local route callback.
      const publisher=new CollaborationStore(pool,90,assets,queue);
      await publisher.done(users[0]!,{fileId:file.id,token:lease.token,baseVersion:1,content:'Committed source',requestId:randomUUID()});
      for(const next of [first,second]){
        const frame=await next();expect(frame).toContain(`data: ${JSON.stringify({projectId:project.id})}`);expect(frame).not.toContain('Committed source');
      }
      expect((await store.files(project.id,users[2]!.id))[0]).toMatchObject({version:2,content:'Committed source',editor:null});
    } finally { control.abort(); }
  });
  it('enables one project under concurrent creation and retries without overwriting published edits',async()=>{
    const requestId=randomUUID();const payload={name:'Converted project',requestId,files:[{path:'main.tex',content:'Imported'}]};
    const create=()=>app.inject({method:'POST',url:'/projects',headers:{authorization:`Bearer ${users[0]!.id}`},payload});
    const responses=await Promise.all([create(),create(),create()]);
    expect(responses.map(r=>r.statusCode)).toEqual([200,200,200]);
    const ids=responses.map(r=>r.json<SharedProject>().id);expect(new Set(ids).size).toBe(1);
    const id=ids[0]!;
    expect((await pool.query('select id from collaboration.projects where owner_id=$1 and creation_request_id=$2',[users[0]!.id,requestId])).rowCount).toBe(1);
    expect((await pool.query('select id from collaboration.git_jobs where project_id=$1',[id])).rowCount).toBe(1);
    const imported=(await store.files(id,users[0]!.id))[0]!;const lease=await store.acquire(imported.id,users[0]!.id);
    await store.done(users[0]!,{fileId:imported.id,token:lease.token,baseVersion:1,content:'Published later',requestId:randomUUID()});
    const retry=await create();expect(retry.json<SharedProject>().id).toBe(id);
    expect((await store.files(id,users[0]!.id))[0]).toMatchObject({content:'Published later',version:2});
    const anotherOwner=await store.create(users[1]!,payload);expect(anotherOwner.id).not.toBe(id);
  });
  it('grants Edit to exactly one concurrent caller and denies a second device of the same user',async()=>{
    const results=await Promise.allSettled([store.acquire(file.id,users[0]!.id),store.acquire(file.id,users[1]!.id)]);
    expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
    const winner=results.find(r=>r.status==='fulfilled') as PromiseFulfilledResult<EditLease>;
    await expect(store.acquire(file.id,winner.value.file.editor!.id)).rejects.toMatchObject({statusCode:409});
    expect((await store.files(project.id,users[2]!.id))[0]!.editor).not.toBeNull();
  });
  it('persists empty folders and imports sources and attachments for all members',async()=>{
    await store.createDirectory(project.id,users[1]!,'figures/empty');
    expect(await store.directories(project.id,users[2]!.id)).toEqual(['figures/empty']);
    const bytes=Buffer.from([1,2,3,4]);
    const response=await app.inject({method:'POST',url:`/projects/${project.id}/import`,headers:{authorization:`Bearer ${users[1]!.id}`},payload:{files:[{path:'chapters/intro.tex',content:'Introduction'},{path:'figures/plot.png',content:bytes.toString('base64'),encoding:'base64'}],directories:['chapters','chapters/empty']}});
    expect(response.statusCode).toBe(200);
    expect((await store.files(project.id,users[2]!.id)).map(f=>({path:f.path,content:f.content}))).toEqual(expect.arrayContaining([{path:'chapters/intro.tex',content:'Introduction'},{path:'figures/plot.png',content:bytes.toString('base64')}]));
    const reopened=await app.inject({url:`/projects/${project.id}/directories`,headers:{authorization:`Bearer ${users[2]!.id}`}});expect(reopened.json<string[]>()).toEqual(['chapters','chapters/empty','figures/empty']);
    const temp=await mkdtemp(path.join(os.tmpdir(),'easy-latex-upload-history-'));
    try {await new GitWorker(pool,temp,assets,queue).tick();expect(await readFile(path.join(temp,project.id,'figures/plot.png'))).toEqual(bytes);expect(await readFile(path.join(temp,project.id,'chapters/intro.tex'),'utf8')).toBe('Introduction');} finally {await rm(temp,{recursive:true,force:true});}
  });
  it('denies shared folder and upload mutations to viewers and outsiders',async()=>{
    for(const actor of [users[2]!,users[3]!]){
      expect((await app.inject({method:'POST',url:`/projects/${project.id}/directories`,headers:{authorization:`Bearer ${actor.id}`},payload:{path:'private'}})).statusCode).toBe(403);
      expect((await app.inject({method:'POST',url:`/projects/${project.id}/import`,headers:{authorization:`Bearer ${actor.id}`},payload:{files:[{path:'added.tex',content:'Blocked'}]}})).statusCode).toBe(403);
    }
    expect(await store.directories(project.id,users[0]!.id)).toEqual([]);expect(await store.files(project.id,users[0]!.id)).toHaveLength(1);
  });
  it('rejects conflicting uploads atomically and never replaces a file being edited',async()=>{
    const lease=await store.acquire(file.id,users[0]!.id);
    await expect(store.importEntries(project.id,users[1]!,[{path:'new.tex',content:'New'},{path:'main.tex',content:'Replacement'}],['new-folder'])).rejects.toMatchObject({statusCode:409});
    expect(await store.files(project.id,users[0]!.id)).toHaveLength(1);expect(await store.directories(project.id,users[0]!.id)).toEqual([]);
    expect((await store.files(project.id,users[0]!.id))[0]!.editor?.id).toBe(users[0]!.id);
    expect((await store.renew(file.id,users[0]!.id,lease.token)).expiresAt).toBeTruthy();
    await store.createDirectory(project.id,users[0]!,'reserved.tex/empty');
    await expect(store.createFile(project.id,users[1]!,'reserved.tex')).rejects.toMatchObject({statusCode:409});
    await expect(store.importEntries(project.id,users[1]!,[{path:'reserved.tex',content:'Conflict'}])).rejects.toMatchObject({statusCode:409});
    await expect(store.createDirectory(project.id,users[0]!,'main.tex/child')).rejects.toMatchObject({statusCode:409});
  });
  it('serializes concurrent uploads to the same path',async()=>{
    const results=await Promise.allSettled([store.importEntries(project.id,users[0]!,[{path:'race.tex',content:'Owner'}]),store.importEntries(project.id,users[1]!,[{path:'race.tex',content:'Editor'}])]);
    expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);expect((await store.files(project.id,users[2]!.id)).filter(f=>f.path==='race.tex')).toHaveLength(1);
  });
  it('validates size and encoding limits without leaving partial uploads',async()=>{
    await expect(store.importEntries(project.id,users[0]!,[{path:'large.tex',content:'x'.repeat(5*1024*1024+1)}],['discarded'])).rejects.toMatchObject({statusCode:400});
    await expect(store.importEntries(project.id,users[0]!,[{path:'image.png',content:'bad-base64',encoding:'base64'}])).rejects.toMatchObject({statusCode:400});
    await expect(store.importEntries(project.id,users[0]!,[{path:'source.tex',content:'dGVzdA==',encoding:'base64'}])).rejects.toMatchObject({statusCode:400});
    expect(await store.files(project.id,users[0]!.id)).toHaveLength(1);expect(await store.directories(project.id,users[0]!.id)).toEqual([]);
  });
  it('publishes Done atomically, exposes the version to viewers and hands Edit to the next user',async()=>{
    const l=await store.acquire(file.id,users[0]!.id);
    const saved=await store.done(users[0]!,{fileId:file.id,token:l.token,baseVersion:1,content:'Published',requestId:randomUUID()});
    expect(saved).toMatchObject({version:2,content:'Published',editor:null});
    expect((await store.files(project.id,users[2]!.id))[0]!.content).toBe('Published');
    const next=await store.acquire(file.id,users[1]!.id);expect(next.file.version).toBe(2);
  });
  it('fences out an expired editor and refuses expired heartbeat revival',async()=>{
    const old=await store.acquire(file.id,users[0]!.id);
    await pool.query(`update collaboration.leases set expires_at=clock_timestamp()-interval '1 second' where file_id=$1`,[file.id]);
    await expect(store.renew(file.id,users[0]!.id,old.token)).rejects.toMatchObject({statusCode:409});
    const next=await store.acquire(file.id,users[1]!.id);
    await expect(store.done(users[0]!,{fileId:file.id,token:old.token,baseVersion:1,content:'Stale write',requestId:randomUUID()})).rejects.toMatchObject({statusCode:409});
    await store.release(file.id,users[0]!.id,old.token);
    expect((await store.files(project.id,users[1]!.id))[0]!.editor?.id).toBe(users[1]!.id);
    expect((await store.renew(file.id,users[1]!.id,next.token)).expiresAt).toBeTruthy();
  });
  it('retries Done without another version, even after the next editor has published',async()=>{
    const l=await store.acquire(file.id,users[0]!.id);
    const request={fileId:file.id,token:l.token,baseVersion:1,content:'First',requestId:randomUUID()};
    await store.done(users[0]!,request);
    const next=await store.acquire(file.id,users[1]!.id);
    await store.done(users[1]!,{fileId:file.id,token:next.token,baseVersion:2,content:'Second',requestId:randomUUID()});
    expect(await store.done(users[0]!,request)).toMatchObject({content:'First',version:2});
    expect((await store.files(project.id,users[0]!.id))[0]!.content).toBe('Second');
    expect(await store.history(file.id,users[0]!.id)).toHaveLength(3);
    await expect(store.done(users[0]!,{...request,content:'Changed retry'})).rejects.toMatchObject({statusCode:409});
  });
  it('allows different files to be edited simultaneously and serializes their Git snapshots',async()=>{
    const second=await store.createFile(project.id,users[0]!,'chapters/intro.tex');
    const [a,b]=await Promise.all([store.acquire(file.id,users[0]!.id),store.acquire(second.id,users[1]!.id)]);
    await Promise.all([store.done(users[0]!,{fileId:file.id,token:a.token,baseVersion:1,content:'Main',requestId:randomUUID()}),store.done(users[1]!,{fileId:second.id,token:b.token,baseVersion:1,content:'Chapter',requestId:randomUUID()})]);
    const temp=await mkdtemp(path.join(os.tmpdir(),'easy-latex-history-'));
    try{
      const worker=new GitWorker(pool,temp,assets,queue);await worker.tick();await worker.tick();
      const repo=path.join(temp,project.id);
      expect(await readFile(path.join(repo,'main.tex'),'utf8')).toBe('Main');expect(await readFile(path.join(repo,'chapters/intro.tex'),'utf8')).toBe('Chapter');
      expect(Number(execFileSync('git',['rev-list','--count','HEAD'],{cwd:repo,encoding:'utf8'}).trim())).toBe(4);
      const last=(await pool.query<{id:string}>('select id::text from collaboration.git_jobs where project_id=$1 order by id desc limit 1',[project.id])).rows[0]!;
      await pool.query('update collaboration.git_jobs set completed_at=null where id=$1',[last.id]);await worker.tick();
      expect(Number(execFileSync('git',['rev-list','--count','HEAD'],{cwd:repo,encoding:'utf8'}).trim())).toBe(4);
      const pending=(await pool.query<{count:number}>('select count(*)::int as count from collaboration.git_jobs where project_id=$1 and completed_at is null',[project.id])).rows[0]!.count;expect(pending).toBe(0);
    }finally{await rm(temp,{recursive:true,force:true});}
  });
  it('rejects outdated base versions without releasing the current lease',async()=>{
    const l=await store.acquire(file.id,users[0]!.id);
    await expect(store.done(users[0]!,{fileId:file.id,token:l.token,baseVersion:9,content:'Wrong base',requestId:randomUUID()})).rejects.toMatchObject({statusCode:409});
    expect((await store.files(project.id,users[0]!.id))[0]!.editor?.id).toBe(users[0]!.id);
  });
  it('enforces authenticated project membership and view-only permissions through the HTTP API',async()=>{
    expect((await app.inject({url:'/projects'})).statusCode).toBe(401);
    expect((await app.inject({url:`/projects/${project.id}/files`,headers:{authorization:`Bearer ${users[3]!.id}`}})).statusCode).toBe(403);
    expect((await app.inject({method:'POST',url:`/files/${file.id}/edit`,headers:{authorization:`Bearer ${users[2]!.id}`},payload:{}})).statusCode).toBe(403);
    expect((await app.inject({method:'POST',url:`/files/${file.id}/done`,headers:{authorization:`Bearer ${users[0]!.id}`},payload:{token:randomUUID(),baseVersion:1,content:'Bad',requestId:randomUUID()}})).statusCode).toBe(409);
    expect((await app.inject({method:'POST',url:'/files/not-a-uuid/edit',headers:{authorization:`Bearer ${users[0]!.id}`},payload:{}})).statusCode).toBe(400);
  });
  it('accepts invitations only for the confirmed invited email',async()=>{
    await store.invite(project.id,users[0]!.id,users[3]!.email,'editor');const invitation=(await store.invitations(users[3]!.email))[0]!;
    await expect(store.accept(invitation.id,users[1]!)).rejects.toMatchObject({statusCode:404});
    await store.accept(invitation.id,users[3]!);expect((await store.projects(users[3]!.id))[0]!.role).toBe('editor');
    await expect(store.invite(project.id,users[1]!.id,'other@example.test','editor')).rejects.toMatchObject({statusCode:403});
  });
  it('stores attachments privately, materializes their bytes and records them in Git',async()=>{
    const bytes=Buffer.from([137,80,78,71,13,10,26,10]);
    const p=await store.create(users[0]!,{name:'Attachments',files:[{path:'main.tex',content:'Source'},{path:'figures/example.png',content:bytes.toString('base64'),encoding:'base64'}]});
    const files=await store.files(p.id,users[1]!.id).catch(()=>store.files(p.id,users[0]!.id));const attachment=files.find(f=>f.path.endsWith('.png'))!;
    expect(attachment.encoding).toBe('base64');expect(Buffer.from(attachment.content,'base64')).toEqual(bytes);
    await expect(store.acquire(attachment.id,users[0]!.id)).rejects.toMatchObject({statusCode:400});
    const temp=await mkdtemp(path.join(os.tmpdir(),'easy-latex-assets-'));try{await new GitWorker(pool,temp,assets,queue).tick();expect(await readFile(path.join(temp,p.id,'figures/example.png'))).toEqual(bytes);}finally{await rm(temp,{recursive:true,force:true});}
  });
  it('hides app tables from untrusted Supabase database roles',async()=>{
    const db=await pool.connect();try{await db.query('begin');await db.query('set local role authenticated');await expect(db.query('select * from collaboration.files')).rejects.toMatchObject({code:'42501'});}finally{await db.query('rollback');db.release();}
  });
});
