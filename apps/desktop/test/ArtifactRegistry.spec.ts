import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ArtifactRegistry } from "../src/main/services/compiler/ArtifactRegistry";

describe("ArtifactRegistry", () => {
  let directory: string;
  beforeEach(async () => { directory = await mkdtemp(path.join(os.tmpdir(), "easy-latex-artifacts-")); });
  afterEach(async () => { await rm(directory, { recursive: true, force: true }); });

  it("preserves successful bytes when a later compile overwrites the working PDF", async () => {
    const registry = new ArtifactRegistry();
    const workingPdf = path.join(directory, "main.pdf");
    await writeFile(workingPdf, "%PDF-1.7 last successful document");
    const previousUrl = await registry.registerPdf(workingPdf, directory);
    await writeFile(workingPdf, "%PDF-1.7 incomplete document before BibTeX failed");
    const previousPath = registry.resolve(previousUrl);
    expect(previousPath).not.toBe(workingPdf);
    expect(await readFile(previousPath!, "utf8")).toBe("%PDF-1.7 last successful document");
  });

  it("rejects PDFs outside the build directory", async () => {
    const registry = new ArtifactRegistry();
    const outside = await mkdtemp(path.join(os.tmpdir(), "easy-latex-outside-"));
    try {
      const pdf = path.join(outside, "main.pdf");
      await writeFile(pdf, "%PDF-1.7");
      await expect(registry.registerPdf(pdf, directory)).rejects.toThrow(/outside/);
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });
});
