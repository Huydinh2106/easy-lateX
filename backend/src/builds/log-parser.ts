export interface CompileError { file: string | null; line: number | null; message: string }

export function parseCompileErrors(log: string): CompileError[] {
  const errors: CompileError[] = [];
  for (const line of log.split(/\r?\n/)) {
    const located = /^(.+?\.tex):(\d+):\s*(?:LaTeX Error:\s*)?(.+)$/.exec(line.trim());
    if (located) {
      errors.push({ file: located[1].replace(/^\.\//, ""), line: Number(located[2]), message: located[3].trim() });
      continue;
    }
    const bang = /^!\s*(.+)$/.exec(line.trim());
    if (bang) errors.push({ file: null, line: null, message: bang[1].trim() });
  }
  return errors.slice(0, 50);
}
