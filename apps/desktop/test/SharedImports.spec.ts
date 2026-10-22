import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AccountManager } from '../src/main/services/account/AccountManager';
import { SecureSessionStorage } from '../src/main/services/account/SecureSessionStorage';
import { CollaborationManager } from '../src/main/services/collaboration/CollaborationManager';
import { ArtifactRegistry } from '../src/main/services/compiler/ArtifactRegistry';

afterEach(()=>vi.restoreAllMocks());
const setup=async(role='editor',selected:string[]=[])=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'easy-latex-shared-import-'));
  const auth=new AccountManager({},new SecureSessionStorage('/unused',{available:()=>false,encrypt:()=>Buffer.alloc(0),decrypt:()=>''}),()=>Promise.resolve());
  vi.spyOn(auth,'accessToken').mockResolvedValue('test-token');
  const fetcher=vi.spyOn(globalThis,'fetch').mockImplementation((_url,options)=>Promise.resolve(new Response(JSON.stringify(options?.method==='POST'?['uploaded']:[{id:'project',name:'Paper',role}]),{status:200})));
  const choose=vi.fn(()=>Promise.resolve(selected));
  const manager=new CollaborationManager(auth,'http://127.0.0.1:4318',path.join(root,'state'),new ArtifactRegistry(),undefined,undefined,choose);
  return {root,fetcher,choose,manager};
};
describe('Shared project uploads',()=>{
  it('uploads source, attachment and empty folder paths without changing the selected files',async()=>{
    const {root,fetcher,manager}=await setup();
    try {
      const folder=path.join(root,'figures');await mkdir(path.join(folder,'empty'),{recursive:true});await writeFile(path.join(folder,'notes.tex'),'Notes');const bytes=Buffer.from([1,2,3]);await writeFile(path.join(folder,'plot.png'),bytes);
      await writeFile(path.join(folder,'notes.lof'),'Generated list');
      await writeFile(path.join(folder,'notes.lot'),'Generated list');
      await writeFile(path.join(folder,'notes.toc'),'Generated list');
      // Verify the filesystem import plan at the publication boundary, without uploading content to an API.
      const publish=vi.spyOn(manager as unknown as {add(id:string,files:unknown[],directories:string[]):Promise<string[]>},'add').mockResolvedValue(['uploaded']);
      expect(await manager.importDropped('project',[folder],'assets')).toEqual(['uploaded']);
      expect(publish).toHaveBeenCalledWith('project',[{path:'assets/figures/notes.tex',content:'Notes',encoding:'utf8'},{path:'assets/figures/plot.png',content:bytes.toString('base64'),encoding:'base64'}],['assets/figures','assets/figures/empty']);
      expect(fetcher.mock.calls.some(([,o])=>o?.method==='POST')).toBe(false);
      expect(await readFile(path.join(folder,'plot.png'))).toEqual(bytes);
      expect(await readFile(path.join(folder,'notes.lof'),'utf8')).toBe('Generated list');
    } finally {await rm(root,{recursive:true,force:true});}
  });
  it('returns cancellation without uploading and checks permissions before opening the picker',async()=>{
    const {root,fetcher,choose,manager}=await setup('viewer');
    try {await expect(manager.importFiles('project','')).rejects.toThrow('permission');expect(choose).not.toHaveBeenCalled();expect(fetcher.mock.calls.some(([,o])=>o?.method==='POST')).toBe(false);} finally {await rm(root,{recursive:true,force:true});}
  });
  it('cancels the file picker without a mutation',async()=>{
    const {root,fetcher,choose,manager}=await setup();
    try {expect(await manager.importFiles('project','')).toEqual([]);expect(choose).toHaveBeenCalledWith('files');expect(fetcher.mock.calls.some(([,o])=>o?.method==='POST')).toBe(false);} finally {await rm(root,{recursive:true,force:true});}
  });
  it('rejects traversal, unsupported files and symlinks before uploading',async()=>{
    const {root,fetcher,manager}=await setup();
    try {
      const source=path.join(root,'notes.tex');await writeFile(source,'Notes');await writeFile(path.join(root,'bad.exe'),'Bad');await symlink(source,path.join(root,'link.tex'));
      await expect(manager.importDropped('project',[source],'../escape')).rejects.toThrow('Invalid project path');
      await expect(manager.importDropped('project',[path.join(root,'bad.exe')],'')).rejects.toThrow('Invalid source file path');
      await expect(manager.importDropped('project',[path.join(root,'link.tex')],'')).rejects.toThrow('Symbolic links');
      expect(fetcher.mock.calls.some(([,o])=>o?.method==='POST')).toBe(false);
    } finally {await rm(root,{recursive:true,force:true});}
  });
});
