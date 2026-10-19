import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SharedProjectInput, SharedProject } from '@easy-latex/shared-types';
import { AccountManager } from '../src/main/services/account/AccountManager';
import { SecureSessionStorage } from '../src/main/services/account/SecureSessionStorage';
import { CollaborationManager } from '../src/main/services/collaboration/CollaborationManager';
import { ArtifactRegistry } from '../src/main/services/compiler/ArtifactRegistry';
const shared={id:'11111111-1111-4111-8111-111111111111',name:'Paper',role:'owner'};
afterEach(()=>vi.restoreAllMocks());
const account=()=>new AccountManager({},new SecureSessionStorage('/unused',{available:()=>false,encrypt:()=>Buffer.alloc(0),decrypt:()=>''}),()=>Promise.resolve());
const authenticated=()=>{const auth=account();vi.spyOn(auth,'installation').mockResolvedValue();vi.spyOn(auth,'accessToken').mockResolvedValue('test-token');vi.spyOn(auth,'state').mockResolvedValue({configured:true,googleEnabled:false,recovery:false,account:{id:'alice',email:'alice@example.test',displayName:'Alice'}});return auth;};
const json=(value:unknown)=>Promise.resolve(new Response(JSON.stringify(value),{status:200}));
const setup=async()=>{const root=await realpath(await mkdtemp(path.join(os.tmpdir(),'easy-latex-share-current-')));const source=path.join(root,'Paper');await mkdir(source);await writeFile(path.join(source,'main.tex'),'Original');return {root,source};};
describe('Enable collaboration on the open project',()=>{
  it('omits generated contents, figure and table lists without deleting local files',async()=>{
    const {root,source}=await setup();
    try {
      const generated=['thesis.lof','thesis.lot','thesis.toc'];
      for(const name of generated)await writeFile(path.join(source,name),'Generated list');
      const fetcher=vi.spyOn(globalThis,'fetch').mockImplementation((_url,options)=>json(options?.method==='POST'?shared:[]));
      const manager=new CollaborationManager(authenticated(),'http://127.0.0.1:4318',path.join(root,'state'),new ArtifactRegistry(),undefined,()=>source);
      vi.spyOn(manager,'create').mockImplementation(input=>{fetcher.mock.calls.push(['http://127.0.0.1:4318/projects',{method:'POST',body:JSON.stringify(input)}]);return Promise.resolve(shared as SharedProject);});
      expect((await manager.shareCurrentProject()).id).toBe(shared.id);
      const options=fetcher.mock.calls.find(([,options])=>options?.method==='POST')![1]!;
      const body=JSON.parse(options.body as string) as SharedProjectInput;
      expect(body.files).toEqual([{path:'main.tex',content:'Original',encoding:'utf8'}]);
      for(const name of generated)expect(await readFile(path.join(source,name),'utf8')).toBe('Generated list');
    }finally{await rm(root,{recursive:true,force:true});}
  });
  it('uses the trusted current folder and preserves text, attachments and original files',async()=>{
    const {root,source}=await setup();
    try {
      const image=Buffer.from([1,2,3,4]);
      await mkdir(path.join(source,'figures'));await writeFile(path.join(source,'figures','plot.png'),image);await writeFile(path.join(source,'.gitignore'),'ignored');
      const fetcher=vi.spyOn(globalThis,'fetch').mockImplementation((_url,options)=>json(options?.method==='POST'?shared:[]));
      const choose=vi.fn(()=>Promise.resolve(null));
      const manager=new CollaborationManager(authenticated(),'http://127.0.0.1:4318',path.join(root,'state'),new ArtifactRegistry(),choose,()=>source);
      vi.spyOn(manager,'create').mockImplementation(input=>{fetcher.mock.calls.push(['http://127.0.0.1:4318/projects',{method:'POST',body:JSON.stringify(input)}]);return Promise.resolve(shared as SharedProject);});
      expect((await manager.shareCurrentProject()).id).toBe(shared.id);expect(choose).not.toHaveBeenCalled();
      const [url,options]=fetcher.mock.calls.find(([,options])=>options?.method==='POST')!;expect(url).toBe('http://127.0.0.1:4318/projects');
      if(typeof options?.body!=='string')throw new Error('Expected a JSON request body');
      const body=JSON.parse(options.body) as SharedProjectInput;
      expect(body.requestId).toMatch(/^[0-9a-f-]{36}$/);
      expect(body.files).toEqual(expect.arrayContaining([{path:'main.tex',content:'Original',encoding:'utf8'},{path:'figures/plot.png',content:image.toString('base64'),encoding:'base64'}]));
      expect(body.files).toHaveLength(2);expect(await readFile(path.join(source,'main.tex'),'utf8')).toBe('Original');expect(await readFile(path.join(source,'figures','plot.png'))).toEqual(image);
      expect(await manager.links()).toEqual([{workspacePath:source,projectId:shared.id}]);
    } finally {await rm(root,{recursive:true,force:true});}
  });
  it('serializes activation, persists links and uses one stable identity after an uncertain response',async()=>{
    const {root,source}=await setup();
    try{
      let published=false;
      vi.spyOn(globalThis,'fetch').mockImplementation(()=>json(published?[shared]:[]));
      const make=()=>new CollaborationManager(authenticated(),'http://127.0.0.1:4318',path.join(root,'state'),new ArtifactRegistry(),undefined,()=>source);
      const first=make();let input:SharedProjectInput|undefined;
      vi.spyOn(first,'create').mockImplementation(v=>{input=v;return Promise.reject(new Error('Uncertain response'));});
      await expect(first.shareCurrentProject()).rejects.toThrow('Uncertain');
      const next=make();const create=vi.spyOn(next,'create').mockImplementation(v=>{expect(v.requestId).toBe(input?.requestId);published=true;return Promise.resolve(shared as SharedProject);});
      await Promise.all([next.shareCurrentProject(),next.shareCurrentProject()]);expect(create).toHaveBeenCalledTimes(1);
      await writeFile(path.join(source,'main.tex'),'Changed original');
      expect((await make().shareCurrentProject()).id).toBe(shared.id);
      expect(await readFile(path.join(source,'main.tex'),'utf8')).toBe('Changed original');
      published=false;await expect(make().shareCurrentProject()).rejects.toThrow('account that has access');
    }finally{await rm(root,{recursive:true,force:true});}
  });
  it('requires authentication before reading the current folder or publishing',async()=>{
    const auth=account();const current=vi.fn(()=>'/private-project');const fetcher=vi.spyOn(globalThis,'fetch');
    const manager=new CollaborationManager(auth,'http://127.0.0.1:4318','/unused',new ArtifactRegistry(),undefined,current);
    await expect(manager.shareCurrentProject()).rejects.toThrow('Please sign in');expect(current).not.toHaveBeenCalled();expect(fetcher).not.toHaveBeenCalled();
  });
});
