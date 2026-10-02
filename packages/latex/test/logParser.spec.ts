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

  it("retains the root cause from the real file-line-error missing-package log", () => {
    const result = parseLatexLog(`(./thesis.tex
! LaTeX Error: File \`vietnam.sty' not found.
Type X to quit or <RETURN> to proceed,
or enter new name. (Default extension: sty)
Enter file name:
./thesis.tex:3: Emergency stop.
<read *>
l.3 \\usepackage
               [utf8]{inputenc}
./thesis.tex:3:  ==> Fatal error occurred, no output PDF file produced!`);

    expect(result.errors).toEqual([{
      severity: "error",
      file: "thesis.tex",
      line: 3,
      message: "LaTeX Error: File `vietnam.sty' not found."
    }]);
  });

  it("reports BibTeX style and citation errors from the bibliography log", () => {
    const result = parseLatexLog(`This is BibTeX, Version 0.99e (TeX Live 2026)
Illegal, another \\bibstyle command---line 73 of file thesis.aux
 : \\bibstyle
 :          {plain}
I found no \\citation commands---while reading file thesis.aux`);

    expect(result.errors).toEqual([
      { severity: "error", file: "thesis.aux", line: 73, message: "BibTeX: Illegal, another \\bibstyle command" },
      { severity: "error", file: "thesis.aux", message: "BibTeX: I found no \\citation commands" }
    ]);
  });

  it("reports missing BibTeX files and Biber errors", () => {
    const result = parseLatexLog(`I couldn't open database file missing.bib
[123] Biber.pm:100> ERROR - Cannot find 'references.bib'!`);
    expect(result.errors.map((diagnostic) => diagnostic.message)).toEqual([
      "BibTeX: I couldn't open database file missing.bib",
      "Biber: Cannot find 'references.bib'!"
    ]);
  });

  it("keeps Emergency stop when no underlying error is available", () => {
    expect(parseLatexLog("./main.tex:5: Emergency stop.").errors).toEqual([
      { severity: "error", file: "main.tex", line: 5, message: "Emergency stop." }
    ]);
  });
});
