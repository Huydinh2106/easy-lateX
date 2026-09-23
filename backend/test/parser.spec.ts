import { LatexParserService } from "../src/parser/latex-parser.service";

describe("LaTeX outline parser", () => {
  const parser = new LatexParserService();

  it("returns source locations for supported headings", () => {
    const items = parser.parseOutline("\\chapter{Start}\ntext\n  \\section{One}\n\\subsection*{Two}", "main.tex");
    expect(items.map(({ type, title, line, column }) => ({ type, title, line, column }))).toEqual([
      { type: "chapter", title: "Start", line: 1, column: 1 },
      { type: "section", title: "One", line: 3, column: 3 },
      { type: "subsection", title: "Two", line: 4, column: 1 }
    ]);
    expect(items[1].sourceRange.end).toBeGreaterThan(items[1].sourceRange.start);
  });

  it("ignores commented headings and preserves escaped percent", () => {
    const items = parser.parseOutline("% \\section{Hidden}\nText \\% ok \\section{Shown}", "main.tex");
    expect(items).toHaveLength(1);
    expect(items[0].title).toBe("Shown");
  });
});
