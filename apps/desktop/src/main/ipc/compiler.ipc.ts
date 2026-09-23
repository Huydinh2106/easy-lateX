import { ipcMain, type BrowserWindow } from "electron";
import { channels } from "./channels";
import { assertTrustedSender, parseCompileOptions } from "./validation";
import type { CompileManager } from "../services/compiler/CompileManager";

export function registerCompilerIpc(compiler: CompileManager, getWindow: () => BrowserWindow | null): void {
  ipcMain.handle(channels.compilerBuild, async (event, value: unknown) => {
    assertTrustedSender(event, getWindow()?.webContents ?? null);
    return compiler.build(parseCompileOptions(value));
  });
  ipcMain.handle(channels.compilerCancel, async (event) => {
    assertTrustedSender(event, getWindow()?.webContents ?? null);
    return compiler.cancel();
  });
}
