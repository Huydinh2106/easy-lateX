import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, unlink, mkdtemp, rm, realpath, lstat } from 'node:fs/promises';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { forwardSearch, parseSyncTeX, type SyncTeXData } from '@easy-latex/latex';
import type { CollaborationApi, CompileResult, EditLease, LatexEngine, ProjectFileInput, SharedProject, SharedProjectInput, SharedProjectSnapshot, DoneInput, SharedFile } from '@easy-latex/shared-types';
import type { AccountManager } from '../account/AccountManager';
import { FileManager } from '../filesystem/FileManager';
import { DockerLatexCompiler } from '../compiler/DockerLatexCompiler';
import type { ArtifactRegistry } from '../compiler/ArtifactRegistry';
import { ProjectLinks } from './ProjectLinks';
import { ProjectEventStream } from './ProjectEventStream';
import { normalizeApiUrl } from '../account/ApiConfiguration';
import { SharedWorkingDirectory } from './SharedWorkingDirectory';

import { validateSharedDirectory, validateSourcePath } from './paths';
export { validateSharedDirectory, validateSourcePath } from './paths';
export class CollaborationManager implements CollaborationApi {
  private readonly compiler = new DockerLatexCompiler(process.env.EASY_LATEX_DOCKER_IMAGE?.trim() || undefined);
  private building = false;
  private readonly projectLinks:ProjectLinks;
  private readonly metadata=new Map<string,SharedFile>();
  private readonly operations=new Map<string,Promise<unknown>>();
  private readonly activations=new Map<string,Promise<SharedProject>>();
  private readonly eventStreams=new Set<ProjectEventStream>();
  private readonly edits=new Map<string,EditLease>();
  private readonly folders=new Map<string,SharedWorkingDirectory>();
  private readonly snapshots=new Map<string,Promise<SharedProjectSnapshot>>();
  private readonly storageDirectories=new Map<string,Promise<string>>();
  private readonly previewSyncTeX=new Map<string,{projectId:string;accountId:string;epoch:number;data:SyncTeXData|null}>();
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
  stopUpdates():void {this.epoch++;for(const stream of this.eventStreams)stream.stop();this.eventStreams.clear();this.metadata.clear();this.edits.clear();this.folders.clear();this.snapshots.clear();this.previewSyncTeX.clear();}
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
    if(!response.ok) { const message=value && typeof value==='object' && 'message' in value && typeof value.message==='string'?value.message:'Collaboration request failed';throw new Error(message); }
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
  private async serial<T>(id:string,fn:()=>Promise<T>):Promise<T>{
    const previous=this.operations.get(id)??Promise.resolve();
    const work=previous.catch(()=>undefined).then(fn);this.operations.set(id,work);
    try{return await work;}finally{if(this.operations.get(id)===work)this.operations.delete(id);}
  }
  create:CollaborationApi['create']=input=>this.request('/projects',{...input,requestId:input.requestId??randomUUID()});
  private async loadSnapshot(id:string):Promise<SharedProjectSnapshot>{
    const epoch=this.epoch;
    const account=(await this.accounts.state()).account;
    if(!account)throw new Error('Please sign in');
    const [files,directories]=await Promise.all([
      this.request<SharedFile[]>(`/projects/${id}/files`),
      this.request<string[]>(`/projects/${id}/directories`)
    ]);
    const rows=files;
    this.checkEpoch(epoch);
    const folder=await this.workingDirectory(id,account.id,epoch);
    const protectedPaths=new Set<string>();
    for(const [fileId,edit] of this.edits){
      if(edit.file.projectId!==id)continue;
      const latest=rows.find(row=>row.id===fileId);
      if(Date.parse(edit.expiresAt)>Date.now()&&latest?.version===edit.file.version&&latest.editor?.id===account.id)protectedPaths.add(edit.file.path);
      else this.edits.delete(fileId);
    }
    await folder.synchronize(files,directories,protectedPaths,()=>this.checkEpoch(epoch));
    for(const [fileId,file] of this.metadata)if(file.projectId===id)this.metadata.delete(fileId);
    for(const row of rows)this.metadata.set(row.id,row);
    return {files,directories:directories.sort(),workspacePath:folder.root};
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
  private async add(projectId:string,entries:ProjectFileInput[],directories:string[]=[]):Promise<string[]>{
    return this.request(`/projects/${projectId}/import`,{files:entries,directories});
  }
  createFile:CollaborationApi['createFile']=async(id,filePath)=>{
    validateSourcePath(filePath);
    const file=await this.request<SharedFile>(`/projects/${id}/files`,{path:filePath});
    this.metadata.set(file.id,file);return file;
  };
  createDirectory:CollaborationApi['createDirectory']=async(id,directory)=>{
    await this.request(`/projects/${id}/directories`,{path:validateSharedDirectory(directory)});return directory;
  };
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
      await this.loadSnapshot(known.projectId);
      const file=this.metadata.get(id);if(!file)throw new Error('This file is no longer in the project.');
      const edit=await this.request<EditLease>(`/files/${id}/edit`,{});
      this.metadata.set(id,edit.file);this.edits.set(id,edit);return edit;
    });
  };
  renew:CollaborationApi['renew']=async(id,token)=>{
    try{const result=await this.request<{expiresAt:string}>(`/files/${id}/renew`,{token});const edit=this.edits.get(id);if(edit?.token===token)this.edits.set(id,{...edit,expiresAt:result.expiresAt});return result;}
    catch(error){if(this.edits.get(id)?.token===token)this.edits.delete(id);throw error;}
  };
  done:CollaborationApi['done']=async input=>{
    const file=this.metadata.get(input.fileId);if(!file)throw new Error('Synchronize the project before saving');
    const account=(await this.accounts.state()).account;if(!account)throw new Error('Please sign in');
    const pendingFile=path.join(await this.storageDirectory(),'pending',account.id,`${file.projectId}.json`);
    try {
      const previous=JSON.parse(await readFile(pendingFile,'utf8')) as {input:DoneInput;path:string};
      if(previous.path===file.path&&previous.input.content===input.content)input=previous.input;
    } catch(error) {if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
    await this.saveJson(pendingFile,{input,path:file.path});
    const result=await this.serial(file.projectId,()=>this.request<SharedFile>(`/files/${file.id}/done`,{token:input.token,baseVersion:input.baseVersion,content:input.content,requestId:input.requestId}));
    if(this.edits.get(file.id)?.token===input.token)this.edits.delete(file.id);
    this.metadata.set(file.id,result);
    await unlink(pendingFile).catch(()=>undefined);
    await this.snapshot(file.projectId);
    return result;
  };
  release:CollaborationApi['release']=async(id,token)=>{
    if(this.edits.get(id)?.token===token)this.edits.delete(id);
    await this.request(`/files/${id}/release`,{token});
    const file=this.metadata.get(id);if(file)await this.snapshot(file.projectId);
  };
  history:CollaborationApi['history']=id=>this.request(`/files/${id}/history`);
  invite:CollaborationApi['invite']=async(id,email,role)=>{await this.request(`/projects/${id}/invitations`,{email,role});};
  invitations:CollaborationApi['invitations']=()=>this.request('/invitations');
  accept:CollaborationApi['accept']=async id=>{await this.request(`/invitations/${id}/accept`,{});};
  legacyConfirmation:CollaborationApi['legacyConfirmation']=()=>Promise.reject(new Error('Projects are stored directly in Supabase. Sign in with your email.'));
  linkLegacy:CollaborationApi['linkLegacy']=()=>Promise.reject(new Error('Projects are stored directly in Supabase. Sign in with your email.'));
  legacyProjects=():Promise<SharedProject[]>=>this.projects();
  migrateLegacy=async(projectId:string):Promise<{project:SharedProject;limitations:string}>=>{
    const project=(await this.projects()).find(item=>item.id===projectId);
    if(!project)throw new Error('Project unavailable');return {project,limitations:''};
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
  forwardSync:CollaborationApi['forwardSync']=async(projectId,pdfUrl,input)=>{
    validateSourcePath(input.file);
    if(!Number.isSafeInteger(input.line)||input.line<1||(input.column!==undefined&&(!Number.isSafeInteger(input.column)||input.column<1)))throw new Error('Invalid source position');
    const epoch=this.epoch;
    const preview=this.previewSyncTeX.get(pdfUrl);
    const unavailable={available:false,reason:'SyncTeX is unavailable for this PDF. Compile the project again.'};
    if(!preview||preview.projectId!==projectId||preview.epoch!==epoch||!this.artifacts.resolve(pdfUrl))return unavailable;
    const account=(await this.accounts.state()).account;
    if(epoch!==this.epoch||!account||account.id!==preview.accountId||!preview.data)return unavailable;
    // Select only the exact snapshot path; basename fallback can confuse two chapters
    // named main.tex, or match a file that was never typeset in this preview.
    const files=new Map([...preview.data.files].filter(([,file])=>file===input.file));
    const result=forwardSearch({...preview.data,files},input.file,input.line,input.column);
    return {available:result.available,...(result.reason?{reason:result.reason}:{}),...(result.page!==undefined?{page:result.page}:{}),...(result.x!==undefined?{x:result.x}:{}),...(result.y!==undefined?{y:result.y}:{})};
  };
  private async readPreviewSyncTeX(filename:string|undefined,root:string,sourcePaths:Set<string>):Promise<SyncTeXData|null>{
    if(!filename)return null;
    try{
      const bytes=await readFile(filename);
      const data=parseSyncTeX((filename.endsWith('.gz')?gunzipSync(bytes,{maxOutputLength:64*1024*1024}):bytes).toString('utf8'));
      const files=new Map<number,string>();
      const workspaceRoot=root.replace(/\\/g,'/')+'/';
      for(const [tag,input] of data.files){
        let relative=input.replace(/\\/g,'/');
        if(relative.startsWith('/workspace/'))relative=relative.slice('/workspace/'.length);
        else if(relative.startsWith(workspaceRoot))relative=relative.slice(workspaceRoot.length);
        relative=path.posix.normalize(relative);
        if(sourcePaths.has(relative))files.set(tag,relative);
      }
      return files.size&&data.records.length?{...data,files}:null;
    }catch{return null;}
  }
  compile=async(projectId:string,files:ProjectFileInput[],rootDocument:string,engine:LatexEngine):Promise<CompileResult>=>{
    if(this.building) throw new Error('A compilation is already running');
    validateSourcePath(rootDocument);
    if(!files.some(f=>f.path===rootDocument) || !rootDocument.toLowerCase().endsWith('.tex') || files.length>1000 || files.reduce((n,f)=>n+Buffer.byteLength(f.content,f.encoding==='base64'?'base64':'utf8'),0)>20*1024*1024) throw new Error('Invalid project snapshot');
    for(const f of files) { validateSourcePath(f.path,f.encoding==='base64'); if(f.encoding==='base64'&&Buffer.from(f.content,'base64').toString('base64')!==f.content)throw new Error('Invalid attachment'); }
    this.building=true;
    const epoch=this.epoch;
    let root:string|undefined;
    try {
      const accountId=(await this.accounts.state()).account?.id;
      this.checkEpoch(epoch);
      await mkdir(path.join(this.dataDirectory,'builds'),{recursive:true});
      root=await mkdtemp(path.join(this.dataDirectory,'builds',`${projectId}-`));
      const output=path.join(root,'.easy-latex','build');
      await mkdir(output,{recursive:true});
      for(const f of files) { const target=path.join(root,f.path);await mkdir(path.dirname(target),{recursive:true});await writeFile(target,f.encoding==='base64'?Buffer.from(f.content,'base64'):f.content); }
      const result=await this.compiler.compile({workspacePath:root,outputDirectory:output,rootDocument,engine,onOutput:()=>undefined});
      this.checkEpoch(epoch);
      // Keep preview snapshots in a stable directory, then remove the temporary source tree.
      let pdfUrl:string|undefined;
      if(result.success && result.pdfPath) {
        const previews=path.join(this.dataDirectory,'previews');await mkdir(previews,{recursive:true});
        const {copyFile}=await import('node:fs/promises'); const pdf=path.join(previews,`${randomUUID()}.pdf`);
        await copyFile(result.pdfPath,pdf);pdfUrl=await this.artifacts.registerPdf(pdf,previews);await unlink(pdf);
        const data=await this.readPreviewSyncTeX(result.synctexPath,root,new Set(files.map(file=>file.path)));
        const currentAccountId=(await this.accounts.state()).account?.id;
        this.checkEpoch(epoch);
        if(currentAccountId!==accountId)throw new Error('Account or server changed. Reopen the project.');
        if(accountId){
          this.previewSyncTeX.set(pdfUrl,{projectId,accountId,epoch,data});
          while(this.previewSyncTeX.size>8){const oldest=this.previewSyncTeX.keys().next().value;if(oldest)this.previewSyncTeX.delete(oldest);}
        }
      }
      return {success:result.success,cancelled:result.cancelled,errors:result.errors,warnings:result.warnings,duration:result.duration,log:result.log,engine,rootDocument,...(pdfUrl?{pdfUrl}:{})};
    } finally { this.building=false;if(root)await rm(root,{recursive:true,force:true}); }
  };
  cancelCompile():Promise<boolean> { return this.compiler.cancel(); }
  cancel():Promise<boolean> { return this.compiler.cancel(); }
}
