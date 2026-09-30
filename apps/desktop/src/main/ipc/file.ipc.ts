import { dialog, ipcMain, type BrowserWindow } from "electron";
import { channels } from "./channels";
import { assertString, assertTrustedSender, parseDroppedFileInput, parseMoveFileInput, parseWriteFileInput } from "./validation";
import type { FileManager } from "../services/filesystem/FileManager";
import type { WorkspaceManager } from "../services/workspace/WorkspaceManager";

export function registerFileIpc(files: FileManager, workspace: WorkspaceManager, getWindow: () => BrowserWindow | null): void {
  ipcMain.handle(channels.fileList, async (event) => {
    assertTrustedSender(event, getWindow()?.webContents ?? null);
    return files.list();
  });
  ipcMain.handle(channels.fileRead, async (event, value: unknown) => {
    assertTrustedSender(event, getWindow()?.webContents ?? null);
    return files.read(assertString(value, "File path"));
  });
  ipcMain.handle(channels.fileWrite, async (event, value: unknown) => {
    assertTrustedSender(event, getWindow()?.webContents ?? null);
    return files.write(parseWriteFileInput(value));
  });
  ipcMain.handle(channels.fileCreate, async (event, value: unknown) => {
    assertTrustedSender(event, getWindow()?.webContents ?? null);
    return files.createFile(assertString(value, "File path"));
  });
  ipcMain.handle(channels.fileCreateDirectory, async (event, value: unknown) => {
    assertTrustedSender(event, getWindow()?.webContents ?? null);
    return files.createDirectory(assertString(value, "Folder path"));
  });
  ipcMain.handle(channels.fileMove, async (event, value: unknown) => {
    assertTrustedSender(event, getWindow()?.webContents ?? null);
    const input = parseMoveFileInput(value);
    return workspace.movePath(input.sourcePath, input.targetPath);
  });
  ipcMain.handle(channels.fileRemove, async (event, value: unknown) => {
    assertTrustedSender(event, getWindow()?.webContents ?? null);
    return workspace.removePath(assertString(value, "File or folder path"));
  });
  ipcMain.handle(channels.fileImportFiles, async (event, value: unknown) => {
    const window = getWindow();
    assertTrustedSender(event, window?.webContents ?? null);
    const destination = parseDestinationDirectory(value);
    const options = {
      title: "Add Files to Project",
      buttonLabel: "Add Files",
      properties: ["openFile", "multiSelections"] as Array<"openFile" | "multiSelections">
    };
    const result = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options);
    return result.canceled ? { paths: [] } : files.importFiles(result.filePaths, destination);
  });
  ipcMain.handle(channels.fileImportFolder, async (event, value: unknown) => {
    const window = getWindow();
    assertTrustedSender(event, window?.webContents ?? null);
    const destination = parseDestinationDirectory(value);
    const options = {
      title: "Add Folder to Project",
      buttonLabel: "Add Folder",
      properties: ["openDirectory"] as Array<"openDirectory">
    };
    const result = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options);
    return result.canceled ? { paths: [] } : files.importFolders(result.filePaths, destination);
  });
  ipcMain.handle(channels.fileImportDropped, async (event, value: unknown) => {
    assertTrustedSender(event, getWindow()?.webContents ?? null);
    const input = parseDroppedFileInput(value);
    return files.importDroppedItems(input.sourcePaths, input.destinationDirectory);
  });
}

function parseDestinationDirectory(value: unknown): string {
  if (typeof value !== "string" || value.length > 4096 || value.includes("\0")) {
    throw new Error("Destination folder must be a valid project-relative path");
  }
  return value;
}
