import { ipcMain, type BrowserWindow } from "electron";
import { channels } from "./channels";
import { assertTrustedSender } from "./validation";
import type { GitManager } from "../services/git/GitManager";

export function registerGitIpc(git: GitManager, getWindow: () => BrowserWindow | null): void {
  ipcMain.handle(channels.gitStatus, async (event) => {
    assertTrustedSender(event, getWindow()?.webContents ?? null);
    return git.status();
  });
}
