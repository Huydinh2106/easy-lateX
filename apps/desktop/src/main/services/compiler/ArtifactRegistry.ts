import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { copyFile, realpath, unlink } from "node:fs/promises";
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
    // A later failed build can replace the working PDF before BibTeX fails.
    const previewPath = path.join(canonicalOutput, `.${id}.preview.pdf`);
    await copyFile(canonicalPdf, previewPath, constants.COPYFILE_EXCL);
    this.artifacts.set(id, previewPath);
    while (this.artifacts.size > 8) {
      const oldest = this.artifacts.keys().next().value;
      if (!oldest) break;
      const oldPath = this.artifacts.get(oldest);
      this.artifacts.delete(oldest);
      if (oldPath) await unlink(oldPath).catch(() => undefined);
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
