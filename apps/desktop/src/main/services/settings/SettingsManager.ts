import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AppSettingKey, AppSettings } from "@easy-latex/shared-types";

export class SettingsManager {
  private readonly defaults: AppSettings;
  private settings: AppSettings;
  private loaded = false;

  constructor(
    private readonly filePath: string,
    defaultProjectsDirectory = path.join(os.homedir(), "Documents", "Easy LaTeX")
  ) {
    this.defaults = {
      compilerEngine: "pdflatex",
      projectsDirectory: path.resolve(defaultProjectsDirectory),
      explorerWidth: 232,
      pdfWidth: 520,
      problemsHeight: 220,
      recentProjects: []
    };
    this.settings = structuredClone(this.defaults);
  }

  async load(): Promise<void> {
    if (this.loaded) return;
    try {
      const parsed = JSON.parse(await readFile(this.filePath, "utf8")) as Partial<AppSettings>;
      this.settings = this.sanitize({ ...this.defaults, ...parsed });
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT" && !(error instanceof SyntaxError)) throw error;
    }
    this.loaded = true;
  }

  async all(): Promise<AppSettings> {
    await this.load();
    return structuredClone(this.settings);
  }

  async get<K extends AppSettingKey>(key: K): Promise<AppSettings[K]> {
    await this.load();
    return structuredClone(this.settings[key]);
  }

  async set<K extends AppSettingKey>(key: K, value: AppSettings[K]): Promise<AppSettings> {
    await this.load();
    this.settings = this.sanitize({ ...this.settings, [key]: value });
    await this.persist();
    return this.all();
  }

  async addRecentProject(workspacePath: string): Promise<void> {
    await this.load();
    const recentProjects = [workspacePath, ...this.settings.recentProjects.filter((candidate) => candidate !== workspacePath)].slice(0, 12);
    this.settings = { ...this.settings, recentProjects };
    await this.persist();
  }

  async removeRecentProject(workspacePath: string): Promise<void> {
    await this.load();
    this.settings = {
      ...this.settings,
      recentProjects: this.settings.recentProjects.filter((candidate) => candidate !== workspacePath)
    };
    await this.persist();
  }

  private sanitize(input: AppSettings): AppSettings {
    const compilerEngine = ["pdflatex", "xelatex", "lualatex"].includes(input.compilerEngine) ? input.compilerEngine : "pdflatex";
    return {
      compilerEngine,
      projectsDirectory: typeof input.projectsDirectory === "string" && path.isAbsolute(input.projectsDirectory)
        ? path.resolve(input.projectsDirectory)
        : this.defaults.projectsDirectory,
      explorerWidth: this.boundedNumber(input.explorerWidth, 180, 420, this.defaults.explorerWidth),
      pdfWidth: this.boundedNumber(input.pdfWidth, 360, 900, this.defaults.pdfWidth),
      problemsHeight: this.boundedNumber(input.problemsHeight, 120, 480, this.defaults.problemsHeight),
      recentProjects: Array.isArray(input.recentProjects)
        ? input.recentProjects.filter((value): value is string => typeof value === "string" && path.isAbsolute(value)).slice(0, 12)
        : []
    };
  }

  private boundedNumber(value: number, minimum: number, maximum: number, fallback: number): number {
    return Number.isFinite(value) ? Math.min(maximum, Math.max(minimum, Math.round(value))) : fallback;
  }

  private async persist(): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.tmp`;
    await writeFile(temporary, `${JSON.stringify(this.settings, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await rename(temporary, this.filePath);
  }
}
