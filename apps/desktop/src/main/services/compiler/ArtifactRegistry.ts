import { randomUUID } from "node:crypto";
import { realpath } from "node:fs/promises";
import path from "node:path";

export class ArtifactRegistry {
  private readonly artifacts = new Map<string, string>();

  async registerPdf(pdfPath: string, outputDirectory: string): Promise<string> {
    const canonicalPdf = await realpath(pdfPath);
    const canonicalOutput = await realpath(outputDirectory);
    const relative = path.relative(canonicalOutput, canonicalPdf);
    if (relative.startsWith("..") || path.isAbsolute(relative) || path.extname(canonicalPdf).toLowerCase() !== ".pdf") {
      throw new Error("Compiler PDF output is outside the build directory");
    }
    const id = randomUUID();
    this.artifacts.set(id, canonicalPdf);
    while (this.artifacts.size > 8) {
      const oldest = this.artifacts.keys().next().value;
      if (!oldest) break;
      this.artifacts.delete(oldest);
    }
    return `easy-latex://pdf/${id}`;
  }

  resolve(url: string): string | null {
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== "easy-latex:" || parsed.hostname !== "pdf") return null;
      const id = parsed.pathname.replace(/^\//, "");
      return /^[0-9a-f-]{36}$/i.test(id) ? this.artifacts.get(id) ?? null : null;
    } catch {
      return null;
    }
  }

  clear(): void {
    this.artifacts.clear();
  }
}
