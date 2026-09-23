import type { CompileEvent, CompileOptions, CompileResult, LatexEngine } from "@easy-latex/shared-types";
import type { ArtifactRegistry } from "./ArtifactRegistry";
import type { CompilerBackend } from "./CompilerBackend";
import type { FileManager } from "../filesystem/FileManager";
import type { SettingsManager } from "../settings/SettingsManager";
import type { WorkspaceManager } from "../workspace/WorkspaceManager";

type Listener = (event: CompileEvent) => void;

export class CompileManager {
  private active: Promise<CompileResult> | null = null;
  private readonly listeners = new Set<Listener>();

  constructor(
    private readonly backend: CompilerBackend,
    private readonly workspace: WorkspaceManager,
    private readonly files: FileManager,
    private readonly settings: SettingsManager,
    private readonly artifacts: ArtifactRegistry
  ) {}

  build(options: CompileOptions = {}): Promise<CompileResult> {
    if (this.active) throw new Error("A LaTeX compilation is already running");
    const task = this.run(options);
    this.active = task;
    const clear = (): void => {
      if (this.active === task) this.active = null;
    };
    void task.then(clear, clear);
    return task;
  }

  async cancel(): Promise<boolean> {
    if (!this.active) return false;
    this.emit({ phase: "cancelling", message: "Cancelling compilation" });
    return this.backend.cancel();
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private async run(options: CompileOptions): Promise<CompileResult> {
    const current = this.workspace.current();
    if (!current) throw new Error("Open a project folder first");
    const rootDocument = this.workspace.requireRootDocument(options.rootDocument);
    await this.files.resolveExistingFile(rootDocument);
    const configuredEngine = await this.settings.get("compilerEngine");
    const engine: LatexEngine = options.engine ?? configuredEngine;
    const executable = await this.settings.get("latexmkPath");
    const outputDirectory = await this.files.ensureInternalDirectory(".easy-latex/build");
    this.emit({ phase: "starting", message: `Starting ${engine}` });
    const started = performance.now();
    const output = await this.backend.compile({
      executable,
      workspacePath: current.project.workspacePath,
      outputDirectory,
      rootDocument,
      engine,
      onOutput: () => this.emit({ phase: "running", message: "Compiling", elapsed: Math.round(performance.now() - started) })
    });
    const pdfUrl = output.success && output.pdfPath ? await this.artifacts.registerPdf(output.pdfPath, outputDirectory) : undefined;
    const result: CompileResult = {
      success: output.success,
      cancelled: output.cancelled,
      ...(pdfUrl ? { pdfUrl } : {}),
      errors: output.errors,
      warnings: output.warnings,
      duration: output.duration,
      engine,
      rootDocument,
      log: output.log
    };
    this.emit({
      phase: output.cancelled ? "cancelled" : output.success ? "success" : "failed",
      message: output.cancelled ? "Compilation cancelled" : output.success ? "PDF updated" : "Compilation failed",
      elapsed: output.duration
    });
    return result;
  }

  private emit(event: CompileEvent): void {
    for (const listener of this.listeners) listener(event);
  }
}
