export type LatexEngine = "pdflatex" | "xelatex" | "lualatex";

export interface Project {
  name: string;
  workspacePath: string;
  rootDocument?: string;
}

export interface OpenProjectResult {
  project: Project;
  rootCandidates: string[];
}
