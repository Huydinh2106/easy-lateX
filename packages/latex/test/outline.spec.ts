import { describe, expect, it } from "vitest";
import { parseOutline } from "../src/parser/outline";

describe("parseOutline", () => {
  it("returns semantic headings and ignores comments", () => {
    const outline = parseOutline("% \\section{Hidden}\n\\section{Introduction}\n\\subsection{Method}", "main.tex");
    expect(outline.map((item) => [item.type, item.title, item.line])).toEqual([
      ["section", "Introduction", 2],
      ["subsection", "Method", 3]
    ]);
  });

  it("supports starred, optional, multiline, and nested heading titles", () => {
    const source = `\\section*[Short]{A long % hidden title comment
  heading with \\textbf{detail}}
Text
\\subsection{Method \\{A\\}}
\\\\section{Not a heading}
% \\section{Commented}`;
    const outline = parseOutline(source, "chapters/method.tex");
    expect(outline.map((item) => [item.type, item.title, item.line, item.column])).toEqual([
      ["section", "A long heading with \\textbf{detail}", 1, 1],
      ["subsection", "Method \\{A\\}", 4, 1]
    ]);
    expect(outline[0]?.sourceRange.end).toBeGreaterThan(outline[0]?.sourceRange.start ?? 0);
  });
});
