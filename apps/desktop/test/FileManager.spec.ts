import { mkdtemp, mkdir, rm, symlink, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FileConflictError, FileManager } from "../src/main/services/filesystem/FileManager";

describe("FileManager", () => {
  let workspace: string;
  let files: FileManager;

  beforeEach(async () => {
    workspace = await mkdtemp(path.join(os.tmpdir(), "easy-latex-files-"));
    files = new FileManager();
    await files.setWorkspace(workspace);
  });

  afterEach(async () => {
    await rm(workspace, { recursive: true, force: true });
  });

  it("lists project source while hiding internal and generated files", async () => {
    await mkdir(path.join(workspace, "chapters"));
    await mkdir(path.join(workspace, ".git"));
    await mkdir(path.join(workspace, ".easy-latex", "build"), { recursive: true });
    await writeFile(path.join(workspace, "main.tex"), "\\documentclass{article}");
    await writeFile(path.join(workspace, "main.aux"), "generated");
    await writeFile(path.join(workspace, "chapters", "method.tex"), "Method");
    const tree = await files.list();
    expect(tree.map((entry) => entry.path)).toEqual(["chapters", "chapters/method.tex", "main.tex"]);
  });

  it("rejects traversal and symlink escapes", async () => {
    const outside = await mkdtemp(path.join(os.tmpdir(), "easy-latex-outside-"));
    try {
      await writeFile(path.join(outside, "secret.tex"), "secret");
      await symlink(path.join(outside, "secret.tex"), path.join(workspace, "linked.tex"));
      await expect(files.read("../secret.tex")).rejects.toThrow(/escapes|relative/i);
      await expect(files.read("linked.tex")).rejects.toThrow(/regular file/i);
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });

  it("uses modification time to prevent silent overwrites", async () => {
    const target = path.join(workspace, "main.tex");
    await writeFile(target, "first");
    const opened = await files.read("main.tex");
    await writeFile(target, "external");
    const future = new Date(Date.now() + 2000);
    await utimes(target, future, future);
    await expect(files.write({ path: "main.tex", content: "mine", expectedModifiedAt: opened.modifiedAt })).rejects.toBeInstanceOf(FileConflictError);
  });

  it("creates files and folders without overwriting project or internal content", async () => {
    await files.createDirectory("chapters");
    const created = await files.createFile("chapters/introduction.tex");
    expect(created.path).toBe("chapters/introduction.tex");
    expect((await files.read(created.path)).content).toBe("");
    await expect(files.createFile(created.path)).rejects.toThrow(/already exists/i);
    await expect(files.createDirectory(".easy-latex/private")).rejects.toThrow(/internal folder/i);
  });

  it("moves, renames, and deletes project files and folders safely", async () => {
    await files.createDirectory("chapters");
    await files.createDirectory("archive");
    await files.createFile("chapters/draft.tex");

    expect((await files.movePath("chapters/draft.tex", "archive/introduction.tex")).paths).toEqual(["archive/introduction.tex"]);
    expect((await files.read("archive/introduction.tex")).content).toBe("");
    await expect(files.read("chapters/draft.tex")).rejects.toThrow();
    await expect(files.movePath("archive", "archive/nested/archive")).rejects.toThrow(/into itself/i);
    await expect(files.movePath("archive/introduction.tex", "chapters")).rejects.toThrow(/already exists|folder/i);

    expect((await files.removePath("archive")).paths).toEqual(["archive"]);
    expect((await files.list()).map((entry) => entry.path)).toEqual(["chapters"]);
    await expect(files.removePath(".easy-latex/build")).rejects.toThrow(/internal folder/i);
  });

  it("imports regular files and folder trees while rejecting symbolic links", async () => {
    const source = await mkdtemp(path.join(os.tmpdir(), "easy-latex-import-"));
    try {
      await writeFile(path.join(source, "references.bib"), "@book{sample, title={Sample}}");
      const figures = path.join(source, "figures");
      await mkdir(figures);
      await writeFile(path.join(figures, "diagram.svg"), "<svg></svg>");
      await files.createDirectory("assets");

      expect((await files.importFiles([path.join(source, "references.bib")], "")).paths).toEqual(["references.bib"]);
      expect((await files.importFolders([figures], "assets")).paths).toEqual(["assets/figures"]);
      expect((await files.read("references.bib")).content).toContain("Sample");
      expect((await files.list()).map((entry) => entry.path)).toContain("assets/figures/diagram.svg");
      await expect(files.importFiles([path.join(source, "references.bib")], "")).rejects.toThrow(/already exists/i);

      await writeFile(path.join(source, "notes.txt"), "notes");
      const tables = path.join(source, "tables");
      await mkdir(tables);
      await writeFile(path.join(tables, "results.csv"), "value\n1");
      expect((await files.importDroppedItems([path.join(source, "notes.txt"), tables], "assets")).paths).toEqual(["assets/notes.txt", "assets/tables"]);

      const unsafe = path.join(source, "unsafe");
      await mkdir(unsafe);
      await symlink(path.join(source, "references.bib"), path.join(unsafe, "linked.bib"));
      await expect(files.importFolders([unsafe], "")).rejects.toThrow(/symbolic links/i);
    } finally {
      await rm(source, { recursive: true, force: true });
    }
  });
});
