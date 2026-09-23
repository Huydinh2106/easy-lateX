import { Injectable } from "@nestjs/common";

export interface OutlineItem {
  type: "part" | "chapter" | "section" | "subsection" | "subsubsection";
  title: string;
  file: string;
  line: number;
  column: number;
  offset: number;
  sourceRange: { start: number; end: number };
}

@Injectable()
export class LatexParserService {
  parseOutline(source: string, file: string): OutlineItem[] {
    const items: OutlineItem[] = [];
    let offset = 0;
    for (const [lineIndex, original] of source.split(/\r?\n/).entries()) {
      const line = this.removeComment(original);
      const pattern = /\\(part|chapter|section|subsection|subsubsection)\*?\s*\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}/g;
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(line))) {
        items.push({
          type: match[1] as OutlineItem["type"], title: match[2].trim(), file,
          line: lineIndex + 1, column: match.index + 1, offset: offset + match.index,
          sourceRange: { start: offset + match.index, end: offset + match.index + match[0].length }
        });
      }
      offset += original.length + 1;
    }
    return items;
  }

  private removeComment(line: string): string {
    for (let i = 0; i < line.length; i += 1) {
      if (line[i] !== "%") continue;
      let slashes = 0;
      for (let j = i - 1; j >= 0 && line[j] === "\\"; j -= 1) slashes += 1;
      if (slashes % 2 === 0) return line.slice(0, i);
    }
    return line;
  }
}
