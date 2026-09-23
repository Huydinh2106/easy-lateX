import { ipcMain, type BrowserWindow } from "electron";
import { channels } from "./channels";
import { assertString, assertTrustedSender, parseWriteFileInput } from "./validation";
import type { FileManager } from "../services/filesystem/FileManager";

export function registerFileIpc(files: FileManager, getWindow: () => BrowserWindow | null): void {
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
}
