import { constants } from "node:fs";
import { chmod, copyFile, lstat, mkdir, readFile, readdir, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { FileContent, FileEntry, FileMutationResult, WriteFileInput, WriteFileResult } from "@easy-latex/shared-types";

const MAX_TEXT_FILE_BYTES = 10 * 1024 * 1024;
const MAX_TREE_ENTRIES = 20_000;
const MAX_IMPORT_ENTRIES = 20_000;
const MAX_IMPORT_FILE_BYTES = 250 * 1024 * 1024;
const MAX_IMPORT_TOTAL_BYTES = 1024 * 1024 * 1024;
const IGNORED_DIRECTORIES = new Set([".git", "node_modules"]);
const PROTECTED_DIRECTORIES = new Set([".easy-latex", ".git", "node_modules"]);
const IGNORED_BUILD_EXTENSIONS = new Set([".aux", ".bbl", ".bcf", ".blg", ".fdb_latexmk", ".fls", ".log", ".out", ".run.xml", ".synctex.gz"]);
const EDITABLE_EXTENSIONS = new Set([".tex", ".bib", ".sty", ".cls", ".bst", ".ltx", ".md", ".txt"]);
const WINDOWS_RESERVED_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;

interface ImportPlan {
  source: string;
  target: string;
  relativePath: string;
}

export class FileConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FileConflictError";
  }
}

function toProjectPath(value: string): string {
  return value.split(path.sep).join("/");
}

function extensionFor(value: string): string {
  const lower = value.toLowerCase();
  if (lower.endsWith(".synctex.gz")) return ".synctex.gz";
  if (lower.endsWith(".run.xml")) return ".run.xml";
  return path.extname(lower);
}

export class FileManager {
  private workspaceRoot: string | null = null;
  private canonicalRoot: string | null = null;

  async setWorkspace(workspaceRoot: string): Promise<void> {
    const canonical = await realpath(workspaceRoot);
    const info = await stat(canonical);
    if (!info.isDirectory()) throw new Error("The selected workspace is not a directory");
    this.workspaceRoot = canonical;
    this.canonicalRoot = canonical;
  }

  clearWorkspace(): void {
    this.workspaceRoot = null;
    this.canonicalRoot = null;
  }

  getWorkspaceRoot(): string {
    if (!this.workspaceRoot) throw new Error("Open a project folder first");
    return this.workspaceRoot;
  }

  async list(): Promise<FileEntry[]> {
    const root = this.getWorkspaceRoot();
    const entries: FileEntry[] = [];

    const visit = async (directory: string, parentPath: string): Promise<void> => {
      const children = await readdir(directory, { withFileTypes: true });
      children.sort((left, right) => {
        if (left.isDirectory() !== right.isDirectory()) return left.isDirectory() ? -1 : 1;
        return left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: "base" });
      });
      for (const child of children) {
        if (entries.length >= MAX_TREE_ENTRIES) throw new Error("The project contains too many files to display");
        if (child.isSymbolicLink()) continue;
        if (child.isDirectory() && (IGNORED_DIRECTORIES.has(child.name) || child.name === ".easy-latex")) continue;
        const relative = parentPath ? `${parentPath}/${child.name}` : child.name;
        const absolute = path.join(directory, child.name);
        if (child.isDirectory()) {
          entries.push({ path: relative, name: child.name, parentPath, kind: "directory" });
          await visit(absolute, relative);
        } else if (child.isFile() && !IGNORED_BUILD_EXTENSIONS.has(extensionFor(child.name))) {
          const info = await stat(absolute);
          entries.push({ path: relative, name: child.name, parentPath, kind: "file", size: info.size, modifiedAt: info.mtimeMs });
        }
      }
    };

    await visit(root, "");
    return entries;
  }

  async read(relativePath: string): Promise<FileContent> {
    const absolute = await this.resolveExistingFile(relativePath);
    if (!EDITABLE_EXTENSIONS.has(extensionFor(relativePath))) throw new Error("This file type cannot be edited as text");
    const info = await stat(absolute);
    if (info.size > MAX_TEXT_FILE_BYTES) throw new Error("The file is too large to edit");
    return {
      path: this.normalizeRelativePath(relativePath),
      content: await readFile(absolute, "utf8"),
      modifiedAt: info.mtimeMs,
      size: info.size
    };
  }

  async write(input: WriteFileInput): Promise<WriteFileResult> {
    const relative = this.normalizeRelativePath(input.path);
    const absolute = await this.resolveExistingFile(relative);
    if (!EDITABLE_EXTENSIONS.has(extensionFor(relative))) throw new Error("This file type cannot be edited as text");
    const before = await stat(absolute);
    if (input.expectedModifiedAt !== undefined && Math.abs(before.mtimeMs - input.expectedModifiedAt) > 0.5) {
      throw new FileConflictError("The file changed on disk after it was opened");
    }
    const bytes = Buffer.byteLength(input.content, "utf8");
    if (bytes > MAX_TEXT_FILE_BYTES) throw new Error("The file is too large to save");

    const temporary = path.join(path.dirname(absolute), `.${path.basename(absolute)}.${process.pid}.${Date.now()}.tmp`);
    try {
      await writeFile(temporary, input.content, { encoding: "utf8", mode: before.mode });
      await chmod(temporary, before.mode);
      await rename(temporary, absolute);
    } catch (error) {
      await rm(temporary, { force: true }).catch(() => undefined);
      throw error;
    }
    const after = await stat(absolute);
    return { path: relative, modifiedAt: after.mtimeMs, size: after.size };
  }

  async createFile(relativePath: string): Promise<WriteFileResult> {
    const relative = this.normalizeRelativePath(relativePath);
    this.assertUserMutablePath(relative);
    const absolute = await this.resolveNewPath(relative);
    try {
      await writeFile(absolute, "", { encoding: "utf8", flag: "wx", mode: 0o644 });
    } catch (error) {
      this.rethrowCreationError(error, relative);
    }
    const info = await stat(absolute);
    return { path: relative, modifiedAt: info.mtimeMs, size: info.size };
  }

  async createDirectory(relativePath: string): Promise<FileMutationResult> {
    const relative = this.normalizeRelativePath(relativePath);
    this.assertUserMutablePath(relative);
    const absolute = await this.resolveNewPath(relative);
    try {
      await mkdir(absolute, { mode: 0o755 });
    } catch (error) {
      this.rethrowCreationError(error, relative);
    }
    return { paths: [relative] };
  }

  async movePath(sourcePath: string, targetPath: string): Promise<FileMutationResult> {
    const sourceRelative = this.normalizeRelativePath(sourcePath);
    const targetRelative = this.normalizeRelativePath(targetPath);
    this.assertUserMutablePath(sourceRelative);
    this.assertUserMutablePath(targetRelative);
    if (sourceRelative === targetRelative) return { paths: [targetRelative] };

    const source = await this.resolveExistingEntry(sourceRelative);
    if (source.kind === "directory" && targetRelative.startsWith(`${sourceRelative}/`)) {
      throw new Error("A folder cannot be moved into itself");
    }
    const target = await this.resolveNewPath(targetRelative);
    await this.assertMissing(target, targetRelative);
    if (source.kind === "directory") {
      const targetParent = await realpath(path.dirname(target));
      if (this.isInside(source.absolute, targetParent)) throw new Error("A folder cannot be moved into itself");
    }
    await rename(source.absolute, target);
    return { paths: [targetRelative] };
  }

  async removePath(relativePath: string): Promise<FileMutationResult> {
    const relative = this.normalizeRelativePath(relativePath);
    this.assertUserMutablePath(relative);
    const entry = await this.resolveExistingEntry(relative);
    await rm(entry.absolute, { recursive: entry.kind === "directory", force: false });
    return { paths: [relative] };
  }

  importFiles(sourcePaths: string[], destinationDirectory: string): Promise<FileMutationResult> {
    return this.importItems(sourcePaths, destinationDirectory, "file");
  }

  importFolders(sourcePaths: string[], destinationDirectory: string): Promise<FileMutationResult> {
    return this.importItems(sourcePaths, destinationDirectory, "directory");
  }

  importDroppedItems(sourcePaths: string[], destinationDirectory: string): Promise<FileMutationResult> {
    return this.importItems(sourcePaths, destinationDirectory);
  }

  async resolveExistingFile(relativePath: string): Promise<string> {
    const relative = this.normalizeRelativePath(relativePath);
    const candidate = path.resolve(this.getWorkspaceRoot(), ...relative.split("/"));
    const candidateInfo = await lstat(candidate);
    if (candidateInfo.isSymbolicLink() || !candidateInfo.isFile()) throw new Error("The requested path is not a regular file");
    const canonical = await realpath(candidate);
    this.assertInsideWorkspace(canonical);
    return canonical;
  }

  async ensureInternalDirectory(relativePath: string): Promise<string> {
    const normalized = this.normalizeRelativePath(relativePath);
    if (normalized !== ".easy-latex" && !normalized.startsWith(".easy-latex/")) {
      throw new Error("Internal output must stay inside .easy-latex");
    }
    const absolute = path.resolve(this.getWorkspaceRoot(), ...normalized.split("/"));
    this.assertLexicallyInsideWorkspace(absolute);
    await mkdir(absolute, { recursive: true });
    const canonical = await realpath(absolute);
    this.assertInsideWorkspace(canonical);
    return canonical;
  }

  normalizeRelativePath(value: string): string {
    if (typeof value !== "string" || !value || value.includes("\0") || value.includes("\\") || path.isAbsolute(value)) {
      throw new Error("Path must be a non-empty project-relative path");
    }
    const normalized = path.posix.normalize(value.normalize("NFC"));
    if (normalized === "." || normalized.startsWith("../") || normalized.includes("/../") || normalized !== value) {
      throw new Error("Path escapes the active workspace");
    }
    if (normalized.split("/").some((segment) => !segment || segment === "." || segment === "..")) {
      throw new Error("Path contains an invalid segment");
    }
    return normalized;
  }

  private async importItems(
    sourcePaths: string[],
    destinationDirectory: string,
    expectedKind?: "file" | "directory"
  ): Promise<FileMutationResult> {
    const destinationRelative = this.normalizeDirectoryPath(destinationDirectory);
    const destination = await this.resolveExistingDirectory(destinationRelative);
    const plans: ImportPlan[] = [];
    const targetKeys = new Set<string>();
    let totalEntries = 0;
    let totalBytes = 0;

    for (const selectedPath of sourcePaths) {
      const selectedInfo = await lstat(selectedPath);
      if (selectedInfo.isSymbolicLink()) throw new Error("Symbolic links cannot be imported into a project");
      if (expectedKind === "file" && !selectedInfo.isFile()) throw new Error("The selected item is not a regular file");
      if (expectedKind === "directory" && !selectedInfo.isDirectory()) throw new Error("The selected item is not a folder");
      const source = await realpath(selectedPath);
      const name = path.basename(source);
      const relativePath = destinationRelative ? `${destinationRelative}/${name}` : name;
      const relative = this.normalizeRelativePath(relativePath);
      this.assertUserMutablePath(relative);
      const target = path.join(destination, name);
      const key = process.platform === "win32" ? target.toLowerCase() : target;
      if (targetKeys.has(key)) throw new Error(`More than one selected item is named "${name}"`);
      targetKeys.add(key);
      await this.assertMissing(target, relative);
      if (selectedInfo.isDirectory() && this.isInside(source, destination)) {
        throw new Error("A folder cannot be imported into itself");
      }
      const measured = await this.validateImportTree(source, relative);
      totalEntries += measured.entries;
      totalBytes += measured.bytes;
      if (totalEntries > MAX_IMPORT_ENTRIES) throw new Error("The selected import contains too many files");
      if (totalBytes > MAX_IMPORT_TOTAL_BYTES) throw new Error("The selected import is larger than 1 GB");
      plans.push({ source, target, relativePath: relative });
    }

    const created: string[] = [];
    try {
      for (const plan of plans) {
        created.push(plan.target);
        await this.copyImportTree(plan.source, plan.target);
      }
    } catch (error) {
      await Promise.all(created.map((target) => rm(target, { recursive: true, force: true }).catch(() => undefined)));
      throw error;
    }
    return { paths: plans.map((plan) => plan.relativePath) };
  }

  private async validateImportTree(source: string, targetRelative: string): Promise<{ entries: number; bytes: number }> {
    const pending = [{ source, targetRelative }];
    let entries = 0;
    let bytes = 0;
    while (pending.length > 0) {
      const current = pending.pop();
      if (!current) break;
      entries += 1;
      if (entries > MAX_IMPORT_ENTRIES) throw new Error("The selected import contains too many files");
      this.assertUserMutablePath(current.targetRelative);
      const info = await lstat(current.source);
      if (info.isSymbolicLink()) throw new Error("Folders containing symbolic links cannot be imported");
      if (info.isDirectory()) {
        const children = await readdir(current.source);
        for (const child of children) {
          pending.push({ source: path.join(current.source, child), targetRelative: `${current.targetRelative}/${child}` });
        }
      } else if (info.isFile()) {
        if (info.size > MAX_IMPORT_FILE_BYTES) throw new Error(`The file "${path.basename(current.source)}" is too large to import`);
        bytes += info.size;
      } else {
        throw new Error("Only regular files and folders can be imported");
      }
    }
    return { entries, bytes };
  }

  private async copyImportTree(source: string, target: string): Promise<void> {
    const info = await lstat(source);
    if (info.isSymbolicLink()) throw new Error("Symbolic links cannot be imported into a project");
    if (info.isDirectory()) {
      await mkdir(target, { mode: info.mode & 0o777 });
      const children = await readdir(source);
      for (const child of children) await this.copyImportTree(path.join(source, child), path.join(target, child));
      return;
    }
    if (!info.isFile()) throw new Error("Only regular files and folders can be imported");
    await copyFile(source, target, constants.COPYFILE_EXCL);
    await chmod(target, info.mode & 0o777);
  }

  private normalizeDirectoryPath(value: string): string {
    if (value === "") return "";
    const relative = this.normalizeRelativePath(value);
    this.assertUserMutablePath(relative);
    return relative;
  }

  private async resolveExistingDirectory(relative: string): Promise<string> {
    const candidate = relative ? path.resolve(this.getWorkspaceRoot(), ...relative.split("/")) : this.getWorkspaceRoot();
    const info = await lstat(candidate);
    if (info.isSymbolicLink() || !info.isDirectory()) throw new Error("The destination is not a project folder");
    const canonical = await realpath(candidate);
    this.assertInsideWorkspace(canonical);
    return canonical;
  }

  private async resolveExistingEntry(relative: string): Promise<{ absolute: string; kind: "file" | "directory" }> {
    const candidate = path.resolve(this.getWorkspaceRoot(), ...relative.split("/"));
    this.assertLexicallyInsideWorkspace(candidate);
    const info = await lstat(candidate);
    if (info.isSymbolicLink() || (!info.isFile() && !info.isDirectory())) {
      throw new Error("The requested path is not a regular file or folder");
    }
    const canonical = await realpath(candidate);
    this.assertInsideWorkspace(canonical);
    return { absolute: canonical, kind: info.isDirectory() ? "directory" : "file" };
  }

  private async resolveNewPath(relative: string): Promise<string> {
    const parentRelative = path.posix.dirname(relative);
    const parent = await this.resolveExistingDirectory(parentRelative === "." ? "" : parentRelative);
    const absolute = path.join(parent, path.posix.basename(relative));
    this.assertLexicallyInsideWorkspace(absolute);
    return absolute;
  }

  private assertUserMutablePath(relative: string): void {
    for (const segment of relative.split("/")) {
      const hasControlCharacter = [...segment].some((character) => character.charCodeAt(0) < 32);
      if (segment.length > 255 || segment !== segment.trim() || /[<>:"|?*]/.test(segment) || hasControlCharacter || /[. ]$/.test(segment) || WINDOWS_RESERVED_NAMES.test(segment)) {
        throw new Error(`"${segment}" cannot be used as a project file or folder name`);
      }
      if (PROTECTED_DIRECTORIES.has(segment.toLowerCase())) {
        throw new Error(`The internal folder "${segment}" cannot be changed from the project explorer`);
      }
    }
  }

  private async assertMissing(absolute: string, relative: string): Promise<void> {
    try {
      await lstat(absolute);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    throw new Error(`A file or folder already exists at "${relative}"`);
  }

  private isInside(parent: string, candidate: string): boolean {
    const relative = path.relative(parent, candidate);
    return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
  }

  private rethrowCreationError(error: unknown, relative: string): never {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new Error(`A file or folder already exists at "${relative}"`);
    throw error;
  }

  private assertLexicallyInsideWorkspace(candidate: string): void {
    const root = this.getWorkspaceRoot();
    const relative = path.relative(root, candidate);
    if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("Path escapes the active workspace");
  }

  private assertInsideWorkspace(candidate: string): void {
    if (!this.canonicalRoot) throw new Error("Open a project folder first");
    const root = process.platform === "win32" ? this.canonicalRoot.toLowerCase() : this.canonicalRoot;
    const target = process.platform === "win32" ? candidate.toLowerCase() : candidate;
    const relative = path.relative(root, target);
    if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("Path escapes the active workspace");
  }
}

export function projectPathFromNative(value: string): string {
  return toProjectPath(value);
}
