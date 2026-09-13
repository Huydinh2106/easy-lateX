# Easy LaTeX platform MVP

Easy LaTeX is a local-development platform for creating, listing, opening, and
deleting isolated browser-based LaTeX projects. A Next.js dashboard and
Firebase Authentication own the sign-in flow, FastAPI verifies Firebase ID
tokens and owns project/workspace lifecycle, PostgreSQL stores users and
project ownership, and a reusable code-server image supplies Git, TeX Live,
`latexmk`, LaTeX Workshop, and PDF preview.

This milestone adds multi-user identity and private project ownership as the
foundation for future sharing and collaboration. It does not yet include
sharing, roles, real-time collaboration, version-history UI, background jobs,
AI features, billing, Kubernetes, or production orchestration.

## Architecture

```text
Browser
  |-- Firebase Auth <------------------------> Email/password + Google
  |-- http://localhost:3000 ----------------> Next.js dashboard
  |                                               |
  |                                    Firebase ID token
  |                                               v
  |-- http://localhost:8000 ----------------> FastAPI
                                                  |-- PostgreSQL (users + projects)
                                                  |-- Docker SDK
                                                  |     `-- Docker socket
                                                  `-- WorkspaceManager
                                                         |-- named volume / project
                                                         `-- code-server / open project
                                                               |-- Git repository
                                                               |-- TeX Live + latexmk
                                                               `-- LaTeX Workshop + PDF viewer
```

The platform services are managed by Compose. code-server containers are
created dynamically by `DockerWorkspaceManager`, one per opened project. Each
container mounts exactly one project volume at `/home/coder/project` and never
receives the Docker socket.

## Repository structure

```text
.
├── backend/
│   ├── alembic/
│   │   └── versions/{20260910_0001_create_projects.py,
│   │                  20260912_0002_add_firebase_users.py}
│   ├── app/
│   │   ├── auth/firebase.py
│   │   ├── api/projects.py
│   │   ├── db/{base.py,session.py}
│   │   ├── models/{project.py,user.py}
│   │   ├── schemas/project.py
│   │   ├── services/{project_service.py,workspace_manager.py}
│   │   ├── config.py
│   │   └── main.py
│   ├── tests/test_projects_api.py
│   ├── Dockerfile
│   ├── alembic.ini
│   ├── requirements.txt
│   └── start.sh
├── config/
│   ├── init-project.sh
│   └── settings.json
├── frontend/
│   ├── app/{globals.css,layout.tsx,page.tsx,login/page.tsx}
│   ├── components/auth-provider.tsx
│   ├── lib/{api.ts,firebase.ts}
│   ├── Dockerfile
│   ├── next.config.ts
│   └── package.json
├── project-template/
│   ├── .gitignore
│   ├── main.tex
│   └── references.bib
├── workspace/                 # preserved legacy prototype sample
├── Dockerfile                 # reusable LaTeX/code-server image
├── docker-compose.yml
├── .env.example
└── README.md
```

## Requirements

- Docker Desktop, or Docker Engine with the Compose plugin
- A Firebase project with a registered Web app
- Enough disk space for PostgreSQL, code-server, and TeX Live images
- Ports 3000, 8000, 5432, and 8100–8199 available by default

Node, Python, PostgreSQL, and TeX do not need to be installed on the host for
the Compose workflow.

## Configure

Create the ignored local environment file:

```bash
cp .env.example .env
```

If upgrading the original prototype and `.env` already exists, do not overwrite
its password blindly. Merge the new variables from `.env.example` and add a
`POSTGRES_PASSWORD` instead.

Replace both placeholder passwords in `.env`:

```dotenv
POSTGRES_PASSWORD=choose-a-long-local-database-password
CODE_SERVER_PASSWORD=choose-a-long-local-editor-password
```

In Firebase Console, enable **Email/Password** and **Google** under
Authentication > Sign-in method, then copy the registered Web app configuration
into the matching `NEXT_PUBLIC_FIREBASE_*` variables in `.env`. Add
`localhost` to Authentication > Settings > Authorized domains when needed.

The backend must verify browser ID tokens with the same Firebase project. Set
`FIREBASE_PROJECT_ID`, create a dedicated service account with the minimum
required access, and save the downloaded key at the ignored path
`.secrets/firebase-service-account.json`. Compose mounts that directory
read-only into the backend:

```dotenv
FIREBASE_PROJECT_ID=your-project-id
FIREBASE_CREDENTIALS_PATH=/run/secrets/firebase-service-account.json
```

Never commit the service-account JSON. `FIREBASE_CREDENTIALS_JSON` remains an
alternative for secret-managed deployments. In a Google-managed production
runtime, prefer Application Default Credentials instead of a long-lived JSON
key and leave both credential settings unset there.

Important settings:

| Variable | Default/example | Purpose |
| --- | --- | --- |
| `POSTGRES_USER` | `latex` | Database role |
| `POSTGRES_PASSWORD` | required | Database password |
| `POSTGRES_DB` | `latex_platform` | Metadata database |
| `DATABASE_URL` | unset | Optional full SQLAlchemy URL override |
| `FRONTEND_PORT` | `3000` | Dashboard host port |
| `BACKEND_PORT` | `8000` | API host port |
| `POSTGRES_PORT` | `5432` | Local inspection port |
| `NEXT_PUBLIC_API_URL` | `http://localhost:8000` | API URL compiled into the browser bundle |
| `NEXT_PUBLIC_FIREBASE_*` | Firebase Web app values | Public client configuration compiled into the browser bundle |
| `FIREBASE_PROJECT_ID` | Firebase project ID | Expected token audience on the backend |
| `FIREBASE_CREDENTIALS_PATH` | `/run/secrets/firebase-service-account.json` | Read-only service-account key path |
| `FIREBASE_CREDENTIALS_JSON` | unset | Optional local service-account JSON; secret |
| `CORS_ORIGINS` | `http://localhost:3000` | Comma-separated allowed browser origins |
| `WORKSPACE_IMAGE` | `latex-workspace:local` | Dynamic editor image |
| `WORKSPACE_*_PREFIX` | `easy-latex-*` | Managed Docker resource names |
| `WORKSPACE_BIND_HOST` | `127.0.0.1` | Editor port bind address |
| `WORKSPACE_PUBLIC_HOST` | `localhost` | Host returned to the browser |
| `WORKSPACE_PORT_START/END` | `8100` / `8199` | Deterministic editor port pool |

The backend connects to `postgres:5432` on the Compose network. `localhost`
would be incorrect from inside the backend container. All browser-facing ports
bind to `127.0.0.1` by default.

If `NEXT_PUBLIC_API_URL` or a `NEXT_PUBLIC_FIREBASE_*` value changes, rebuild
the frontend because these are public build-time settings.

## Build and start

Validate configuration, build all three application images, and start:

```bash
docker compose config
docker compose build
docker compose up -d --wait
docker compose ps
```

The `workspace-image` Compose service is a successful one-shot image check; it
is expected to show `Exited (0)`. The long-running services are:

- `frontend` — production Next.js server
- `backend` — FastAPI, SQLAlchemy, Alembic, and Docker workspace management
- `postgres` — PostgreSQL metadata storage

Startup waits for PostgreSQL's `pg_isready` healthcheck. The backend retries and
runs `alembic upgrade head` before starting Uvicorn. The frontend waits for the
backend healthcheck.

### URLs

- Dashboard: <http://localhost:3000>
- Backend root: <http://localhost:8000>
- Health: <http://localhost:8000/health>
- Swagger UI: <http://localhost:8000/docs>
- OpenAPI JSON: <http://localhost:8000/openapi.json>
- Dynamic editors: `http://localhost:8100` onward

Adminer is not included; PostgreSQL can be inspected directly with `psql`.

## Database and migrations

The first Alembic migration creates the `projects` table. The authentication
migration adds `users` and a nullable `projects.owner_id` foreign key:

| Column | Type | Notes |
| --- | --- | --- |
| `id` | UUID | Primary key; also drives safe Docker resource names |
| `name` | varchar(128) | Validated display name |
| `created_at` | timestamptz | Server-generated |
| `updated_at` | timestamptz | Updated with record changes |
| `workspace_status` | varchar(32) | Last known runtime state |
| `workspace_identifier` | varchar(255) | Unique named-volume identifier |
| `owner_id` | UUID | Firebase-backed user who owns the project |

`users.firebase_uid` is unique. The API creates or refreshes the local user
profile from verified Firebase claims on each authenticated request. Existing
projects from before the authentication migration keep `owner_id = NULL` and
are intentionally hidden until an administrator assigns an owner.

LaTeX sources, PDFs, images, and Git data are never stored in PostgreSQL.

Migrations run automatically at backend startup. To run or inspect them:

```bash
docker compose run --rm backend alembic upgrade head
docker compose exec backend alembic current
docker compose exec backend alembic history
```

Inspect PostgreSQL:

```bash
docker compose exec postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
```

Useful commands at the `psql` prompt:

```text
\d+ projects
SELECT id, name, workspace_status, workspace_identifier FROM projects;
\q
```

## Project lifecycle

### Create Project

When the form is submitted, the frontend sends a fresh Firebase ID token and
calls `POST /projects` with the display name. The backend:

1. Trims and validates the name (1–128 characters; control characters rejected).
2. Associates the project with the authenticated user, generates a UUID, and
   stages the PostgreSQL row.
3. Creates a labeled Docker named volume using that UUID, never the raw name.
4. Runs a short-lived, network-disabled initializer from the workspace image.
5. Copies `main.tex`, `references.bib`, and `.gitignore` into the empty volume.
6. Initializes a `main` Git repository as the non-root `coder` user and creates
   the one allowed `Initial project` commit.
7. Commits the database transaction and returns the project.

If initialization fails, the database transaction rolls back and the newly
created volume is removed. Project names are never interpolated into shell,
container, path, or volume names.

Generated PDFs are ignored by the project `.gitignore`. They remain useful
local build products in the persistent volume without bloating future Git
history.

### Open Project

The Open button calls `POST /projects/{id}/open` and shows `Starting
workspace…`. The API first requires the project to belong to the authenticated
user. `DockerWorkspaceManager` then validates the project's labeled volume and:

- reuses its running container if one exists;
- restarts its stopped container if one exists; or
- allocates the first free managed port and creates one editor container.

The container mounts only that project's named volume at
`/home/coder/project`, uses password authentication from `.env`, and opens that
folder automatically. The API waits for code-server's healthcheck and returns
the URL; the dashboard navigates there. Repeated opens do not create duplicate
containers.

The optional `POST /projects/{id}/stop` endpoint stops the editor but preserves
its container and volume. `GET /projects/{id}/workspace` reports current status
and URL.

### Delete Project

The dashboard asks for confirmation, then calls `DELETE /projects/{id}`. The
backend resolves the UUID record, validates the expected management and
project labels, removes that one editor container, removes that one named
volume, and finally deletes the database row. It never accepts a filesystem
path or arbitrary Docker resource name from the browser.

Deletion is permanent: it removes the project's LaTeX files, PDF artifacts,
and nested Git repository.

## Persistent storage and isolation

Each project is stored in a Docker-managed named volume such as:

```text
easy-latex-project-550e8400-e29b-41d4-a716-446655440000
└── mounted at /home/coder/project
    ├── .git/
    ├── .gitignore
    ├── main.tex
    └── references.bib
```

List resources managed by the platform:

```bash
docker volume ls --filter label=com.easy-latex.managed=true
docker ps -a --filter label=com.easy-latex.managed=true
```

Named volumes survive backend restarts, editor restarts, image rebuilds, and
`docker compose down`. PostgreSQL uses the separate
`latex-platform_postgres_data` Compose volume. During a normal backend shutdown,
managed editor containers are stopped to release resources; they are restarted
on the next Open action.

## Edit, compile, preview, and use Git

Open a project and enter `CODE_SERVER_PASSWORD`. The focused workspace opens
`main.tex` with the project Explorer on the left and a distraction-free source
editor in the center. Generated LaTeX files stay out of the Explorer.

- Compile and preview: click **Compile** (the play icon) in the editor toolbar,
  or press `Ctrl+Enter` (`Cmd+Enter` on macOS). Auto-build is disabled. After a
  successful build, the PDF opens in a right-hand editor group.
- Hide preview: close the PDF tab or its editor group. It stays hidden when the
  workspace is reopened and returns the next time **Compile** is used.
- Terminal check:

```bash
cd /home/coder/project
latexmk -pdf main.tex
test -s main.pdf && echo "PDF generated successfully"
git status
git log --oneline
```

The initial repository has local author values `Easy LaTeX` and
`easy-latex@localhost`. Users may replace them with normal `git config
user.name` and `git config user.email` commands. The platform does not create
automatic commits after initialization.

## Authentication and API

All `/projects` endpoints require `Authorization: Bearer <Firebase ID token>`.
The backend verifies the token with Firebase Admin, upserts the local user, and
scopes every project query by that user's UUID. `/health` remains public.

| Method | Path | Result |
| --- | --- | --- |
| `GET` | `/health` | Database and Docker availability |
| `GET` | `/projects` | Current user's project list |
| `POST` | `/projects` | Create metadata, volume, template, and Git repository |
| `GET` | `/projects/{id}` | One project |
| `DELETE` | `/projects/{id}` | Remove editor, files, and metadata |
| `POST` | `/projects/{id}/open` | Reuse/start editor and return its URL |
| `GET` | `/projects/{id}/workspace` | Current editor status and URL |
| `POST` | `/projects/{id}/stop` | Stop editor; preserve project |

Example:

```bash
curl -X POST http://localhost:8000/projects \
  -H 'Authorization: Bearer YOUR_FIREBASE_ID_TOKEN' \
  -H 'Content-Type: application/json' \
  -d '{"name":"My Thesis"}'
```

## Tests

Backend tests use an in-memory database and a fake `WorkspaceManager` to cover
Firebase claim provisioning, missing-token rejection, per-user isolation,
validation, and create/list/open/reuse/status/delete behavior without touching
host Docker:

```bash
docker build --target test -t latex-platform-backend-test ./backend
docker run --rm latex-platform-backend-test
```

Frontend checks:

```bash
cd frontend
npm ci
npm run typecheck
npm run build
```

For a manual integration check, create two projects from the dashboard, open
both, confirm distinct ports and volumes, edit/compile one, restart the platform,
reopen it, and confirm the second is unchanged. Then delete one and verify only
its labeled container, volume, and database row disappear.

## Stop and reset

Stop the platform while preserving PostgreSQL and every project volume:

```bash
docker compose down
```

The safest complete reset is to start the API, delete each project from the
dashboard so cleanup remains scoped by validated UUID and Docker labels, then
remove the Compose database volume:

```bash
docker compose down --volumes
```

The second command is destructive to PostgreSQL metadata but does not discover
or delete dynamic project volumes by itself. If the API is unavailable, inspect
the label-filtered lists carefully before manually removing dynamic containers
and volumes. Never use an unfiltered Docker prune or broad filesystem deletion
for project cleanup.

## Docker socket security

The backend mounts `/var/run/docker.sock` so the Python Docker SDK can create
and manage editor containers. Access to that socket is effectively
root-equivalent control of the Docker host. This design is acceptable only for
local development:

- keep frontend, API, PostgreSQL, and editor ports bound to `127.0.0.1`;
- do not expose the stack to an untrusted network;
- do not treat the shared code-server password as user-level authorization;
- never give the Docker socket to code-server containers or future agents;
- do not add arbitrary command, image, path, or Docker-name inputs to the API.

`WorkspaceManager` keeps Docker operations behind a replaceable interface so a
future milestone can move to a less-privileged runtime without changing route
handlers.

## Troubleshooting

### Compose rejects the configuration

Create `.env` and replace both required placeholder passwords. Then run:

```bash
docker compose config
```

### PostgreSQL is unhealthy or authentication fails

```bash
docker compose ps
docker compose logs postgres
docker compose logs backend
```

Changing PostgreSQL credentials after its named volume is initialized does not
rewrite the existing database role. Restore the original values or perform the
documented destructive reset.

### Docker is unavailable to the backend

Ensure Docker is running, `/var/run/docker.sock` exists, and the Docker Desktop
context supports the socket mount. `/health` returns 503 when either PostgreSQL
or Docker is unavailable.

### Workspace image is missing

```bash
docker compose build workspace-image
docker image inspect latex-workspace:local
```

Keep `WORKSPACE_IMAGE` identical for Compose and the backend.

### No workspace port is free

Inspect `WORKSPACE_PORT_START` through `WORKSPACE_PORT_END` and managed
containers. Expand the range or free the conflicting localhost port, then
retry Open Project.

### An editor still uses an old password or image

Existing editor containers preserve their original environment and image.
Delete only the affected editor container (not its named project volume); the
next Open action recreates it. Inspect labels and mounts before removal.

### Project files are missing

The API returns a curated 503 if the expected UUID-derived, correctly labeled
volume is absent. Check backend logs and `docker volume ls` rather than creating
an unlabeled replacement manually.

### LaTeX Workshop is absent

The image build installs and verifies the pinned Open VSX extension. Rebuild
with network access and inspect:

```bash
docker run --rm latex-workspace:local --list-extensions --show-versions
```

The list should include `james-yu.latex-workshop`.

### Compilation or PDF preview fails

Open the LaTeX Workshop output panel and confirm `main.tex` compiles first. In
the integrated terminal:

```bash
cd /home/coder/project
latexmk -pdf -interaction=nonstopmode main.tex
ls -lh main.pdf
```

Reload code-server, reopen `main.tex`, and use **View LaTeX PDF file**. Build
artifacts are ignored by Git but intentionally persist in the project volume.

## Known limitations

- Dashboard/API identity and private project ownership are implemented, but
  sharing, roles, invitations, and real-time collaboration are not.
- Every editor still uses one shared password from `.env`; production multi-user
  deployment needs an authenticated workspace gateway or per-user credentials.
- The Docker socket is highly privileged.
- Editor routing uses a finite localhost port pool rather than a reverse proxy.
- Lifecycle locking is process-local; the MVP intentionally runs one backend
  process/worker.
- There are no resource quotas, idle timeouts, backups, renaming, sharing,
  collaboration, version-history UI, automatic commits, or AI features.
- Docker named volumes are local to the current Docker host and are not a
  backup strategy.
