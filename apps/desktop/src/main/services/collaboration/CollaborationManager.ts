import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, unlink, mkdtemp, rm, realpath, lstat } from 'node:fs/promises';
import path from 'node:path';
import type { CollaborationApi, CompileResult, EditLease, LatexEngine, ProjectFileInput, SharedProject, SharedProjectInput, SharedProjectSnapshot, DoneInput, SharedFile, GitFileMetadata, PublishTicket, PublishChange } from '@easy-latex/shared-types';
import type { AccountManager } from '../account/AccountManager';
import { FileManager } from '../filesystem/FileManager';
import { DockerLatexCompiler } from '../compiler/DockerLatexCompiler';
import type { ArtifactRegistry } from '../compiler/ArtifactRegistry';
import { ProjectLinks } from './ProjectLinks';
import { ProjectEventStream } from './ProjectEventStream';
import { GitCheckout, gitBlobSha } from './GitCheckout';
import { normalizeApiUrl } from '../account/ApiConfiguration';
import { SharedWorkingDirectory } from './SharedWorkingDirectory';

import { validateSharedDirectory, validateSourcePath } from './paths';
export { validateSharedDirectory, validateSourcePath } from './paths';
export class CollaborationManager implements CollaborationApi {
  private readonly compiler = new DockerLatexCompiler(process.env.EASY_LATEX_DOCKER_IMAGE?.trim() || undefined);
  private building = false;
  private readonly projectLinks:ProjectLinks;
  private readonly metadata=new Map<string,GitFileMetadata>();
  private readonly operations=new Map<string,Promise<unknown>>();
  private readonly activations=new Map<string,Promise<SharedProject>>();
  private readonly eventStreams=new Set<ProjectEventStream>();
  private readonly edits=new Map<string,EditLease>();
  private readonly folders=new Map<string,SharedWorkingDirectory>();
  private readonly snapshots=new Map<string,Promise<SharedProjectSnapshot>>();
  private readonly storageDirectories=new Map<string,Promise<string>>();
  private epoch=0;
  constructor(private readonly accounts: AccountManager, private apiUrl: string | undefined, private readonly dataDirectory: string, private readonly artifacts: ArtifactRegistry, private readonly chooseSource?:()=>Promise<string|null>, private readonly currentSource?:()=>string, private readonly chooseItems?:(kind:'files'|'folder')=>Promise<string[]>, private readonly projectsDirectory?:()=>Promise<string>) {
    this.projectLinks=new ProjectLinks(path.join(dataDirectory,'project-links.json'));
    this.apiUrl=normalizeApiUrl(apiUrl??'');
  }
  configure(url:string):void {this.stopUpdates();this.metadata.clear();this.apiUrl=normalizeApiUrl(url);}
  links:CollaborationApi['links']=()=>this.apiUrl?this.projectLinks.list(this.apiUrl.replace(/\/$/,'')):Promise.resolve([]);
  onProjectUpdate:CollaborationApi['onProjectUpdate']=(projectId,callback)=>{
    if(!this.apiUrl)throw new Error('Collaboration backend is not configured');
    const apiUrl=this.apiUrl;
    const stream=new ProjectEventStream(apiUrl,projectId,()=>this.accounts.accessToken(apiUrl),event=>{
      if(event.type==='disconnected')for(const [id,edit] of this.edits)if(edit.file.projectId===projectId)this.edits.delete(id);
      callback(event);
    });
    this.eventStreams.add(stream);
    void stream.run().finally(()=>this.eventStreams.delete(stream));
    return()=>{stream.stop();this.eventStreams.delete(stream);for(const [id,edit] of this.edits)if(edit.file.projectId===projectId)this.edits.delete(id);};
  };
  stopUpdates():void {this.epoch++;for(const stream of this.eventStreams)stream.stop();this.eventStreams.clear();this.metadata.clear();this.edits.clear();this.folders.clear();this.snapshots.clear();}
  private checkEpoch(epoch:number):void {if(epoch!==this.epoch)throw new Error('Account or server changed. Reopen the project.');}
  private storageDirectory():Promise<string>{
    if(!this.apiUrl)throw new Error('Collaboration backend is not configured');
    const backend=this.apiUrl.replace(/\/$/,'');
    let running=this.storageDirectories.get(backend);
    if(!running){
      running=(async()=>{
        // Keep existing receipts/drafts in place for the original server. Other
        // backends get a separate namespace, including after app restart.
        await mkdir(this.dataDirectory,{recursive:true,mode:0o700});
        const filename=path.join(this.dataDirectory,'storage-backend.json');
        try{await writeFile(filename,JSON.stringify({backend}),{flag:'wx',mode:0o600});}
        catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;}
        const value:unknown=JSON.parse(await readFile(filename,'utf8'));
        if(!value||typeof value!=='object'||!('backend' in value)||typeof value.backend!=='string')throw new Error('Invalid collaboration storage identity');
        return value.backend===backend?this.dataDirectory:path.join(this.dataDirectory,'backends',createHash('sha256').update(backend).digest('hex'));
      })();
      this.storageDirectories.set(backend,running);
      void running.catch(()=>this.storageDirectories.delete(backend));
    }
    return running;
  }
  private async saveJson(filename:string,value:unknown):Promise<void>{
    await mkdir(path.dirname(filename),{recursive:true,mode:0o700});const temporary=`${filename}.${randomUUID()}.tmp`;
    await writeFile(temporary,JSON.stringify(value),{mode:0o600});await rename(temporary,filename);
  }
  private async request<T>(route:string,body?:unknown):Promise<T> {
    if(!this.apiUrl) throw new Error('Collaboration backend is not configured');
    const apiUrl=this.apiUrl;
    const epoch=this.epoch;
    const token=await this.accounts.accessToken(apiUrl);
    this.checkEpoch(epoch);
    let response:Response;
    try { response=await fetch(`${apiUrl.replace(/\/$/,'')}${route}`,{method:body===undefined?'GET':'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},...(body!==undefined?{body:JSON.stringify(body)}:{}),redirect:'error',signal:AbortSignal.timeout(15_000)}); }
    catch { throw new Error('Could not connect. Your local draft is preserved.'); }
    const value:unknown=await response.json();
    this.checkEpoch(epoch);
    if(!response.ok) { if(value && typeof value==='object' && 'installationUrl' in value && typeof value.installationUrl==='string')await this.accounts.openInstallation(value.installationUrl); const message=value && typeof value==='object' && 'message' in value && typeof value.message==='string'?value.message:'Collaboration request failed';throw new Error(message); }
    return value as T;
  }
  importProject:CollaborationApi['importProject']=async()=>{
    await this.accounts.accessToken();
    const source=await this.chooseSource?.();if(!source)return null;
    return this.activate(source);
  };
  shareCurrentProject:CollaborationApi['shareCurrentProject']=async()=>{
    await this.accounts.accessToken();
    const source=this.currentSource?.();
    if(!source)throw new Error('Open a local project before enabling collaboration');
    return this.activate(source);
  };
  private async activate(source:string):Promise<SharedProject>{
    const canonical=await realpath(source);
    const running=this.activations.get(canonical);if(running)return running;
    const activation=this.enable(canonical).finally(()=>this.activations.delete(canonical));
    this.activations.set(canonical,activation);
    return activation;
  }
  private async enable(source:string):Promise<SharedProject>{
    if(!this.apiUrl)throw new Error('Collaboration backend is not configured');
    const backend=this.apiUrl.replace(/\/$/,'');
    const link=(await this.links()).find(entry=>entry.workspacePath===source);
    const projects=await this.projects();
    if(link){
      const existing=projects.find(p=>p.id===link.projectId);
      if(!existing)throw new Error('This project already uses collaboration. Sign in with an account that has access.');
      return existing;
    }
    const input=await this.exportSnapshot(source);
    const account=(await this.accounts.state()).account;
    if(!account)throw new Error('Please sign in to enable collaboration');
    // A stable request ID prevents a second project after an uncertain network response.
    const bytes=createHash('sha256').update(`${backend}\0${account.id}\0${source}`).digest().subarray(0,16);
    bytes[6]=(bytes[6]!&0x0f)|0x40;bytes[8]=(bytes[8]!&0x3f)|0x80;
    const hex=bytes.toString('hex');const requestId=`${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
    const project=await this.create({...input,requestId});
    await this.projectLinks.bind(backend,source,project.id);
    return project;
  }
  private excluded(filePath:string):boolean{return filePath.split('/').some(p=>p.startsWith('.')||['build','dist','out','cache','node_modules'].includes(p.toLowerCase()))||/^(tokens?|credentials?|secrets?|passwords?)\./i.test(path.basename(filePath));}
  private async exportSnapshot(source:string):Promise<SharedProjectInput>{
    const files=new FileManager();await files.setWorkspace(source);
    const tree=await files.list();const inputs:ProjectFileInput[]=[];const directories:string[]=[];
    const allPaths=new Set(tree.map(f=>f.path));
    for(const f of tree){
      if(!f.path.includes('/')&&f.path.endsWith('.pdf')&&allPaths.has(f.path.slice(0,-4)+'.tex'))continue;
      if(this.excluded(f.path))continue;
      if(f.kind==='directory'){validateSharedDirectory(f.path);directories.push(f.path);continue;}
      validateSourcePath(f.path,true);
      const text=/\.(tex|bib|sty|cls|bst|ltx|md|txt)$/i.test(f.path);
      if((f.size??0)>(text?5:10)*1024*1024)throw new Error(`File is too large to share: ${f.path}`);
      const bytes=await readFile(await files.resolveExistingFile(f.path));
      const encoding=text?'utf8':'base64';
      inputs.push({path:f.path,content:bytes.toString(encoding==='utf8'?'utf8':'base64'),encoding});
    }
    if(!inputs.length||inputs.length>1000||!inputs.some(f=>f.encoding==='utf8'&&f.path.toLowerCase().endsWith('.tex')))throw new Error('Choose a LaTeX project with at least one source document and at most 1000 files');
    if(directories.length>1000)throw new Error('Project contains too many folders');
    return {name:path.basename(source),files:inputs,directories};
  }
  projects:CollaborationApi['projects']=()=>this.request('/projects');
  private async checkout(projectId:string,requestId?:string):Promise<GitCheckout>{
    const epoch=this.epoch;
    const project=await this.request<SharedProject>(`/projects/${projectId}`);
    const account=(await this.accounts.state()).account;
    if(!account||!project.repository)throw new Error('Please sign in and retry repository activation');
    const directory=await this.storageDirectory();this.checkEpoch(epoch);
    return new GitCheckout(directory,account,projectId,project.repository,write=>{this.checkEpoch(epoch);return this.request(`/projects/${projectId}/git-credentials`,{write,...(requestId?{requestId}:{})});});
  }
  private async serial<T>(id:string,fn:()=>Promise<T>):Promise<T>{
    const previous=this.operations.get(id)??Promise.resolve();
    const work=previous.catch(()=>undefined).then(fn);this.operations.set(id,work);
    try{return await work;}finally{if(this.operations.get(id)===work)this.operations.delete(id);}
  }
  create:CollaborationApi['create']=async input=>{
    const requestId=input.requestId??randomUUID();
    await this.accounts.installation();
    const project=await this.request<SharedProject>('/projects',{name:input.name,requestId});
    let entries=input.files??[{path:'main.tex',content:'\\documentclass{article}\n\\begin{document}\nStart writing here.\n\\end{document}\n'}];
    // Initial import is a separate durable publication. No source bytes go to the API.
    const initialId=this.stableId(`initial:${project.id}:${requestId}`);
    const account=(await this.accounts.state()).account;
    if(!account)throw new Error('Please sign in');
    const activationFile=path.join(await this.storageDirectory(),'activations',account.id,`${project.id}.json`);
    try{entries=JSON.parse(await readFile(activationFile,'utf8')) as ProjectFileInput[];}
    catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;entries=this.withDirectories(entries,input.directories??[]);await this.saveJson(activationFile,entries);}
    await this.serial(project.id,()=>this.publish(project.id,initialId,entries,{}));
    return (await this.projects()).find(p=>p.id===project.id)!;
  };
  private stableId(value:string):string{const bytes=createHash('sha256').update(value).digest().subarray(0,16);bytes[6]=(bytes[6]!&15)|64;bytes[8]=(bytes[8]!&63)|128;const h=bytes.toString('hex');return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;}
  private withDirectories(files:ProjectFileInput[],directories:string[]):ProjectFileInput[]{
    const result=[...files];
    for(const d of new Set(directories)){validateSharedDirectory(d);if(!files.some(f=>f.path.startsWith(`${d}/`))&&!directories.some(other=>other!==d&&other.startsWith(`${d}/`)))result.push({path:`${d}/.gitkeep`,content:'',encoding:'utf8'});}
    return result;
  }
  private validateEntries(entries:ProjectFileInput[]):void{
    if(!entries.length||entries.length>1000)throw new Error('Import is empty or too large');
    const seen=new Set<string>();let total=0;
    for(const f of entries){
      if(f.path.endsWith('/.gitkeep'))validateSharedDirectory(f.path.slice(0,-9));else validateSourcePath(f.path,true);
      if(f.path.split('/').some(part=>/^(build|dist|out|cache|\.env.*)$/i.test(part))||/^(credentials|secrets)\./i.test(path.basename(f.path)))throw new Error('Build and secret files cannot be shared');
      if(seen.has(f.path))throw new Error('Duplicate import path');seen.add(f.path);
      const bytes=Buffer.from(f.content,f.encoding==='base64'?'base64':'utf8');total+=bytes.length;
      if(bytes.length>(f.encoding==='base64'?10:5)*1024*1024||total>20*1024*1024||f.encoding==='base64'&&bytes.toString('base64')!==f.content||f.encoding!=='base64'&&f.content.includes('\0'))throw new Error('File is invalid or too large');
    }
  }
  private async hydrate(checkout:GitCheckout,file:GitFileMetadata):Promise<SharedFile>{
    const bytes=await checkout.readBlob(file.blobSha);return {...file,content:bytes.toString(file.encoding==='base64'?'base64':'utf8')};
  }
  private async loadSnapshot(id:string):Promise<SharedProjectSnapshot>{
    const epoch=this.epoch;
    const checkout=await this.checkout(id);
    const pendingFile=path.join(await this.storageDirectory(),'pending',checkout.account.id,`${id}.json`);
    try{
      const pending=JSON.parse(await readFile(pendingFile,'utf8')) as {input:DoneInput;path:string};
      const ticket=await this.request<PublishTicket|null>(`/projects/${id}/publications/${pending.input.requestId}`);
      if(ticket?.status==='confirmed'){await unlink(pendingFile);}
      else if(ticket?.status==='pushing'){
        const head=await checkout.fetch();
        if(head===ticket.commitSha){await this.request(`/projects/${id}/publications/${pending.input.requestId}/confirm`,{});await unlink(pendingFile);}
      }
    }catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
    let rows=await this.request<GitFileMetadata[]>(`/projects/${id}/files`);
    let head=await checkout.fetch();
    // Metadata and bytes must describe one published Git version before touching disk.
    for(let attempt=0;!await checkout.matches(head,rows);attempt++){
      if(attempt>=2)throw new Error('The project is being published. Retry synchronization in a moment.');
      rows=await this.request<GitFileMetadata[]>(`/projects/${id}/files`);head=await checkout.fetch();
    }
    this.checkEpoch(epoch);
    const files=await Promise.all(rows.filter(f=>!f.path.endsWith('/.gitkeep')).map(f=>this.hydrate(checkout,f)));
    const directories=new Set<string>();
    for(const row of rows){const parts=row.path.split('/');for(let i=1;i<parts.length;i++)directories.add(parts.slice(0,i).join('/'));}
    const folder=await this.workingDirectory(id,checkout.account.id,epoch);
    const protectedPaths=new Set<string>();
    for(const [fileId,edit] of this.edits){
      if(edit.file.projectId!==id)continue;
      const latest=rows.find(row=>row.id===fileId);
      if(Date.parse(edit.expiresAt)>Date.now()&&latest?.version===edit.file.version&&latest.editor?.id===checkout.account.id)protectedPaths.add(edit.file.path);
      else this.edits.delete(fileId);
    }
    await folder.synchronize(files,[...directories],protectedPaths,()=>this.checkEpoch(epoch));
    for(const [fileId,file] of this.metadata)if(file.projectId===id)this.metadata.delete(fileId);
    for(const row of rows)this.metadata.set(row.id,row);
    return {files,directories:[...directories].sort(),workspacePath:folder.root};
  }
  snapshot:CollaborationApi['snapshot']=id=>{
    const key=`${this.epoch}:${id}`;
    const running=this.snapshots.get(key);if(running)return running;
    const epoch=this.epoch;
    const work=this.serial(id,()=>{this.checkEpoch(epoch);return this.loadSnapshot(id);});
    this.snapshots.set(key,work);
    void work.finally(()=>{if(this.snapshots.get(key)===work)this.snapshots.delete(key);}).catch(()=>undefined);
    return work;
  };
  files:CollaborationApi['files']=async id=>(await this.snapshot(id)).files;
  directories:CollaborationApi['directories']=async id=>(await this.snapshot(id)).directories;
  private async workingDirectory(projectId:string,accountId:string,epoch:number):Promise<SharedWorkingDirectory>{
    const backend=this.apiUrl!.replace(/\/$/,'');
    const key=createHash('sha256').update(`${backend}\0${accountId}\0${projectId}`).digest('hex');
    const cached=this.folders.get(key);if(cached)return cached;
    let root=(await this.links()).find(link=>link.projectId===projectId)?.workspacePath;
    if(!root){
      const base=this.projectsDirectory?await this.projectsDirectory():path.join(this.dataDirectory,'projects');
      await mkdir(base,{recursive:true});
      this.checkEpoch(epoch);
      root=await mkdtemp(path.join(await realpath(base),'Shared-project-'));
      await this.projectLinks.bind(backend,root,projectId);
    }
    const canonical=await realpath(root);
    this.checkEpoch(epoch);
    const folder=new SharedWorkingDirectory(canonical,path.join(this.dataDirectory,'working-folders',key+'.json'));
    this.folders.set(key,folder);return folder;
  }
  private async publish(projectId:string,requestId:string,entries:ProjectFileInput[],leases:Record<string,string>):Promise<void>{
    const epoch=this.epoch;
    const request=<T>(route:string,body?:unknown):Promise<T>=>{this.checkEpoch(epoch);return this.request<T>(route,body);};
    this.validateEntries(entries);
    const fingerprint=createHash('sha256').update(JSON.stringify({entries,leases})).digest('hex');
    const checkout=await this.checkout(projectId,requestId);await checkout.initialize();
    const receipt=await checkout.receipt(requestId);if(receipt&&receipt.fingerprint!==fingerprint)throw new Error('Publication request ID was already used');
    let ticket=await request<PublishTicket|null>(`/projects/${projectId}/publications/${requestId}`);
    const changes:PublishChange[]=entries.map(f=>({path:f.path,blobSha:gitBlobSha(Buffer.from(f.content,f.encoding==='base64'?'base64':'utf8')),encoding:f.encoding??'utf8'}));
    if(ticket&&JSON.stringify(ticket.changes)!==JSON.stringify(changes))throw new Error('Publication request ID was already used');
    if(ticket?.status==='confirmed')return;
    if(ticket?.status==='aborted')throw new Error('Publication turn expired. Request Edit again before publishing.');
    let head=await checkout.fetch();
    if(!ticket){
      await checkout.saveReceipt(requestId,{fingerprint,commitSha:null});
      for(let attempt=0;!ticket;attempt++){
        try{ticket=await request<PublishTicket>(`/projects/${projectId}/publications`,{requestId,baseSha:head,changes,leases});}
        catch(error){
          if(attempt>=7||!(error instanceof Error)||!/^Another publication is in progress\.|^Remote has a newer version\. Synchronize and retry\.$/.test(error.message))throw error;
          await new Promise(resolve=>setTimeout(resolve,Math.min(4000,1000*2**attempt)+Math.floor(Math.random()*250)));
          this.checkEpoch(epoch);head=await checkout.fetch();
        }
      }
    }
    if(JSON.stringify(ticket.changes)!==JSON.stringify(changes))throw new Error('Publication request ID was already used');
    if(ticket.commitSha){
      // Confirmation first recovers a successful push whose HTTP response was lost.
      try{await request(`/projects/${projectId}/publications/${requestId}/confirm`,{});return;}catch(e){if(head===ticket.commitSha)throw e;}
      if(!await checkout.contains(ticket.commitSha))throw new Error('Publication commit is unavailable on this device. Recovery is required.');
    }
    if(head!==ticket.baseSha)throw new Error('Remote has a newer version. Your draft is preserved; synchronize before retrying.');
    if(Date.parse(ticket.expiresAt)<=Date.now())throw new Error('Publication turn expired. Request Edit again before publishing.');
    this.checkEpoch(epoch);
    const sha=ticket.commitSha??await checkout.commit(ticket.baseSha,entries,requestId);
    await checkout.saveReceipt(requestId,{fingerprint,commitSha:sha});
    await request(`/projects/${projectId}/publications/${requestId}/commit`,{sha});
    await checkout.push(sha);
    await request(`/projects/${projectId}/publications/${requestId}/confirm`,{});
    await checkout.fetch();
  }
  private async add(projectId:string,entries:ProjectFileInput[],directories:string[]=[]):Promise<string[]>{
    const files=this.withDirectories(entries,directories);
    const account=(await this.accounts.state()).account;if(!account)throw new Error('Please sign in');
    const requestId=this.stableId(`add:${account.id}:${projectId}:${JSON.stringify(files)}`);
    await this.serial(projectId,()=>this.publish(projectId,requestId,files,{}));return [...entries.map(f=>f.path),...directories];
  }
  createFile:CollaborationApi['createFile']=async(id,filePath)=>{validateSourcePath(filePath);await this.add(id,[{path:filePath,content:''}]);return (await this.files(id)).find(f=>f.path===filePath)!;};
  createDirectory:CollaborationApi['createDirectory']=async(id,directory)=>{await this.add(id,[],[validateSharedDirectory(directory)]);return directory;};
  private async canAddFiles(projectId:string):Promise<void> {
    const project=(await this.projects()).find(p=>p.id===projectId);
    if(!project||project.role==='viewer')throw new Error('You do not have permission for this project');
  }
  importFiles:CollaborationApi['importFiles']=async(id,destination)=>{
    await this.canAddFiles(id);
    const selected=await this.chooseItems?.('files')??[];
    return selected.length?this.importDropped(id,selected,destination):[];
  };
  importFolder:CollaborationApi['importFolder']=async(id,destination)=>{
    await this.canAddFiles(id);
    const selected=await this.chooseItems?.('folder')??[];
    return selected.length?this.importDropped(id,selected,destination):[];
  };
  importDropped:CollaborationApi['importDropped']=async(id,sourcePaths,destination)=>{
    await this.canAddFiles(id);
    if(destination)validateSharedDirectory(destination);
    const inputs:ProjectFileInput[]=[];const directories:string[]=[];let totalBytes=0;
    const target=(relative:string)=>destination?`${destination}/${relative}`:relative;
    const addDirectory=(relative:string)=>{directories.push(validateSharedDirectory(target(relative)));if(directories.length>1000)throw new Error('Import contains too many folders');};
    const addFile=async(absolute:string,relative:string)=>{
      const filePath=validateSourcePath(target(relative),true);
      const encoding=/\.(tex|bib|sty|cls|bst|ltx|md|txt)$/i.test(relative)?'utf8':'base64';
      const info=await lstat(absolute);
      if(!info.isFile()||info.isSymbolicLink())throw new Error('Only regular files can be uploaded');
      if(info.size>(encoding==='utf8'?5:10)*1024*1024)throw new Error(`File is too large to share: ${relative}`);
      totalBytes+=info.size;
      if(totalBytes>20*1024*1024||inputs.length>=1000)throw new Error('Import is too large');
      const bytes=await readFile(absolute);
      inputs.push({path:filePath,content:bytes.toString(encoding),encoding});
    };
    for(const source of sourcePaths){
      const info=await lstat(source);if(info.isSymbolicLink())throw new Error('Symbolic links cannot be uploaded');
      const name=path.basename(source);if(name.startsWith('.'))throw new Error('Hidden items cannot be uploaded');
      if(info.isFile()){await addFile(source,name);continue;}
      if(!info.isDirectory())throw new Error('Only files and folders can be uploaded');
      addDirectory(name);
      const manager=new FileManager();await manager.setWorkspace(source);
      for(const entry of await manager.list()){
        if(this.excluded(entry.path))continue;
        const relative=`${name}/${entry.path}`;
        if(entry.kind==='directory')addDirectory(relative);
        else await addFile(await manager.resolveExistingFile(entry.path),relative);
      }
    }
    if(!inputs.length&&!directories.length)return [];
    return this.add(id,inputs,directories);
  };
  acquire:CollaborationApi['acquire']=async id=>{
    const known=this.metadata.get(id);if(!known)throw new Error('Synchronize the project before requesting Edit');
    const epoch=this.epoch;
    return this.serial(known.projectId,async()=>{
      this.checkEpoch(epoch);
      if(this.edits.has(id))throw new Error('This file already has an Edit session on this device.');
      const snapshot=await this.loadSnapshot(known.projectId);
      const file=this.metadata.get(id);if(!file)throw new Error('This file is no longer in the project.');
      const result=await this.request<{token:string;expiresAt:string;file:GitFileMetadata}>(`/files/${id}/edit`,{blobSha:file.blobSha,version:file.version});
      const resultFile={...result.file,content:snapshot.files.find(row=>row.id===id)!.content};
      const edit={...result,file:resultFile};this.edits.set(id,edit);return edit;
    });
  };
  renew:CollaborationApi['renew']=async(id,token)=>{
    try{const result=await this.request<{expiresAt:string}>(`/files/${id}/renew`,{token});const edit=this.edits.get(id);if(edit?.token===token)this.edits.set(id,{...edit,expiresAt:result.expiresAt});return result;}
    catch(error){if(this.edits.get(id)?.token===token)this.edits.delete(id);throw error;}
  };
  done:CollaborationApi['done']=async input=>{
    const file=this.metadata.get(input.fileId);if(!file)throw new Error('Synchronize the project before publishing');
    const accountState=(await this.accounts.state()).account;
    if(accountState){try{const prior=JSON.parse(await readFile(path.join(await this.storageDirectory(),'pending',accountState.id,`${file.projectId}.json`),'utf8')) as {input:DoneInput;path:string};
      if(prior.path===file.path&&prior.input.content===input.content){const state=await this.request<PublishTicket|null>(`/projects/${file.projectId}/publications/${prior.input.requestId}`);if(state&&state.status!=='aborted')input=prior.input;}
    }catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}}
    // A confirmed receipt may have advanced the cached version after a lost response.
    const ticket=await this.request<PublishTicket|null>(`/projects/${file.projectId}/publications/${input.requestId}`);
    if(!ticket&&file.version!==input.baseVersion)throw new Error('The file has a newer version. Review your saved draft and request Edit again.');
    const entries=[{path:file.path,content:input.content,encoding:'utf8' as const}];
    if(!ticket&&gitBlobSha(Buffer.from(input.content))===file.blobSha){await this.release(file.id,input.token);return (await this.files(file.projectId)).find(f=>f.id===file.id)!;}
    const account=(await this.accounts.state()).account;
    if(!account)throw new Error('Please sign in');
    // Save the full local intent before network operations so a restart can resume the same request.
    const pendingFile=path.join(await this.storageDirectory(),'pending',account.id,`${file.projectId}.json`);
    await this.saveJson(pendingFile,{input,path:file.path});
    await this.serial(file.projectId,()=>this.publish(file.projectId,input.requestId,entries,{[file.id]:input.token}));
    if(this.edits.get(file.id)?.token===input.token)this.edits.delete(file.id);
    await unlink(pendingFile).catch(()=>undefined);
    return (await this.files(file.projectId)).find(f=>f.id===file.id)!;
  };
  release:CollaborationApi['release']=async(id,token)=>{
    if(this.edits.get(id)?.token===token)this.edits.delete(id);
    await this.request(`/files/${id}/release`,{token});
    const file=this.metadata.get(id);if(file)await this.snapshot(file.projectId);
  };
  history:CollaborationApi['history']=async id=>{const file=this.metadata.get(id);if(!file)throw new Error('Synchronize the project first');const checkout=await this.checkout(file.projectId);const history=await checkout.history(file.path);return history.map((h,i)=>({...h,version:history.length-i}));};
  invite:CollaborationApi['invite']=async(id,login,role)=>{await this.request(`/projects/${id}/invitations`,{login,role});};
  invitations:CollaborationApi['invitations']=()=>this.request('/invitations');
  accept:CollaborationApi['accept']=async id=>{await this.request(`/invitations/${id}/accept`,{});};
  legacyConfirmation=async(email:string):Promise<void>=>{await this.request('/legacy/confirmation',{email});};
  linkLegacy=async(email:string,code:string):Promise<void>=>{await this.request('/legacy/link',{email,code});};
  legacyProjects=():Promise<SharedProject[]>=>this.request('/legacy/projects');
  migrateLegacy=async(projectId:string):Promise<{project:SharedProject;limitations:string}>=>{
    const account=(await this.accounts.state()).account;if(!account)throw new Error('Please sign in');
    const requestId=this.stableId(`migration:${account.id}:${projectId}`);
    const filename=path.join(await this.storageDirectory(),'migrations',account.id,`${projectId}.json`);
    type Export={project:SharedProject;files:ProjectFileInput[];directories:string[];limitations:string};
    let exported:Export;
    try{exported=JSON.parse(await readFile(filename,'utf8')) as Export;}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;exported=await this.request<Export>('/legacy/export',{projectId,requestId});await this.saveJson(filename,exported);}
    await this.serial(exported.project.id,()=>this.publish(exported.project.id,requestId,this.withDirectories(exported.files,exported.directories),{}));
    for(const link of await this.links())if(link.projectId===projectId)await this.projectLinks.bind(this.apiUrl!.replace(/\/$/,''),link.workspacePath,exported.project.id);
    return {project:exported.project,limitations:exported.limitations};
  };
  private async draftPath(projectId:string,filePath:string):Promise<string> {
    const account=(await this.accounts.state()).account;
    if(!account) throw new Error('Sign in to access your draft');
    const key=createHash('sha256').update(`${projectId}\0${filePath}`).digest('hex');
    return path.join(await this.storageDirectory(),'drafts',account.id,`${key}.json`);
  }
  saveDraft:CollaborationApi['saveDraft']=async(projectId,filePath,content,baseVersion)=>{
    validateSourcePath(filePath);
    const epoch=this.epoch;
    const filename=await this.draftPath(projectId,filePath);
    await this.serial(projectId,async()=>{
      this.checkEpoch(epoch);
      // Recovery is durable before replacing the visible source file.
      await this.saveJson(filename,{content,baseVersion});
      const edit=[...this.edits.values()].find(edit=>edit.file.projectId===projectId&&edit.file.path===filePath&&edit.file.version===baseVersion&&Date.parse(edit.expiresAt)>Date.now());
      if(!edit)return;
      const account=(await this.accounts.state()).account;if(!account)throw new Error('Please sign in');
      const folder=await this.workingDirectory(projectId,account.id,epoch);
      await folder.write(filePath,Buffer.from(content),()=>this.checkEpoch(epoch));
    });
  };
  draft:CollaborationApi['draft']=async(projectId,filePath)=>{
    try { const value:unknown=JSON.parse(await readFile(await this.draftPath(projectId,filePath),'utf8')); if(value && typeof value==='object' && 'content' in value && typeof value.content==='string' && 'baseVersion' in value && typeof value.baseVersion==='number') return {content:value.content,baseVersion:value.baseVersion}; }
    catch(error) { if((error as NodeJS.ErrnoException).code!=='ENOENT') throw error; }
    return null;
  };
  clearDraft:CollaborationApi['clearDraft']=async(projectId,filePath)=>{await unlink(await this.draftPath(projectId,filePath)).catch(e=>{if((e as NodeJS.ErrnoException).code!=='ENOENT') throw e;});};
  compile=async(projectId:string,files:ProjectFileInput[],rootDocument:string,engine:LatexEngine):Promise<CompileResult>=>{
    if(this.building) throw new Error('A compilation is already running');
    validateSourcePath(rootDocument);
    if(!files.some(f=>f.path===rootDocument) || !rootDocument.toLowerCase().endsWith('.tex') || files.length>1000 || files.reduce((n,f)=>n+Buffer.byteLength(f.content,f.encoding==='base64'?'base64':'utf8'),0)>20*1024*1024) throw new Error('Invalid project snapshot');
    for(const f of files) { validateSourcePath(f.path,f.encoding==='base64'); if(f.encoding==='base64'&&Buffer.from(f.content,'base64').toString('base64')!==f.content)throw new Error('Invalid attachment'); }
    this.building=true;
    let root:string|undefined;
    try {
      await mkdir(path.join(this.dataDirectory,'builds'),{recursive:true});
      root=await mkdtemp(path.join(this.dataDirectory,'builds',`${projectId}-`));
      const output=path.join(root,'.easy-latex','build');
      await mkdir(output,{recursive:true});
      for(const f of files) { const target=path.join(root,f.path);await mkdir(path.dirname(target),{recursive:true});await writeFile(target,f.encoding==='base64'?Buffer.from(f.content,'base64'):f.content); }
      const result=await this.compiler.compile({workspacePath:root,outputDirectory:output,rootDocument,engine,onOutput:()=>undefined});
      // Keep preview snapshots in a stable directory, then remove the temporary source tree.
      let pdfUrl:string|undefined;
      if(result.success && result.pdfPath) {
        const previews=path.join(this.dataDirectory,'previews');await mkdir(previews,{recursive:true});
        const {copyFile}=await import('node:fs/promises'); const pdf=path.join(previews,`${randomUUID()}.pdf`);
        await copyFile(result.pdfPath,pdf);pdfUrl=await this.artifacts.registerPdf(pdf,previews);await unlink(pdf);
      }
      return {success:result.success,cancelled:result.cancelled,errors:result.errors,warnings:result.warnings,duration:result.duration,log:result.log,engine,rootDocument,...(pdfUrl?{pdfUrl}:{})};
    } finally { this.building=false;if(root)await rm(root,{recursive:true,force:true}); }
  };
  cancelCompile():Promise<boolean> { return this.compiler.cancel(); }
  cancel():Promise<boolean> { return this.compiler.cancel(); }
}
