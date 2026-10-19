import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { CollaborationManager } from '../src/main/services/collaboration/CollaborationManager';
import { AccountManager } from '../src/main/services/account/AccountManager';
import { SecureSessionStorage } from '../src/main/services/account/SecureSessionStorage';
import { ArtifactRegistry } from '../src/main/services/compiler/ArtifactRegistry';

describe.runIf(process.env.EASY_LATEX_COMPILER_INTEGRATION === '1')('Shared project compilation',()=>{
  it('compiles a snapshot with a PDF attachment, cleans sources and preserves previews after failure',async()=>{
    const directory=await mkdtemp(path.join(os.tmpdir(),'easy-latex-shared-compile-'));
    try {
      const storage=new SecureSessionStorage(path.join(directory,'session'),{available:()=>false,encrypt:()=>Buffer.alloc(0),decrypt:()=>''});
      const account=new AccountManager({},storage,()=>Promise.resolve());
      const artifacts=new ArtifactRegistry();
      const manager=new CollaborationManager(account,undefined,directory,artifacts);
      const id=randomUUID();
      const first=await manager.compile(id,[{path:'main.tex',content:'\\documentclass{article}\n\\begin{document}Reference figure.\\end{document}'}],'main.tex','pdflatex');
      expect(first.success,first.log.slice(-3000)).toBe(true);
      const attachment=await readFile(artifacts.resolve(first.pdfUrl!)!);
      const files=[{path:'main.tex',content:'\\documentclass{article}\n\\usepackage{graphicx}\n\\begin{document}\\includegraphics[width=3cm]{figures/reference.pdf}\\end{document}'},{path:'figures/reference.pdf',content:attachment.toString('base64'),encoding:'base64' as const}];
      const second=await manager.compile(id,files,'main.tex','pdflatex');
      expect(second.success,second.log.slice(-3000)).toBe(true);
      const preview=artifacts.resolve(second.pdfUrl!)!;
      const bytes=await readFile(preview);
      expect(bytes.subarray(0,4).toString()).toBe('%PDF');
      const failed=await manager.compile(id,[{path:'main.tex',content:'\\documentclass{article}\n\\usepackage{easy-latex-intentionally-missing}\n\\begin{document}Broken.\\end{document}'}],'main.tex','pdflatex');
      expect(failed.success).toBe(false);
      expect(await readFile(preview)).toEqual(bytes);
      expect(await readdir(path.join(directory,'builds'))).toEqual([]);
    } finally {await rm(directory,{recursive:true,force:true});}
  },180_000);
});
