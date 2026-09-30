import path from "node:path";
import { pathToFileURL } from "node:url";
import { app, BrowserWindow, Menu, net, protocol, session } from "electron";
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
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
