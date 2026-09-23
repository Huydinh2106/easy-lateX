import { Module } from "@nestjs/common";
import { LatexParserService } from "./latex-parser.service";

@Module({ providers: [LatexParserService], exports: [LatexParserService] })
export class ParserModule {}
