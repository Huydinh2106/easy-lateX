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

  it("keeps a missing-package root cause instead of replacing it with Emergency stop", () => {
    const result = parseLatexLog(`(./main.tex
! LaTeX Error: File \`vietnam.sty' not found.
Type X to quit or <RETURN> to proceed,
or enter new name. (Default extension: sty)
! Emergency stop.
<read *>
l.4 \\usepackage{vietnam}
./main.tex:4: Emergency stop.
./main.tex:4:  ==> Fatal error occurred, no output PDF file produced!
)`);

    expect(result.errors[0]).toMatchObject({
      file: "main.tex",
      line: 4,
      message: "LaTeX Error: File \`vietnam.sty' not found."
    });
    expect(result.errors.some((diagnostic) => /Emergency stop/i.test(diagnostic.message))).toBe(false);
    expect(result.errors.some((diagnostic) => /Fatal error/i.test(diagnostic.message))).toBe(false);
  });
});
