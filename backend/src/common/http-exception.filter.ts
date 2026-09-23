import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";

@Catch()
export class SafeExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<FastifyReply>();
    const request = host.switchToHttp().getRequest<FastifyRequest & { requestId?: string }>();
    const status = exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const payload = exception instanceof HttpException ? exception.getResponse() : "Internal server error";
    const detail = typeof payload === "string" ? payload : ((payload as { message?: string | string[] }).message ?? "Request failed");
    if (status >= 500) request.log.error({ err: exception, requestId: request.requestId }, "request failed");
    void response.status(status).send({ statusCode: status, detail, requestId: request.requestId });
  }
}
