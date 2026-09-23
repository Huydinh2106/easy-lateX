import type { Diagnostic } from "./Diagnostic";
import type { LatexEngine } from "./Project";

export type CompilePhase = "idle" | "starting" | "running" | "cancelling" | "success" | "failed" | "cancelled";

export interface CompileOptions {
  engine?: LatexEngine;
  rootDocument?: string;
}

export interface CompileResult {
  success: boolean;
  cancelled: boolean;
  pdfUrl?: string;
  errors: Diagnostic[];
  warnings: Diagnostic[];
  duration: number;
  engine: LatexEngine;
  rootDocument: string;
  log: string;
}

export interface CompileEvent {
  phase: CompilePhase;
  message: string;
  elapsed?: number;
}
