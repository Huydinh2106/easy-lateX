export interface AppConfig {
  nodeEnv: string;
  port: number;
  authMode: "development" | "firebase";
  redisUrl: string;
  corsOrigins: string[];
  s3: {
    endpoint?: string;
    bucket: string;
    accessKeyId: string;
    secretAccessKey: string;
    region: string;
    forcePathStyle: boolean;
  };
  compiler: {
    image: string;
    workspaceBase: string;
    timeoutMs: number;
    maxSourceBytes: number;
    maxLogBytes: number;
    maxArtifactBytes: number;
  };
}

function positiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value ?? fallback);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`Invalid positive integer: ${value}`);
  return parsed;
}

export function readConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const nodeEnv = env.NODE_ENV ?? "development";
  const authMode = (env.AUTH_MODE ?? "development") as AppConfig["authMode"];
  if (!(["development", "firebase"] as string[]).includes(authMode)) {
    throw new Error("AUTH_MODE must be development or firebase");
  }
  if (nodeEnv === "production" && authMode === "development") {
    throw new Error("AUTH_MODE=development is forbidden when NODE_ENV=production");
  }
  const accessKeyId = env.S3_ACCESS_KEY ?? "minio";
  const secretAccessKey = env.S3_SECRET_KEY ?? "minio-development";
  if (!env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  return {
    nodeEnv,
    port: positiveInt(env.PORT, 8000),
    authMode,
    redisUrl: env.REDIS_URL ?? "redis://redis:6379",
    corsOrigins: (env.CORS_ORIGINS ?? "http://localhost:3000").split(",").map((v) => v.trim()).filter(Boolean),
    s3: {
      endpoint: env.S3_ENDPOINT,
      bucket: env.S3_BUCKET ?? "easy-latex",
      accessKeyId,
      secretAccessKey,
      region: env.S3_REGION ?? "auto",
      forcePathStyle: (env.S3_FORCE_PATH_STYLE ?? "true") === "true"
    },
    compiler: {
      image: env.COMPILER_IMAGE ?? "easy-latex-compiler:local",
      workspaceBase: env.COMPILE_WORKSPACE_BASE ?? "/tmp/easy-latex-compile",
      timeoutMs: positiveInt(env.COMPILE_TIMEOUT_MS, 120000),
      maxSourceBytes: positiveInt(env.MAX_PROJECT_SOURCE_BYTES, 50 * 1024 * 1024),
      maxLogBytes: positiveInt(env.MAX_COMPILE_LOG_BYTES, 5 * 1024 * 1024),
      maxArtifactBytes: positiveInt(env.MAX_ARTIFACT_BYTES, 50 * 1024 * 1024)
    }
  };
}
