import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FileManager } from "../src/main/services/filesystem/FileManager";
import { FileWatcher } from "../src/main/services/filesystem/FileWatcher";
import { SettingsManager } from "../src/main/services/settings/SettingsManager";
import { WorkspaceManager } from "../src/main/services/workspace/WorkspaceManager";

describe("WorkspaceManager file mutations", () => {
  let temporaryDirectory: string;
  let projectDirectory: string;
  let watcher: FileWatcher;
  let workspace: WorkspaceManager;

  beforeEach(async () => {
    temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "easy-latex-workspace-"));
    projectDirectory = path.join(temporaryDirectory, "paper");
    await mkdir(projectDirectory);
    const files = new FileManager();
    watcher = new FileWatcher();
    const settings = new SettingsManager(path.join(temporaryDirectory, "settings.json"), path.join(temporaryDirectory, "projects"));
    await settings.load();
    workspace = new WorkspaceManager(files, watcher, settings);
  });

  afterEach(async () => {
    watcher.stop();
    await rm(temporaryDirectory, { recursive: true, force: true });
  });

  it("keeps root-document metadata valid after moving and deleting files", async () => {
    await writeFile(path.join(projectDirectory, "main.tex"), "\\documentclass{article}\\begin{document}Main\\end{document}");
    await writeFile(path.join(projectDirectory, "fallback.tex"), "\\documentclass{article}\\begin{document}Fallback\\end{document}");
    await mkdir(path.join(projectDirectory, "chapters"));
    await workspace.openPath(projectDirectory);
    await workspace.setRoot("main.tex");

    await workspace.movePath("main.tex", "chapters/paper.tex");
    expect(workspace.current()?.project.rootDocument).toBe("chapters/paper.tex");
    expect(JSON.parse(await readFile(path.join(projectDirectory, ".easy-latex", "project.json"), "utf8"))).toEqual({ rootDocument: "chapters/paper.tex" });

    await workspace.removePath("chapters");
    expect(workspace.current()?.project.rootDocument).toBe("fallback.tex");
    expect(JSON.parse(await readFile(path.join(projectDirectory, ".easy-latex", "project.json"), "utf8"))).toEqual({ rootDocument: "fallback.tex" });
  });
});
