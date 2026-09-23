import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, NestFastifyApplication } from "@nestjs/platform-fastify";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import { AppModule } from "./app.module";
import type { AppConfig } from "./common/config";
import { APP_CONFIG } from "./common/tokens";
import { SafeExceptionFilter } from "./common/http-exception.filter";

async function bootstrap(): Promise<void> {
  const adapter = new FastifyAdapter({ logger: { level: process.env.LOG_LEVEL ?? "info", redact: ["req.headers.authorization"] }, bodyLimit: 12 * 1024 * 1024 });
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, adapter);
  const config = app.get<AppConfig>(APP_CONFIG);
  const server = adapter.getInstance();
  await server.register(cors, {
    origin: config.corsOrigins,
    credentials: true,
    methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]
  });
  await server.register(multipart, { limits: { fileSize: 10 * 1024 * 1024, files: 1 } });
  await server.register(rateLimit, { max: 300, timeWindow: "1 minute" });
  server.addHook("onRequest", (request, reply, done) => {
    const requestId = String(request.headers["x-request-id"] ?? randomUUID());
    request.headers["x-request-id"] = requestId;
    (request as typeof request & { requestId: string }).requestId = requestId;
    reply.header("x-request-id", requestId);
    done();
  });
  server.addHook("onResponse", (request, reply, done) => {
    const authenticated = request as typeof request & { user?: { id?: string }; requestId?: string };
    const projectId = request.url.match(/\/projects\/([^/?]+)/)?.[1];
    const buildId = request.url.match(/\/builds\/([^/?]+)/)?.[1];
    request.log.info({
      requestId: authenticated.requestId ?? request.id,
      userId: authenticated.user?.id,
      projectId,
      buildId,
      durationMs: reply.elapsedTime,
      statusCode: reply.statusCode
    }, "request audit");
    done();
  });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.useGlobalFilters(new SafeExceptionFilter());
  const swagger = new DocumentBuilder().setTitle("Easy LaTeX API").setVersion("1.0").addBearerAuth().build();
  SwaggerModule.setup("docs", app, SwaggerModule.createDocument(app, swagger));
  app.enableShutdownHooks();
  await app.listen(config.port, "0.0.0.0");
}

void bootstrap();
