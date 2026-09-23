import { ipcMain, type BrowserWindow } from "electron";
import { channels } from "./channels";
import { assertTrustedSender, parseSettingKey, parseSettingValue, parseUserSettingKey } from "./validation";
import type { SettingsManager } from "../services/settings/SettingsManager";

export function registerSettingsIpc(settings: SettingsManager, getWindow: () => BrowserWindow | null): void {
  ipcMain.handle(channels.settingsAll, async (event) => {
    assertTrustedSender(event, getWindow()?.webContents ?? null);
    return settings.all();
  });
  ipcMain.handle(channels.settingsGet, async (event, rawKey: unknown) => {
    assertTrustedSender(event, getWindow()?.webContents ?? null);
    return settings.get(parseSettingKey(rawKey));
  });
  ipcMain.handle(channels.settingsSet, async (event, rawKey: unknown, rawValue: unknown) => {
    assertTrustedSender(event, getWindow()?.webContents ?? null);
    const key = parseUserSettingKey(rawKey);
    return settings.set(key, parseSettingValue(key, rawValue));
  });
}
