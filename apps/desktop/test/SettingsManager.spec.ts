import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SettingsManager } from "../src/main/services/settings/SettingsManager";

describe("SettingsManager recent projects", () => {
  let directory: string;
  let settingsPath: string;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), "easy-latex-settings-"));
    settingsPath = path.join(directory, "settings.json");
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it("deduplicates, orders, persists, and forgets recent project paths", async () => {
    const first = path.join(directory, "paper-one");
    const second = path.join(directory, "paper-two");
    const settings = new SettingsManager(settingsPath);

    await settings.addRecentProject(first);
    await settings.addRecentProject(second);
    await settings.addRecentProject(first);
    expect(await settings.get("recentProjects")).toEqual([first, second]);

    await settings.removeRecentProject(first);
    const reloaded = new SettingsManager(settingsPath);
    expect(await reloaded.get("recentProjects")).toEqual([second]);
  });

  it("uses and persists the configurable default projects directory", async () => {
    const initial = path.join(directory, "Easy LaTeX");
    const changed = path.join(directory, "Research");
    const settings = new SettingsManager(settingsPath, initial);
    expect(await settings.get("projectsDirectory")).toBe(initial);
    await settings.set("projectsDirectory", changed);

    const reloaded = new SettingsManager(settingsPath, initial);
    expect(await reloaded.get("projectsDirectory")).toBe(changed);
  });
});
