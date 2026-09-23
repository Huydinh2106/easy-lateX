import { chmod, lstat, mkdir, readFile, readdir, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { FileContent, FileEntry, WriteFileInput, WriteFileResult } from "@easy-latex/shared-types";

const MAX_TEXT_FILE_BYTES = 10 * 1024 * 1024;
const MAX_TREE_ENTRIES = 20_000;
const IGNORED_DIRECTORIES = new Set([".git", "node_modules"]);
const IGNORED_BUILD_EXTENSIONS = new Set([".aux", ".bbl", ".bcf", ".blg", ".fdb_latexmk", ".fls", ".log", ".out", ".run.xml", ".synctex.gz"]);
const EDITABLE_EXTENSIONS = new Set([".tex", ".bib", ".sty", ".cls", ".bst", ".ltx", ".md", ".txt"]);

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
