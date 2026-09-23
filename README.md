# Easy LaTeX

Easy LaTeX is a local, end-to-end LaTeX editing platform. It has a Next.js workspace, a NestJS API running on Fastify, PostgreSQL/Prisma metadata, private S3-compatible object storage through MinIO, Redis/BullMQ build jobs, a separate compile worker, and a reproducible TeX Live/`latexmk` compiler image.

The default setup uses development authentication and needs no cloud account:

```bash
docker compose up --build
```

Open <http://localhost:3000>, create a project, edit `main.tex`, and press **Compile**. The editor saves an immutable source version to MinIO, the API snapshots that version as a project revision, and the worker runs real `latexmk` in an isolated container. The returned PDF and log are read back from MinIO.

## Architecture and source of truth

```text
AI Agent (primary) ───────┐
Visual Editor (secondary) ├──> Document / Project Layer ──> PostgreSQL metadata
Code Editor (advanced) ───┘                │               + immutable MinIO objects
                                          ├──> Parser / outline
                                          ├──> operations, history, events
                                          └──> immutable ProjectRevision
                                                        │
                                                        v
Browser <── PDF/log API <── MinIO <── compile worker <── BullMQ/Redis
                                           │
                                           └── isolated TeX Live/latexmk container
```

Canonical LaTeX source—`.tex`, `.bib`, `.sty`, `.cls`, figures, and other project assets—is the only source of truth. Monaco state, future visual ASTs, AI conversations, build workspaces, SyncTeX, logs, and PDFs are clients, caches, or derived artifacts. They can be regenerated and never become a second document model.

All writes flow through `ProjectDocumentService`. It owns authorization, normalized paths, immutable `FileVersion` objects, checksums, optimistic concurrency, structured operation metadata, project events, history, revision snapshots, and the compiler boundary. A stale `expectedVersion` returns HTTP 409; it never silently overwrites a collaborator's change.

The parser derives outline nodes for `part`, `chapter`, `section`, `subsection`, and `subsubsection`, ignores comments, and returns source ranges/line/column data. It is the starting boundary for a round-trip-safe visual editor: unsupported LaTeX remains untouched in canonical source.

Collaboration and a future CRDT belong above the same Document Layer and version/operation model. AI, visual, Monaco, Git, and future VS Code integrations must hydrate canonical snapshots and submit versioned operations back through that layer.

## Services

| Service | Responsibility |
| --- | --- |
| `frontend` | Next.js project dashboard, file explorer, Monaco editor, autosave, outline, AI/PDF panel |
| `api` | NestJS + Fastify REST/OpenAPI, auth, authorization, Document Layer, Prisma, build enqueue |
| `compile-worker` | BullMQ consumer, revision hydration, compiler lifecycle, artifact persistence |
| `compiler` | Reproducible one-shot TeX Live image check; the worker creates isolated children from this image |
| `postgres` | Users, projects/members, file tree/version metadata, operations, revisions, builds |
| `redis` | Persistent BullMQ queue, rate-limit and job coordination data |
| `minio` | Private canonical source versions, manifests, PDFs, logs, SyncTeX |
| `minio-init` | Idempotently creates and makes the development bucket private |

API and worker are separate processes from the same TypeScript codebase. The API never receives the Docker socket. In local development only, the worker receives it so it can create tightly constrained compiler containers.

## Requirements and quick start

- Docker Desktop, or Docker Engine with Compose v2
- approximately 5 GB free space for Node, TeX Live, PostgreSQL, and MinIO images/data
- ports 3000, 8000, 5432, 9000, and 9001 available on loopback

Node.js and TeX are not required on the host for the application stack.

```bash
cp .env.example .env       # optional: Compose defaults already support development auth
docker compose up --build
```

The first compiler image build is intentionally large because TeX Live, BibTeX, Biber, and commonly used LaTeX collections are installed in the image rather than on the host.

### Local URLs and credentials

- Frontend: <http://localhost:3000>
- API docs: <http://localhost:8000/docs>
- OpenAPI JSON: <http://localhost:8000/docs-json>
- Liveness: <http://localhost:8000/health/live>
- Readiness: <http://localhost:8000/health/ready>
- MinIO console: <http://localhost:9001>
- MinIO username: `minio`
- MinIO password: `minio-development`
- Development user: `developer@easy-latex.local` (automatic; no login password)

Change all defaults before using the stack outside an isolated development machine. The bucket is private; PDF/source endpoints authorize the project user and stream objects without exposing storage credentials.

## Authentication and project roles

`AUTH_MODE=development` creates/upserts the fixed development user on authenticated API calls. It works only when `NODE_ENV` is not `production`; configuration validation fails startup for development auth in production.

For Firebase:

1. Set `AUTH_MODE=firebase`.
2. Fill the six `NEXT_PUBLIC_FIREBASE_*` web-app values in `.env`.
3. Set `FIREBASE_PROJECT_ID`.
4. Put the service-account file at `.secrets/firebase-service-account.json`, or provide application-default credentials / `FIREBASE_CREDENTIALS_JSON` through a secret manager.
5. Rebuild `frontend` and `api`.

The browser sends a Firebase ID token as `Authorization: Bearer ...`; Firebase Admin verifies revocation and the API upserts the Firebase UID. Tokens, private keys, and storage credentials are redacted/not logged.

Roles are `OWNER`, `EDITOR`, and `VIEWER`. Owners manage the project and members; editors mutate/compile; viewers read source, build status, authorized PDFs, and logs. Every project-scoped endpoint resolves membership server-side and hides inaccessible project IDs to prevent IDOR.

## Storage and persistence

PostgreSQL is authoritative for the file tree and metadata. Each successful content change creates a provider-neutral object key such as:

```text
projects/{projectId}/files/{fileId}/versions/{version}
projects/{projectId}/revisions/{revisionId}/manifest.json
projects/{projectId}/builds/{buildId}/document.pdf
projects/{projectId}/builds/{buildId}/compile.log
projects/{projectId}/builds/{buildId}/document.synctex.gz
```

The database stores keys, never provider URLs or credentials. Development uses MinIO. Cloudflare R2 and AWS S3 use the existing AWS SDK v3 `S3StorageAdapter` with configuration changes only. Google Cloud Storage can be added as `GcsStorageAdapter implements ObjectStorage`; business modules and the frontend do not change.

Compose named volumes `postgres_data`, `redis_data`, and `minio_data` survive container rebuilds, restarts, and ordinary `docker compose down`. There is no per-project workspace volume and no persistent code-server filesystem.

> **Destructive:** `docker compose down -v` permanently removes the local database, source versions, revisions, PDFs, and logs. Use only for an intentional reset.

## Save and compile behavior

The frontend loads the file tree from the API. It supports text/binary-safe open, create file/folder, upload, download, rename/move (including folder descendants), delete confirmation, and root `.tex` selection. Monaco edits `.tex`, `.bib`, `.sty`, `.cls`, Markdown, and text.

Autosave is debounced about 800 ms and reports Unsaved, Saving, Saved, Save failed, or Version conflict. Network failures retain the editor buffer and retry only twice with backoff. File switches and Compile flush pending content; Compile is refused if the save/conflict is unresolved.

Each build pins an immutable `ProjectRevision`; the worker never compiles live editor state. The compiler invocation is argv-based:

```text
latexmk -pdf -interaction=nonstopmode -file-line-error -halt-on-error -synctex=1 -no-shell-escape main.tex
```

The child compiler is non-root, network-disabled, read-only outside its single temporary workspace, capability-free, and protected by CPU, memory, PID, source/log/artifact size, and hard timeout limits. It never receives the Docker socket. Workspaces and child containers are removed after success, syntax failure, infrastructure failure, or timeout. Build infrastructure retries are bounded; LaTeX syntax failures are terminal and do not retry.

The right panel has only AI Chat and PDF Preview. Compile switches to PDF Preview immediately and polls the real build with bounded network backoff. Success shows the exact build's PDF blob; failure shows the stored log and parsed file/line errors that navigate Monaco. The local chat placeholder preserves state while switching tabs; no fake AI backend or second document model is introduced.

## Database and Prisma

The additive migration is `backend/prisma/migrations/20260913000000_document_platform/migration.sql`. It upgrades the earlier FastAPI/Alembic metadata schema without dropping existing projects or resetting data. API startup runs `prisma migrate deploy`, never `db push` and never an automatic reset.

```bash
make migrate              # deploy existing migrations through Compose
make migration            # interactive prisma migrate dev
make seed                 # upsert the development identity

cd backend
npm run prisma:validate
npm run prisma:generate
npm run prisma:migrate -- --name your_change
```

If Prisma reports `P3005` while adopting a database previously managed only by Alembic, `backend/start-api.sh` applies the idempotent compatibility SQL and records that baseline migration. It does not drop tables or data.

## Development and verification commands

```bash
make dev                  # docker compose up --build (foreground)
make lint                 # backend ESLint
make typecheck            # backend + frontend strict TypeScript checks
make test                 # backend Jest + frontend Vitest
make frontend-test
make e2e                  # full real-compiler smoke, including restart persistence
make logs
make worker-logs
make stop                 # preserves named volumes
make reset-data CONFIRM=yes   # intentional destructive reset
```

Direct equivalents:

```bash
cd backend && npm ci && npm run lint && npm run typecheck && npm test && npm run build
cd frontend && npm ci && npm run typecheck && npm test && npm run build
docker compose build
docker compose up -d --wait
node scripts/e2e-smoke.mjs
```

The E2E smoke uses development auth and a real compiler. It creates/reads/saves `main.tex`, verifies checksum dedup and HTTP 409 conflicts, exercises folder CRUD/move, compiles a successful PDF and checks `%PDF`, reads revisions/history, restarts API/worker and rechecks source/PDF persistence, introduces a genuine LaTeX error and verifies the stored failure log, fixes the source, and compiles successfully again. Set `E2E_KEEP_PROJECT=1` to retain its evidence project; otherwise it cleans up through the authorized API.

CI runs dependency installation, lint, strict typecheck, Prisma validation, backend/frontend tests and builds, all Docker builds, and the real Compose smoke without cloud credentials.

## Docker socket notes

Launching an isolated sibling compiler through Docker requires local worker access to `/var/run/docker.sock`; this is inherently root-equivalent access to the Docker daemon. The socket is never exposed to the API, frontend, or compiler. Compose keeps the worker process at UID 1000 and adds only the socket's group. Docker Desktop commonly uses group `0`; Linux/CI can set:

```bash
export DOCKER_SOCKET_GID=$(stat -c '%g' /var/run/docker.sock)
docker compose up --build
```

On macOS, `stat -f '%g' /var/run/docker.sock` may be used if a native (non-Desktop-proxied) socket has a different group. If the worker logs `EACCES /var/run/docker.sock`, verify the mounted socket, its group, and `DOCKER_SOCKET_GID`. Never mount the socket into untrusted application or compiler containers.

## Troubleshooting

- **API not ready:** run `docker compose logs api postgres minio redis`; readiness checks all three dependencies.
- **Worker build remains RUNNING:** run `docker compose logs compile-worker` and inspect Docker socket permissions.
- **Compiler image missing:** run `docker compose build compiler compile-worker` and ensure `COMPILER_IMAGE` matches both services.
- **MinIO login fails:** use the `S3_ACCESS_KEY`/`S3_SECRET_KEY` values from your current `.env`, not necessarily the defaults above.
- **Changed `NEXT_PUBLIC_*` value has no effect:** rebuild `frontend`; these values are embedded at build time.
- **Port already in use:** override `FRONTEND_PORT`, `BACKEND_PORT`, `POSTGRES_PORT`, `MINIO_PORT`, or `MINIO_CONSOLE_PORT` in `.env`.
- **Old local containers remain:** run `docker compose up --remove-orphans`; do not add `-v` unless local data should be erased.
- **Inspect persisted objects:** open the MinIO console or use the `mc` image with matching credentials.

## Repository layout

```text
backend/
  prisma/                 schema, additive migration, development seed
  src/
    auth/ database/ storage/ projects/ document/ files/ operations/
    revisions/ parser/ builds/ compiler/ collaboration/ health/ common/
  test/                   Jest unit/service/worker tests
compiler/                 reproducible non-root TeX Live image
frontend/                 Next.js App Router, Monaco workspace, Vitest tests
scripts/e2e-smoke.mjs     non-mocked Compose/LaTeX persistence smoke
docker-compose.yml
Makefile
```

The retired Python/FastAPI and permanent code-server workspace implementation has been removed after parity and E2E verification. NestJS/Fastify plus the Document Layer is the single backend source of truth.
