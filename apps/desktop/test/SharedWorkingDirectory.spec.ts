import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { SharedFile } from '@easy-latex/shared-types';
import { SharedWorkingDirectory } from '../src/main/services/collaboration/SharedWorkingDirectory';

const roots: string[] = [];
afterEach(async()=>{for(const root of roots.splice(0))await rm(root,{recursive:true,force:true});});
const file=(name='main.tex',content='Published'):SharedFile=>({id:name,projectId:'project',path:name,content,version:1,encoding:'utf8',editor:null,updatedAt:'today'});
const setup=async()=>{
  const root=await realpath(await mkdtemp(path.join(os.tmpdir(),'easy-latex-working-')));roots.push(root);
  const folder=path.join(root,'Paper');await mkdir(folder);
  const working=new SharedWorkingDirectory(folder,path.join(root,'state','manifest.json'));
  const sync=(files:SharedFile[],dirs:string[]=[],protectedPaths=new Set<string>())=>working.synchronize(files,dirs,protectedPaths,()=>{});
  return {root,folder,working,sync};
};
describe('Shared project files on disk',()=>{
  it('replaces outside edits on every open and writes text, resource bytes and empty folders in the project folder',async()=>{
    const {folder,sync}=await setup();
    const image=Buffer.from([0,255,1]);
    const files=[file(),{...file('figures/plot.png',image.toString('base64')),encoding:'base64' as const}];
    await sync(files,['figures','chapters/empty']);
    await writeFile(path.join(folder,'main.tex'),'Changed in VS Code');
    await sync(files,['figures','chapters/empty']);
    expect(await readFile(path.join(folder,'main.tex'),'utf8')).toBe('Published');
    expect(await readFile(path.join(folder,'figures/plot.png'))).toEqual(image);
    await writeFile(path.join(folder,'chapters/empty/probe.txt'),'exists');
  });
  it('updates other files without replacing the file whose local Edit session is active',async()=>{
    const {folder,working,sync}=await setup();
    await sync([file(),file('chapter.tex','Old chapter')]);
    await working.write('main.tex',Buffer.from('My current writing'),()=>{});
    await sync([file(),file('chapter.tex','New chapter')],[],new Set(['main.tex']));
    expect(await readFile(path.join(folder,'main.tex'),'utf8')).toBe('My current writing');
    expect(await readFile(path.join(folder,'chapter.tex'),'utf8')).toBe('New chapter');
    await sync([file('main.tex','Confirmed writing'),file('chapter.tex','New chapter')]);
    expect(await readFile(path.join(folder,'main.tex'),'utf8')).toBe('Confirmed writing');
  });
  it('removes previously published files deleted on GitHub and preserves unrelated files and existing Git configuration',async()=>{
    const {folder,sync}=await setup();
    await mkdir(path.join(folder,'.git'));await writeFile(path.join(folder,'.git/config'),'User Git config');
    await writeFile(path.join(folder,'private-notes.txt'),'Local only');
    await sync([file(),file('old.tex')]);await writeFile(path.join(folder,'old.tex'),'Outside modification');
    await sync([file()]);
    await expect(readFile(path.join(folder,'old.tex'))).rejects.toMatchObject({code:'ENOENT'});
    expect(await readFile(path.join(folder,'private-notes.txt'),'utf8')).toBe('Local only');
    expect(await readFile(path.join(folder,'.git/config'),'utf8')).toBe('User Git config');
  });
  it('rejects unsafe paths and symlinks instead of writing outside the project',async()=>{
    const {root,folder,sync}=await setup();
    const outside=path.join(root,'outside');await mkdir(outside);await writeFile(path.join(outside,'main.tex'),'Do not touch');
    await symlink(outside,path.join(folder,'chapters'));
    await expect(sync([file('chapters/main.tex')])).rejects.toThrow('symbolic link');
    await expect(sync([file('../outside/main.tex')])).rejects.toThrow('Invalid project path');
    await expect(sync([file('.GIT/config.txt')])).rejects.toThrow('Invalid project path');
    await symlink(path.join(outside,'main.tex'),path.join(folder,'main.tex'));
    await expect(sync([file()])).rejects.toThrow('symbolic link');
    expect(await readFile(path.join(outside,'main.tex'),'utf8')).toBe('Do not touch');
  });
  it('stops replacing source if the account/session changes during synchronization',async()=>{
    const {folder,working,sync}=await setup();await sync([file()]);
    await expect(working.write('main.tex',Buffer.from('Wrong account'),()=>{throw new Error('Account changed');})).rejects.toThrow('Account changed');
    expect(await readFile(path.join(folder,'main.tex'),'utf8')).toBe('Published');
  });
});
