import { mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { GitCheckout, gitBlobSha } from '../src/main/services/collaboration/GitCheckout';
const user={id:'alice',email:'42+alice@users.noreply.github.com',displayName:'Alice',githubId:'42',githubLogin:'alice'};
const repo={id:123,owner:'alice',name:'paper',branch:'main',head:null};
describe('Desktop Git publication',()=>{
  it('commits only permitted blobs, preserves resources, creates an immutable checkout and reuses a request commit',async()=>{
    const root=await mkdtemp(path.join(os.tmpdir(),'easy-latex-git-test-'));
    try{
      const checkout=new GitCheckout(root,user,'project',repo,()=>Promise.reject(new Error('No network in this test')));await checkout.initialize();
      const image=Buffer.from([0,255,1,2]);
      const initial=await checkout.commit(null,[{path:'main.tex',content:'Original'},{path:'figures/plot.png',content:image.toString('base64'),encoding:'base64'},{path:'empty/.gitkeep',content:''}],'request-1');
      const snapshot=await checkout.materialize(initial);expect(await readFile(path.join(snapshot,'main.tex'),'utf8')).toBe('Original');expect(await readFile(path.join(snapshot,'figures/plot.png'))).toEqual(image);
      const metadata=[{path:'main.tex',blobSha:gitBlobSha(Buffer.from('Original'))},{path:'figures/plot.png',blobSha:gitBlobSha(image)},{path:'empty/.gitkeep',blobSha:gitBlobSha(Buffer.alloc(0))}];
      expect(await checkout.matches(initial,metadata)).toBe(true);
      expect(await checkout.matches(initial,metadata.slice(1))).toBe(false);
      expect(await checkout.matches(initial,[...metadata.slice(1),{path:'main.tex',blobSha:gitBlobSha(Buffer.from('Stale'))}])).toBe(false);
      const second=await checkout.commit(initial,[{path:'main.tex',content:'Edited'}],'request-2');
      expect(await checkout.commit(initial,[{path:'main.tex',content:'Edited'}],'request-2')).toBe(second);
      const gitdir=path.join(checkout.root,'objects.git');
      expect(execFileSync('git',['--git-dir',gitdir,'diff-tree','--no-commit-id','--name-only','-r',initial,second],{encoding:'utf8'}).trim()).toBe('main.tex');
      expect(await checkout.readBlob(gitBlobSha(image))).toEqual(image);
      expect(await readFile(path.join(snapshot,'main.tex'),'utf8')).toBe('Original');
      const config=await readFile(path.join(gitdir,'config'),'utf8');expect(config).not.toContain('token');expect(config).not.toContain('Authorization');
      const bob=new GitCheckout(root,{...user,id:'bob'},'project',repo,()=>Promise.reject(new Error('No network')));expect(bob.root).not.toBe(checkout.root);
    }finally{await rm(root,{recursive:true,force:true});}
  });
});
