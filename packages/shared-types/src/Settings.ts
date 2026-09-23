import type { LatexEngine } from "./Project";

export interface AppSettings {
  compilerEngine: LatexEngine;
  latexmkPath: string;
  explorerWidth: number;
  pdfWidth: number;
  problemsHeight: number;
  recentProjects: string[];
}

export type AppSettingKey = keyof AppSettings;

export type UserSettingKey = "compilerEngine" | "explorerWidth" | "pdfWidth" | "problemsHeight";
