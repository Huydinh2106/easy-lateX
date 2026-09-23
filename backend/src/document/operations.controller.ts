import { BadRequestException, Body, Controller, Param, Post } from "@nestjs/common";
import type { AuthUser } from "../common/current-user";
import { CurrentUser } from "../common/current-user";
import { ProjectDocumentService } from "./document.service";
import { SourceOperationDto } from "./operations.dto";

@Controller("projects/:projectId/document")
export class OperationsController {
  constructor(private readonly documents: ProjectDocumentService) {}

  @Post("operations")
  async apply(@Param("projectId") projectId: string, @Body() operation: SourceOperationDto, @CurrentUser() actor: AuthUser) {
    const file = await this.documents.getFile(projectId, operation.path, actor.id);
    if (file.entry.currentVersion !== operation.baseVersion) return this.documents.applyFileUpdate({ projectId, path: operation.path, content: await file.buffer(), expectedVersion: operation.baseVersion, actor });
    const source = (await file.buffer()).toString("utf8");
    const end = operation.end ?? operation.start;
    if (operation.start > end || end > source.length) throw new BadRequestException("Operation range is outside the source");
    const text = operation.operationType === "DELETE_RANGE" ? "" : (operation.text ?? "");
    const updated = `${source.slice(0, operation.start)}${text}${source.slice(end)}`;
    return this.documents.applyFileUpdate({
      projectId,
      path: operation.path,
      content: Buffer.from(updated),
      expectedVersion: operation.baseVersion,
      actor,
      operationType: operation.operationType,
      operationMetadata: { start: operation.start, end, insertedBytes: Buffer.byteLength(text) }
    });
  }
}
