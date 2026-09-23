import { ipcMain, type BrowserWindow } from "electron";
import { channels } from "./channels";
import { assertString, assertTrustedSender } from "./validation";
import type { WorkspaceManager } from "../services/workspace/WorkspaceManager";

export function registerProjectIpc(workspace: WorkspaceManager, getWindow: () => BrowserWindow | null): void {
  ipcMain.handle(channels.projectOpen, async (event) => {
    const window = getWindow();
    assertTrustedSender(event, window?.webContents ?? null);
    return workspace.open(window);
  });
  ipcMain.handle(channels.projectOpenRecent, async (event, value: unknown) => {
    assertTrustedSender(event, getWindow()?.webContents ?? null);
    return workspace.openRecent(assertString(value, "Recent project path"));
  });
  ipcMain.handle(channels.projectRecent, async (event) => {
    assertTrustedSender(event, getWindow()?.webContents ?? null);
    return workspace.recent();
  });
  ipcMain.handle(channels.projectForgetRecent, async (event, value: unknown) => {
    assertTrustedSender(event, getWindow()?.webContents ?? null);
    return workspace.forgetRecent(assertString(value, "Recent project path"));
  });
  ipcMain.handle(channels.projectCurrent, (event) => {
    assertTrustedSender(event, getWindow()?.webContents ?? null);
    return workspace.current();
  });
  ipcMain.handle(channels.projectSetRoot, async (event, value: unknown) => {
    assertTrustedSender(event, getWindow()?.webContents ?? null);
    return workspace.setRoot(assertString(value, "Root document"));
  });
}
