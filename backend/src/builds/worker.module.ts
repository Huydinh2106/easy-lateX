import { Module } from "@nestjs/common";
import { CompilerModule } from "../compiler/compiler.module";
import { BuildProcessorService } from "./build-processor.service";

@Module({ imports: [CompilerModule], providers: [BuildProcessorService], exports: [BuildProcessorService] })
export class WorkerModule {}
