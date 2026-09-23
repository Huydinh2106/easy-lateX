export const channels = {
  projectOpen: "project:open",
  projectCurrent: "project:current",
  projectSetRoot: "project:set-root",
  fileList: "file:list",
  fileRead: "file:read",
  fileWrite: "file:write",
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
