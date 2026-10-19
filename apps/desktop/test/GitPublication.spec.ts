import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import type * as GitCheckoutModule from '../src/main/services/collaboration/GitCheckout';
import type { AccountState, GitFileMetadata, PublishTicket, SharedProject } from '@easy-latex/shared-types';
const git=vi.hoisted(()=>({initialize:vi.fn(),fetch:vi.fn(),materialize:vi.fn(),readBlob:vi.fn(),contains:vi.fn(),commit:vi.fn(),push:vi.fn(),receipt:vi.fn(),saveReceipt:vi.fn()}));
vi.mock('../src/main/services/collaboration/GitCheckout',async importOriginal=>{
  const original=await importOriginal<typeof GitCheckoutModule>();
  return {...original,GitCheckout:class {
    root='/mock-checkout';account={id:'alice'};
    initialize=git.initialize;fetch=git.fetch;materialize=git.materialize;readBlob=git.readBlob;contains=git.contains;commit=git.commit;push=git.push;receipt=git.receipt;saveReceipt=git.saveReceipt;
  }};
});
import { CollaborationManager } from '../src/main/services/collaboration/CollaborationManager';
import { AccountManager } from '../src/main/services/account/AccountManager';
import { SecureSessionStorage } from '../src/main/services/account/SecureSessionStorage';
import { ArtifactRegistry } from '../src/main/services/compiler/ArtifactRegistry';
import { gitBlobSha } from '../src/main/services/collaboration/GitCheckout';
const projectId='11111111-1111-4111-8111-111111111111',fileId='22222222-2222-4222-8222-222222222222';
const oldSha='1'.repeat(40),newSha='2'.repeat(40);
const state:AccountState={configured:true,googleEnabled:false,recovery:false,account:{id:'alice',githubId:'42',githubLogin:'alice',email:'alice@users.noreply.github.com',displayName:'Alice'}};
let root:string,head:string,ticket:PublishTicket|null,file:GitFileMetadata,failConfirmation:boolean;
let calls:{route:string;body:unknown}[]=[];
beforeEach(async()=>{
  vi.resetAllMocks();root=await mkdtemp(path.join(os.tmpdir(),'easy-latex-publication-test-'));head=oldSha;ticket=null;failConfirmation=false;calls=[];
  file={id:fileId,projectId,path:'main.tex',blobSha:gitBlobSha(Buffer.from('Original')),encoding:'utf8',version:1,updatedAt:'today',editor:null};
  git.initialize.mockResolvedValue(undefined);git.materialize.mockResolvedValue('/mock-checkout');git.fetch.mockImplementation(()=>Promise.resolve(head));git.commit.mockResolvedValue(newSha);git.contains.mockResolvedValue(true);git.receipt.mockResolvedValue(null);git.saveReceipt.mockResolvedValue(undefined);
  git.readBlob.mockImplementation(()=>Promise.resolve(Buffer.from(file.version===1?'Original':'Edited')));
  git.push.mockImplementation(()=>{head=newSha;return Promise.resolve();});
  vi.spyOn(globalThis,'fetch').mockImplementation((url,options)=>{
    const route=new URL(typeof url==='string'?url:url instanceof URL?url.href:url.url).pathname;
    const body=options?.body?JSON.parse(options.body as string) as unknown:null;calls.push({route,body});
    let value:unknown;
    if(route===`/projects/${projectId}`)value={id:projectId,name:'Paper',role:'owner',repository:{id:42,owner:'alice',name:'paper',branch:'main',head}} satisfies SharedProject;
    else if(route===`/projects/${projectId}/files`)value=[file];
    else if(route.endsWith('/publications')&&options?.method==='POST'){
      const input=body as Pick<PublishTicket,'requestId'|'changes'>;ticket={projectId,...input,baseSha:head,commitSha:null,status:'prepared',expiresAt:new Date(Date.now()+120000).toISOString()};value=ticket;
    }else if(route.endsWith('/commit')){ticket={...ticket!,commitSha:newSha,status:'pushing'};value=ticket;}
    else if(route.endsWith('/confirm')){
      if(failConfirmation){failConfirmation=false;return Promise.reject(new Error('API stopped after push'));}
      if(head!==newSha)return Promise.resolve(new Response(JSON.stringify({message:'Remote was not pushed'}),{status:409}));
      ticket={...ticket!,status:'confirmed'};file={...file,version:2,blobSha:gitBlobSha(Buffer.from('Edited'))};value=ticket;
    }else if(route.includes('/publications/'))value=ticket;
    else throw new Error(`Unexpected fixture route ${route}`);
    return Promise.resolve(new Response(JSON.stringify(value),{status:200}));
  });
});
afterEach(async()=>{vi.restoreAllMocks();await rm(root,{recursive:true,force:true});});
const manager=()=>{
  const accounts=new AccountManager({},new SecureSessionStorage('/unused',{available:()=>false,encrypt:()=>Buffer.alloc(0),decrypt:()=>''}),()=>Promise.resolve());
  vi.spyOn(accounts,'state').mockResolvedValue(state);vi.spyOn(accounts,'accessToken').mockResolvedValue('private-app-token');
  return new CollaborationManager(accounts,'http://127.0.0.1:4318',root,new ArtifactRegistry());
};
const input={fileId,token:'33333333-3333-4333-8333-333333333333',baseVersion:1,requestId:'44444444-4444-4444-8444-444444444444',content:'Edited'};
describe('Desktop publication recovery with mocked Git transport/API',()=>{
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
