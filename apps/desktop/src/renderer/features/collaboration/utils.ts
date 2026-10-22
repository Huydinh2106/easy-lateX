import type { FileEntry, SharedFile } from "@easy-latex/shared-types";

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '') : 'The operation failed. Please retry.';
}

export function sharedFileTree(files: SharedFile[], directories: string[] = []): FileEntry[] {
  const entries = new Map<string, FileEntry>();
  for (const directory of directories) {
    const parts = directory.split('/');
    for (let n = 1; n <= parts.length; n++) {
      const directoryPath = parts.slice(0, n).join('/');
      entries.set(directoryPath, {path: directoryPath, name: parts[n - 1]!, parentPath: parts.slice(0, n - 1).join('/'), kind: 'directory'});
    }
  }
  for (const file of files) {
    const parts = file.path.split('/');
    for (let n = 1; n < parts.length; n++) {
      const directory = parts.slice(0, n).join('/');
      entries.set(directory, {path: directory, name: parts[n - 1]!, parentPath: parts.slice(0, n - 1).join('/'), kind: 'directory'});
    }
    entries.set(file.path, {path: file.path, name: parts.at(-1)!, parentPath: parts.slice(0, -1).join('/'), kind: 'file'});
  }
  // Keep each directory immediately before its descendants, as in the local explorer.
  return [...entries.values()].sort((a, b) => {
    const left = a.path.split('/'); const right = b.path.split('/');
    for (let n = 0; n < Math.min(left.length, right.length); n++) {
      if (left[n] === right[n]) continue;
      const leftFolder = n < left.length - 1 || a.kind === 'directory';
      const rightFolder = n < right.length - 1 || b.kind === 'directory';
      if (leftFolder !== rightFolder) return leftFolder ? -1 : 1;
      return left[n]!.localeCompare(right[n]!, undefined, {numeric: true});
    }
    return left.length - right.length;
  });
}
