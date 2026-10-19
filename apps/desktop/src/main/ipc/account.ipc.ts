import { ipcMain, type BrowserWindow } from 'electron';
import { z } from 'zod';
import type { AccountManager } from '../services/account/AccountManager';
import type { CollaborationManager } from '../services/collaboration/CollaborationManager';
import { assertTrustedSender } from './validation';

const uuid=z.uuid();
const content=z.string().max(5*1024*1024);
export function registerAccountIpc(accounts:AccountManager,shared:CollaborationManager,getWindow:()=>BrowserWindow|null,configure?:(url:string)=>Promise<void>):void {
  const subscriptions=new Map<string,()=>void>();
  ipcMain.handle('account:action',async(event,action:unknown,value:unknown)=>{
    assertTrustedSender(event,getWindow()?.webContents??null);
    switch(action) {
      case 'state': return accounts.state();
      case 'configure': {if(!configure)throw new Error('Server configuration unavailable');await configure(z.string().max(2048).parse(value));return accounts.state();}
      case 'github': return accounts.github();
      case 'cancel': return accounts.cancel();
      case 'signOut': shared.stopUpdates();for(const stop of subscriptions.values())stop();subscriptions.clear();return accounts.signOut();
      default: throw new Error('Unknown account operation');
    }
  });
  ipcMain.handle('collaboration:action',async(event,action:unknown,value:unknown)=>{
    assertTrustedSender(event,getWindow()?.webContents??null);
    switch(action) {
      case 'watchProject': {
        const input=z.object({projectId:uuid,subscriptionId:uuid}).parse(value);
        if(subscriptions.has(input.subscriptionId))return;
        if(subscriptions.size>=8)throw new Error('Too many live subscriptions');
        const sender=event.sender;
        const stop=shared.onProjectUpdate(input.projectId,update=>{if(!sender.isDestroyed())sender.send('collaboration:update',{subscriptionId:input.subscriptionId,update});});
        const dispose=()=>{stop();subscriptions.delete(input.subscriptionId);sender.removeListener('destroyed',dispose);};
        subscriptions.set(input.subscriptionId,dispose);sender.once('destroyed',dispose);
        return;
      }
      case 'unwatchProject': {const stop=subscriptions.get(uuid.parse(value));stop?.();return;}
      case 'legacyConfirmation': return shared.legacyConfirmation(z.email().parse(value));
      case 'linkLegacy': {const v=z.object({email:z.email(),code:z.string().regex(/^\d{6}$/)}).parse(value);return shared.linkLegacy(v.email,v.code);}
      case 'legacyProjects': return shared.legacyProjects();
      case 'migrateLegacy': return shared.migrateLegacy(uuid.parse(value));
      case 'links': return shared.links();
      case 'importProject': return shared.importProject();
      case 'shareCurrentProject': return shared.shareCurrentProject();
      case 'projects': return shared.projects();
      case 'create': return shared.create(z.object({name:z.string().trim().min(1).max(80),requestId:uuid.optional(),directories:z.array(z.string().max(512)).max(1000).optional(),files:z.array(z.object({path:z.string().max(512),content:z.string().max(14*1024*1024),encoding:z.enum(['utf8','base64']).optional()})).max(1000).optional()}).parse(value));
      case 'files': return shared.files(uuid.parse(value));
      case 'createFile': {const v=z.object({projectId:uuid,path:z.string().max(512)}).parse(value);return shared.createFile(v.projectId,v.path);}
      case 'directories': return shared.directories(uuid.parse(value));
      case 'createDirectory': {const v=z.object({projectId:uuid,path:z.string().max(512)}).parse(value);return shared.createDirectory(v.projectId,v.path);}
      case 'importFiles': case 'importFolder': {const v=z.object({projectId:uuid,destinationDirectory:z.string().max(512)}).parse(value);return action==='importFiles'?shared.importFiles(v.projectId,v.destinationDirectory):shared.importFolder(v.projectId,v.destinationDirectory);}
      case 'importDropped': {const v=z.object({projectId:uuid,sourcePaths:z.array(z.string().min(1).max(4096)).min(1).max(1000),destinationDirectory:z.string().max(512)}).parse(value);return shared.importDropped(v.projectId,v.sourcePaths,v.destinationDirectory);}
      case 'acquire': return shared.acquire(uuid.parse(value));
      case 'renew': case 'release': {const v=z.object({fileId:uuid,token:uuid}).parse(value);return action==='renew'?shared.renew(v.fileId,v.token):shared.release(v.fileId,v.token);}
      case 'done': return shared.done(z.object({fileId:uuid,token:uuid,baseVersion:z.number().int().positive(),content,requestId:uuid}).parse(value));
      case 'history': return shared.history(uuid.parse(value));
      case 'invite': {const v=z.object({projectId:uuid,email:z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9-]{0,38}$/),role:z.enum(['editor','viewer'])}).parse(value);return shared.invite(v.projectId,v.email,v.role);}
      case 'invitations': return shared.invitations();
      case 'accept': return shared.accept(uuid.parse(value));
      case 'saveDraft': {const v=z.object({projectId:uuid,path:z.string().max(512),content,baseVersion:z.number().int().positive()}).parse(value);return shared.saveDraft(v.projectId,v.path,v.content,v.baseVersion);}
      case 'draft': case 'clearDraft': {const v=z.object({projectId:uuid,path:z.string().max(512)}).parse(value);return action==='draft'?shared.draft(v.projectId,v.path):shared.clearDraft(v.projectId,v.path);}
      case 'cancelCompile': return shared.cancelCompile();
      case 'compile': {const v=z.object({projectId:uuid,files:z.array(z.object({path:z.string().max(512),content:z.string().max(14*1024*1024),encoding:z.enum(['utf8','base64']).optional()})).max(1000),rootDocument:z.string().max(512),engine:z.enum(['pdflatex','xelatex','lualatex'])}).parse(value);return shared.compile(v.projectId,v.files,v.rootDocument,v.engine);}
      default: throw new Error('Unknown collaboration operation');
    }
  });
}
