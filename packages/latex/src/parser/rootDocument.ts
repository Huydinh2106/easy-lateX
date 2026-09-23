export interface LatexSourceFile {
  path: string;
  content: string;
}

function withoutComments(source: string): string {
  return source
    .split(/\r?\n/)
    .map((line) => line.replace(/(^|[^\\])%.*/, "$1"))
    .join("\n");
}

export function isRootDocument(source: string): boolean {
  const clean = withoutComments(source);
  return /\\documentclass(?:\[[^\]]*\])?\s*\{[^}]+\}/.test(clean) && /\\begin\s*\{document\}/.test(clean);
}

export function findRootCandidates(files: LatexSourceFile[]): string[] {
  return files
    .filter((file) => file.path.toLowerCase().endsWith(".tex") && isRootDocument(file.content))
    .map((file) => file.path)
    .sort((left, right) => {
      const leftMain = left.toLowerCase() === "main.tex" ? 0 : 1;
      const rightMain = right.toLowerCase() === "main.tex" ? 0 : 1;
      return leftMain - rightMain || left.split("/").length - right.split("/").length || left.localeCompare(right);
    });
}
