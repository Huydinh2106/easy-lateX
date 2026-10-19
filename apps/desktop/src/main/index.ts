import path from "node:path";
import { pathToFileURL } from "node:url";
import { app, BrowserWindow, Menu, net, protocol, session, safeStorage, shell, dialog } from "electron";
import { config as loadEnvironment } from "dotenv";
import { AccountManager } from "./services/account/AccountManager";
import { SecureSessionStorage } from "./services/account/SecureSessionStorage";
import { normalizeApiUrl, readReleaseApiUrl } from './services/account/ApiConfiguration';
import { CollaborationManager } from "./services/collaboration/CollaborationManager";
import { registerAccountIpc } from "./ipc/account.ipc";
import { channels } from "./ipc/channels";
import { registerCompilerIpc } from "./ipc/compiler.ipc";
import { registerFileIpc } from "./ipc/file.ipc";
import { registerGitIpc } from "./ipc/git.ipc";
import { registerProjectIpc } from "./ipc/project.ipc";
import { registerSettingsIpc } from "./ipc/settings.ipc";
import { registerSyncTeXIpc } from "./ipc/synctex.ipc";
import { ArtifactRegistry } from "./services/compiler/ArtifactRegistry";
import { CompileManager } from "./services/compiler/CompileManager";
import { DEFAULT_COMPILER_IMAGE, DockerLatexCompiler } from "./services/compiler/DockerLatexCompiler";
import { FileManager } from "./services/filesystem/FileManager";
import { FileWatcher } from "./services/filesystem/FileWatcher";
import { GitManager } from "./services/git/GitManager";
import { SettingsManager } from "./services/settings/SettingsManager";
import { SyncTeXManager } from "./services/synctex/SyncTeXManager";
import { WorkspaceManager } from "./services/workspace/WorkspaceManager";

protocol.registerSchemesAsPrivileged([
  { scheme: "easy-latex", privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }
]);
app.enableSandbox();

let mainWindow: BrowserWindow | null = null;
let watcher: FileWatcher | null = null;
let compiler: CompileManager | null = null;
let shared: CollaborationManager | null = null;
let accounts: AccountManager | null = null;

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 960,
    minHeight: 640,
    show: false,
    backgroundColor: "#fafafa",
    title: "Easy LaTeX",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false
    }
  });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event, url) => {
    if (url !== window.webContents.getURL()) event.preventDefault();
  });
  window.once("ready-to-show", () => window.show());
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    void window.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    void window.loadFile(path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`));
  }
  window.on("closed", () => {
    if (mainWindow === window) mainWindow = null;
  });
  return window;
}

async function bootstrap(): Promise<void> {
  loadEnvironment({ path: [path.resolve(process.cwd(), ".env.local"), path.resolve(process.cwd(), "../../.env.local"), path.resolve(process.cwd(), ".env")], quiet: true });
  const files = new FileManager();
  watcher = new FileWatcher();
  const settings = new SettingsManager(
    path.join(app.getPath("userData"), "settings.json"),
    path.join(app.getPath("documents"), "Easy LaTeX")
  );
  await settings.load();
  const workspace = new WorkspaceManager(files, watcher, settings);
  const artifacts = new ArtifactRegistry();
  const compilerImage = process.env.EASY_LATEX_DOCKER_IMAGE?.trim() || DEFAULT_COMPILER_IMAGE;
  compiler = new CompileManager(new DockerLatexCompiler(compilerImage), workspace, files, settings, artifacts);
  const synctex = new SyncTeXManager();
  const git = new GitManager(files);
  const getWindow = (): BrowserWindow | null => mainWindow;
  const apiUrl=await settings.get('collaborationApiUrl') || process.env.EASY_LATEX_API_URL || await readReleaseApiUrl(process.resourcesPath);

  accounts = new AccountManager({url:apiUrl},
    new SecureSessionStorage(path.join(app.getPath("userData"),"account-session.json"), {
      available: () => safeStorage.isEncryptionAvailable() && (process.platform !== "linux" || safeStorage.getSelectedStorageBackend() !== "basic_text"),
      encrypt: value => safeStorage.encryptString(value), decrypt: value => safeStorage.decryptString(value)
    }), async url => { await shell.openExternal(url); });
  shared = new CollaborationManager(accounts, apiUrl, path.join(app.getPath("userData"), "collaboration"), artifacts, async () => {
    const options = {title: "Share LaTeX project", properties: ["openDirectory"] as Array<"openDirectory">};
    const result = mainWindow ? await dialog.showOpenDialog(mainWindow, options) : await dialog.showOpenDialog(options);
    return result.canceled ? null : result.filePaths[0] ?? null;
  }, () => files.getWorkspaceRoot(), async kind => {
    const options = {title: kind === 'files' ? 'Add Files to Shared Project' : 'Add Folder to Shared Project', properties: kind === 'files' ? ['openFile', 'multiSelections'] as Array<'openFile' | 'multiSelections'> : ['openDirectory'] as Array<'openDirectory'>};
    const result = mainWindow ? await dialog.showOpenDialog(mainWindow, options) : await dialog.showOpenDialog(options);
    return result.canceled ? [] : result.filePaths;
  });
  registerAccountIpc(accounts, shared, getWindow, async value=>{
    const url=normalizeApiUrl(value);
    if((await accounts!.state()).account)throw new Error('Sign out before changing the collaboration server');
    await accounts!.cancel();
    await settings.set('collaborationApiUrl',url);
    await accounts!.configure(url);
    shared!.configure(url);
  });
  registerProjectIpc(workspace, getWindow);
  registerFileIpc(files, workspace, getWindow);
  registerCompilerIpc(compiler, getWindow);
  registerSyncTeXIpc(synctex, getWindow);
  registerGitIpc(git, getWindow);
  registerSettingsIpc(settings, getWindow);

  watcher.subscribe((event) => mainWindow?.webContents.send(channels.fileChanged, event));
  compiler.subscribe((event) => mainWindow?.webContents.send(channels.compilerEvent, event));

  protocol.handle("easy-latex", (request) => {
    const artifact = artifacts.resolve(request.url);
    if (!artifact) return new Response("Not found", { status: 404 });
    return net.fetch(pathToFileURL(artifact).toString());
  });

  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  Menu.setApplicationMenu(null);
  mainWindow = createWindow();
}

void app.whenReady().then(async () => {
  await bootstrap();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow();
  });
});

app.on("before-quit", () => {
  watcher?.stop();
  void compiler?.cancel();
  void shared?.cancel();
  shared?.stopUpdates();
  void accounts?.cancel();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
