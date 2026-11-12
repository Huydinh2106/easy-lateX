import type { BrowserWindow, IpcMainInvokeEvent, WebContents } from 'electron';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AccountManager } from '../src/main/services/account/AccountManager';
import type { CollaborationManager } from '../src/main/services/collaboration/CollaborationManager';

type Handler=(event:IpcMainInvokeEvent,action:unknown,value:unknown)=>Promise<unknown>;
const handlers=vi.hoisted(()=>new Map<string,Handler>());
vi.mock('electron',()=>({ipcMain:{handle:(channel:string,handler:Handler)=>{handlers.set(channel,handler);}}}));
import { registerAccountIpc } from '../src/main/ipc/account.ipc';

const projectId='11111111-1111-4111-8111-111111111111';
const invite=vi.fn<(projectId:string,email:string,role:'editor'|'viewer')=>Promise<void>>();
const forwardSync=vi.fn<CollaborationManager['forwardSync']>();
let sender:WebContents,event:IpcMainInvokeEvent,invoke:Handler;

beforeEach(()=>{
  handlers.clear();invite.mockReset();invite.mockResolvedValue(undefined);
  forwardSync.mockReset();forwardSync.mockResolvedValue({available:true,page:2,x:10,y:20});
  sender={id:7,mainFrame:{}} as WebContents;
  event={sender,senderFrame:sender.mainFrame} as IpcMainInvokeEvent;
  registerAccountIpc({} as AccountManager,{invite,forwardSync} as unknown as CollaborationManager,()=>({webContents:sender}) as BrowserWindow);
  invoke=handlers.get('collaboration:action')!;
});

describe('Project-scoped cloud SyncTeX through IPC',()=>{
  const pdfUrl='easy-latex://pdf/22222222-2222-4222-8222-222222222222';
  it('forwards the project, immutable PDF URL and source position',async()=>{
    await expect(invoke(event,'forwardSync',{projectId,pdfUrl,input:{file:'chapters/intro.tex',line:17,column:3}})).resolves.toEqual({available:true,page:2,x:10,y:20});
    expect(forwardSync).toHaveBeenCalledExactlyOnceWith(projectId,pdfUrl,{file:'chapters/intro.tex',line:17,column:3});
  });
  it.each([
    {projectId:'not-a-project-id'},
    {pdfUrl:'file:///tmp/main.pdf'},
    {pdfUrl:'https://example.test/main.pdf'},
    {input:{file:'main.tex',line:0}},
    {input:{file:'main.tex',line:1.5}},
    {input:{file:'main.tex',line:1,column:0}},
    {input:{file:'',line:1}}
  ])('rejects invalid navigation input %j',async invalid=>{
    await expect(invoke(event,'forwardSync',{projectId,pdfUrl,input:{file:'main.tex',line:1},...invalid})).rejects.toThrow();
    expect(forwardSync).not.toHaveBeenCalled();
  });
  it('rejects navigation from an untrusted frame',async()=>{
    await expect(invoke({...event,senderFrame:{}} as IpcMainInvokeEvent,'forwardSync',{projectId,pdfUrl,input:{file:'main.tex',line:1}})).rejects.toThrow('untrusted frame');
    expect(forwardSync).not.toHaveBeenCalled();
  });
});

describe('Email invitations through the trusted desktop IPC boundary',()=>{
  it.each(['editor','viewer'] as const)('trims an email address and preserves %s permissions',async role=>{
    await invoke(event,'invite',{projectId,email:'  research.editor+paper@example.com \n',role});
    expect(invite).toHaveBeenCalledExactlyOnceWith(projectId,'research.editor+paper@example.com',role);
  });

  it.each(['github-handle','@github-handle','not-an-email','a@','a@example','bad@@example.com'])('rejects %s before calling the cloud invitation service',async email=>{
    await expect(invoke(event,'invite',{projectId,email,role:'editor'})).rejects.toThrow();
    expect(invite).not.toHaveBeenCalled();
  });

  it('accepts a 254-character email and rejects a longer email',async()=>{
    const prefix=`${'a'.repeat(64)}@${'b'.repeat(63)}.${'c'.repeat(63)}.`;
    const email=prefix+'d'.repeat(61);
    expect(email).toHaveLength(254);
    await invoke(event,'invite',{projectId,email,role:'viewer'});
    expect(invite).toHaveBeenCalledExactlyOnceWith(projectId,email,'viewer');
    invite.mockClear();
    await expect(invoke(event,'invite',{projectId,email:email+'d',role:'viewer'})).rejects.toThrow();
    expect(invite).not.toHaveBeenCalled();
  });

  it('does not grant ownership through an invitation',async()=>{
    await expect(invoke(event,'invite',{projectId,email:'editor@example.com',role:'owner'})).rejects.toThrow();
    expect(invite).not.toHaveBeenCalled();
  });

  it('rejects a valid invitation from an untrusted frame',async()=>{
    const untrusted={...event,senderFrame:{}} as IpcMainInvokeEvent;
    await expect(invoke(untrusted,'invite',{projectId,email:'editor@example.com',role:'editor'})).rejects.toThrow('untrusted frame');
    expect(invite).not.toHaveBeenCalled();
  });
});
