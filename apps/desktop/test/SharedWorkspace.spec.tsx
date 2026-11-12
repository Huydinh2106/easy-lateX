// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Account, CollaborationApi, CompileResult, SharedFile } from '@easy-latex/shared-types';
vi.mock('../src/renderer/features/editor/LatexEditor',()=>({LatexEditor:({value,readOnly,onChange,onSyncToPdf}:{value:string;readOnly:boolean;onChange(v:string):void;onSyncToPdf?(line:number):void})=><textarea aria-label="Source" readOnly={readOnly} value={value} onChange={e=>onChange(e.target.value)} onDoubleClick={()=>onSyncToPdf?.(5)}/>}));
vi.mock('../src/renderer/features/pdf/PdfViewer',()=>({PdfViewer:({url,jumpTarget}:{url?:string;jumpTarget?:{page:number;x:number;y:number;nonce:number}|null})=><div aria-label="PDF preview" data-url={url}>{jumpTarget?<output aria-label="PDF position">{jumpTarget.page}:{jumpTarget.x}:{jumpTarget.y}</output>:null}</div>}));
vi.mock('../src/renderer/features/project/FileOutline',()=>({FileOutline:()=>null}));
import { SharedWorkspace } from '../src/renderer/features/collaboration/SharedWorkspace';
const account:Account={id:'owner',email:'owner@example.test',displayName:'Owner'};
const file:SharedFile={id:'file',projectId:'project',path:'main.tex',content:'Published source',version:1,encoding:'utf8',updatedAt:'2026-10-04T00:00:00Z',editor:null};
const preview:CompileResult={success:true,cancelled:false,errors:[],warnings:[],duration:1,log:'',engine:'pdflatex',rootDocument:'main.tex',pdfUrl:'easy-latex://pdf/11111111-1111-4111-8111-111111111111'};
const api={snapshot:vi.fn(),onProjectUpdate:vi.fn<CollaborationApi['onProjectUpdate']>(),files:vi.fn(),directories:vi.fn(),createDirectory:vi.fn(),importFiles:vi.fn(),importFolder:vi.fn(),importDropped:vi.fn(),draft:vi.fn(),saveDraft:vi.fn(),clearDraft:vi.fn(),acquire:vi.fn(),renew:vi.fn(),release:vi.fn(),done:vi.fn(),history:vi.fn(),createFile:vi.fn(),invite:vi.fn(),compile:vi.fn<CollaborationApi['compile']>(),cancelCompile:vi.fn<CollaborationApi['cancelCompile']>(),forwardSync:vi.fn<CollaborationApi['forwardSync']>()};
beforeEach(()=>{vi.resetAllMocks();api.compile.mockResolvedValue(preview);api.cancelCompile.mockResolvedValue(false);api.forwardSync.mockResolvedValue({available:true,page:2,x:100,y:190});api.snapshot.mockImplementation(async()=>({files:await api.files() as SharedFile[],directories:await api.directories() as string[],workspacePath:'/projects/Paper'}));api.onProjectUpdate.mockReturnValue(vi.fn());api.files.mockResolvedValue([file]);api.directories.mockResolvedValue([]);api.draft.mockResolvedValue(null);api.saveDraft.mockResolvedValue(undefined);api.clearDraft.mockResolvedValue(undefined);api.release.mockResolvedValue(undefined);api.acquire.mockResolvedValue({token:'lease',expiresAt:new Date(Date.now()+90_000).toISOString(),file:{...file,editor:{id:account.id,displayName:'Owner',expiresAt:new Date(Date.now()+90_000).toISOString()}}});api.done.mockResolvedValue({...file,content:'Changed source',version:2});Object.defineProperty(window,'desktop',{value:{collaboration:api,file:{pathForDroppedFile:()=>'/tmp/plot.png'}},configurable:true});});
afterEach(()=>{cleanup();vi.useRealTimers();});
const open=async(role:'owner'|'editor'|'viewer'='owner')=>{render(<SharedWorkspace project={{id:'project',name:'Shared paper',role}} account={account} onClose={()=>undefined}/>);await waitFor(()=>expect(screen.getByLabelText('Source')).toHaveValue('Published source'));};
describe('Cloud source to PDF navigation',()=>{
  const compile=async()=>{
    fireEvent.click(screen.getByRole('button',{name:'Compile'}));
    await screen.findByText('Compilation complete');
  };
  it('explains when the source has no compiled PDF yet',async()=>{
    await open();fireEvent.doubleClick(screen.getByLabelText('Source'));
    await screen.findByText('Compile the project before jumping to the PDF.');
    expect(api.forwardSync).not.toHaveBeenCalled();
  });
  it('navigates a read-only source using the cloud project and displayed PDF',async()=>{
    await open('viewer');await compile();
    fireEvent.click(screen.getByRole('button',{name:'PDF'}));
    expect(screen.queryByLabelText('PDF preview')).not.toBeInTheDocument();
    fireEvent.doubleClick(screen.getByLabelText('Source'));
    await screen.findByLabelText('PDF position');
    expect(api.forwardSync).toHaveBeenCalledExactlyOnceWith('project',preview.pdfUrl,{file:'main.tex',line:5});
    expect(screen.getByLabelText('PDF position')).toHaveTextContent('2:100:190');
    expect(screen.getByLabelText('PDF preview')).toHaveAttribute('data-url',preview.pdfUrl);
  });
  it('keeps navigation paired with the last PDF after a failed compile',async()=>{
    await open();await compile();
    const failed:CompileResult={success:false,cancelled:false,errors:[{severity:'error',message:'Broken source'}],warnings:[],duration:1,log:'',engine:'pdflatex',rootDocument:'main.tex'};
    api.compile.mockResolvedValueOnce(failed);
    fireEvent.click(screen.getByRole('button',{name:'Compile'}));
    await screen.findByText('Broken source');
    fireEvent.click(screen.getByRole('button',{name:'Jump to PDF'}));
    await screen.findByLabelText('PDF position');
    expect(api.forwardSync).toHaveBeenCalledExactlyOnceWith('project',preview.pdfUrl,{file:'main.tex',line:1});
    expect(screen.getByLabelText('PDF preview')).toHaveAttribute('data-url',preview.pdfUrl);
  });
  it('shows unavailable SyncTeX without a stale jump target',async()=>{
    api.forwardSync.mockResolvedValue({available:false,reason:'This PDF has no source mapping.'});
    await open();await compile();fireEvent.doubleClick(screen.getByLabelText('Source'));
    await screen.findByText('This PDF has no source mapping.');
    expect(screen.queryByLabelText('PDF position')).not.toBeInTheDocument();
  });
  it('ignores an old navigation response when a newer PDF is displayed',async()=>{
    let finish!: (result:Awaited<ReturnType<CollaborationApi['forwardSync']>>)=>void;
    api.forwardSync.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
    await open();await compile();fireEvent.doubleClick(screen.getByLabelText('Source'));
    await waitFor(()=>expect(api.forwardSync).toHaveBeenCalledTimes(1));
    const nextUrl='easy-latex://pdf/33333333-3333-4333-8333-333333333333';
    api.compile.mockResolvedValueOnce({...preview,pdfUrl:nextUrl});
    fireEvent.click(screen.getByRole('button',{name:'Compile'}));
    await waitFor(()=>expect(screen.getByLabelText('PDF preview')).toHaveAttribute('data-url',nextUrl));
    await act(()=>{finish({available:true,page:9,x:10,y:10});return Promise.resolve();});
    expect(screen.queryByLabelText('PDF position')).not.toBeInTheDocument();
    fireEvent.doubleClick(screen.getByLabelText('Source'));
    await screen.findByLabelText('PDF position');
    expect(api.forwardSync).toHaveBeenLastCalledWith('project',nextUrl,{file:'main.tex',line:5});
    expect(screen.getByLabelText('PDF position')).toHaveTextContent('2:100:190');
  });
});
describe('Shared file access in the editor',()=>{
  it('uses one snapshot and displays the actual working folder',async()=>{
    await open();expect(api.snapshot).toHaveBeenCalledWith('project');
    expect(screen.getByText('/projects/Paper')).toBeInTheDocument();
  });
  it('blocks Edit after a synchronization error until a successful refresh',async()=>{
    api.snapshot.mockRejectedValueOnce(new Error('Supabase unavailable'));
    render(<SharedWorkspace project={{id:'project',name:'Paper',role:'owner'}} account={account} onClose={()=>undefined}/>);
    await screen.findByText('Supabase unavailable');expect(screen.getByRole('switch',{name:'Edit mode'})).toBeDisabled();
    fireEvent.click(screen.getByRole('button',{name:'Retry synchronization'}));
    await waitFor(()=>expect(screen.getByRole('switch',{name:'Edit mode'})).toBeEnabled());
  });
  it('does not publish when saving the current source file fails',async()=>{
    await open();fireEvent.click(screen.getByRole('switch',{name:'Edit mode'}));
    await waitFor(()=>expect(screen.getByLabelText('Source')).not.toHaveAttribute('readonly'));
    api.saveDraft.mockRejectedValue(new Error('Disk is full'));
    fireEvent.change(screen.getByLabelText('Source'),{target:{value:'Do not lose this'}});
    fireEvent.click(screen.getByRole('button',{name:'Done'}));
    await screen.findByText('Save failed');expect(api.done).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Source')).toHaveValue('Do not lose this');
  });
  it('keeps Visual mode read-only until Edit is acquired and publishes the shared visual buffer', async () => {
    await open();
    fireEvent.click(screen.getByRole('switch', {name: 'Visual mode'}));
    expect(screen.getByRole('textbox', {name: 'Paragraph 1'})).toHaveAttribute('contenteditable', 'false');
    fireEvent.click(screen.getByRole('switch', {name: 'Edit mode'}));
    await waitFor(() => expect(screen.getByRole('textbox', {name: 'Paragraph 1'})).toHaveAttribute('contenteditable', 'true'));
    const paragraph = screen.getByRole('textbox', {name: 'Paragraph 1'});
    fireEvent.focus(paragraph); paragraph.textContent = 'Visual draft with 100%'; fireEvent.input(paragraph);
    fireEvent.click(screen.getByRole('button', {name: 'Done'}));
    await waitFor(() => expect(api.done).toHaveBeenCalledWith(expect.objectContaining({content: 'Visual draft with 100\\%'})));
    await waitFor(() => expect(screen.getByRole('switch', {name: 'Edit mode'})).not.toBeChecked());
  });
  it('continues renewing Edit while the window is hidden',async()=>{
    vi.useFakeTimers({toFake:['setInterval','clearInterval']});api.renew.mockResolvedValue({expiresAt:new Date(Date.now()+120_000).toISOString()});
    await open();fireEvent.click(screen.getByRole('switch',{name:'Edit mode'}));
    await waitFor(()=>expect(screen.getByLabelText('Source')).not.toHaveAttribute('readonly'));
    Object.defineProperty(document,'visibilityState',{value:'hidden',configurable:true});
    try{await act(()=>document.dispatchEvent(new Event('visibilitychange')));await act(async()=>{await vi.advanceTimersByTimeAsync(20_000);});
      expect(api.renew).toHaveBeenCalledWith('file','lease');expect(api.release).not.toHaveBeenCalled();
    }finally{Object.defineProperty(document,'visibilityState',{value:'visible',configurable:true});}
  });
  it('loads published changes on push and reconnect without polling while idle',async()=>{
    vi.useFakeTimers({toFake:['setInterval','clearInterval']});
    const unsubscribe=vi.fn();api.onProjectUpdate.mockReturnValue(unsubscribe);
    await open();expect(api.onProjectUpdate).toHaveBeenCalledWith('project',expect.any(Function));
    const update=api.onProjectUpdate.mock.calls[0]![1];
    await act(async()=>{await vi.advanceTimersByTimeAsync(15_000);});
    expect(api.files).toHaveBeenCalledTimes(1);
    api.files.mockResolvedValue([{...file,version:2,content:'Published by someone else'}]);
    act(()=>{update({projectId:'project',type:'changed'});});
    await waitFor(()=>expect(screen.getByLabelText('Source')).toHaveValue('Published by someone else'));
    act(()=>{update({projectId:'project',type:'disconnected'});});
    api.files.mockResolvedValue([{...file,version:3,content:'Published while disconnected'}]);
    act(()=>{update({projectId:'project',type:'connected'});});
    await waitFor(()=>expect(screen.getByLabelText('Source')).toHaveValue('Published while disconnected'));
    cleanup();expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
  it('keeps the active draft when a push updates another file',async()=>{
    await open();fireEvent.click(screen.getByRole('switch',{name:'Edit mode'}));
    await waitFor(()=>expect(screen.getByLabelText('Source')).not.toHaveAttribute('readonly'));
    fireEvent.change(screen.getByLabelText('Source'),{target:{value:'My unpublished work'}});
    api.files.mockResolvedValue([{...file,editor:{id:account.id,displayName:'Owner',expiresAt:new Date(Date.now()+90_000).toISOString()}},{...file,id:'second',path:'chapter.tex',version:2,content:'New chapter'}]);
    act(()=>{api.onProjectUpdate.mock.calls[0]![1]({projectId:'project',type:'changed'});});
    await screen.findByRole('treeitem',{name:/chapter.tex/});
    expect(screen.getByLabelText('Source')).toHaveValue('My unpublished work');
    expect(screen.getByRole('switch',{name:'Edit mode'})).toBeChecked();
  });
  it.each(['owner','editor'] as const)('keeps all four file actions available for a %s',async role=>{
    await open(role);
    for(const name of ['New file','New folder','Add files','Add folder'])expect(screen.getByRole('button',{name})).toBeEnabled();
  });
  it('creates an empty shared folder and uploads into the selected folder',async()=>{
    api.createDirectory.mockImplementation(()=>{api.directories.mockResolvedValue(['figures']);return Promise.resolve('figures');});
    api.importFiles.mockImplementation(()=>{api.files.mockResolvedValue([file,{...file,id:'image',path:'figures/plot.png',encoding:'base64'}]);return Promise.resolve(['figures/plot.png']);});
    await open();fireEvent.click(screen.getByRole('button',{name:'New folder'}));fireEvent.change(screen.getByLabelText('New folder name'),{target:{value:'figures'}});fireEvent.click(screen.getByRole('button',{name:'Create'}));
    await waitFor(()=>expect(api.createDirectory).toHaveBeenCalledWith('project','figures'));
    await screen.findByText('figures');await waitFor(()=>expect(screen.getByRole('button',{name:'Add files'})).toBeEnabled());
    fireEvent.click(screen.getByRole('button',{name:'Add files'}));await screen.findByText('plot.png');
    expect(api.importFiles).toHaveBeenCalledWith('project','figures');
  });
  it('uploads a folder without discarding an active edit',async()=>{
    api.importFolder.mockImplementation(()=>{api.files.mockResolvedValue([{...file,editor:{id:account.id,displayName:'Owner',expiresAt:new Date(Date.now()+90_000).toISOString()}},{...file,id:'chapter',path:'chapters/intro.tex',content:'Chapter'}]);api.directories.mockResolvedValue(['chapters','chapters/empty']);return Promise.resolve(['chapters/intro.tex','chapters/empty']);});
    await open();fireEvent.click(screen.getByRole('switch',{name:'Edit mode'}));await waitFor(()=>expect(screen.getByLabelText('Source')).not.toHaveAttribute('readonly'));
    fireEvent.change(screen.getByLabelText('Source'),{target:{value:'Work in progress'}});fireEvent.click(screen.getByRole('button',{name:'Add folder'}));
    await screen.findByText('chapters');expect(api.importFolder).toHaveBeenCalledWith('project','');expect(screen.getByLabelText('Source')).toHaveValue('Work in progress');expect(api.release).not.toHaveBeenCalled();
  });
  it('shows import failures and keeps the published file tree',async()=>{
    api.importFiles.mockRejectedValue(new Error('This file already exists'));await open();fireEvent.click(screen.getByRole('button',{name:'Add files'}));await screen.findByText('This file already exists');expect(screen.getByRole('treeitem',{name:/main.tex/})).toBeInTheDocument();expect(screen.getByRole('button',{name:'Add files'})).toBeEnabled();
  });
  it('opens invitation settings after activation without sending an invitation until submitted',async()=>{
    api.invite.mockResolvedValue(undefined);
    render(<SharedWorkspace project={{id:'project',name:'Paper',role:'owner'}} account={account} onClose={()=>undefined} initialInvitationsOpen/>);
    await screen.findByRole('dialog',{name:'Invite people'});expect(api.invite).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Email address'),{target:{value:'editor@example.com'}});
    fireEvent.click(screen.getByRole('button',{name:'Add invitation'}));
    await waitFor(()=>expect(api.invite).toHaveBeenCalledWith('project','editor@example.com','editor'));
  });
  it('preserves view-only permissions when the owner invites by email',async()=>{
    api.invite.mockResolvedValue(undefined);
    render(<SharedWorkspace project={{id:'project',name:'Paper',role:'owner'}} account={account} onClose={()=>undefined} initialInvitationsOpen/>);
    fireEvent.change(await screen.findByLabelText('Email address'),{target:{value:'reader@example.com'}});
    fireEvent.change(screen.getByLabelText('Permission'),{target:{value:'viewer'}});
    fireEvent.click(screen.getByRole('button',{name:'Add invitation'}));
    await waitFor(()=>expect(api.invite).toHaveBeenCalledWith('project','reader@example.com','viewer'));
  });
  it('starts in View, enables typing only after acquiring Edit, and publishes Done',async()=>{
    await open();expect(screen.getByLabelText('Source')).toHaveAttribute('readonly');
    expect(screen.getByRole('switch',{name:'Edit mode'})).not.toBeChecked();
    fireEvent.click(screen.getByRole('switch',{name:'Edit mode'}));await waitFor(()=>expect(screen.getByLabelText('Source')).not.toHaveAttribute('readonly'));
    expect(screen.getByRole('switch',{name:'Edit mode'})).toBeChecked();
    fireEvent.change(screen.getByLabelText('Source'),{target:{value:'Changed source'}});
    await screen.findByText('Saved locally · Click Done to save to cloud');
    expect(api.done).not.toHaveBeenCalled();
    expect(screen.getByTitle('Signed in as owner@example.test')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button',{name:'Done'}));
    await waitFor(()=>expect(api.done).toHaveBeenCalledWith(expect.objectContaining({token:'lease',baseVersion:1,content:'Changed source'})));
    await waitFor(()=>expect(screen.getByLabelText('Source')).toHaveAttribute('readonly'));expect(api.clearDraft).toHaveBeenCalledWith('project','main.tex');
    expect(screen.getByRole('switch',{name:'Edit mode'})).not.toBeChecked();
    expect(screen.getByText('Saved to Supabase. Your changes are available to collaborators.')).toBeInTheDocument();
  });
  it('switches back to View by keeping the draft and releasing access without publishing',async()=>{
    await open();fireEvent.click(screen.getByRole('switch',{name:'Edit mode'}));
    await waitFor(()=>expect(screen.getByLabelText('Source')).not.toHaveAttribute('readonly'));
    fireEvent.change(screen.getByLabelText('Source'),{target:{value:'Private draft'}});
    fireEvent.click(screen.getByRole('switch',{name:'Edit mode'}));
    await waitFor(()=>expect(screen.getByRole('switch',{name:'Edit mode'})).not.toBeChecked());
    expect(api.release).toHaveBeenCalledWith('file','lease');
    expect(api.saveDraft).toHaveBeenCalledWith('project','main.tex','Private draft',1);
    expect(api.done).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Source')).toHaveAttribute('readonly');
    expect(screen.getByLabelText('Source')).toHaveValue('Published source');
  });
  it('keeps an old draft separate until the user acquires Edit and explicitly restores it',async()=>{
    api.draft.mockResolvedValue({content:'Old private draft',baseVersion:1});await open();fireEvent.click(screen.getByText(/A saved draft is available/));expect(screen.getByLabelText('Source')).toHaveValue('Published source');expect(screen.getByRole('button',{name:'Use draft in editor'})).toBeDisabled();
    fireEvent.click(screen.getByRole('switch',{name:'Edit mode'}));await waitFor(()=>expect(screen.getByRole('button',{name:'Use draft in editor'})).toBeEnabled());fireEvent.click(screen.getByRole('button',{name:'Use draft in editor'}));expect(screen.getByLabelText('Source')).toHaveValue('Old private draft');
  });
  it('preserves the draft and retries an uncertain Done with the identical request ID',async()=>{
    api.done.mockRejectedValueOnce(new Error('Could not connect. Your local draft is preserved.')).mockResolvedValueOnce({...file,content:'Changed source',version:2});await open();fireEvent.click(screen.getByRole('switch',{name:'Edit mode'}));await waitFor(()=>expect(screen.getByLabelText('Source')).not.toHaveAttribute('readonly'));fireEvent.change(screen.getByLabelText('Source'),{target:{value:'Changed source'}});fireEvent.click(screen.getByRole('button',{name:'Done'}));
    await screen.findByText('Could not connect. Your local draft is preserved.');expect(screen.getByLabelText('Source')).toHaveValue('Changed source');fireEvent.click(screen.getByRole('button',{name:'Retry Done'}));await waitFor(()=>expect(api.done).toHaveBeenCalledTimes(2));expect(api.done.mock.calls[0]![0]).toEqual(api.done.mock.calls[1]![0]);
  });
  it('returns to View after an expired-lease rejection and keeps the draft recoverable',async()=>{
    api.done.mockRejectedValue(new Error('Edit access has expired. Your draft is preserved; request Edit again.'));await open();fireEvent.click(screen.getByRole('switch',{name:'Edit mode'}));await waitFor(()=>expect(screen.getByLabelText('Source')).not.toHaveAttribute('readonly'));fireEvent.change(screen.getByLabelText('Source'),{target:{value:'Local work'}});fireEvent.click(screen.getByRole('button',{name:'Done'}));await screen.findByText('Edit access has expired. Your draft is preserved; request Edit again.');expect(screen.getByLabelText('Source')).toHaveAttribute('readonly');expect(screen.getByLabelText('Source')).toHaveValue('Local work');expect(screen.queryByRole('button',{name:'Retry Done'})).not.toBeInTheDocument();
  });
  it('never offers Edit or local filesystem mutations to a view-only member',async()=>{
    await open('viewer');expect(screen.getByRole('switch',{name:'Edit mode'})).toBeDisabled();expect(screen.queryByRole('button',{name:'New file'})).not.toBeInTheDocument();
    const row=screen.getByRole('treeitem');expect(row).toHaveAttribute('draggable','false');fireEvent.contextMenu(row);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();for(const name of ['New folder','Add files','Add folder'])expect(screen.queryByRole('button',{name})).not.toBeInTheDocument();
    expect(screen.getByRole('separator',{name:'Resize project explorer'})).toBeInTheDocument();expect(screen.getByLabelText('Compilation problems')).toBeInTheDocument();
  });
  it('switches to read-only on heartbeat failure without replacing typed content',async()=>{
    vi.useFakeTimers({toFake:['setInterval','clearInterval']});
    await open();fireEvent.click(screen.getByRole('switch',{name:'Edit mode'}));await waitFor(()=>expect(screen.getByLabelText('Source')).not.toHaveAttribute('readonly'));
    fireEvent.change(screen.getByLabelText('Source'),{target:{value:'Offline draft'}});api.renew.mockRejectedValue(new Error('Connection lost'));
    await act(async()=>{await vi.advanceTimersByTimeAsync(20_000);});
    expect(api.renew).toHaveBeenCalledWith('file','lease');
    expect(screen.getByLabelText('Source')).toHaveValue('Offline draft');expect(screen.getByLabelText('Source')).toHaveAttribute('readonly');
    expect(screen.getByText('Connection lost')).toBeInTheDocument();
  });
});
