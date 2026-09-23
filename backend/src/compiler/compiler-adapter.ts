export interface CompileInput { workspacePath: string; rootFile: string; buildId: string }
export interface CompileResult { success: boolean; timedOut: boolean; exitCode: number | null; durationMs: number; log: Buffer; pdfPath?: string; synctexPath?: string }
export interface CompilerAdapter { compile(input: CompileInput): Promise<CompileResult> }
