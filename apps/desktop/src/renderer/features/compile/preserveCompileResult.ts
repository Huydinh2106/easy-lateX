import type { CompileResult } from "@easy-latex/shared-types";

export function preserveLastSuccessfulPdf(
  previous: CompileResult | null,
  next: CompileResult
): CompileResult {
  if (next.success || next.pdfUrl || !previous?.pdfUrl) return next;
  return { ...next, pdfUrl: previous.pdfUrl };
}
