export type OutlineKind = "part" | "chapter" | "section" | "subsection" | "subsubsection";

export interface OutlineItem {
  type: OutlineKind;
  title: string;
  file: string;
  line: number;
  column: number;
  offset: number;
  sourceRange: { start: number; end: number };
}

function removeComment(line: string): string {
  for (let index = 0; index < line.length; index += 1) {
    if (line[index] !== "%") continue;
    let slashes = 0;
    for (let cursor = index - 1; cursor >= 0 && line[cursor] === "\\"; cursor -= 1) slashes += 1;
    if (slashes % 2 === 0) return line.slice(0, index);
  }
  return line;
}

export function parseOutline(source: string, file: string): OutlineItem[] {
  const items: OutlineItem[] = [];
  let offset = 0;
  const lines = source.split(/\r?\n/);
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const original = lines[lineIndex] ?? "";
    const line = removeComment(original);
    const pattern = /\\(part|chapter|section|subsection|subsubsection)\*?\s*\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}/g;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(line))) {
      const type = match[1] as OutlineKind;
      const title = match[2]?.trim() ?? "";
      items.push({
        type,
        title,
        file,
        line: lineIndex + 1,
        column: match.index + 1,
        offset: offset + match.index,
        sourceRange: { start: offset + match.index, end: offset + match.index + match[0].length }
      });
    }
    offset += original.length + 1;
  }
  return items;
}
