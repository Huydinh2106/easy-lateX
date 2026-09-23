import { Module } from "@nestjs/common";
import { MembersController } from "./members.controller";
import { ProjectAccessService } from "./project-access.service";
import { ProjectsController } from "./projects.controller";
import { ProjectsService } from "./projects.service";

@Module({
  controllers: [ProjectsController, MembersController],
  providers: [ProjectsService, ProjectAccessService],
  exports: [ProjectsService, ProjectAccessService]
})
export class ProjectsModule {}
