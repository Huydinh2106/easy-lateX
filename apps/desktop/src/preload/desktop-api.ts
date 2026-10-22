import { ipcRenderer, webUtils } from "electron";
import type { CompileEvent, CompileOptions, DesktopApi, FileChangeEvent, ProjectUpdateEvent } from "@easy-latex/shared-types";

const channels = {
  projectOpen: "project:open",
  projectCreate: "project:create",
  projectChooseProjectsDirectory: "project:choose-projects-directory",
  projectOpenRecent: "project:open-recent",
  projectRecent: "project:recent",
  projectForgetRecent: "project:forget-recent",
  projectCurrent: "project:current",
  projectSetRoot: "project:set-root",
  fileList: "file:list",
  fileRead: "file:read",
  fileWrite: "file:write",
  fileCreate: "file:create",
  fileCreateDirectory: "file:create-directory",
  fileMove: "file:move",
  fileRemove: "file:remove",
  fileImportFiles: "file:import-files",
  fileImportFolder: "file:import-folder",
  fileImportDropped: "file:import-dropped",
  fileChanged: "file:changed",
  compilerBuild: "compiler:build",
  compilerCancel: "compiler:cancel",
  compilerEvent: "compiler:event",
  synctexForward: "synctex:forward",
  synctexInverse: "synctex:inverse",
  gitStatus: "git:status",
  settingsAll: "settings:all",
  settingsGet: "settings:get",
  settingsSet: "settings:set"
} as const;

export const desktopApi: DesktopApi = {
  auth: {
    state: () => ipcRenderer.invoke("account:action", "state"),
    configure: url => ipcRenderer.invoke('account:action', 'configure', url),
    github: () => ipcRenderer.invoke("account:action", "github"),
    cancel: () => ipcRenderer.invoke("account:action", "cancel"),
    signOut: () => ipcRenderer.invoke("account:action", "signOut")
  },
  collaboration: {
    legacyConfirmation: email => ipcRenderer.invoke('collaboration:action','legacyConfirmation',email),
    linkLegacy: (email,code) => ipcRenderer.invoke('collaboration:action','linkLegacy',{email,code}),
    legacyProjects: () => ipcRenderer.invoke('collaboration:action','legacyProjects'),
    migrateLegacy: projectId => ipcRenderer.invoke('collaboration:action','migrateLegacy',projectId),
    onProjectUpdate(projectId,callback) {
      const subscriptionId=crypto.randomUUID();
      let active=true;
      const listener=(_event:Electron.IpcRendererEvent,payload:{subscriptionId:string;update:ProjectUpdateEvent})=>{
        if(active&&payload.subscriptionId===subscriptionId&&payload.update.projectId===projectId)callback(payload.update);
      };
      ipcRenderer.on('collaboration:update',listener);
      void ipcRenderer.invoke('collaboration:action','watchProject',{projectId,subscriptionId}).catch(()=>{if(active)callback({projectId,type:'disconnected'});});
      return()=>{active=false;ipcRenderer.removeListener('collaboration:update',listener);void ipcRenderer.invoke('collaboration:action','unwatchProject',subscriptionId).catch(()=>undefined);};
    },
    links: () => ipcRenderer.invoke("collaboration:action", "links"),
    importProject: () => ipcRenderer.invoke("collaboration:action", "importProject"),
    shareCurrentProject: () => ipcRenderer.invoke("collaboration:action", "shareCurrentProject"),
    projects: () => ipcRenderer.invoke("collaboration:action", "projects"),
    create: input => ipcRenderer.invoke("collaboration:action", "create", input),
    files: projectId => ipcRenderer.invoke("collaboration:action", "files", projectId),
    snapshot: projectId => ipcRenderer.invoke("collaboration:action", "snapshot", projectId),
    createFile: (projectId, path) => ipcRenderer.invoke("collaboration:action", "createFile", {projectId, path}),
    directories: projectId => ipcRenderer.invoke("collaboration:action", "directories", projectId),
    createDirectory: (projectId, path) => ipcRenderer.invoke("collaboration:action", "createDirectory", {projectId, path}),
    importFiles: (projectId, destinationDirectory) => ipcRenderer.invoke("collaboration:action", "importFiles", {projectId, destinationDirectory}),
    importFolder: (projectId, destinationDirectory) => ipcRenderer.invoke("collaboration:action", "importFolder", {projectId, destinationDirectory}),
    importDropped: (projectId, sourcePaths, destinationDirectory) => ipcRenderer.invoke("collaboration:action", "importDropped", {projectId, sourcePaths, destinationDirectory}),
    acquire: fileId => ipcRenderer.invoke("collaboration:action", "acquire", fileId),
    renew: (fileId, token) => ipcRenderer.invoke("collaboration:action", "renew", {fileId, token}),
    done: input => ipcRenderer.invoke("collaboration:action", "done", input),
    release: (fileId, token) => ipcRenderer.invoke("collaboration:action", "release", {fileId, token}),
    history: fileId => ipcRenderer.invoke("collaboration:action", "history", fileId),
    invite: (projectId, email, role) => ipcRenderer.invoke("collaboration:action", "invite", {projectId, email, role}),
    invitations: () => ipcRenderer.invoke("collaboration:action", "invitations"),
    accept: invitationId => ipcRenderer.invoke("collaboration:action", "accept", invitationId),
    saveDraft: (projectId, path, content, baseVersion) => ipcRenderer.invoke("collaboration:action", "saveDraft", {projectId, path, content, baseVersion}),
    draft: (projectId, path) => ipcRenderer.invoke("collaboration:action", "draft", {projectId, path}),
    clearDraft: (projectId, path) => ipcRenderer.invoke("collaboration:action", "clearDraft", {projectId, path}),
    cancelCompile: () => ipcRenderer.invoke("collaboration:action", "cancelCompile"),
    compile: (projectId, files, rootDocument, engine) => ipcRenderer.invoke("collaboration:action", "compile", {projectId, files, rootDocument, engine})
  },
  project: {
    open: () => ipcRenderer.invoke(channels.projectOpen),
    create: (name) => ipcRenderer.invoke(channels.projectCreate, name),
    chooseProjectsDirectory: () => ipcRenderer.invoke(channels.projectChooseProjectsDirectory),
    openRecent: (workspacePath) => ipcRenderer.invoke(channels.projectOpenRecent, workspacePath),
    recent: () => ipcRenderer.invoke(channels.projectRecent),
    forgetRecent: (workspacePath) => ipcRenderer.invoke(channels.projectForgetRecent, workspacePath),
    current: () => ipcRenderer.invoke(channels.projectCurrent),
    setRoot: (rootDocument) => ipcRenderer.invoke(channels.projectSetRoot, rootDocument)
  },
  file: {
    list: () => ipcRenderer.invoke(channels.fileList),
    read: (path) => ipcRenderer.invoke(channels.fileRead, path),
    write: (input) => ipcRenderer.invoke(channels.fileWrite, input),
    create: (path) => ipcRenderer.invoke(channels.fileCreate, path),
    createDirectory: (path) => ipcRenderer.invoke(channels.fileCreateDirectory, path),
    move: (input) => ipcRenderer.invoke(channels.fileMove, input),
    remove: (path) => ipcRenderer.invoke(channels.fileRemove, path),
    importFiles: (destinationDirectory) => ipcRenderer.invoke(channels.fileImportFiles, destinationDirectory),
    importFolder: (destinationDirectory) => ipcRenderer.invoke(channels.fileImportFolder, destinationDirectory),
    importDropped: (sourcePaths, destinationDirectory) => ipcRenderer.invoke(channels.fileImportDropped, { sourcePaths, destinationDirectory }),
    pathForDroppedFile: (file) => webUtils.getPathForFile(file),
    onChanged(callback) {
      const listener = (_event: Electron.IpcRendererEvent, value: FileChangeEvent): void => callback(value);
      ipcRenderer.on(channels.fileChanged, listener);
      return () => ipcRenderer.removeListener(channels.fileChanged, listener);
    }
  },
  compiler: {
    build: (options?: CompileOptions) => ipcRenderer.invoke(channels.compilerBuild, options),
    cancel: () => ipcRenderer.invoke(channels.compilerCancel),
    onEvent(callback) {
      const listener = (_event: Electron.IpcRendererEvent, value: CompileEvent): void => callback(value);
      ipcRenderer.on(channels.compilerEvent, listener);
      return () => ipcRenderer.removeListener(channels.compilerEvent, listener);
    }
  },
  synctex: {
    forward: (input) => ipcRenderer.invoke(channels.synctexForward, input),
    inverse: (input) => ipcRenderer.invoke(channels.synctexInverse, input)
  },
  git: {
    status: () => ipcRenderer.invoke(channels.gitStatus)
  },
  settings: {
    all: () => ipcRenderer.invoke(channels.settingsAll),
    get: (key) => ipcRenderer.invoke(channels.settingsGet, key),
    set: (key, value) => ipcRenderer.invoke(channels.settingsSet, key, value)
  }
};
