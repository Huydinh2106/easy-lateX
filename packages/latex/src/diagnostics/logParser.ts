import type { Diagnostic } from "@easy-latex/shared-types";

export interface ParsedDiagnostics {
  errors: Diagnostic[];
  warnings: Diagnostic[];
}

function normalizeFile(value: string): string {
  return value.trim().replaceAll("\\", "/").replace(/^\.\//, "");
}

function warningLine(message: string): number | undefined {
  const match = /(?:on input line|at lines?)\s+(\d+)/i.exec(message);
  return match?.[1] ? Number(match[1]) : undefined;
}

function diagnosticKey(diagnostic: Diagnostic): string {
  return [diagnostic.severity, diagnostic.file ?? "", diagnostic.line ?? "", diagnostic.column ?? "", diagnostic.message].join("|");
}

export function parseLatexLog(log: string): ParsedDiagnostics {
  const diagnostics: Diagnostic[] = [];
  const seen = new Set<string>();
  const fileStack: string[] = [];
  let pendingError: { message: string; file?: string } | undefined;

  const add = (diagnostic: Diagnostic): void => {
    const clean: Diagnostic = { ...diagnostic, message: diagnostic.message.replace(/\s+/g, " ").trim() };
    if (!clean.message) return;
    const key = diagnosticKey(clean);
    if (seen.has(key) || diagnostics.length >= 200) return;
    seen.add(key);
    diagnostics.push(clean);
  };

  for (const rawLine of log.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    for (const match of line.matchAll(/\((?:\.\/)?([^()\s]+\.(?:tex|sty|cls|bib))/gi)) {
      const file = match[1];
      if (file) fileStack.push(normalizeFile(file));
    }
    const closingCount = (line.match(/\)/g) ?? []).length;

    const located = /^(.+?\.(?:tex|sty|cls|bib)):(\d+)(?::(\d+))?:\s*(.+)$/i.exec(line);
    if (located) {
      const message = located[4] ?? "LaTeX compilation failed";
      add({
        severity: /warning|overfull|underfull/i.test(message) ? "warning" : "error",
        file: normalizeFile(located[1] ?? ""),
        line: Number(located[2]),
        ...(located[3] ? { column: Number(located[3]) } : {}),
        message
      });
      pendingError = undefined;
    } else {
      const bang = /^!\s*(.+)$/.exec(line);
      if (bang?.[1]) {
        const file = fileStack.at(-1);
        pendingError = { message: bang[1], ...(file ? { file } : {}) };
      } else {
        const sourceLine = /^l\.(\d+)\s*(.*)$/.exec(line);
        if (sourceLine?.[1] && pendingError) {
          add({ severity: "error", ...pendingError, line: Number(sourceLine[1]) });
          pendingError = undefined;
        } else if (/^(?:LaTeX|Package\s+\S+|Class\s+\S+|pdfTeX) Warning:/i.test(line)) {
          const file = fileStack.at(-1);
          const atLine = warningLine(line);
          add({ severity: "warning", message: line, ...(file ? { file } : {}), ...(atLine ? { line: atLine } : {}) });
        } else if (/^(?:Over|Under)full \\[hv]box/i.test(line)) {
          const file = fileStack.at(-1);
          const atLine = warningLine(line);
          add({ severity: "warning", message: line, ...(file ? { file } : {}), ...(atLine ? { line: atLine } : {}) });
        }
      }
    }

    for (let count = 0; count < closingCount && fileStack.length > 0; count += 1) fileStack.pop();
  }

  if (pendingError) add({ severity: "error", ...pendingError });
  return {
    errors: diagnostics.filter((diagnostic) => diagnostic.severity === "error"),
    warnings: diagnostics.filter((diagnostic) => diagnostic.severity === "warning")
  };
}
