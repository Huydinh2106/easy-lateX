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
});
