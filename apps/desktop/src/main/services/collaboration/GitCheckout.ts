import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm, readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import type { Account, GitFileMetadata, GitRepository, ProjectFileInput } from '@easy-latex/shared-types';
import { gitRuntime } from '../git/GitRuntime';
import { validateSharedDirectory, validateSourcePath } from './paths';
interface Credential {token:string;url:string;expires_at:string;}
export function gitBlobSha(bytes:Buffer):string {return createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');}
/** Managed object store and immutable checkouts. Drafts never live in a Git worktree. */
export class GitCheckout {
  readonly root:string;
  private readonly repository:string;
  constructor(directory:string,readonly account:Account,readonly projectId:string,readonly remote:GitRepository,private readonly credential:(write:boolean)=>Promise<Credential>) {
    if(!/^[a-zA-Z0-9-]+$/.test(account.id)||!/^[a-zA-Z0-9-]+$/.test(projectId)||!/^[a-zA-Z0-9_.-]+$/.test(remote.owner)||!/^[a-zA-Z0-9_.-]+$/.test(remote.name)||!remote.branch||remote.branch.startsWith('-')||/[\s~^:?*[\\]|\.\.|@\{/.test(remote.branch))throw new Error('Invalid managed repository identity');
    this.root=path.join(directory,'checkouts',account.id,projectId);this.repository=path.join(this.root,'objects.git');
  }
  private async run(args:string[],input?:Buffer,extra:NodeJS.ProcessEnv={},credential?:Credential):Promise<Buffer>{
    const runtime=gitRuntime();
    const env:NodeJS.ProcessEnv={...runtime.env,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:process.platform==='win32'?'NUL':'/dev/null',GIT_TERMINAL_PROMPT:'0',GIT_OPTIONAL_LOCKS:'0',...extra};
    // Credentials are passed only in the child environment and never in argv or a stored remote URL.
    for(const key of Object.keys(env))if(/^GIT_CONFIG_(KEY_|VALUE_|COUNT)/.test(key))delete env[key];
    if(credential){const u=new URL(credential.url);if(u.protocol!=='https:'||u.hostname!=='github.com'||u.username||u.password||u.pathname!==`/${this.remote.owner}/${this.remote.name}.git`)throw new Error('Unexpected Git credential scope');env.GIT_CONFIG_COUNT='1';env.GIT_CONFIG_KEY_0='http.https://github.com/.extraheader';env.GIT_CONFIG_VALUE_0=`Authorization: Basic ${Buffer.from(`x-access-token:${credential.token}`).toString('base64')}`;}
    return new Promise((resolve,reject)=>{
      const child=spawn(runtime.executable,['-c',`core.hooksPath=${path.join(this.root,'disabled-hooks')}`,'-c','credential.helper=','-c','core.fsmonitor=false','--git-dir',this.repository,...args],{env,stdio:['pipe','pipe','pipe'],windowsHide:true});
      const chunks:Buffer[]=[];let size=0;let killed=false;
      const timer=setTimeout(()=>{killed=true;child.kill();},90_000);
      child.stdout.on('data',(b:Buffer)=>{size+=b.length;if(size>32*1024*1024){killed=true;child.kill();}else chunks.push(b);});
      // Git stderr can include remote/server controlled data; never log or forward it.
      child.stderr.resume();child.stdin.on('error',()=>{});child.once('error',()=>{clearTimeout(timer);reject(new Error('Bundled Git runtime is unavailable. Reinstall Easy LaTeX.'));});
      child.once('close',code=>{clearTimeout(timer);if(code===0&&!killed)resolve(Buffer.concat(chunks));else reject(new Error('Git operation failed or remote changed. Keep your draft and retry.'));});
      child.stdin.end(input);
    });
  }
  async initialize():Promise<void>{await mkdir(this.root,{recursive:true,mode:0o700});try{await readFile(path.join(this.repository,'HEAD'));}catch{await this.run(['init','--bare',this.repository]);}}
  async fetch():Promise<string|null>{
    await this.initialize();const credential=await this.credential(false);const url=credential.url;
    const refs=(await this.run(['ls-remote','--heads',url,`refs/heads/${this.remote.branch}`],undefined,{},credential)).toString().trim();
    if(!refs)return null;
    await this.run(['fetch','--no-tags',url,`+refs/heads/${this.remote.branch}:refs/remotes/origin/${this.remote.branch}`],undefined,{},credential);
    const head=(await this.run(['rev-parse',`refs/remotes/origin/${this.remote.branch}`])).toString().trim();
    if(!/^[a-f0-9]{40}$/.test(head))throw new Error('Invalid Git head');return head;
  }
  async materialize(head:string):Promise<string>{
    if(!/^[a-f0-9]{40}$/.test(head))throw new Error('Invalid Git version');
    const checkout=path.join(this.root,head);
    try{await readFile(path.join(checkout,'.git'));}catch{await this.run(['worktree','add','--detach',checkout,head]);}
    return checkout;
  }
  async readBlob(sha:string):Promise<Buffer>{if(!/^[a-f0-9]{40}$/.test(sha))throw new Error('Invalid Git blob');return this.run(['cat-file','blob',sha]);}
  async matches(head:string|null,files:Pick<GitFileMetadata,'path'|'blobSha'>[]):Promise<boolean>{
    if(!head)return files.length===0;
    if(!/^[a-f0-9]{40}$/.test(head))throw new Error('Invalid Git version');
    const entries=(await this.run(['ls-tree','-rz',head])).toString('utf8').split('\0').filter(Boolean);
    const blobs=new Map<string,string>();
    for(const entry of entries){const tab=entry.indexOf('\t');const [mode,type,sha]=entry.slice(0,tab).split(' ');if(mode==='100644'&&type==='blob'&&sha)blobs.set(entry.slice(tab+1),sha);}
    // The backend intentionally excludes unsupported/internal Git paths.
    return files.every(file=>blobs.get(file.path)===file.blobSha)&&[...blobs.keys()].every(p=>files.some(file=>file.path===p)||!this.supportedPath(p));
  }
  private supportedPath(value:string):boolean{
    try{if(value.endsWith('/.gitkeep'))validateSharedDirectory(value.slice(0,-9));else validateSourcePath(value,true);return !value.split('/').some(p=>/^(build|dist|out|cache|\.env.*)$/i.test(p))&&!/^(credentials|secrets)\./i.test(path.posix.basename(value));}catch{return false;}
  }
  async contains(sha:string):Promise<boolean>{try{await this.run(['cat-file','-e',sha]);return true;}catch{return false;}}
  async commit(base:string|null,entries:ProjectFileInput[],requestId:string):Promise<string>{
    if(!/^[a-zA-Z0-9-]+$/.test(requestId)||base&&!/^[a-f0-9]{40}$/.test(base))throw new Error('Invalid publication');
    const ref=`refs/easy-latex/requests/${requestId}`;
    try{return (await this.run(['rev-parse','--verify',ref])).toString().trim();}catch{ /* First attempt. */ }
    const temp=await mkdtemp(path.join(this.root,'index-'));
    try{
      const env={GIT_INDEX_FILE:path.join(temp,'index'),GIT_AUTHOR_NAME:this.account.githubLogin||this.account.displayName,GIT_AUTHOR_EMAIL:this.account.email,GIT_COMMITTER_NAME:this.account.githubLogin||this.account.displayName,GIT_COMMITTER_EMAIL:this.account.email};
      await this.run(['read-tree',base??'--empty'],undefined,env);
      const index:Buffer[]=[];
      for(const f of entries){
        const parts=f.path.split('/');
        if(!f.path||f.path.length>512||f.path.includes('\\')||parts.some(p=>!p||p==='.'||p==='..'||p==='.git')||[...f.path].some(c=>c.charCodeAt(0)<32))throw new Error('Invalid publication path');
        const bytes=Buffer.from(f.content,f.encoding==='base64'?'base64':'utf8');const sha=(await this.run(['hash-object','-w','--stdin'],bytes)).toString().trim();index.push(Buffer.from(`100644 ${sha}\t${f.path}\0`));}
      await this.run(['update-index','-z','--index-info'],Buffer.concat(index),env);
      const tree=(await this.run(['write-tree'],undefined,env)).toString().trim();
      const sha=(await this.run(['commit-tree',tree,...(base?['-p',base]:[])],Buffer.from(`Publish project changes\n\nEasy-LaTeX-Request: ${requestId}\n`),env)).toString().trim();
      await this.run(['update-ref',ref,sha]);return sha;
    }finally{await rm(temp,{recursive:true,force:true});}
  }
  async push(sha:string):Promise<void>{if(!/^[a-f0-9]{40}$/.test(sha))throw new Error('Invalid publication SHA');const credential=await this.credential(true);await this.run(['push','--porcelain',credential.url,`${sha}:refs/heads/${this.remote.branch}`],undefined,{},credential);}
  async history(filePath:string):Promise<{id:string;author:string;createdAt:string;content:string}[]>{
    const head=await this.fetch();if(!head)return [];
    const log=(await this.run(['log','-50','--format=%H%x09%an%x09%aI',head,'--',filePath])).toString().trim();
    const rows=[];
    for(const line of log.split('\n').filter(Boolean)){const [id,author,createdAt]=line.split('\t');if(!id)continue;try{const content=(await this.run(['show',`${id}:${filePath}`])).toString('utf8');rows.push({id,author:author??'',createdAt:createdAt??'',content});}catch{/* A deletion has no blob to display. */}}
    return rows;
  }
  async receipt(requestId:string):Promise<{fingerprint:string;commitSha:string|null}|null>{try{return JSON.parse(await readFile(path.join(this.root,`${requestId}.json`),'utf8')) as {fingerprint:string;commitSha:string|null};}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return null;throw e;}}
  async saveReceipt(requestId:string,value:{fingerprint:string;commitSha:string|null}):Promise<void>{await mkdir(this.root,{recursive:true,mode:0o700});const filename=path.join(this.root,`${requestId}.json`),temp=`${filename}.${randomUUID()}.tmp`;await writeFile(temp,JSON.stringify(value),{mode:0o600});await rename(temp,filename);}
}
