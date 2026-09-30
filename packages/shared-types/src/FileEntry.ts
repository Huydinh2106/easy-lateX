export type FileEntryKind = "file" | "directory";

export interface FileEntry {
  path: string;
  name: string;
  parentPath: string;
  kind: FileEntryKind;
  size?: number;
  modifiedAt?: number;
}

export interface FileContent {
  path: string;
  content: string;
  modifiedAt: number;
  size: number;
}

export interface WriteFileInput {
  path: string;
  content: string;
  expectedModifiedAt?: number;
}

export interface WriteFileResult {
  path: string;
  modifiedAt: number;
  size: number;
}

export interface FileMutationResult {
  paths: string[];
}

export interface FileChangeEvent {
  path?: string;
  kind: "changed" | "renamed" | "rescan";
}
