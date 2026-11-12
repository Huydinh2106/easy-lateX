import { access, readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { forwardSearch, inverseSearch, parseSyncTeX, type SyncTeXData } from "@easy-latex/latex";
import type { SyncTeXForwardInput, SyncTeXInverseInput, SyncTeXResult } from "@easy-latex/shared-types";
import type { FileManager } from "../filesystem/FileManager";
import type { WorkspaceManager } from "../workspace/WorkspaceManager";

export class SyncTeXManager {
  private readonly artifacts = new Map<string, { workspaceRoot: string; data: SyncTeXData }>();
  private latestPath: string | null = null;
  private cache: {
    filePath: string;
    mtimeMs: number;
    data: SyncTeXData;
  } | null = null;

  constructor(
    private readonly workspace?: WorkspaceManager,
    private readonly files?: FileManager
  ) {}

  setLatestSyncTeX(filePath: string): void {
    this.latestPath = filePath;
  }

  /** Keep the parsed mapping immutable for exactly the PDF shown in the viewer. */
  async registerArtifact(pdfUrl: string, filePath: string, workspaceRoot: string): Promise<void> {
    if (this.artifacts.has(pdfUrl)) return;
    const data = await this.readData(filePath);
    this.artifacts.set(pdfUrl, { workspaceRoot: await realpath(workspaceRoot), data });
    while (this.artifacts.size > 8) {
      const oldest = this.artifacts.keys().next().value;
      if (!oldest) break;
      this.artifacts.delete(oldest);
    }
  }

  private artifact(pdfUrl: string): { workspaceRoot: string; data: SyncTeXData } {
    const snapshot = this.artifacts.get(pdfUrl);
    if (!snapshot) throw new Error("SyncTeX is unavailable for this PDF. Compile the document again.");
    if (this.files && path.resolve(this.files.getWorkspaceRoot()) !== snapshot.workspaceRoot) {
      throw new Error("This PDF belongs to another project. Compile the current project first.");
    }
    return snapshot;
  }

  async forward(input: SyncTeXForwardInput): Promise<SyncTeXResult> {
    try {
      const data = input.pdfUrl ? this.artifact(input.pdfUrl).data : await this.loadSyncTeXData();
      if (!data) {
        return { available: false, reason: "SyncTeX file not found. Please compile the document first." };
      }
      const res = forwardSearch(data, input.file, input.line, input.column);
      return {
        available: res.available,
        ...(res.reason ? { reason: res.reason } : {}),
        ...(res.page !== undefined ? { page: res.page } : {}),
        ...(res.x !== undefined ? { x: res.x } : {}),
        ...(res.y !== undefined ? { y: res.y } : {})
      };
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "SyncTeX forward navigation failed";
      return { available: false, reason: message };
    }
  }

  async inverse(input: SyncTeXInverseInput): Promise<SyncTeXResult> {
    try {
      const snapshot = input.pdfUrl ? this.artifact(input.pdfUrl) : null;
      const data = snapshot?.data ?? await this.loadSyncTeXData();
      if (!data) {
        return { available: false, reason: "SyncTeX file not found. Please compile the document first." };
      }
      let workspaceRoot: string | undefined;
      try {
        workspaceRoot = snapshot?.workspaceRoot ?? this.files?.getWorkspaceRoot();
      } catch {
        workspaceRoot = undefined;
      }
      const res = inverseSearch(data, input.page, input.x, input.y, workspaceRoot);
      return {
        available: res.available,
        ...(res.reason ? { reason: res.reason } : {}),
        ...(res.file ? { file: res.file } : {}),
        ...(res.line !== undefined ? { line: res.line } : {}),
        ...(res.column !== undefined ? { column: res.column } : {})
      };
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "SyncTeX inverse navigation failed";
      return { available: false, reason: message };
    }
  }

  private async loadSyncTeXData(): Promise<SyncTeXData | null> {
    const synctexPath = await this.resolveSyncTeXPath();
    if (!synctexPath) return null;

    const stats = await stat(synctexPath);
    if (this.cache && this.cache.filePath === synctexPath && this.cache.mtimeMs === stats.mtimeMs) {
      return this.cache.data;
    }

    const data = await this.readData(synctexPath);
    this.cache = {
      filePath: synctexPath,
      mtimeMs: stats.mtimeMs,
      data
    };
    return data;
  }

  private async readData(filePath: string): Promise<SyncTeXData> {
    const buffer = await readFile(filePath);
    return parseSyncTeX(filePath.endsWith(".gz") ? gunzipSync(buffer).toString("utf8") : buffer.toString("utf8"));
  }

  private async resolveSyncTeXPath(): Promise<string | null> {
    if (this.latestPath) {
      try {
        await access(this.latestPath);
        return this.latestPath;
      } catch {
        this.latestPath = null;
      }
    }

    if (!this.workspace || !this.files) return null;
    let currentWorkspaceRoot: string;
    try {
      currentWorkspaceRoot = this.files.getWorkspaceRoot();
    } catch {
      return null;
    }

    const current = this.workspace.current();
    if (!current?.project.rootDocument) return null;

    const rootDoc = current.project.rootDocument;
    const rootBase = path.basename(rootDoc, path.extname(rootDoc));
    const buildDir = path.join(currentWorkspaceRoot, ".easy-latex", "build");
    const gzPath = path.join(buildDir, `${rootBase}.synctex.gz`);
    const plainPath = path.join(buildDir, `${rootBase}.synctex`);

    try {
      await access(gzPath);
      return gzPath;
    } catch {
      try {
        await access(plainPath);
        return plainPath;
      } catch {
        return null;
      }
    }
  }
}
