import type { IpcMainInvokeEvent, WebContents } from "electron";
import type { AppSettingKey, AppSettings, CompileOptions, SyncTeXForwardInput, SyncTeXInverseInput, UserSettingKey, WriteFileInput } from "@easy-latex/shared-types";

export function assertTrustedSender(event: IpcMainInvokeEvent, trusted: WebContents | null): void {
  if (!trusted || event.sender.id !== trusted.id || event.senderFrame !== trusted.mainFrame) {
    throw new Error("IPC request came from an untrusted frame");
  }
}

export function assertString(value: unknown, label: string, maximum = 4096): string {
  if (typeof value !== "string" || !value || value.length > maximum || value.includes("\0")) {
    throw new Error(`${label} must be a valid string`);
  }
  return value;
}

export function parseWriteFileInput(value: unknown): WriteFileInput {
  if (!value || typeof value !== "object") throw new Error("Invalid file write request");
  const input = value as Record<string, unknown>;
  const path = assertString(input.path, "File path");
  if (typeof input.content !== "string") throw new Error("File content must be text");
  if (input.content.length > 10 * 1024 * 1024) throw new Error("File content is too large");
  if (input.expectedModifiedAt !== undefined && (typeof input.expectedModifiedAt !== "number" || !Number.isFinite(input.expectedModifiedAt))) {
    throw new Error("Expected modification time is invalid");
  }
  return {
    path,
    content: input.content,
    ...(typeof input.expectedModifiedAt === "number" ? { expectedModifiedAt: input.expectedModifiedAt } : {})
  };
}

export function parseCompileOptions(value: unknown): CompileOptions {
  if (value === undefined) return {};
  if (!value || typeof value !== "object") throw new Error("Invalid compile options");
  const input = value as Record<string, unknown>;
  const engine = input.engine;
  if (engine !== undefined && engine !== "pdflatex" && engine !== "xelatex" && engine !== "lualatex") {
    throw new Error("Unsupported LaTeX engine");
  }
  return {
    ...(engine ? { engine } : {}),
    ...(input.rootDocument !== undefined ? { rootDocument: assertString(input.rootDocument, "Root document") } : {})
  };
}

export function parseSyncTeXForward(value: unknown): SyncTeXForwardInput {
  if (!value || typeof value !== "object") throw new Error("Invalid forward SyncTeX request");
  const input = value as Record<string, unknown>;
  if (!Number.isSafeInteger(input.line) || Number(input.line) < 1) throw new Error("SyncTeX line must be a positive integer");
  if (input.column !== undefined && (!Number.isSafeInteger(input.column) || Number(input.column) < 1)) throw new Error("SyncTeX column must be a positive integer");
  return {
    file: assertString(input.file, "SyncTeX file"),
    line: Number(input.line),
    ...(input.column !== undefined ? { column: Number(input.column) } : {})
  };
}

export function parseSyncTeXInverse(value: unknown): SyncTeXInverseInput {
  if (!value || typeof value !== "object") throw new Error("Invalid inverse SyncTeX request");
  const input = value as Record<string, unknown>;
  for (const key of ["page", "x", "y"] as const) {
    if (typeof input[key] !== "number" || !Number.isFinite(input[key])) throw new Error(`SyncTeX ${key} is invalid`);
  }
  if (Number(input.page) < 1) throw new Error("SyncTeX page must be positive");
  return { page: Number(input.page), x: Number(input.x), y: Number(input.y) };
}

const settingKeys = new Set<AppSettingKey>(["compilerEngine", "explorerWidth", "pdfWidth", "problemsHeight", "recentProjects"]);
const userSettingKeys = new Set<UserSettingKey>(["compilerEngine", "explorerWidth", "pdfWidth", "problemsHeight"]);

export function parseSettingKey(value: unknown): AppSettingKey {
  if (typeof value !== "string" || !settingKeys.has(value as AppSettingKey)) throw new Error("Unknown setting key");
  return value as AppSettingKey;
}

export function parseUserSettingKey(value: unknown): UserSettingKey {
  const key = parseSettingKey(value);
  if (!userSettingKeys.has(key as UserSettingKey)) throw new Error("This setting is managed by the main process");
  return key as UserSettingKey;
}

export function parseSettingValue<K extends AppSettingKey>(key: K, value: unknown): AppSettings[K] {
  if (key === "compilerEngine") {
    if (value !== "pdflatex" && value !== "xelatex" && value !== "lualatex") throw new Error("Unsupported compiler engine");
    return value as AppSettings[K];
  }
  if (key === "recentProjects") {
    if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) throw new Error("Recent projects are invalid");
    return value as AppSettings[K];
  }
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error("Panel size is invalid");
  return value as AppSettings[K];
}
