import { Injectable } from "@nestjs/common";
import { EventEmitter, on } from "node:events";

export interface ProjectEvent { projectId: string; type: string; actorId: string; timestamp: string; metadata: Record<string, unknown> }

@Injectable()
export class DocumentEvents {
  private readonly emitter = new EventEmitter();

  publish(event: ProjectEvent): void { this.emitter.emit(event.projectId, event); }

  async *subscribe(projectId: string): AsyncIterable<ProjectEvent> {
    for await (const [event] of on(this.emitter, projectId)) yield event as ProjectEvent;
  }
}
