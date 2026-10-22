import { useEffect, useRef, useState } from 'react';
import { parseOutline } from '@easy-latex/latex';
import type { Account, CompileResult, DoneInput, EditLease, FileRevision, LatexEngine, SharedFile, SharedProject } from '@easy-latex/shared-types';
import { LatexEditor, type LatexEditorHandle } from '../editor/LatexEditor';
import { preserveLastSuccessfulPdf } from '../compile/preserveCompileResult';
import { errorMessage, sharedFileTree } from './utils';
import { WorkspaceFrame, type PanelSettings } from '../../components/WorkspaceFrame';
import { StatusBar } from '../../components/StatusBar';
import { CompileToolbar, type SaveState } from '../compile/CompileToolbar';
import { ProjectExplorer } from '../project/ProjectExplorer';
import { CircleAlert, Users, X } from 'lucide-react';
import { InvitationDialog } from './InvitationDialog';

interface Props { project:SharedProject; account:Account; onClose():void; initialInvitationsOpen?:boolean; settings?:PanelSettings; onResize?(key:keyof PanelSettings,value:number,persist:boolean):void; }
export function SharedWorkspace({project,account,onClose,settings,onResize,initialInvitationsOpen=false}:Props) {
  const api=window.desktop.collaboration;
  const [files,setFiles]=useState<SharedFile[]>([]);const [activeId,setActiveId]=useState<string|null>(null);
  const [directories,setDirectories]=useState<string[]>([]);
  const [workspacePath,setWorkspacePath]=useState('');const [synchronized,setSynchronized]=useState(false);
  const [saveState,setSaveState]=useState<SaveState>('saved');
  const [content,setContent]=useState('');const [lease,setLease]=useState<EditLease|null>(null);const [busy,setBusy]=useState(false);
  const [preserved,setPreserved]=useState(false);const [draft,setDraft]=useState<{content:string;baseVersion:number}|null>(null);
  const [error,setError]=useState('');const [notice,setNotice]=useState('');const [history,setHistory]=useState<FileRevision[]|null>(null);
  const [root,setRoot]=useState('');const [engine,setEngine]=useState<LatexEngine>('pdflatex');const [pdf,setPdf]=useState<CompileResult|null>(null);const [pdfOpen,setPdfOpen]=useState(false);const [compiling,setCompiling]=useState(false);const [stale,setStale]=useState(false);
  const [shareOpen,setShareOpen]=useState(initialInvitationsOpen&&project.role==='owner');
  const [panels,setPanels]=useState<PanelSettings>({explorerWidth:232,pdfWidth:520,problemsHeight:220});
  const [problemsOpen,setProblemsOpen]=useState(false);
  const [cursorLine,setCursorLine]=useState(1);
  const editor=useRef<LatexEditorHandle>(null);const leaseRef=useRef(lease);leaseRef.current=lease;
  const contentRef=useRef(content);contentRef.current=content;const activeRef=useRef<SharedFile|null>(null);
  const live=useRef(true);const choice=useRef(0);const draftWrites=useRef<Promise<void>>(Promise.resolve());const pendingDone=useRef<DoneInput|null>(null);
  const snapshotRequest=useRef(0);const filesRef=useRef(files);filesRef.current=files;
  const saveSequence=useRef(0);const busyRef=useRef(false);
  const syncRef=useRef<()=>void>(()=>{});
  const current=files.find(f=>f.id===activeId)??null;activeRef.current=current;
  const refresh=async()=>{
    const request=++snapshotRequest.current;const {files:f,directories:d,workspacePath:folder}=await api.snapshot(project.id);
    if(live.current&&request===snapshotRequest.current){
      if(f.some(file=>filesRef.current.some(previous=>previous.id===file.id&&previous.version!==file.version)))setStale(true);
      const editing=leaseRef.current;
      if(editing&&!f.some(file=>file.id===editing.file.id&&file.version===editing.file.version&&file.editor?.id===account.id)){
        persist(editing.file,contentRef.current,editing.file.version);leaseRef.current=null;setLease(null);setDraft({content:contentRef.current,baseVersion:editing.file.version});setPreserved(false);setNotice('A newer published version is available. Your previous draft is kept separately on this device.');
      }
      setFiles(f);setDirectories(d);setWorkspacePath(folder);setSynchronized(true);setRoot(r=>r||f.find(x=>x.path==='main.tex')?.path||f.find(x=>x.path.toLowerCase().endsWith('.tex'))?.path||'');
    }
    return f;
  };
  const persist=(file:SharedFile,value:string,version:number)=>{
    const sequence=++saveSequence.current;setSaveState('saving');
    draftWrites.current=draftWrites.current.catch(()=>undefined).then(()=>api.saveDraft(project.id,file.path,value,version));
    void draftWrites.current.then(()=>{if(live.current&&sequence===saveSequence.current)setSaveState('saved');}).catch(e=>{if(live.current){setSaveState('failed');setError(`Your draft could not be saved on this device: ${errorMessage(e)}`);}});
  };
  useEffect(()=>{
    live.current=true;let active=true;let loading=false;let pending=false;
    const disconnected='Live updates disconnected. Reconnecting; your draft stays on this device.';
    const sync=()=>{
      pending=true;if(loading||!active)return;loading=true;
      void (async()=>{try{do{pending=false;await refresh();}while(pending&&active);}catch(e){if(active){setSynchronized(false);setError(errorMessage(e));}}finally{loading=false;}})();
    };
    syncRef.current=sync;
    const disconnect=()=>{
      snapshotRequest.current++;setSynchronized(false);
      const l=leaseRef.current;if(l){persist(l.file,contentRef.current,l.file.version);leaseRef.current=null;setLease(null);setPreserved(true);setNotice('Your draft is kept locally. Reconnect and synchronize before requesting Edit.');void api.release(l.file.id,l.token).catch(()=>undefined);}
      setError(disconnected);
    };
    const unsubscribe=api.onProjectUpdate(project.id,event=>{
      if(!active||event.projectId!==project.id)return;
      if(event.type==='disconnected'){disconnect();return;}
      if(event.type==='connected'){setError(previous=>previous===disconnected?'':previous);setPreserved(false);}
      sync();
    });
    window.addEventListener('offline',disconnect);window.addEventListener('online',sync);
    sync();
    return()=>{active=false;live.current=false;window.removeEventListener('offline',disconnect);window.removeEventListener('online',sync);snapshotRequest.current++;choice.current++;unsubscribe();const l=leaseRef.current;if(l){persist(l.file,contentRef.current,l.file.version);void draftWrites.current.then(()=>api.release(l.file.id,l.token)).catch(()=>undefined);}void api.cancelCompile?.().catch(()=>undefined);};
  },[project.id]);
  // A lost client cannot send a release event: reload once when its lease expires.
  useEffect(()=>{
    const deadlines=files.flatMap(file=>file.editor&&file.id!==lease?.file.id?[new Date(file.editor.expiresAt).getTime()]:[]).filter(Number.isFinite);
    if(!deadlines.length)return;
    const timer=setTimeout(()=>syncRef.current(),Math.max(1000,Math.min(...deadlines)-Date.now()+100));
    return()=>clearTimeout(timer);
  },[files,lease?.file.id]);
  useEffect(()=>{
    if(!files.length||activeId)return;setActiveId(files[0]!.id);setContent(files[0]!.content);
    void api.draft(project.id,files[0]!.path).then(d=>{if(live.current)setDraft(d);}).catch(e=>setError(errorMessage(e)));
  },[files,activeId,project.id]);
  useEffect(()=>{if(current&&!lease&&!preserved&&!pendingDone.current)setContent(current.content);},[current?.content,current?.id,lease,preserved]);
  useEffect(()=>{
    if(!lease)return;
    const token=lease.token;const file=lease.file;
    const lost=(reason:string)=>{if(!live.current||leaseRef.current?.token!==token)return;persist(file,contentRef.current,file.version);leaseRef.current=null;setLease(null);setPreserved(true);setNotice('Edit access ended. Your draft is kept on this device.');setError(reason);};
    const expiry=setTimeout(()=>lost('Edit access expired. Request Edit again before publishing.'),Math.max(0,new Date(lease.expiresAt).getTime()-Date.now()));
    const heartbeat=setInterval(()=>{void api.renew(file.id,token).then(r=>{if(live.current&&leaseRef.current?.token===token)setLease(l=>l?.token===token?{...l,expiresAt:r.expiresAt}:l);}).catch(e=>lost(errorMessage(e)));},20_000);
    return()=>{clearTimeout(expiry);clearInterval(heartbeat);};
  },[lease?.token,lease?.expiresAt]);
  const run=async(action:()=>Promise<void>)=>{if(busyRef.current)return;busyRef.current=true;setBusy(true);setError('');try{await action();}catch(e){setError(errorMessage(e));}finally{busyRef.current=false;if(live.current)setBusy(false);}};
  const view=async()=>{
    const l=leaseRef.current;
    if(l){persist(l.file,contentRef.current,l.file.version);await draftWrites.current;await api.release(l.file.id,l.token);leaseRef.current=null;setLease(null);setDraft({content:contentRef.current,baseVersion:l.file.version});}
    pendingDone.current=null;setPreserved(false);if(activeRef.current)setContent(activeRef.current.content);setNotice('View mode. Any unpublished draft is kept on this device.');
  };
  const select=(file:SharedFile)=>run(async()=>{
    if(pendingDone.current)throw new Error('Retry Done before switching files so its result can be confirmed.');
    if(leaseRef.current)await view();
    const seq=++choice.current;setActiveId(file.id);setCursorLine(1);setContent(file.content);setPreserved(false);setDraft(null);setHistory(null);setNotice('');
    const d=await api.draft(project.id,file.path);if(live.current&&choice.current===seq)setDraft(d);
  });
  const acquire=()=>run(async()=>{
    if(!current)return;if(!synchronized)throw new Error('Synchronize with GitHub before requesting Edit.');if(pendingDone.current)throw new Error('Retry Done to confirm the previous update first.');
    const l=await api.acquire(current.id);if(!live.current){await api.release(current.id,l.token);return;}
    leaseRef.current=l;setLease(l);setFiles(f=>f.map(x=>x.id===l.file.id?l.file:x));setContent(l.file.content);setPreserved(false);setNotice('Only you can edit this file. Done publishes your changes and returns to View.');
    const d=await api.draft(project.id,l.file.path);if(live.current)setDraft(d);
  });
  const done=()=>run(async()=>{
    if(!pendingDone.current){const l=leaseRef.current;if(!l)return;pendingDone.current={fileId:l.file.id,token:l.token,baseVersion:l.file.version,content:contentRef.current,requestId:crypto.randomUUID()};persist(l.file,contentRef.current,l.file.version);}
    await draftWrites.current;
    setNotice('Saved locally. Waiting for a publication turn and publishing to GitHub…');
    const request=pendingDone.current;
    let result:SharedFile;
    try { result=await api.done(request); }
    catch (failure) {
      if (/Edit access has expired|Publication turn expired|newer version|permission|Please sign in|too large|request ID was already used/.test(errorMessage(failure))) {
        pendingDone.current=null;leaseRef.current=null;setLease(null);setPreserved(true);setDraft({content:request.content,baseVersion:request.baseVersion});
      }
      setNotice('Saved locally. Publication needs a retry; your draft is preserved.');
      throw failure;
    }
    await api.clearDraft(project.id,result.path);
    pendingDone.current=null;leaseRef.current=null;setLease(null);setDraft(null);setPreserved(false);setContent(result.content);setFiles(f=>f.map(x=>x.id===result.id?result:x));setNotice('Published to GitHub. Your commit is confirmed and Edit is available.');setStale(Boolean(pdf));await refresh();
  });
  const change=(value:string)=>{const l=leaseRef.current;if(!l||busy||pendingDone.current)return;setContent(value);contentRef.current=value;setStale(Boolean(pdf));persist(l.file,value,l.file.version);};
  const saveCurrent=()=>run(async()=>{const l=leaseRef.current;if(!l)return;persist(l.file,contentRef.current,l.file.version);await draftWrites.current;setNotice('Saved in your project folder. Click Done to publish to GitHub.');});
  const compile=async()=>{
    if(compiling||!root)return;setCompiling(true);setError('');setPdfOpen(true);
    try{const snapshot=await refresh();const source=snapshot.map(f=>({path:f.path,content:f.id===current?.id&&(leaseRef.current||preserved)?contentRef.current:f.content,encoding:f.encoding}));const result=await api.compile(project.id,source,root,engine);setPdf(p=>preserveLastSuccessfulPdf(p,result));setStale(!result.success);if(!result.success)setError(result.errors[0]?.message??'Compilation failed.');}
    catch(e){setError(errorMessage(e));}finally{if(live.current)setCompiling(false);}
  };
  const leave=()=>run(async()=>{if(pendingDone.current)throw new Error('Retry Done before leaving so its result can be confirmed.');if(leaseRef.current)await view();await draftWrites.current;onClose();});
  const tree=sharedFileTree(files,directories);
  const diagnostics=pdf?[...pdf.errors,...pdf.warnings]:[];
  const createFile=async(filePath:string):Promise<string|null>=>{
    let created:string|null=null;
    await run(async()=>{
      const file=await api.createFile(project.id,filePath);created=file.path;const next=await refresh();
      if(!leaseRef.current&&!pendingDone.current){setActiveId(file.id);setContent(file.content);setDraft(null);setPreserved(false);}
      setRoot(r=>r||next.find(f=>f.path.toLowerCase().endsWith('.tex'))?.path||'');
      setStale(Boolean(pdf));
    });
    return created;
  };
  const createDirectory=async(directory:string):Promise<string|null>=>{
    let created:string|null=null;
    await run(async()=>{created=await api.createDirectory(project.id,directory);await refresh();});
    return created;
  };
  const importItems=async(action:()=>Promise<string[]>):Promise<string[]>=>{
    let imported:string[]=[];
    await run(async()=>{imported=await action();if(imported.length){await refresh();setStale(Boolean(pdf));}});
    return imported;
  };
  return <WorkspaceFrame settings={settings??panels} onResize={(key,value,persist)=>{if(onResize)onResize(key,value,persist);else setPanels(p=>({...p,[key]:value}));}}
    pdfOpen={pdfOpen} pdfUrl={pdf?.pdfUrl} pdfStale={stale} onClosePdf={()=>setPdfOpen(false)}
    problemsOpen={problemsOpen} diagnostics={diagnostics} log={pdf?.log??''} onToggleProblems={()=>setProblemsOpen(!problemsOpen)}
    onSelectDiagnostic={diagnostic=>{const file=files.find(f=>f.path===diagnostic.file?.replace(/^\/workspace\//,''));if(file&&diagnostic.line)void select(file).then(()=>requestAnimationFrame(()=>editor.current?.jumpTo(diagnostic.line!,diagnostic.column)));}}
    status={<StatusBar file={current?.path} engine={engine} git={{available:true,isRepository:true}} collaboration/>}
    overlay={<>
      {error?<div className="toast toast-error" role="alert"><CircleAlert/><span>{error}</span><button type="button" aria-label="Dismiss" onClick={()=>setError('')}><X/></button></div>:null}
      {shareOpen?<InvitationDialog projectName={project.name} onClose={()=>setShareOpen(false)} onInvite={async username=>{
        await api.invite(project.id,username,'editor');
        setNotice('GitHub invitation sent. They can accept it in Projects after signing in with GitHub.');
        setShareOpen(false);
      }}/>:null}
    </>}
    toolbar={<CompileToolbar project={{name:project.name,workspacePath,rootDocument:root}} texFiles={tree.filter(f=>f.kind==='file'&&f.path.toLowerCase().endsWith('.tex'))}
      engine={engine} saveState={saveState} compileEvent={{phase:compiling?'running':pdf?(pdf.success?'success':pdf.cancelled?'cancelled':'failed'):'idle',message:compiling?'Compiling…':pdf?(pdf.success?'Compilation complete':pdf.cancelled?'Compilation cancelled':'Compilation failed'):'Ready to compile'}}
      pdfOpen={pdfOpen} disabled={busy} onShowProjects={()=>void leave()} onSave={()=>void saveCurrent()}
      onSetRoot={setRoot} onSetEngine={setEngine} onCompile={()=>void compile()} onCancel={()=>void api.cancelCompile().catch(e=>setError(errorMessage(e)))} onTogglePdf={()=>setPdfOpen(!pdfOpen)}
      status={lease?<span className="quiet-status" title={`Signed in as ${account.displayName}`}>{saveState==='failed'?'Save failed':saveState==='saving'?'Saving…':'Saved locally · Editing'}</span>:undefined}
      actions={project.role==='owner'?<button className="button button-secondary" type="button" disabled={busy} onClick={()=>setShareOpen(true)}><Users/> Collaborate</button>:<span className="quiet-status"><Users/> Collaboration enabled</span>}/>
    }
    explorer={<ProjectExplorer files={tree} selectedPath={current?.path} rootDocument={root} outlineFilePath={current?.path} outlineItems={current?.encoding==='utf8'?parseOutline(content,current.path):[]} outlineActiveLine={cursorLine}
      disabled={busy||!synchronized} capabilities={{createFile:project.role!=='viewer',createDirectory:project.role!=='viewer',move:false,remove:false,import:project.role!=='viewer'}}
      fileNotes={Object.fromEntries(files.filter(f=>f.editor).map(f=>[f.path,`${f.editor!.displayName} editing`]))}
      onOpen={filePath=>{const file=files.find(f=>f.path===filePath);if(file)void select(file);}} onCreateFile={createFile}
      onCreateDirectory={createDirectory} onMove={()=>Promise.resolve(null)} onRemove={()=>Promise.resolve(false)}
      onImportFiles={destination=>importItems(()=>api.importFiles(project.id,destination))}
      onImportFolder={destination=>importItems(()=>api.importFolder(project.id,destination))}
      onImportDropped={(dropped,destination)=>importItems(()=>api.importDropped(project.id,dropped.map(file=>window.desktop.file.pathForDroppedFile(file)),destination))}
      onSelectOutline={item=>editor.current?.jumpTo(item.line,item.column)}/>
    }
  >
        <div className="shared-file-toolbar"><div>
          <button className="shared-mode-switch" type="button" role="switch" aria-label="Edit mode" aria-checked={Boolean(lease)}
            disabled={busy||Boolean(pendingDone.current)||(!lease&&(!synchronized||project.role==='viewer'||!current||Boolean(current.editor)||current.encoding==='base64'))}
            title={lease?'Switch to View and keep your unpublished draft':project.role==='viewer'?'You have view-only access':current?.encoding==='base64'?'Attachments are view-only':current?.editor?`${current.editor.displayName} is editing`: 'Switch to Edit'}
            onClick={()=>{if(lease)void run(view);else void acquire();}}>
            <span className="shared-mode-switch-thumb" aria-hidden="true"/>
            <span className="shared-mode-switch-label" aria-hidden="true">View</span>
            <span className="shared-mode-switch-label" aria-hidden="true">Edit</span>
          </button>
          <button className="button button-primary" type="button" disabled={busy||(!lease&&!pendingDone.current)} onClick={()=>void done()}>{pendingDone.current?'Retry Done':'Done'}</button>
          <button className="button button-secondary" type="button" disabled={!current||busy||current.encoding==='base64'} onClick={()=>void run(async()=>{setHistory(history?null:await api.history(current!.id));})}>History</button>
        </div></div>
        {!synchronized?<p className="shared-notice" role="status">Not synchronized with GitHub. Edit is unavailable. <button className="button button-secondary" type="button" disabled={busy} onClick={()=>syncRef.current()}>Retry synchronization</button></p>:null}
        {workspacePath?<p className="shared-notice" title={workspacePath}>Project folder: <code>{workspacePath}</code></p>:null}
        {notice?<p className="shared-notice" role="status">{notice}</p>:null}
        {current?.editor&&!lease?<p className="shared-notice">{current.editor.displayName} is editing. You can keep reading.</p>:null}
        {preserved?<p className="shared-notice">Unpublished draft shown below. Request Edit to review it against the latest shared version.</p>:null}
        {draft&&draft.content!==current?.content?<details className="shared-draft"><summary>A saved draft is available {draft.baseVersion!==current?.version?'from an older version':''}</summary><div className="shared-draft-comparison"><label>Latest shared version<textarea readOnly value={current?.content??''}/></label><label>Your saved draft<textarea readOnly value={draft.content}/></label></div><button className="button button-secondary" type="button" disabled={!lease||busy} onClick={()=>{setContent(draft.content);contentRef.current=draft.content;persist(lease!.file,draft.content,lease!.file.version);setDraft(null);setNotice('Draft restored into your editor. Review it, then click Done to publish.');}}>Use draft in editor</button></details>:null}
        <div className="shared-source">{current?.encoding==='base64'?<div className="shared-attachment"><strong>{current.path}</strong><p>Project attachment · View only</p>{/\.(png|jpg|jpeg|svg)$/i.test(current.path)?<img alt={current.path} src={`data:${current.path.endsWith('.svg')?'image/svg+xml':current.path.endsWith('.png')?'image/png':'image/jpeg'};base64,${current.content}`}/>:<p>This attachment is included when the project is compiled.</p>}</div>:current?<LatexEditor ref={editor} path={current.path} value={content} diagnostics={pdf?[...pdf.errors,...pdf.warnings]:[]} readOnly={!lease||busy||Boolean(pendingDone.current)} onChange={change} onCursorLineChange={setCursorLine} onSave={()=>void saveCurrent()}/>:<p>No files yet.</p>}</div>
        {history?<section className="shared-history" aria-label="File history"><h2>File history</h2>{history.map(r=><details key={r.id}><summary>Version {r.version} · {r.author} · {new Date(r.createdAt).toLocaleString()}</summary><textarea aria-label={`Version ${r.version} content`} readOnly value={r.content}/></details>)}</section>:null}
  </WorkspaceFrame>;
}
