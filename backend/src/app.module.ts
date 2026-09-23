import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { AuthGuard } from "./auth/auth.guard";
import { AuthModule } from "./auth/auth.module";
import { BuildsModule } from "./builds/builds.module";
import { WorkerModule } from "./builds/worker.module";
import { CollaborationModule } from "./collaboration/collaboration.module";
import { AppConfigModule } from "./common/config.module";
import { DatabaseModule } from "./database/database.module";
import { DocumentModule } from "./document/document.module";
import { FilesModule } from "./files/files.module";
import { HealthModule } from "./health/health.module";
import { OperationsModule } from "./operations/operations.module";
import { ParserModule } from "./parser/parser.module";
import { ProjectsModule } from "./projects/projects.module";
import { RevisionsModule } from "./revisions/revisions.module";
import { StorageModule } from "./storage/storage.module";
import { UsersModule } from "./users/users.module";

@Module({
  imports: [AppConfigModule, DatabaseModule, StorageModule, AuthModule, UsersModule, ProjectsModule, DocumentModule, FilesModule, OperationsModule, RevisionsModule, ParserModule, BuildsModule, WorkerModule, CollaborationModule, HealthModule],
  providers: [{ provide: APP_GUARD, useClass: AuthGuard }]
})
export class AppModule {}
