import fs from "node:fs/promises";
import path from "node:path";
import { Inject, Injectable } from "@nestjs/common";
import Docker from "dockerode";
import type { AppConfig } from "../common/config";
import { normalizeProjectPath } from "../common/path";
import { APP_CONFIG } from "../common/tokens";
import type { CompileInput, CompileResult, CompilerAdapter } from "./compiler-adapter";

@Injectable()
export class LatexmkCompilerAdapter implements CompilerAdapter {
  private readonly docker = new Docker();
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  async compile(input: CompileInput): Promise<CompileResult> {
    const rootFile = normalizeProjectPath(input.rootFile);
    const started = Date.now();
    const container = await this.docker.createContainer({
      Image: this.config.compiler.image,
      Cmd: ["latexmk", "-pdf", "-interaction=nonstopmode", "-file-line-error", "-halt-on-error", "-synctex=1", "-no-shell-escape", rootFile],
      WorkingDir: "/workspace",
      // The backend runtime uses the standard Node image user (uid/gid 1000).
      // Matching that non-root identity lets latexmk write beside the staged
      // sources without making the host-side compile workspace world-writable.
      User: "1000:1000",
      Tty: true,
      NetworkDisabled: true,
      Labels: { "com.easy-latex.managed": "true", "com.easy-latex.build-id": input.buildId },
      HostConfig: {
        Binds: [`${input.workspacePath}:/workspace:rw`],
        NetworkMode: "none",
        AutoRemove: false,
        ReadonlyRootfs: true,
        CapDrop: ["ALL"],
        SecurityOpt: ["no-new-privileges"],
        Memory: 1024 * 1024 * 1024,
        NanoCpus: 1_500_000_000,
        PidsLimit: 256,
        Tmpfs: { "/tmp": "rw,noexec,nosuid,size=128m" }
      }
    });
    let timedOut = false;
    let exitCode: number | null = null;
    let timeout: NodeJS.Timeout | undefined;
    try {
      await container.start();
      const result = await Promise.race([
        container.wait().then((value) => ({ kind: "done" as const, code: value.StatusCode })),
        new Promise<{ kind: "timeout" }>((resolve) => {
          timeout = setTimeout(() => resolve({ kind: "timeout" }), this.config.compiler.timeoutMs);
        })
      ]);
      if (timeout) clearTimeout(timeout);
      if (result.kind === "timeout") {
        timedOut = true;
        await container.stop({ t: 2 }).catch(() => undefined);
      } else exitCode = result.code;
      const raw = await container.logs({ stdout: true, stderr: true });
      const log = Buffer.from(raw).subarray(0, this.config.compiler.maxLogBytes);
      const outputBase = path.join(input.workspacePath, rootFile.replace(/\.tex$/i, ""));
      const pdfPath = `${outputBase}.pdf`;
      const synctexPath = `${outputBase}.synctex.gz`;
      const pdf = await fs.stat(pdfPath).catch(() => null);
      const synctex = await fs.stat(synctexPath).catch(() => null);
      return {
        success: !timedOut && exitCode === 0 && Boolean(pdf) && (pdf?.size ?? 0) <= this.config.compiler.maxArtifactBytes,
        timedOut, exitCode, durationMs: Date.now() - started, log,
        pdfPath: pdf ? pdfPath : undefined,
        synctexPath: synctex ? synctexPath : undefined
      };
    } finally {
      if (timeout) clearTimeout(timeout);
      await container.remove({ force: true }).catch(() => undefined);
    }
  }
}
