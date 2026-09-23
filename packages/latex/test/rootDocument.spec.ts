import { describe, expect, it } from "vitest";
import { findRootCandidates, isRootDocument } from "../src/parser/rootDocument";

describe("root document detection", () => {
  it("ignores commented markers", () => {
    expect(isRootDocument("% \\documentclass{article}\n\\input{chapter}" )).toBe(false);
  });

  it("prefers main.tex and shallower documents", () => {
    const source = "\\documentclass{article}\n\\begin{document}\nHello\n\\end{document}";
    expect(findRootCandidates([
      { path: "chapters/demo.tex", content: source },
      { path: "paper.tex", content: source },
      { path: "main.tex", content: source }
    ])).toEqual(["main.tex", "paper.tex", "chapters/demo.tex"]);
  });
});
