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
});
