import { Module } from "@nestjs/common";
import { DocumentModule } from "../document/document.module";
import { ProjectsModule } from "../projects/projects.module";
import { BuildsController } from "./builds.controller";
import { BuildsService } from "./builds.service";

@Module({ imports: [DocumentModule, ProjectsModule], controllers: [BuildsController], providers: [BuildsService], exports: [BuildsService] })
export class BuildsModule {}
