import { ipcMain, type BrowserWindow } from "electron";
import { channels } from "./channels";
import { assertTrustedSender, parseSyncTeXForward, parseSyncTeXInverse } from "./validation";
import type { SyncTeXManager } from "../services/synctex/SyncTeXManager";

export function registerSyncTeXIpc(synctex: SyncTeXManager, getWindow: () => BrowserWindow | null): void {
  ipcMain.handle(channels.synctexForward, async (event, value: unknown) => {
    assertTrustedSender(event, getWindow()?.webContents ?? null);
    return synctex.forward(parseSyncTeXForward(value));
  });
  ipcMain.handle(channels.synctexInverse, async (event, value: unknown) => {
    assertTrustedSender(event, getWindow()?.webContents ?? null);
    return synctex.inverse(parseSyncTeXInverse(value));
  });
}
