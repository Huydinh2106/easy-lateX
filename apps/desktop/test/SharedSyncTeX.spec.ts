import { randomUUID } from "node:crypto";
import { access, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
import type { AccountState } from "@easy-latex/shared-types";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import type { AccountManager } from "../src/main/services/account/AccountManager";
import { CollaborationManager } from "../src/main/services/collaboration/CollaborationManager";
import { ArtifactRegistry } from "../src/main/services/compiler/ArtifactRegistry";
import type { CompilerOutput, CompilerRequest } from "../src/main/services/compiler/CompilerBackend";
import { DockerLatexCompiler } from "../src/main/services/compiler/DockerLatexCompiler";

const backendUrl = "https://cloud.example.test";
const pdfBytes = Buffer.from("%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n");
const sourceFiles = [{ path: "main.tex", content: "\\documentclass{article}\n\\begin{document}Example.\\end{document}" }];

function syncTeX(page: number): string {
  return `SyncTeX Version:1
Input:1:/workspace/main.tex
Output:pdf
Magnification:1000
Unit:1
X Offset:0
Y Offset:0
Content:
!100
{${page}
[1,1:6578176,6578176:26312704,65781760,0
(1,5:6578176,13156352:13156352,657817,131563
h1,5:6578176,13156352:6578176,657817,131563
)
]
}${page}
Postamble:
Count:1
!200
Post Scriptum:
`;
}

type SyncData = "valid" | "missing" | "missing-file" | "malformed" | "invalid-gzip";

async function compilerOutput(
  request: CompilerRequest,
  options: { page?: number; syncData?: SyncData; success?: boolean; cancelled?: boolean } = {}
): Promise<CompilerOutput> {
  const { page = 1, syncData = "valid", success = true, cancelled = false } = options;
  const pdfPath = path.join(request.outputDirectory, "main.pdf");
  const synctexPath = path.join(request.outputDirectory, "main.synctex.gz");
  await writeFile(pdfPath, pdfBytes);
  if (syncData === "valid" || syncData === "malformed") {
    await writeFile(synctexPath, gzipSync(syncData === "valid" ? syncTeX(page) : "This is not SyncTeX data."));
  } else if (syncData === "invalid-gzip") {
    await writeFile(synctexPath, "This is not gzip data.");
  }
  return {
    success,
    cancelled,
    exitCode: success ? 0 : 1,
    duration: 1,
    log: cancelled ? "Compilation cancelled" : success ? "Compiled" : "Compilation failed",
    pdfPath,
    ...(syncData !== "missing" ? { synctexPath } : {}),
    errors: [],
    warnings: []
  };
}

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => { resolve = complete; });
  return { promise, resolve };
}

describe("Shared project SyncTeX", () => {
  let directory: string;
  let state: AccountState;
  let manager: CollaborationManager;
  let artifacts: ArtifactRegistry;
  let compile: MockInstance<DockerLatexCompiler["compile"]>;
  const accountState = vi.fn<() => Promise<AccountState>>();

  beforeEach(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), "easy-latex-shared-synctex-"));
    state = {
      configured: true,
      apiUrl: backendUrl,
      googleEnabled: false,
      recovery: false,
      account: { id: "account-a", email: "a@example.test", displayName: "Author A" }
    };
    accountState.mockReset().mockImplementation(() => Promise.resolve(state));
    const accounts = { state: accountState } as unknown as AccountManager;
    artifacts = new ArtifactRegistry();
    manager = new CollaborationManager(accounts, backendUrl, directory, artifacts);
    compile = vi.spyOn(DockerLatexCompiler.prototype, "compile").mockImplementation(request => compilerOutput(request));
  });

  afterEach(async () => {
    manager.stopUpdates();
    vi.restoreAllMocks();
    await rm(directory, { recursive: true, force: true });
  });

  async function build(projectId: string) {
    const result = await manager.compile(projectId, sourceFiles, "main.tex", "pdflatex");
    expect(result.success).toBe(true);
    expect(result.pdfUrl).toBeDefined();
    return result.pdfUrl!;
  }

  it("navigates the retained PDF after the temporary sources and SyncTeX file are removed", async () => {
    const projectId = randomUUID();
    const pdfUrl = await build(projectId);
    const request = compile.mock.calls[0]![0];
    await expect(access(request.workspacePath)).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readdir(path.join(directory, "builds"))).toEqual([]);
    expect(await readFile(artifacts.resolve(pdfUrl)!)).toEqual(pdfBytes);

    await expect(manager.forwardSync(projectId, pdfUrl, { file: "main.tex", line: 5, column: 1 }))
      .resolves.toMatchObject({ available: true, page: 1, x: 100, y: 190 });
  });

  it("isolates projects with the same source filename by project and PDF URL", async () => {
    const firstProject = randomUUID();
    const secondProject = randomUUID();
    compile.mockImplementationOnce(request => compilerOutput(request, { page: 1 }));
    const firstPdf = await build(firstProject);
    compile.mockImplementationOnce(request => compilerOutput(request, { page: 3 }));
    const secondPdf = await build(secondProject);

    await expect(manager.forwardSync(firstProject, firstPdf, { file: "main.tex", line: 5 }))
      .resolves.toMatchObject({ available: true, page: 1 });
    await expect(manager.forwardSync(secondProject, secondPdf, { file: "main.tex", line: 5 }))
      .resolves.toMatchObject({ available: true, page: 3 });
    await expect(manager.forwardSync(firstProject, secondPdf, { file: "main.tex", line: 5 }))
      .resolves.toMatchObject({ available: false });
    await expect(manager.forwardSync(secondProject, firstPdf, { file: "main.tex", line: 5 }))
      .resolves.toMatchObject({ available: false });
    await expect(manager.forwardSync(firstProject, `easy-latex://pdf/${randomUUID()}`, { file: "main.tex", line: 5 }))
      .resolves.toMatchObject({ available: false });
  });

  it("uses each PDF's mapping when a project has multiple successful previews", async () => {
    const projectId = randomUUID();
    const firstPdf = await build(projectId);
    compile.mockImplementationOnce(request => compilerOutput(request, { page: 4 }));
    const secondPdf = await build(projectId);

    expect(secondPdf).not.toBe(firstPdf);
    await expect(manager.forwardSync(projectId, firstPdf, { file: "main.tex", line: 5 }))
      .resolves.toMatchObject({ available: true, page: 1 });
    await expect(manager.forwardSync(projectId, secondPdf, { file: "main.tex", line: 5 }))
      .resolves.toMatchObject({ available: true, page: 4 });
  });

  it("distinguishes duplicate filenames by their exact source paths", async () => {
    const projectId = randomUUID();
    compile.mockImplementationOnce(async request => {
      const output = await compilerOutput(request);
      await writeFile(output.synctexPath!, gzipSync(`SyncTeX Version:1
Input:1:/workspace/chapters/main.tex
Input:2:/workspace/appendix/main.tex
Output:pdf
Magnification:1000
Unit:1
X Offset:0
Y Offset:0
Content:
{2
h1,5:6578176,13156352:6578176,657817,131563
}2
{6
h2,5:6578176,13156352:6578176,657817,131563
}6
Postamble:
Count:2
`));
      return output;
    });
    const result = await manager.compile(projectId, [
      ...sourceFiles,
      { path: "chapters/main.tex", content: "Chapter." },
      { path: "appendix/main.tex", content: "Appendix." }
    ], "main.tex", "pdflatex");
    expect(result.success).toBe(true);
    expect(result.pdfUrl).toBeDefined();

    await expect(manager.forwardSync(projectId, result.pdfUrl!, { file: "chapters/main.tex", line: 5 }))
      .resolves.toMatchObject({ available: true, page: 2 });
    await expect(manager.forwardSync(projectId, result.pdfUrl!, { file: "appendix/main.tex", line: 5 }))
      .resolves.toMatchObject({ available: true, page: 6 });
    await expect(manager.forwardSync(projectId, result.pdfUrl!, { file: "main.tex", line: 5 }))
      .resolves.toMatchObject({ available: false });
  });

  it.each([
    { label: "failed", cancelled: false },
    { label: "cancelled", cancelled: true }
  ])("preserves the previous preview and mapping after a $label build", async ({ cancelled }) => {
    const projectId = randomUUID();
    const pdfUrl = await build(projectId);
    compile.mockImplementationOnce(request => compilerOutput(request, { success: false, cancelled, page: 7 }));

    const result = await manager.compile(projectId, sourceFiles, "main.tex", "pdflatex");
    expect(result.success).toBe(false);
    expect(result.cancelled).toBe(cancelled);
    expect(result.pdfUrl).toBeUndefined();
    expect(await readFile(artifacts.resolve(pdfUrl)!)).toEqual(pdfBytes);
    expect(await readdir(path.join(directory, "builds"))).toEqual([]);
    await expect(manager.forwardSync(projectId, pdfUrl, { file: "main.tex", line: 5 }))
      .resolves.toMatchObject({ available: true, page: 1 });
  });

  it.each(["signed-out", "different-account"] as const)("rejects cached navigation for a %s session", async (session) => {
    const projectId = randomUUID();
    const pdfUrl = await build(projectId);
    state = {
      ...state,
      account: session === "signed-out" ? null : { id: "account-b", email: "b@example.test", displayName: "Author B" }
    };

    await expect(manager.forwardSync(projectId, pdfUrl, { file: "main.tex", line: 5 }))
      .resolves.toMatchObject({ available: false });
  });

  it.each(["stopUpdates", "backend-change"] as const)("clears retained mappings on %s", async (change) => {
    const projectId = randomUUID();
    const pdfUrl = await build(projectId);
    if (change === "stopUpdates") manager.stopUpdates();
    else manager.configure("https://another-cloud.example.test");

    expect(await readFile(artifacts.resolve(pdfUrl)!)).toEqual(pdfBytes);
    await expect(manager.forwardSync(projectId, pdfUrl, { file: "main.tex", line: 5 }))
      .resolves.toMatchObject({ available: false });
  });

  it("does not restore a stale mapping when a build finishes after stopUpdates", async () => {
    const projectId = randomUUID();
    const oldPdf = await build(projectId);
    const started = deferred<CompilerRequest>();
    const finished = deferred<CompilerOutput>();
    compile.mockImplementationOnce(request => {
      started.resolve(request);
      return finished.promise;
    });
    const compiling = manager.compile(projectId, sourceFiles, "main.tex", "pdflatex");
    const request = await started.promise;
    const output = await compilerOutput(request);
    manager.stopUpdates();
    finished.resolve(output);
    await expect(compiling).rejects.toThrow("Account or server changed. Reopen the project.");

    expect(await readFile(artifacts.resolve(oldPdf)!)).toEqual(pdfBytes);
    await expect(manager.forwardSync(projectId, oldPdf, { file: "main.tex", line: 5 }))
      .resolves.toMatchObject({ available: false });
    expect(await readdir(path.join(directory, "builds"))).toEqual([]);

    const currentPdf = await build(projectId);
    await expect(manager.forwardSync(projectId, currentPdf, { file: "main.tex", line: 5 }))
      .resolves.toMatchObject({ available: true, page: 1 });
    await expect(manager.forwardSync(projectId, oldPdf, { file: "main.tex", line: 5 }))
      .resolves.toMatchObject({ available: false });
  });

  it("fences navigation already waiting for account state when updates stop", async () => {
    const projectId = randomUUID();
    const pdfUrl = await build(projectId);
    const pendingState = deferred<AccountState>();
    accountState.mockImplementationOnce(() => pendingState.promise);
    const navigating = manager.forwardSync(projectId, pdfUrl, { file: "main.tex", line: 5 });
    manager.stopUpdates();
    pendingState.resolve(state);

    await expect(navigating).resolves.toMatchObject({ available: false });
  });

  it.each(["missing", "missing-file", "malformed", "invalid-gzip"] as const)(
    "keeps a successful PDF usable when SyncTeX is %s",
    async (syncData) => {
      const projectId = randomUUID();
      compile.mockImplementationOnce(request => compilerOutput(request, { syncData }));
      const pdfUrl = await build(projectId);

      expect(await readFile(artifacts.resolve(pdfUrl)!)).toEqual(pdfBytes);
      expect(await readdir(path.join(directory, "builds"))).toEqual([]);
      await expect(manager.forwardSync(projectId, pdfUrl, { file: "main.tex", line: 5 }))
        .resolves.toMatchObject({ available: false });
    }
  );
});
