import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import type * as GitCheckoutModule from '../src/main/services/collaboration/GitCheckout';
import type { AccountState, GitFileMetadata, PublishTicket, SharedProject } from '@easy-latex/shared-types';
const git=vi.hoisted(()=>({matches:vi.fn(),initialize:vi.fn(),fetch:vi.fn(),materialize:vi.fn(),readBlob:vi.fn(),contains:vi.fn(),commit:vi.fn(),push:vi.fn(),receipt:vi.fn(),saveReceipt:vi.fn()}));
vi.mock('../src/main/services/collaboration/GitCheckout',async importOriginal=>{
  const original=await importOriginal<typeof GitCheckoutModule>();
  return {...original,GitCheckout:class {
    root='/mock-checkout';account={id:'alice'};
    matches=git.matches;initialize=git.initialize;fetch=git.fetch;materialize=git.materialize;readBlob=git.readBlob;contains=git.contains;commit=git.commit;push=git.push;receipt=git.receipt;saveReceipt=git.saveReceipt;
  }};
});
import { CollaborationManager } from '../src/main/services/collaboration/CollaborationManager';
import { AccountManager } from '../src/main/services/account/AccountManager';
import { SecureSessionStorage } from '../src/main/services/account/SecureSessionStorage';
import { ArtifactRegistry } from '../src/main/services/compiler/ArtifactRegistry';
import { gitBlobSha } from '../src/main/services/collaboration/GitCheckout';
import { ProjectLinks } from '../src/main/services/collaboration/ProjectLinks';
const projectId='11111111-1111-4111-8111-111111111111',fileId='22222222-2222-4222-8222-222222222222';
const oldSha='1'.repeat(40),newSha='2'.repeat(40);
const state:AccountState={configured:true,googleEnabled:false,recovery:false,account:{id:'alice',githubId:'42',githubLogin:'alice',email:'alice@users.noreply.github.com',displayName:'Alice'}};
let root:string,head:string,ticket:PublishTicket|null,file:GitFileMetadata,failConfirmation:boolean,blockedTurns:number;
let calls:{route:string;body:unknown}[]=[];
beforeEach(async()=>{
  vi.resetAllMocks();root=await realpath(await mkdtemp(path.join(os.tmpdir(),'easy-latex-publication-test-')));head=oldSha;ticket=null;failConfirmation=false;blockedTurns=0;calls=[];
  file={id:fileId,projectId,path:'main.tex',blobSha:gitBlobSha(Buffer.from('Original')),encoding:'utf8',version:1,updatedAt:'today',editor:null};
  git.matches.mockResolvedValue(true);git.initialize.mockResolvedValue(undefined);git.materialize.mockResolvedValue('/mock-checkout');git.fetch.mockImplementation(()=>Promise.resolve(head));git.commit.mockResolvedValue(newSha);git.contains.mockResolvedValue(true);git.receipt.mockResolvedValue(null);git.saveReceipt.mockResolvedValue(undefined);
  git.readBlob.mockImplementation(()=>Promise.resolve(Buffer.from(file.version===1?'Original':'Edited')));
  git.push.mockImplementation(()=>{head=newSha;return Promise.resolve();});
  vi.spyOn(globalThis,'fetch').mockImplementation((url,options)=>{
    const route=new URL(typeof url==='string'?url:url instanceof URL?url.href:url.url).pathname;
    const body=options?.body?JSON.parse(options.body as string) as unknown:null;calls.push({route,body});
    let value:unknown;
    if(route===`/projects/${projectId}`)value={id:projectId,name:'Paper',role:'owner',repository:{id:42,owner:'alice',name:'paper',branch:'main',head}} satisfies SharedProject;
    else if(route===`/projects/${projectId}/files`)value=[file];
    else if(route.endsWith('/publications')&&options?.method==='POST'){
      if(blockedTurns-->0)return Promise.resolve(new Response(JSON.stringify({message:'Another publication is in progress. Keep your draft and retry Done.'}),{status:409}));
      const input=body as Pick<PublishTicket,'requestId'|'changes'>;ticket={projectId,...input,baseSha:head,commitSha:null,status:'prepared',expiresAt:new Date(Date.now()+120000).toISOString()};value=ticket;
    }else if(route.endsWith('/commit')){ticket={...ticket!,commitSha:newSha,status:'pushing'};value=ticket;}
    else if(route.endsWith('/confirm')){
      if(failConfirmation){failConfirmation=false;return Promise.reject(new Error('API stopped after push'));}
      if(head!==newSha)return Promise.resolve(new Response(JSON.stringify({message:'Remote was not pushed'}),{status:409}));
      ticket={...ticket!,status:'confirmed'};file={...file,version:2,editor:null,blobSha:gitBlobSha(Buffer.from('Edited'))};value=ticket;
    }else if(route.includes('/publications/'))value=ticket;
    else if(route.endsWith('/edit')){file={...file,editor:{id:'alice',displayName:'Alice',expiresAt:new Date(Date.now()+90_000).toISOString()}};value={token:input.token,expiresAt:file.editor!.expiresAt,file};}
    else if(route.endsWith('/release')){file={...file,editor:null};value={ok:true};}
    else if(route.endsWith('/renew'))value={expiresAt:new Date(Date.now()+90_000).toISOString()};
    else throw new Error(`Unexpected fixture route ${route}`);
    return Promise.resolve(new Response(JSON.stringify(value),{status:200}));
  });
});
afterEach(async()=>{vi.restoreAllMocks();vi.useRealTimers();await rm(root,{recursive:true,force:true});});
const manager=()=>{
  const accounts=new AccountManager({},new SecureSessionStorage('/unused',{available:()=>false,encrypt:()=>Buffer.alloc(0),decrypt:()=>''}),()=>Promise.resolve());
  vi.spyOn(accounts,'state').mockResolvedValue(state);vi.spyOn(accounts,'accessToken').mockResolvedValue('private-app-token');
  return new CollaborationManager(accounts,'http://127.0.0.1:4318',root,new ArtifactRegistry());
};
const input={fileId,token:'33333333-3333-4333-8333-333333333333',baseVersion:1,requestId:'44444444-4444-4444-8444-444444444444',content:'Edited'};
describe('Desktop publication recovery with mocked Git transport/API',()=>{
  it('uses the original bound folder, shares concurrent snapshots and restores the GitHub version after reopening',async()=>{
    const folder=path.join(root,'My paper');await mkdir(folder);await writeFile(path.join(folder,'main.tex'),'Outside edit');
    await new ProjectLinks(path.join(root,'project-links.json')).bind('http://127.0.0.1:4318',folder,projectId);
    const first=manager();
    const [snapshot,files,dirs]=await Promise.all([first.snapshot(projectId),first.files(projectId),first.directories(projectId)]);
    expect(snapshot.workspacePath).toBe(folder);expect(files[0]!.content).toBe('Original');expect(dirs).toEqual([]);
    expect(calls.filter(call=>call.route.endsWith('/files'))).toHaveLength(1);
    expect(await readFile(path.join(folder,'main.tex'),'utf8')).toBe('Original');
    await writeFile(path.join(folder,'main.tex'),'Outside edit again');
    await manager().snapshot(projectId);
    expect(await readFile(path.join(folder,'main.tex'),'utf8')).toBe('Original');
  });
  it('saves an active edit into the visible file and a recovery draft, then updates it after confirmed Done',async()=>{
    const instance=manager();const snapshot=await instance.snapshot(projectId);
    await instance.acquire(fileId);await instance.saveDraft(projectId,'main.tex','Edited',1);
    expect(await readFile(path.join(snapshot.workspacePath,'main.tex'),'utf8')).toBe('Edited');
    await instance.snapshot(projectId);
    expect(await readFile(path.join(snapshot.workspacePath,'main.tex'),'utf8')).toBe('Edited');
    expect(await instance.draft(projectId,'main.tex')).toEqual({content:'Edited',baseVersion:1});
    await instance.done(input);
    expect(await readFile(path.join(snapshot.workspacePath,'main.tex'),'utf8')).toBe('Edited');
  });
  it('does not touch local files when synchronization fails and rechecks GitHub before granting Edit',async()=>{
    const instance=manager();const snapshot=await instance.snapshot(projectId);
    await writeFile(path.join(snapshot.workspacePath,'main.tex'),'Outside edit');
    git.fetch.mockRejectedValueOnce(new Error('Offline'));
    await expect(instance.acquire(fileId)).rejects.toThrow('Offline');
    expect(calls.some(call=>call.route.endsWith('/edit'))).toBe(false);
    expect(await readFile(path.join(snapshot.workspacePath,'main.tex'),'utf8')).toBe('Outside edit');
    await instance.acquire(fileId);
    expect(await readFile(path.join(snapshot.workspacePath,'main.tex'),'utf8')).toBe('Original');
  });
  it('keeps recovery drafts separate when a lease is released or the app restarts',async()=>{
    const instance=manager();const snapshot=await instance.snapshot(projectId);await instance.acquire(fileId);
    await instance.saveDraft(projectId,'main.tex','My unfinished work',1);
    await instance.release(fileId,input.token);
    expect(await readFile(path.join(snapshot.workspacePath,'main.tex'),'utf8')).toBe('Original');
    expect(await manager().draft(projectId,'main.tex')).toMatchObject({content:'My unfinished work'});
    await manager().snapshot(projectId);
    expect(await readFile(path.join(snapshot.workspacePath,'main.tex'),'utf8')).toBe('Original');
  });
  it('refuses mixed Git metadata instead of replacing a file with an inconsistent version',async()=>{
    const instance=manager();const snapshot=await instance.snapshot(projectId);
    await writeFile(path.join(snapshot.workspacePath,'main.tex'),'Local file');git.matches.mockResolvedValue(false);
    await expect(instance.snapshot(projectId)).rejects.toThrow('being published');
    expect(await readFile(path.join(snapshot.workspacePath,'main.tex'),'utf8')).toBe('Local file');
  });
  it('waits for another publication automatically with the same request ID and commits only once',async()=>{
    const instance=manager();await instance.snapshot(projectId);blockedTurns=1;
    vi.useFakeTimers({toFake:['setTimeout','clearTimeout']});
    const publishing=instance.done(input);
    await vi.waitFor(()=>expect(calls.filter(call=>call.route.endsWith('/publications'))).toHaveLength(1));
    await vi.advanceTimersByTimeAsync(1500);
    await publishing;
    const attempts=calls.filter(call=>call.route.endsWith('/publications'));
    expect(attempts).toHaveLength(2);expect(attempts[0]!.body).toEqual(attempts[1]!.body);
    expect(git.commit).toHaveBeenCalledTimes(1);expect(git.push).toHaveBeenCalledTimes(1);
  });
  it('scopes recovery drafts to the backend and returns to the original drafts when switching back',async()=>{
    const instance=manager();await instance.saveDraft(projectId,'main.tex','Private original draft',1);
    instance.configure('http://127.0.0.1:9999');
    expect(await instance.draft(projectId,'main.tex')).toBeNull();
    await instance.saveDraft(projectId,'main.tex','Other backend draft',1);
    instance.configure('http://127.0.0.1:4318');
    expect(await instance.draft(projectId,'main.tex')).toMatchObject({content:'Private original draft'});
  });
  it('stops an in-flight snapshot after sign-out instead of writing stale data into the folder',async()=>{
    const instance=manager();const snapshot=await instance.snapshot(projectId);await writeFile(path.join(snapshot.workspacePath,'main.tex'),'Outside edit');
    let finish!:(value:string)=>void;
    git.fetch.mockImplementationOnce(()=>new Promise<string>(resolve=>{finish=resolve;}));
    const pending=instance.snapshot(projectId);const rejected=expect(pending).rejects.toThrow('Account or server changed');
    await vi.waitFor(()=>expect(finish).toBeTypeOf('function'));
    instance.stopUpdates();finish(oldSha);await rejected;
    expect(await readFile(path.join(snapshot.workspacePath,'main.tex'),'utf8')).toBe('Outside edit');
  });
  it('recovers push success after API response loss and restart with the same commit and no source sent to the backend',async()=>{
    const first=manager();await first.files(projectId);failConfirmation=true;
    await expect(first.done(input)).rejects.toThrow('Could not connect');expect(git.commit).toHaveBeenCalledTimes(1);expect(git.push).toHaveBeenCalledTimes(1);
    const restarted=manager();await restarted.files(projectId);expect((await restarted.done(input)).content).toBe('Edited');
    expect(git.commit).toHaveBeenCalledTimes(1);expect(git.push).toHaveBeenCalledTimes(1);
    const prepare=calls.find(c=>c.route.endsWith('/publications'))!;expect(JSON.stringify(prepare.body)).not.toContain('Edited');expect(prepare.body).toMatchObject({changes:[{path:'main.tex',blobSha:gitBlobSha(Buffer.from('Edited')),encoding:'utf8'}]});
    expect(calls.every(c=>!c.route.includes('private-app-token'))).toBe(true);
  });
  it('retries a failed push with the bound commit and preserves its local intent',async()=>{
    const instance=manager();await instance.files(projectId);git.push.mockRejectedValueOnce(new Error('Push failed'));
    await expect(instance.done(input)).rejects.toThrow('Push failed');expect(ticket?.status).toBe('pushing');
    expect((await instance.done(input)).version).toBe(2);expect(git.commit).toHaveBeenCalledTimes(1);expect(git.push).toHaveBeenCalledTimes(2);
  });
});
