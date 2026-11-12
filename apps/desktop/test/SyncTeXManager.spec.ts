import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FileManager } from "../src/main/services/filesystem/FileManager";
import { SyncTeXManager } from "../src/main/services/synctex/SyncTeXManager";
import type { WorkspaceManager } from "../src/main/services/workspace/WorkspaceManager";

const sampleSyncTeX = `SyncTeX Version:1
Input:1:/workspace/main.tex
Input:2:/workspace/sub/chapter.tex
Output:pdf
Magnification:1000
Unit:1
X Offset:0
Y Offset:0
Content:
!100
{1
[1,1:6578176,6578176:26312704,65781760,0
(1,5:6578176,13156352:13156352,657817,131563
h1,5:6578176,13156352:6578176,657817,131563
)
]
}1
Postamble:
Count:1
!200
Post Scriptum:
`;

describe("SyncTeXManager", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "easy-latex-synctex-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("returns unavailable when no synctex file exists", async () => {
    const manager = new SyncTeXManager();
    const result = await manager.forward({ file: "main.tex", line: 5 });
    expect(result.available).toBe(false);
    expect(result.reason).toContain("SyncTeX file not found");
  });

  it("performs forward and inverse search from a .synctex.gz file", async () => {
    const gzPath = path.join(tempDir, "main.synctex.gz");
    await writeFile(gzPath, gzipSync(Buffer.from(sampleSyncTeX, "utf8")));

    const manager = new SyncTeXManager();
    manager.setLatestSyncTeX(gzPath);

    const forward = await manager.forward({ file: "main.tex", line: 5 });
    expect(forward.available).toBe(true);
    expect(forward.page).toBe(1);
    expect(forward.x).toBe(100);
    expect(forward.y).toBe(190);

    const inverse = await manager.inverse({ page: 1, x: 120, y: 195 });
    expect(inverse.available).toBe(true);
    expect(inverse.file).toBe("main.tex");
    expect(inverse.line).toBe(5);
  });

  it("locates synctex from workspace root structure if latestPath is not set", async () => {
    const buildDir = path.join(tempDir, ".easy-latex", "build");
    await mkdir(buildDir, { recursive: true });
    await writeFile(path.join(buildDir, "doc.synctex.gz"), gzipSync(Buffer.from(sampleSyncTeX, "utf8")));

    const mockWorkspace = {
      current: () => ({ project: { rootDocument: "doc.tex", workspacePath: tempDir } })
    } as unknown as WorkspaceManager;
    const mockFiles = {
      getWorkspaceRoot: () => tempDir
    } as unknown as FileManager;

    const manager = new SyncTeXManager(mockWorkspace, mockFiles);
    const forward = await manager.forward({ file: "main.tex", line: 5 });
    expect(forward.available).toBe(true);
    expect(forward.page).toBe(1);
  });

  it("keeps each PDF mapping after the working SyncTeX file is overwritten and removed", async () => {
    const source = path.join(tempDir, 'main.synctex.gz');
    const manager = new SyncTeXManager();
    await writeFile(source, gzipSync(sampleSyncTeX));
    await manager.registerArtifact('pdf:first', source, tempDir);
    await writeFile(source, gzipSync(sampleSyncTeX.replace('{1\n', '{4\n')));
    await manager.registerArtifact('pdf:second', source, tempDir);
    await rm(source);
    expect((await manager.forward({pdfUrl: 'pdf:first', file: 'main.tex', line: 5})).page).toBe(1);
    expect((await manager.forward({pdfUrl: 'pdf:second', file: 'main.tex', line: 5})).page).toBe(4);
    expect((await manager.inverse({pdfUrl: 'pdf:first', page: 1, x: 120, y: 195})).line).toBe(5);
  });

  it("rejects another workspace's PDF even when both projects contain main.tex", async () => {
    const source = path.join(tempDir, 'main.synctex.gz');
    await writeFile(source, gzipSync(sampleSyncTeX));
    let root = path.join(tempDir, 'project-a');
    await mkdir(root);
    await mkdir(path.join(tempDir, 'project-b'));
    root = await realpath(root);
    const files = {getWorkspaceRoot: () => root} as FileManager;
    const manager = new SyncTeXManager(undefined, files);
    await manager.registerArtifact('pdf:a', source, root);
    expect((await manager.forward({pdfUrl: 'pdf:a', file: 'main.tex', line: 5})).available).toBe(true);
    root = await realpath(path.join(tempDir, 'project-b'));
    const result = await manager.forward({pdfUrl: 'pdf:a', file: 'main.tex', line: 5});
    expect(result.available).toBe(false); expect(result.reason).toContain('another project');
    expect((await manager.inverse({pdfUrl: 'pdf:a', page: 1, x: 100, y: 190})).available).toBe(false);
  });

  it("never substitutes the latest working mapping for an unknown or evicted PDF", async () => {
    const source = path.join(tempDir, 'main.synctex.gz');
    await writeFile(source, gzipSync(sampleSyncTeX));
    const manager = new SyncTeXManager();
    manager.setLatestSyncTeX(source);
    for (let index = 0; index < 9; index++) await manager.registerArtifact(`pdf:${index}`, source, tempDir);
    expect((await manager.forward({pdfUrl: 'pdf:0', file: 'main.tex', line: 5})).available).toBe(false);
    expect((await manager.forward({pdfUrl: 'pdf:8', file: 'main.tex', line: 5})).available).toBe(true);
    expect((await manager.forward({pdfUrl: 'pdf:unknown', file: 'main.tex', line: 5})).available).toBe(false);
  });
});
