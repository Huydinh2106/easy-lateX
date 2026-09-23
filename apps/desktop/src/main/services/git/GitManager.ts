import { spawn } from "node:child_process";
import type { GitStatus } from "@easy-latex/shared-types";
import type { FileManager } from "../filesystem/FileManager";

export class GitManager {
  constructor(private readonly files: FileManager) {}

  async status(): Promise<GitStatus> {
    let workspacePath: string;
    try {
      workspacePath = this.files.getWorkspaceRoot();
    } catch {
      return { available: true, isRepository: false };
    }
    return new Promise((resolve) => {
      const child = spawn("git", ["rev-parse", "--is-inside-work-tree"], {
        cwd: workspacePath,
        shell: false,
        windowsHide: true,
        stdio: ["ignore", "pipe", "ignore"]
      });
      let output = "";
      child.stdout.on("data", (chunk: Buffer) => { output += chunk.toString("utf8"); });
      child.once("error", () => resolve({ available: false, isRepository: false }));
      child.once("close", (code) => resolve({ available: true, isRepository: code === 0 && output.trim() === "true" }));
    });
  }
}
