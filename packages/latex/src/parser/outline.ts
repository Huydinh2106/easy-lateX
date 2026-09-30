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

function maskComments(source: string): string {
  const characters = source.split("");
  let escaped = false;
  let comment = false;
  for (let index = 0; index < characters.length; index += 1) {
    const character = characters[index] ?? "";
    if (character === "\n") {
      comment = false;
      escaped = false;
      continue;
    }
    if (comment) {
      characters[index] = character === "\r" ? "\r" : " ";
      continue;
    }
    if (character === "%" && !escaped) {
      characters[index] = " ";
      comment = true;
      continue;
    }
    if (character === "\\") escaped = !escaped;
    else escaped = false;
  }
  return characters.join("");
}

function isEscapedCommand(source: string, commandOffset: number): boolean {
  let slashes = 0;
  for (let index = commandOffset - 1; index >= 0 && source[index] === "\\"; index -= 1) slashes += 1;
  return slashes % 2 === 1;
}

function isEscapedBrace(source: string, braceOffset: number): boolean {
  let slashes = 0;
  for (let index = braceOffset - 1; index >= 0 && source[index] === "\\"; index -= 1) slashes += 1;
  return slashes % 2 === 1;
}

function lineStartsFor(source: string): number[] {
  const starts = [0];
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === "\n") starts.push(index + 1);
  }
  return starts;
}

function locationAt(lineStarts: number[], offset: number): { line: number; column: number } {
  let low = 0;
  let high = lineStarts.length - 1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const start = lineStarts[middle] ?? 0;
    if (start <= offset) low = middle + 1;
    else high = middle - 1;
  }
  const lineIndex = Math.max(0, high);
  return { line: lineIndex + 1, column: offset - (lineStarts[lineIndex] ?? 0) + 1 };
}

export function parseOutline(source: string, file: string): OutlineItem[] {
  const items: OutlineItem[] = [];
  const masked = maskComments(source);
  const lineStarts = lineStartsFor(source);
  const pattern = /\\(part|chapter|section|subsection|subsubsection)\*?\s*(?:\[[^\]\n]*\]\s*)?\{/g;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(masked))) {
    if (isEscapedCommand(masked, match.index)) continue;
    const openingBrace = pattern.lastIndex - 1;
    let depth = 1;
    let cursor = openingBrace + 1;
    for (; cursor < masked.length && depth > 0; cursor += 1) {
      const character = masked[cursor];
      if ((character === "{" || character === "}") && isEscapedBrace(masked, cursor)) continue;
      if (character === "{") depth += 1;
      if (character === "}") depth -= 1;
    }
    if (depth !== 0) continue;

    const title = masked.slice(openingBrace + 1, cursor - 1).replace(/\s+/g, " ").trim();
    const location = locationAt(lineStarts, match.index);
    items.push({
      type: match[1] as OutlineKind,
      title,
      file,
      line: location.line,
      column: location.column,
      offset: match.index,
      sourceRange: { start: match.index, end: cursor }
    });
    pattern.lastIndex = cursor;
  }
  return items;
}
