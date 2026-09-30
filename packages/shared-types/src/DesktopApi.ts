import type { CompileEvent, CompileOptions, CompileResult } from "./CompileResult";
import type { FileChangeEvent, FileContent, FileEntry, FileMutationResult, WriteFileInput, WriteFileResult } from "./FileEntry";
import type { OpenProjectResult, Project, RecentProject } from "./Project";
import type { AppSettingKey, AppSettings, UserSettingKey } from "./Settings";

export interface SyncTeXForwardInput {
  file: string;
  line: number;
  column?: number;
}

export interface SyncTeXInverseInput {
  page: number;
  x: number;
  y: number;
}

export interface SyncTeXResult {
  available: boolean;
  reason?: string;
  file?: string;
  line?: number;
  page?: number;
  x?: number;
  y?: number;
}

export interface GitStatus {
  available: boolean;
  isRepository: boolean;
}

export interface DesktopApi {
  project: {
    open(): Promise<OpenProjectResult | null>;
    create(name: string): Promise<OpenProjectResult>;
    chooseProjectsDirectory(): Promise<string | null>;
    openRecent(workspacePath: string): Promise<OpenProjectResult>;
    recent(): Promise<RecentProject[]>;
    forgetRecent(workspacePath: string): Promise<RecentProject[]>;
    current(): Promise<OpenProjectResult | null>;
    setRoot(rootDocument: string): Promise<Project>;
  };
  file: {
    list(): Promise<FileEntry[]>;
    read(path: string): Promise<FileContent>;
    write(input: WriteFileInput): Promise<WriteFileResult>;
    create(path: string): Promise<WriteFileResult>;
    createDirectory(path: string): Promise<FileMutationResult>;
    importFiles(destinationDirectory: string): Promise<FileMutationResult>;
    importFolder(destinationDirectory: string): Promise<FileMutationResult>;
    onChanged(callback: (event: FileChangeEvent) => void): () => void;
  };
  compiler: {
    build(options?: CompileOptions): Promise<CompileResult>;
    cancel(): Promise<boolean>;
    onEvent(callback: (event: CompileEvent) => void): () => void;
  };
  synctex: {
    forward(input: SyncTeXForwardInput): Promise<SyncTeXResult>;
    inverse(input: SyncTeXInverseInput): Promise<SyncTeXResult>;
  };
  git: {
    status(): Promise<GitStatus>;
  };
  settings: {
    all(): Promise<AppSettings>;
    get<K extends AppSettingKey>(key: K): Promise<AppSettings[K]>;
    set<K extends UserSettingKey>(key: K, value: AppSettings[K]): Promise<AppSettings>;
  };
}
