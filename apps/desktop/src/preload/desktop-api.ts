import { ipcRenderer } from "electron";
import type { CompileEvent, CompileOptions, DesktopApi, FileChangeEvent } from "@easy-latex/shared-types";

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
  fileImportFiles: "file:import-files",
  fileImportFolder: "file:import-folder",
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
    importFiles: (destinationDirectory) => ipcRenderer.invoke(channels.fileImportFiles, destinationDirectory),
    importFolder: (destinationDirectory) => ipcRenderer.invoke(channels.fileImportFolder, destinationDirectory),
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
