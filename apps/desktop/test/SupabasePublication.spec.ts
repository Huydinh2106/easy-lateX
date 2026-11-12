import { mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import type { AccountState, DoneInput, SharedFile } from '@easy-latex/shared-types';
import { CollaborationManager } from '../src/main/services/collaboration/CollaborationManager';
import { AccountManager } from '../src/main/services/account/AccountManager';
import { SecureSessionStorage } from '../src/main/services/account/SecureSessionStorage';
import { ArtifactRegistry } from '../src/main/services/compiler/ArtifactRegistry';
import { ProjectLinks } from '../src/main/services/collaboration/ProjectLinks';

const apiUrl='https://fixture.supabase.co/functions/v1/easy-latex-api';
const alternateApiUrl='https://other-fixture.supabase.co/functions/v1/easy-latex-api';
const apiPrefix='/functions/v1/easy-latex-api';
const projectId='11111111-1111-4111-8111-111111111111';
const fileId='22222222-2222-4222-8222-222222222222';
const input:DoneInput={fileId,token:'33333333-3333-4333-8333-333333333333',baseVersion:1,requestId:'44444444-4444-4444-8444-444444444444',content:'Edited'};
const signedIn:AccountState={configured:true,googleEnabled:false,recovery:false,account:{id:'alice',email:'alice@example.test',displayName:'Alice'}};
interface Call { route:string; method:string; body:unknown; url:string; authorization:string|null; }
type DoneBody=Omit<DoneInput,'fileId'>;
let root:string,cloudFiles:SharedFile[],cloudDirectories:string[],account:AccountState;
let calls:Call[],mutations:number,loseNextDoneResponse:boolean,failNextFiles:boolean,failNextDone:boolean;
let holdNextFiles:boolean,finishFiles:((response:Response)=>void)|undefined;
let receipts:Map<string,{input:DoneBody;file:SharedFile}>;

const json=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status});
const latest=()=>cloudFiles.find(file=>file.id===fileId)!;
const doneCalls=()=>calls.filter(call=>call.route===`/files/${fileId}/done`);
const pendingPath=()=>path.join(root,'pending','alice',`${projectId}.json`);

beforeEach(async()=>{
  vi.resetAllMocks();
  root=await realpath(await mkdtemp(path.join(os.tmpdir(),'easy-latex-supabase-recovery-')));
  cloudFiles=[{id:fileId,projectId,path:'main.tex',content:'Original',encoding:'utf8',version:1,updatedAt:'2026-11-02T00:00:00Z',editor:null}];
  cloudDirectories=[];account=signedIn;calls=[];mutations=0;receipts=new Map();
  loseNextDoneResponse=false;failNextFiles=false;failNextDone=false;holdNextFiles=false;finishFiles=undefined;
  vi.spyOn(globalThis,'fetch').mockImplementation((url,options)=>{
    const href=typeof url==='string'?url:url instanceof URL?url.href:url.url;
    const route=new URL(href).pathname.slice(apiPrefix.length);
    const method=options?.method??'GET';
    const body:unknown=typeof options?.body==='string'?JSON.parse(options.body):null;
    calls.push({route,method,body,url:href,authorization:new Headers(options?.headers).get('Authorization')});
    if(route===`/projects/${projectId}/files`){
      if(failNextFiles){failNextFiles=false;return Promise.resolve(json({message:'Cloud synchronization unavailable'},503));}
      if(holdNextFiles){holdNextFiles=false;return new Promise<Response>(resolve=>{finishFiles=resolve;});}
      return Promise.resolve(json(cloudFiles));
    }
    if(route===`/projects/${projectId}/directories`)return Promise.resolve(json(cloudDirectories));
    if(route===`/files/${fileId}/edit`){
      const file={...latest(),editor:{id:'alice',displayName:'Alice',expiresAt:new Date(Date.now()+90_000).toISOString()}};
      cloudFiles=cloudFiles.map(row=>row.id===fileId?file:row);
      return Promise.resolve(json({token:input.token,expiresAt:file.editor.expiresAt,file}));
    }
    if(route===`/files/${fileId}/release`){cloudFiles=cloudFiles.map(file=>file.id===fileId?{...file,editor:null}:file);return Promise.resolve(json({ok:true}));}
    if(route===`/files/${fileId}/renew`)return Promise.resolve(json({expiresAt:new Date(Date.now()+90_000).toISOString()}));
    if(route===`/files/${fileId}/done`){
      const request=body as DoneBody;
      const previous=receipts.get(request.requestId);
      if(previous){
        return Promise.resolve(JSON.stringify(previous.input)===JSON.stringify(request)
          ?json(previous.file):json({message:'This request ID was already used for another update'},409));
      }
      if(failNextDone){failNextDone=false;return Promise.resolve(json({message:'Cloud save unavailable'},503));}
      if(!latest().editor||request.token!==input.token)return Promise.resolve(json({message:'Edit access has expired'},409));
      if(request.baseVersion!==latest().version)return Promise.resolve(json({message:'The file has a newer version'},409));
      const file={...latest(),content:request.content,version:latest().version+1,updatedAt:'2026-11-02T01:00:00Z',editor:null};
      cloudFiles=cloudFiles.map(row=>row.id===fileId?file:row);mutations++;receipts.set(request.requestId,{input:request,file});
      if(loseNextDoneResponse){loseNextDoneResponse=false;return Promise.reject(new Error('Response lost after cloud commit'));}
      return Promise.resolve(json(file));
    }
    throw new Error(`Unexpected cloud fixture route ${method} ${route}`);
  });
});
afterEach(async()=>{vi.restoreAllMocks();await rm(root,{recursive:true,force:true});});

const manager=(url=apiUrl)=>{
  const accounts=new AccountManager({url},new SecureSessionStorage('/unused',{available:()=>false,encrypt:()=>Buffer.alloc(0),decrypt:()=>''}),()=>Promise.resolve());
  vi.spyOn(accounts,'state').mockImplementation(()=>Promise.resolve(account));
  vi.spyOn(accounts,'accessToken').mockImplementation(()=>account.account?Promise.resolve('fixture-supabase-access-token'):Promise.reject(new Error('Please sign in')));
  return new CollaborationManager(accounts,url,root,new ArtifactRegistry());
};

describe('Supabase cloud transport and durable draft recovery',()=>{
  it('uses the original bound folder, shares concurrent snapshots and restores cloud content after reopening',async()=>{
    const folder=path.join(root,'My paper');await mkdir(folder);await writeFile(path.join(folder,'main.tex'),'Outside edit');
    await new ProjectLinks(path.join(root,'project-links.json')).bind(apiUrl,folder,projectId);
    const first=manager();
    const [snapshot,files,directories]=await Promise.all([first.snapshot(projectId),first.files(projectId),first.directories(projectId)]);
    expect(snapshot.workspacePath).toBe(folder);expect(files[0]!.content).toBe('Original');expect(directories).toEqual([]);
    expect(calls.filter(call=>call.route===`/projects/${projectId}/files`)).toHaveLength(1);
    expect(calls.filter(call=>call.route===`/projects/${projectId}/directories`)).toHaveLength(1);
    expect(await readFile(path.join(folder,'main.tex'),'utf8')).toBe('Original');
    await writeFile(path.join(folder,'main.tex'),'Outside edit again');
    await manager().snapshot(projectId);
    expect(await readFile(path.join(folder,'main.tex'),'utf8')).toBe('Original');
  });

  it('writes the active edit to the visible file and a recovery draft before saving content/version to the cloud',async()=>{
    const instance=manager(),snapshot=await instance.snapshot(projectId);
    await instance.acquire(fileId);await instance.saveDraft(projectId,'main.tex',input.content,1);
    expect(await readFile(path.join(snapshot.workspacePath,'main.tex'),'utf8')).toBe('Edited');
    expect(latest()).toMatchObject({content:'Original',version:1});expect(doneCalls()).toHaveLength(0);
    await instance.snapshot(projectId);
    expect(await readFile(path.join(snapshot.workspacePath,'main.tex'),'utf8')).toBe('Edited');
    expect(await instance.draft(projectId,'main.tex')).toEqual({content:'Edited',baseVersion:1});
    const result=await instance.done(input);
    expect(result).toMatchObject({content:'Edited',version:2,editor:null});expect(latest()).toMatchObject({content:'Edited',version:2});
    expect(doneCalls()).toHaveLength(1);
    expect(doneCalls()[0]!.body).toEqual({token:input.token,baseVersion:1,content:'Edited',requestId:input.requestId});
    expect(await readFile(path.join(snapshot.workspacePath,'main.tex'),'utf8')).toBe('Edited');
    await expect(readFile(pendingPath())).rejects.toMatchObject({code:'ENOENT'});
  });

  it('keeps disk content on failed synchronization and refreshes the cloud before granting Edit',async()=>{
    const instance=manager(),snapshot=await instance.snapshot(projectId);
    await writeFile(path.join(snapshot.workspacePath,'main.tex'),'Outside edit');failNextFiles=true;
    await expect(instance.acquire(fileId)).rejects.toThrow('Cloud synchronization unavailable');
    expect(calls.some(call=>call.route.endsWith('/edit'))).toBe(false);
    expect(await readFile(path.join(snapshot.workspacePath,'main.tex'),'utf8')).toBe('Outside edit');
    await instance.acquire(fileId);
    expect(await readFile(path.join(snapshot.workspacePath,'main.tex'),'utf8')).toBe('Original');
    expect(calls.at(-1)!.route).toBe(`/files/${fileId}/edit`);
  });

  it('keeps recovery drafts separate when an edit is released or the app restarts',async()=>{
    const instance=manager(),snapshot=await instance.snapshot(projectId);await instance.acquire(fileId);
    await instance.saveDraft(projectId,'main.tex','My unfinished work',1);await instance.release(fileId,input.token);
    expect(await readFile(path.join(snapshot.workspacePath,'main.tex'),'utf8')).toBe('Original');
    const restarted=manager();
    expect(await restarted.draft(projectId,'main.tex')).toEqual({content:'My unfinished work',baseVersion:1});
    expect((await restarted.snapshot(projectId)).files[0]!.content).toBe('Original');
    expect(await readFile(path.join(snapshot.workspacePath,'main.tex'),'utf8')).toBe('Original');
  });

  it('materializes text, binary attachments and empty directories directly from the cloud snapshot',async()=>{
    const bytes=Buffer.from([0,255,10,92,128]);
    cloudFiles=[{...latest(),content:'Tiếng Việt\n\\documentclass{article}'},
      {...latest(),id:'55555555-5555-4555-8555-555555555555',path:'figures/plot.png',encoding:'base64',content:bytes.toString('base64')}];
    cloudDirectories=['figures/empty'];
    const snapshot=await manager().snapshot(projectId);
    expect(await readFile(path.join(snapshot.workspacePath,'main.tex'),'utf8')).toBe('Tiếng Việt\n\\documentclass{article}');
    expect(await readFile(path.join(snapshot.workspacePath,'figures/plot.png'))).toEqual(bytes);
    expect(snapshot.directories).toEqual(['figures/empty']);
    expect((await stat(path.join(snapshot.workspacePath,'figures/empty'))).isDirectory()).toBe(true);
    expect(calls.every(call=>call.method==='GET')).toBe(true);
  });

  it('validates an entire cloud snapshot before replacing any visible source file',async()=>{
    const instance=manager(),snapshot=await instance.snapshot(projectId);
    await writeFile(path.join(snapshot.workspacePath,'main.tex'),'Local file');
    cloudFiles=[{...latest(),content:'New cloud content'}, {...latest(),id:'invalid',path:'../escape.tex',content:'Invalid'}];
    await expect(instance.snapshot(projectId)).rejects.toThrow('Invalid');
    expect(await readFile(path.join(snapshot.workspacePath,'main.tex'),'utf8')).toBe('Local file');
    await expect(readFile(path.join(snapshot.workspacePath,'../escape.tex'))).rejects.toMatchObject({code:'ENOENT'});
  });

  it('scopes recovery drafts to the backend, including after restart and switching back',async()=>{
    const instance=manager();await instance.saveDraft(projectId,'main.tex','Private original draft',1);
    instance.configure(alternateApiUrl);expect(await instance.draft(projectId,'main.tex')).toBeNull();
    await instance.saveDraft(projectId,'main.tex','Other backend draft',1);
    expect(await manager(alternateApiUrl).draft(projectId,'main.tex')).toEqual({content:'Other backend draft',baseVersion:1});
    instance.configure(apiUrl);expect(await instance.draft(projectId,'main.tex')).toEqual({content:'Private original draft',baseVersion:1});
  });

  it('keeps one account recovery drafts private from another signed-in account',async()=>{
    const instance=manager();await instance.saveDraft(projectId,'main.tex','Alice private draft',1);
    account={...signedIn,account:{id:'bob',email:'bob@example.test',displayName:'Bob'}};
    expect(await instance.draft(projectId,'main.tex')).toBeNull();
    await instance.saveDraft(projectId,'main.tex','Bob private draft',1);
    account=signedIn;expect(await instance.draft(projectId,'main.tex')).toEqual({content:'Alice private draft',baseVersion:1});
  });

  it('stops an in-flight snapshot after sign-out without writing stale responses into the folder',async()=>{
    const instance=manager(),snapshot=await instance.snapshot(projectId);
    await writeFile(path.join(snapshot.workspacePath,'main.tex'),'Outside edit');holdNextFiles=true;
    const pending=instance.snapshot(projectId),rejected=expect(pending).rejects.toThrow('Account or server changed');
    await vi.waitFor(()=>expect(finishFiles).toBeTypeOf('function'));
    account={...signedIn,account:null};instance.stopUpdates();finishFiles!(json([{...latest(),content:'Stale response'}]));await rejected;
    expect(await readFile(path.join(snapshot.workspacePath,'main.tex'),'utf8')).toBe('Outside edit');
  });

  it('recovers a committed cloud save after response loss and restart using the persisted request',async()=>{
    const first=manager();await first.snapshot(projectId);await first.acquire(fileId);await first.saveDraft(projectId,'main.tex',input.content,1);
    loseNextDoneResponse=true;await expect(first.done(input)).rejects.toThrow('Could not connect');
    expect(latest()).toMatchObject({content:'Edited',version:2});expect(mutations).toBe(1);
    expect(JSON.parse(await readFile(pendingPath(),'utf8'))).toEqual({input,path:'main.tex'});
    const restarted=manager();await restarted.snapshot(projectId);
    const result=await restarted.done({...input,token:'new-device-token',baseVersion:2,requestId:'66666666-6666-4666-8666-666666666666'});
    expect(result).toMatchObject({content:'Edited',version:2});expect(mutations).toBe(1);
    expect(doneCalls()).toHaveLength(2);expect(doneCalls()[1]!.body).toEqual(doneCalls()[0]!.body);
    await expect(readFile(pendingPath())).rejects.toMatchObject({code:'ENOENT'});
  });

  it('retains a failed cloud save for retry without advancing the content version twice',async()=>{
    const instance=manager();await instance.snapshot(projectId);await instance.acquire(fileId);await instance.saveDraft(projectId,'main.tex',input.content,1);
    failNextDone=true;await expect(instance.done(input)).rejects.toThrow('Cloud save unavailable');
    expect(mutations).toBe(0);expect(latest()).toMatchObject({content:'Original',version:1});
    expect(await instance.draft(projectId,'main.tex')).toEqual({content:'Edited',baseVersion:1});
    expect((await instance.done({...input,requestId:'77777777-7777-4777-8777-777777777777'})).version).toBe(2);
    expect(mutations).toBe(1);expect(doneCalls()[1]!.body).toEqual(doneCalls()[0]!.body);
  });

  it('sends authentication in headers and source content only to the cloud API save endpoint',async()=>{
    const instance=manager();await instance.snapshot(projectId);await instance.acquire(fileId);await instance.done(input);
    expect(calls.every(call=>call.url.startsWith(`${apiUrl}/`))).toBe(true);
    expect(calls.every(call=>call.authorization==='Bearer fixture-supabase-access-token')).toBe(true);
    expect(calls.every(call=>!call.url.includes('fixture-supabase-access-token'))).toBe(true);
    expect(calls.filter(call=>call.body&&JSON.stringify(call.body).includes('Edited')).map(call=>call.route)).toEqual([`/files/${fileId}/done`]);
  });
});
