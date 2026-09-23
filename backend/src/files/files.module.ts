import { Module } from "@nestjs/common";
import { DocumentModule } from "../document/document.module";
import { ParserModule } from "../parser/parser.module";
import { FilesController } from "./files.controller";

@Module({ imports: [DocumentModule, ParserModule], controllers: [FilesController] })
export class FilesModule {}
