import { Module } from "@nestjs/common";
import { ProjectsModule } from "../projects/projects.module";
import { DocumentEvents } from "./document.events";
import { ProjectDocumentService } from "./document.service";
import { OperationsController } from "./operations.controller";

@Module({ imports: [ProjectsModule], controllers: [OperationsController], providers: [ProjectDocumentService, DocumentEvents], exports: [ProjectDocumentService, DocumentEvents] })
export class DocumentModule {}
