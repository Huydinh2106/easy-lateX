import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import type { AuthUser } from "../common/current-user";
import { CurrentUser } from "../common/current-user";
import { ProjectsService } from "./projects.service";
import { CreateProjectDto, UpdateProjectDto } from "./projects.dto";

@ApiTags("projects")
@ApiBearerAuth()
@Controller("projects")
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) { return this.projects.list(user.id); }

  @Post()
  create(@Body() body: CreateProjectDto, @CurrentUser() user: AuthUser) { return this.projects.create(body.name, user); }

  @Get(":projectId")
  get(@Param("projectId") id: string, @CurrentUser() user: AuthUser) { return this.projects.get(id, user.id); }

  @Patch(":projectId")
  update(@Param("projectId") id: string, @Body() body: UpdateProjectDto, @CurrentUser() user: AuthUser) {
    return body.name ? this.projects.update(id, user.id, body.name) : this.projects.get(id, user.id);
  }

  @Delete(":projectId")
  @HttpCode(204)
  remove(@Param("projectId") id: string, @CurrentUser() user: AuthUser) { return this.projects.remove(id, user.id); }
}
