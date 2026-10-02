import { describe, expect, it } from "vitest";
import type { CompileResult } from "@easy-latex/shared-types";
import { preserveLastSuccessfulPdf } from "../src/renderer/features/compile/preserveCompileResult";

const successful: CompileResult = {
  success: true,
  cancelled: false,
  pdfUrl: "easy-latex://pdf/previous",
  errors: [],
  warnings: [],
  duration: 100,
  engine: "pdflatex",
  rootDocument: "main.tex",
  log: ""
};

describe("preserveLastSuccessfulPdf", () => {
  it.each([false, true])("keeps the previous PDF when a later build fails (cancelled=%s)", (cancelled) => {
    const failed: CompileResult = {
      success: false,
      cancelled,
      errors: [{ severity: "error", message: "Compilation failed" }],
      warnings: [],
      duration: 100,
      engine: "pdflatex",
      rootDocument: "main.tex",
      log: ""
    };

    expect(preserveLastSuccessfulPdf(successful, failed)).toEqual({
      ...failed,
      pdfUrl: successful.pdfUrl
    });
  });

  it("uses a newly successful PDF", () => {
    const next = { ...successful, pdfUrl: "easy-latex://pdf/next" };
    expect(preserveLastSuccessfulPdf(successful, next)).toBe(next);
  });
});
