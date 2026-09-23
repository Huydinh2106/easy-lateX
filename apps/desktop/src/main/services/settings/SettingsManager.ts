import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AppSettingKey, AppSettings } from "@easy-latex/shared-types";

const DEFAULT_SETTINGS: AppSettings = {
  compilerEngine: "pdflatex",
  latexmkPath: process.env.EASY_LATEX_LATEXMK_PATH?.trim() || "latexmk",
  explorerWidth: 232,
  pdfWidth: 520,
  problemsHeight: 220,
  recentProjects: []
};

export class SettingsManager {
  private settings: AppSettings = structuredClone(DEFAULT_SETTINGS);
  private loaded = false;

  constructor(private readonly filePath: string) {}

  async load(): Promise<void> {
    if (this.loaded) return;
    try {
      const parsed = JSON.parse(await readFile(this.filePath, "utf8")) as Partial<AppSettings>;
      this.settings = this.sanitize({ ...DEFAULT_SETTINGS, ...parsed });
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
      // Executable selection belongs to the trusted main-process launch environment,
      // never to persisted renderer-controlled state.
      latexmkPath: DEFAULT_SETTINGS.latexmkPath,
      explorerWidth: this.boundedNumber(input.explorerWidth, 180, 420, DEFAULT_SETTINGS.explorerWidth),
      pdfWidth: this.boundedNumber(input.pdfWidth, 360, 900, DEFAULT_SETTINGS.pdfWidth),
      problemsHeight: this.boundedNumber(input.problemsHeight, 120, 480, DEFAULT_SETTINGS.problemsHeight),
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
