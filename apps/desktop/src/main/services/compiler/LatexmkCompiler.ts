import { spawn, type ChildProcess } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { parseLatexLog } from "@easy-latex/latex";
import type { LatexEngine } from "@easy-latex/shared-types";
import type { CompilerBackend, CompilerOutput, CompilerRequest } from "./CompilerBackend";

const ENGINE_FLAG: Record<LatexEngine, string> = {
  pdflatex: "-pdf",
  xelatex: "-xelatex",
  lualatex: "-lualatex"
};

const MAX_LOG_CHARACTERS = 5 * 1024 * 1024;

export class LatexmkCompiler implements CompilerBackend {
  private child: ChildProcess | null = null;
  private cancelled = false;

  async compile(request: CompilerRequest): Promise<CompilerOutput> {
    if (this.child) throw new Error("A LaTeX compilation is already running");
    this.cancelled = false;
    const started = performance.now();
    const args = [
      ENGINE_FLAG[request.engine],
      "-interaction=nonstopmode",
      "-file-line-error",
      "-halt-on-error",
      "-synctex=1",
      "-no-shell-escape",
      `-outdir=${request.outputDirectory}`,
      request.rootDocument
    ];

    let output = "";
    const append = (chunk: Buffer): void => {
      const text = chunk.toString("utf8");
      if (output.length < MAX_LOG_CHARACTERS) output += text.slice(0, MAX_LOG_CHARACTERS - output.length);
      request.onOutput(text);
    };

    const exitCode = await new Promise<number | null>((resolve, reject) => {
      const child = spawn(request.executable, args, {
        cwd: request.workspacePath,
        detached: process.platform !== "win32",
        shell: false,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"]
      });
      this.child = child;
      child.stdout.on("data", append);
      child.stderr.on("data", append);
      child.once("error", (error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") {
          reject(new Error("latexmk was not found. Install a TeX distribution that provides latexmk, then try again."));
          return;
        }
        reject(new Error(`latexmk could not start: ${error.message}`));
      });
      child.once("close", resolve);
    }).finally(() => {
      this.child = null;
    });

    const rootBase = path.basename(request.rootDocument, path.extname(request.rootDocument));
    const pdfPath = path.join(request.outputDirectory, `${rootBase}.pdf`);
    const synctexPath = path.join(request.outputDirectory, `${rootBase}.synctex.gz`);
    const logPath = path.join(request.outputDirectory, `${rootBase}.log`);
    const fileLog = await readFile(logPath, "utf8").catch(() => "");
    const log = `${output}\n${fileLog}`.slice(0, MAX_LOG_CHARACTERS);
    const diagnostics = parseLatexLog(log);
    const hasPdf = await access(pdfPath).then(() => true).catch(() => false);
    const hasSyncTeX = await access(synctexPath).then(() => true).catch(() => false);
    const success = !this.cancelled && exitCode === 0 && hasPdf;

    return {
      success,
      cancelled: this.cancelled,
      exitCode,
      duration: Math.round(performance.now() - started),
      log,
      ...(hasPdf ? { pdfPath } : {}),
      ...(hasSyncTeX ? { synctexPath } : {}),
      errors: diagnostics.errors,
      warnings: diagnostics.warnings
    };
  }

  async cancel(): Promise<boolean> {
    const child = this.child;
    if (!child?.pid) return false;
    this.cancelled = true;
    if (process.platform === "win32") {
      const killer = spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], { shell: false, windowsHide: true });
      await new Promise<void>((resolve) => killer.once("close", () => resolve()));
      return true;
    }
    const killGroup = (signal: NodeJS.Signals): void => {
      try {
        process.kill(-child.pid!, signal);
      } catch {
        child.kill(signal);
      }
    };
    killGroup("SIGTERM");
    const timer = setTimeout(() => killGroup("SIGKILL"), 2000);
    child.once("close", () => clearTimeout(timer));
    return true;
  }
}
