import { describe, expect, it } from "vitest";
import { parseLatexLog } from "../src/diagnostics/logParser";

describe("parseLatexLog", () => {
  it("parses file-line errors and package warnings", () => {
    const result = parseLatexLog(`./chapters/method.tex:18: Undefined control sequence.
Package hyperref Warning: Token not allowed on input line 22.
Overfull \\hbox (4.0pt too wide) in paragraph at lines 30--31`);
    expect(result.errors).toEqual([{ severity: "error", file: "chapters/method.tex", line: 18, message: "Undefined control sequence." }]);
    expect(result.warnings).toHaveLength(2);
    expect(result.warnings[0]?.line).toBe(22);
  });

  it("joins a bang error with its source line", () => {
    const result = parseLatexLog(`(./main.tex
! LaTeX Error: File 'missing.sty' not found.
l.7 \\usepackage{missing}
)`);
    expect(result.errors[0]).toMatchObject({ file: "main.tex", line: 7, message: "LaTeX Error: File 'missing.sty' not found." });
  });
});
