import { watch, type FSWatcher } from "node:fs";
import path from "node:path";
import type { FileChangeEvent } from "@easy-latex/shared-types";

type Listener = (event: FileChangeEvent) => void;

export class FileWatcher {
  private watcher: FSWatcher | null = null;
  private root: string | null = null;
  private readonly listeners = new Set<Listener>();
  private readonly pending = new Map<string, NodeJS.Timeout>();

  start(workspaceRoot: string): void {
    this.stop();
    this.root = workspaceRoot;
    try {
      this.watcher = watch(workspaceRoot, { recursive: true }, (eventType, filename) => {
        this.queue(eventType === "rename" ? "renamed" : "changed", filename?.toString());
      });
    } catch {
      this.watcher = watch(workspaceRoot, (eventType, filename) => {
        this.queue(eventType === "rename" ? "renamed" : "rescan", filename?.toString());
      });
    }
    this.watcher.on("error", () => this.emit({ kind: "rescan" }));
  }

  stop(): void {
    this.watcher?.close();
    this.watcher = null;
    this.root = null;
    for (const timer of this.pending.values()) clearTimeout(timer);
    this.pending.clear();
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private queue(kind: FileChangeEvent["kind"], nativePath?: string): void {
    if (nativePath?.split(path.sep).includes(".git") || nativePath?.split(path.sep).includes(".easy-latex")) return;
    const projectPath = nativePath ? nativePath.split(path.sep).join("/") : undefined;
    const key = projectPath ?? "*";
    const existing = this.pending.get(key);
    if (existing) clearTimeout(existing);
    this.pending.set(key, setTimeout(() => {
      this.pending.delete(key);
      this.emit({ kind, ...(projectPath ? { path: projectPath } : {}) });
    }, 120));
  }

  private emit(event: FileChangeEvent): void {
    for (const listener of this.listeners) listener(event);
  }
}
