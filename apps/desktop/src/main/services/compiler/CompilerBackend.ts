import type { Diagnostic, LatexEngine } from "@easy-latex/shared-types";

export interface CompilerRequest {
  executable: string;
  workspacePath: string;
  outputDirectory: string;
  rootDocument: string;
  engine: LatexEngine;
  onOutput(chunk: string): void;
}

export interface CompilerOutput {
  success: boolean;
  cancelled: boolean;
  exitCode: number | null;
  duration: number;
  log: string;
  pdfPath?: string;
  synctexPath?: string;
  errors: Diagnostic[];
  warnings: Diagnostic[];
}

export interface CompilerBackend {
  compile(request: CompilerRequest): Promise<CompilerOutput>;
  cancel(): Promise<boolean>;
}
