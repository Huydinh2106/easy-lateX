import { randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { parseLatexLog } from "@easy-latex/latex";
import type { LatexEngine } from "@easy-latex/shared-types";
import type { CompilerBackend, CompilerOutput, CompilerRequest } from "./CompilerBackend";

export const DEFAULT_COMPILER_IMAGE = "easy-latex-compiler:2026.09.15";

const ENGINE_FLAG: Record<LatexEngine, string> = {
  pdflatex: "-pdf",
  xelatex: "-xelatex",
  lualatex: "-lualatex"
};

const MAX_LOG_CHARACTERS = 5 * 1024 * 1024;

export function resolveDockerExecutable(
  platform = process.platform,
  fileExists: (candidate: string) => boolean = existsSync
): string {
  const candidates = platform === "darwin"
    ? ["/Applications/Docker.app/Contents/Resources/bin/docker", "/usr/local/bin/docker", "/opt/homebrew/bin/docker"]
    : platform === "win32"
      ? ["C:\\Program Files\\Docker\\Docker\\resources\\bin\\docker.exe"]
      : ["/usr/bin/docker", "/usr/local/bin/docker"];
  return candidates.find((candidate) => fileExists(candidate)) ?? "docker";
}

interface DockerRunOptions {
  image: string;
  containerName: string;
  user?: string;
}

export function buildDockerRunArguments(request: CompilerRequest, options: DockerRunOptions): string[] {
  return [
    "run",
    "--rm",
    "--name",
    options.containerName,
    "--network",
    "none",
    "--read-only",
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges",
    "--pids-limit",
    "256",
    "--memory",
    "2g",
    "--cpus",
    "2",
    "--tmpfs",
    "/tmp:rw,nosuid,nodev,noexec,size=256m,mode=1777",
    "--tmpfs",
    "/var/cache/biber:rw,nosuid,nodev,exec,size=256m,mode=1777",
    "--env",
    "HOME=/tmp",
    "--env",
    "PAR_GLOBAL_TMPDIR=/var/cache/biber",
    ...(options.user ? ["--user", options.user] : []),
    "--mount",
    `type=bind,source=${request.workspacePath},target=/workspace,readonly`,
    "--mount",
    `type=bind,source=${request.outputDirectory},target=/output`,
    "--workdir",
    "/workspace",
    options.image,
    ENGINE_FLAG[request.engine],
    // Clean cached auxiliary state before rebuilding: -g alone can rerun
    // BibTeX on a stale, invalid .aux before LaTeX regenerates it. Preview PDFs
    // are separately snapshotted by ArtifactRegistry and survive this cleanup.
    "-gg",
    "-interaction=nonstopmode",
    "-file-line-error",
    "-halt-on-error",
    "-synctex=1",
    "-no-shell-escape",
    "-outdir=/output",
    request.rootDocument
  ];
}

export class DockerLatexCompiler implements CompilerBackend {
  private child: ChildProcess | null = null;
  private containerName: string | null = null;
  private cancelled = false;

  constructor(
    private readonly image = DEFAULT_COMPILER_IMAGE,
    private readonly executable = resolveDockerExecutable()
  ) {}

  async compile(request: CompilerRequest): Promise<CompilerOutput> {
    if (this.child) throw new Error("A LaTeX compilation is already running");
    await this.assertImageAvailable();
    this.cancelled = false;
    const started = performance.now();
    const containerName = `easy-latex-build-${randomUUID()}`;
    this.containerName = containerName;
    const user = typeof process.getuid === "function" && typeof process.getgid === "function"
      ? `${process.getuid()}:${process.getgid()}`
      : undefined;
    const args = buildDockerRunArguments(request, {
      image: this.image,
      containerName,
      ...(user ? { user } : {})
    });

    let output = "";
    const append = (chunk: Buffer): void => {
      const text = chunk.toString("utf8");
      if (output.length < MAX_LOG_CHARACTERS) output += text.slice(0, MAX_LOG_CHARACTERS - output.length);
      request.onOutput(text);
    };

    const exitCode = await new Promise<number | null>((resolve, reject) => {
      const child = spawn(this.executable, args, {
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
          reject(new Error("Docker CLI was not found. Install and start Docker Desktop, then try again."));
          return;
        }
        reject(new Error(`Docker could not start the compiler: ${error.message}`));
      });
      child.once("close", resolve);
    }).finally(() => {
      this.child = null;
      this.containerName = null;
    });

    const rootBase = path.basename(request.rootDocument, path.extname(request.rootDocument));
    const pdfPath = path.join(request.outputDirectory, `${rootBase}.pdf`);
    const synctexPath = path.join(request.outputDirectory, `${rootBase}.synctex.gz`);
    const logPath = path.join(request.outputDirectory, `${rootBase}.log`);
    const fileLog = await readFile(logPath, "utf8").catch(() => "");
    const bibliographyLog = await readFile(path.join(request.outputDirectory, `${rootBase}.blg`), "utf8").catch(() => "");
    const log = `${output}\n${fileLog}\n${bibliographyLog}`.slice(0, MAX_LOG_CHARACTERS);
    const hasPdf = await access(pdfPath).then(() => true).catch(() => false);
    const hasSyncTeX = await access(synctexPath).then(() => true).catch(() => false);
    const success = !this.cancelled && exitCode === 0 && hasPdf;
    // latexmk can recover during later passes (e.g. create an include's aux
    // directory). A successful build's Problems must reflect the final pass.
    const diagnostics = parseLatexLog(success && fileLog ? fileLog : log);
    if (!success && !this.cancelled && diagnostics.errors.length === 0) {
      diagnostics.errors.push({
        severity: "error",
        message: `Compilation failed (exit code ${String(exitCode)}). See the technical log for details.`
      });
    }

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
    const containerName = this.containerName;
    if (!child || !containerName) return false;
    this.cancelled = true;
    await this.runDocker(["stop", "--time", "2", containerName]).catch(() => {
      if (child.pid && process.platform !== "win32") {
        try { process.kill(-child.pid, "SIGKILL"); } catch { child.kill("SIGKILL"); }
      } else {
        child.kill("SIGKILL");
      }
    });
    return true;
  }

  private async assertImageAvailable(): Promise<void> {
    try {
      await this.runDocker(["image", "inspect", this.image]);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Docker is unavailable";
      if (/no such image/i.test(message)) {
        throw new Error(`Compiler image ${this.image} is missing. Run npm run compiler:build first.`);
      }
      throw new Error(`Docker is not ready: ${message}`);
    }
  }

  private runDocker(args: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = spawn(this.executable, args, { shell: false, windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
      let errorOutput = "";
      child.stderr.on("data", (chunk: Buffer) => {
        if (errorOutput.length < 4096) errorOutput += chunk.toString("utf8").slice(0, 4096 - errorOutput.length);
      });
      child.once("error", (error: NodeJS.ErrnoException) => {
        reject(error.code === "ENOENT" ? new Error("Docker CLI was not found") : error);
      });
      child.once("close", (code) => {
        if (code === 0) resolve();
        else reject(new Error(errorOutput.trim() || `docker exited with code ${String(code)}`));
      });
    });
  }
}
