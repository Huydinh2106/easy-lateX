import { cp, mkdir, mkdtemp, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ArtifactRegistry } from "../src/main/services/compiler/ArtifactRegistry";
import { DockerLatexCompiler } from "../src/main/services/compiler/DockerLatexCompiler";
import type { CompilerRequest } from "../src/main/services/compiler/CompilerBackend";

const fixtureRoot = path.resolve(import.meta.dirname, "fixtures/compiler");
const integration = describe.runIf(process.env.EASY_LATEX_COMPILER_INTEGRATION === "1");

async function withProject(fixture: string, run: (compiler: DockerLatexCompiler, request: CompilerRequest) => Promise<void>): Promise<void> {
  const workspacePath = await mkdtemp(path.join(os.tmpdir(), "easy-latex-integration-"));
  try {
    await cp(path.join(fixtureRoot, fixture), workspacePath, { recursive: true });
    const outputDirectory = path.join(workspacePath, ".easy-latex/build");
    await mkdir(outputDirectory, { recursive: true });
    const compiler = new DockerLatexCompiler(process.env.EASY_LATEX_DOCKER_IMAGE);
    await run(compiler, { workspacePath, outputDirectory, rootDocument: "main.tex", engine: "pdflatex", onOutput: () => undefined });
  } finally {
    await rm(workspacePath, { recursive: true, force: true });
  }
}

integration("Docker compiler integration", () => {
  it.each([
    ["pdflatex-basic", "pdflatex"], ["pdflatex-vietnamese", "pdflatex"],
    ["xelatex-unicode", "xelatex"], ["lualatex-unicode", "lualatex"],
    ["bibtex", "pdflatex"], ["biber", "pdflatex"],
    ["packages", "pdflatex"], ["multifile", "pdflatex"]
  ] as const)("compiles %s with %s through the app backend", async (fixture, engine) => {
    await withProject(fixture, async (compiler, request) => {
      const result = await compiler.compile({ ...request, engine });
      expect(result.success, result.log.slice(-6000)).toBe(true);
      expect(result.errors).toEqual([]);
      expect(result.pdfPath).toBeDefined();
      expect(result.synctexPath).toBeDefined();
    });
  }, 180_000);

  it("reports the missing-package root cause from a real failed compile", async () => {
    await withProject("broken", async (compiler, request) => {
      const result = await compiler.compile(request);
      expect(result.success).toBe(false);
      expect(result.errors.some((error) => error.message.includes("easy-latex-intentionally-missing.sty"))).toBe(true);
      expect(result.errors.some((error) => /Emergency stop|Fatal error/i.test(error.message))).toBe(false);
    });
  }, 180_000);

  it("retries a cached failure when a runtime gains a previously missing package", async () => {
    await withProject("broken", async (compiler, request) => {
      expect((await compiler.compile(request)).success).toBe(false);
      // Simulate a runtime upgrade: the missing dependency now exists while
      // the root source and timestamp remain unchanged.
      await writeFile(path.join(request.workspacePath, "easy-latex-intentionally-missing.sty"), "\\ProvidesPackage{easy-latex-intentionally-missing}\n");
      const retried = await compiler.compile(request);
      expect(retried.success, retried.log.slice(-6000)).toBe(true);
      expect(retried.errors).toEqual([]);
    });
  }, 180_000);

  it("reports BibTeX errors and preserves the previous successful preview", async () => {
    await withProject("bibtex", async (compiler, request) => {
      const successful = await compiler.compile(request);
      expect(successful.success).toBe(true);
      const registry = new ArtifactRegistry();
      const previousUrl = await registry.registerPdf(successful.pdfPath!, request.outputDirectory);
      const previousBytes = await readFile(registry.resolve(previousUrl)!);
      const root = path.join(request.workspacePath, "main.tex");
      const source = await readFile(root, "utf8");
      const originalTime = await stat(root);
      await writeFile(root, source.replace("\\end{document}", "\\bibliographystyle{unsrt}\n\\end{document}"));
      await utimes(root, originalTime.atime, originalTime.mtime);
      const failed = await compiler.compile(request);
      expect(failed.success).toBe(false);
      expect(failed.errors.some((error) => /BibTeX: Illegal, another \\bibstyle command/.test(error.message))).toBe(true);
      expect(await readFile(registry.resolve(previousUrl)!)).toEqual(previousBytes);
      await writeFile(root, source);
      const repaired = await compiler.compile(request);
      expect(repaired.success, repaired.log.slice(-6000)).toBe(true);
      expect(repaired.errors).toEqual([]);
    });
  }, 180_000);

  it("cancels an active compile through the app backend", async () => {
    await withProject("cancel", async (compiler, request) => {
      let running!: () => void;
      const started = new Promise<void>((resolve) => { running = resolve; });
      const build = compiler.compile({ ...request, onOutput: (chunk) => {
        if (chunk.includes("entering extended mode")) running();
      } });
      await Promise.race([started, build.then(() => { throw new Error("Compiler exited before starting the cancellation fixture"); })]);
      const cancelledAt = performance.now();
      expect(await compiler.cancel()).toBe(true);
      const result = await build;
      expect(result.cancelled).toBe(true);
      expect(result.success).toBe(false);
      expect(performance.now() - cancelledAt).toBeLessThan(10_000);
    });
  }, 30_000);
});
