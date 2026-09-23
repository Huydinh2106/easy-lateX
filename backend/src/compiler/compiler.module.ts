import { Module } from "@nestjs/common";
import { COMPILER_ADAPTER } from "../common/tokens";
import { LatexmkCompilerAdapter } from "./latexmk-compiler.adapter";

@Module({ providers: [LatexmkCompilerAdapter, { provide: COMPILER_ADAPTER, useExisting: LatexmkCompilerAdapter }], exports: [COMPILER_ADAPTER] })
export class CompilerModule {}
