# GitHub collaboration

Local editing and Docker compilation remain available without an account. New collaboration uses a GitHub App, an application session, and Git on the desktop. Source, resources, PDFs and readable revision content are held in GitHub/local Git, not the new backend tables or Supabase Storage. The old API/store/Git worker modules remain for recovery of existing installations, but `apps/api/src/index.ts` starts only the new API and never starts a worker.

## Configure the GitHub App

Create a GitHub App for this installation. This is an operator setup step, not something each project member must do. Set:

For a new installation, the optional `npm run github:setup` wizard uses GitHub's App manifest flow and saves the returned credentials directly to `.env.local` and `.secrets`. Set an HTTPS `GITHUB_SETUP_WEBHOOK_URL` first. The wizard listens only on `127.0.0.1:4319`, validates a one-use state, and refuses to replace an existing App. The operator reviews and approves App creation on GitHub. Never run it again just to sign in to an existing installation.

- Callback URL: the backend's `/auth/github/callback`, matching `GITHUB_CALLBACK_URL` exactly. Use HTTPS outside loopback development.
- Disable **Request user authorization during installation**; the application runs its own authorization with state and S256 PKCE. Enable expiring user access tokens.
- Repository permissions: **Contents: read/write**, **Administration: read/write**, **Metadata: read**. Administration is required to create private repositories and invite collaborators; the current invitation API also documents Administration write for accepting invitations. No Actions, workflows, SSH keys, organization administration or email access is needed.
- Webhook URL: backend `/github/webhook`; JSON payloads; the secret in `GITHUB_WEBHOOK_SECRET`. Subscribe to **push**, **repository**, and **member**. GitHub sends **installation**, **installation_repositories**, and authorization revocation automatically; installation events have no subscription checkbox.
- Choose **Any account** if other personal accounts will install the App, including the second account in the manual validation checklist. This makes the App installable by others; project repositories are still private.
- Install the App on the owner's personal account. Prefer **Only select repositories**. New repositories may require an additional selection in GitHub installation settings; the app opens this step on access failure. Finish it, then retry Collaborate. No personal access token or Git configuration is required.

The choice follows GitHub's [GitHub App vs OAuth App documentation](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/differences-between-github-apps-and-oauth-apps), [user authorization and PKCE](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app), [repository creation permissions](https://docs.github.com/en/rest/repos/repos#create-a-repository-for-the-authenticated-user), and [invitation API](https://docs.github.com/en/rest/collaborators/invitations). REST requests use API version `2026-03-10`.

Use `.env.example` as a reference when filling `.env.local`; preserve an existing `.env.local`. Local setup fills absent or blank DB/API keys and preserves configured values. Fill in `DATABASE_URL`, App/client IDs, client secret, private key file path, slug, callback URL, token encryption key and webhook secret. Generate the encryption key with `openssl rand -base64 32`; keep it stable and backed up. GitHub tokens are encrypted with AES-256-GCM in the database. App sessions use hashed opaque tokens: access lasts 15 minutes, refresh lasts 30 days, and refreshed tokens rotate. GitHub's own refresh credential is kept only on the backend. A failed or revoked GitHub identity is rejected and its sessions revoked. Logout revokes this device's app session; it does not uninstall the App or delete repositories.

For detailed operator instructions in Vietnamese, see [GITHUB_SETUP.vi.md](GITHUB_SETUP.vi.md).

Only `EASY_LATEX_API_URL` and the optional compiler image belong in desktop configuration. Never include the private key, client secret, server encryption key or Storage service key in a distributable app or a `VITE_*` variable. Desktop credentials use Electron `safeStorage` and file mode 0600; Linux refuses the `basic_text` backend. If an OS key store is unavailable, sessions are memory-only. Renderer IPC exposes account display information, not session or Git tokens. A Git operation receives a short-lived installation token restricted to one repository and Contents read/write as needed; it is passed in the child environment, never a stored remote URL or command argument. Git tracing and credential helpers are disabled.

## Database and running locally

Use the existing Supabase PostgreSQL database, or an existing database with the legacy collaboration schema and its roles installed. Do not reset an existing database.

```sh
npm install
npm run supabase:start          # only if using the local Supabase stack
npm run collaboration:setup     # adds missing local DB/API settings; preserves GitHub settings
npm run github:migrate         # additive migration, no legacy content deletion
npm run api:dev
# production API alternative after npm run build: npm run start:built --workspace @easy-latex/api
# separate terminal:
npm run dev
```

For a fresh Supabase stack, Supabase applies the migrations during startup. `github:migrate` recognizes the installed GitHub schema. For an existing stack, it applies only `202610060001_github_coordination.sql` in one short transaction. It removes the dependency of profile IDs on Supabase Auth and creates separate GitHub identity/session/coordination tables. Existing profile IDs and project/content tables remain intact. No identities are matched by email.

PostgreSQL LISTEN/NOTIFY must be supported by the API connection (use a direct connection, not a transaction pooler). SSE requires a proxy that disables buffering and keeps the stream open. It carries only project IDs and commit SHAs; clients fetch Git and preserve drafts. Reconnect reloads the latest metadata and Git version. Dashboard invitations/project listings refresh every 10 seconds; editor source is never polled every five seconds.

Desktop packages include the Git runtime supplied by pinned Dugite 3.2.3, copied into `Resources/git` with licenses/provenance. Both local Git status and collaboration invoke that runtime and its helpers directly. Installation verifies the downloaded runtime checksum. Install dependencies and build on the target OS/architecture; cross-platform binaries and signed releases have not been validated. Git on the user's PATH is unnecessary. Docker and the compiler image remain required; no TeX installation is needed on the host.

For a packaged app, set the public `EASY_LATEX_RELEASE_API_URL` environment variable when building, for example `EASY_LATEX_RELEASE_API_URL=https://api.example.com npm run build`. Only the API URL is written to `Resources/desktop-config.json`; backend secrets are never copied. A signed-out user may choose **Connection settings** in the sign-in dialog and save a server address. This is retained across launches and takes precedence over environment/release defaults. Changing servers requires signing out first.

## Activation, Edit and publication

Collaborate reserves a project using an account/local-folder-derived request UUID. Its repository name is a sanitized project name plus project UUID. Creation is private and empty; an uncertain creation response can adopt only the same marked empty repository. Existing unrelated or populated repositories are never overwritten. Repository ID, rather than its owner/name, is the stable link; names and ownership are refreshed after GitHub permission checks. A transferred repository can still be opened by authorized members, but owner operations stop if the original owner no longer controls it. Deleted, uninstalled or inaccessible repositories produce recovery errors.

Shared editing uses the real project folder. For an activated local project this is the original bound folder; a project first opened from GitHub gets a folder under the configured projects location, shown in the workspace. Every open synchronizes supported published files from GitHub before enabling Edit. External edits to those local files are deliberately overwritten; files previously synchronized and then deleted on GitHub are removed. Unrelated untracked files and existing `.git` configuration are retained. The app does not import outside local changes into Done.

Git object stores and publication receipts remain private to the desktop. The first backend retains existing recovery records in place; other backends use separate storage namespaces. Drafts, activation exports, migration exports and receipts are separated by account. Existing immutable checkouts are no longer used as the editor folder and are left intact. Updates never stash, reset or merge the user's Git repository. Only supported sources and resources are imported; hidden/internal paths, build/cache directories and obvious credential files are excluded. Root PDFs with a matching `.tex` are treated as build output; PDF resources under folders remain supported. Empty directories use `.gitkeep` marker blobs hidden from the editor tree.

Edit is an atomic PostgreSQL lease, bound to the user, file, token, version and blob SHA. Two requests on the same file cannot both win. Files may be edited in parallel. A stale file requires synchronization before Edit; expired tokens cannot confirm new versions. The desktop refreshes GitHub before acquiring Edit. While its lease is valid, saves write both the visible project file and a separate recovery draft. Updates to other files leave that active file alone. Disconnect/lease loss preserves the draft and makes the editor read-only. Reconnect automatically synchronizes the published files before enabling another Edit request. Restore an Easy LaTeX recovery draft explicitly after obtaining a fresh lease; outside local edits are not merged.

Done reserves one publication per project. It validates the touched file leases and versions, then closes the database transaction before Git operations. Desktop writes only authorized paths to a separate index and creates one request-tagged commit. The commit SHA is fixed in the ticket before credentials are issued or pushing begins. A normal push is used, never force-push. Backend verifies the actual head, parent, request trailer, all changed paths, blob SHAs and regular file modes before updating metadata, releasing matching leases and sending SSE. New files, directories and imports use this same process and cannot overwrite existing paths without their leases. The desktop automatically retries a busy publication turn or an advanced base before reservation, at most eight attempts with increasing delays (about 25 seconds total waiting). The request ID stays fixed. No automatic replacement occurs after a ticket/commit is fixed, and credential fencing is unchanged. Exhausted retries leave a recoverable Retry Done state.

Receipts make retry reuse the original commit. Confirmation is attempted first when the remote already contains it, including after an API response loss or restart. An expired prepared turn is reconciled before replacement. An uncertain push is fenced until its issued Git credential expires (typically up to one hour plus one minute); this deliberately delays another turn so an old client cannot race it. If another GitHub commit advanced the head after a successful push, the backend verifies ancestry (up to 256 commits), confirms the original request and synchronizes the latest tree. Unpublished expired requests are abandoned only after credential fencing; histories too deep to verify stop for manual recovery. The application preserves the draft rather than rewriting a branch.

Remote changes to another file are included in a fresh publication base. Changes to the active draft file require comparison with the new published content and a new Edit lease. The UI reports saved locally, publishing, confirmed publication and retry needed separately. GitHub changes outside the app are detected by signed webhooks, or by opening/refreshing/reconnecting a project. Without a reachable webhook URL, an otherwise idle connected project will not immediately detect an external push. External Git clients can write outside the app's cooperative Edit leases; those leases are not GitHub branch protection.

Webhook reconciliation uses an installation token restricted to the affected repository with Contents read access. It does not require the project owner's desktop session. Active publication tickets still block metadata advancement until their normal verification/recovery path completes.

Private personal repositories grant invited collaborators write access. Accordingly the UI offers **Can edit** and rejects View only invitations. It never promises repository read-only access when GitHub actually grants write access. Owners invite an exact GitHub username in the app, and members accept GitHub invitations in Projects. Opening/editing still checks both backend membership and actual GitHub access. Removing a collaborator or uninstalling/revoking the App denies later operations and terminates SSE on its next authorization check (at most 60 seconds).

## Migrating an old project

Enable the optional backend bridge with `LEGACY_SUPABASE_URL`, `LEGACY_SUPABASE_ANON_KEY` and `LEGACY_SUPABASE_SERVICE_KEY`. Stop the old API/worker from taking new edits while migrating; retain its database, Storage and Git directory. In the signed-in dashboard account menu choose **Migrate legacy projects**. Confirm the old account using its emailed OTP (for hosted legacy Supabase, set the Magic Link template to show `{{ .Token }}`, following [Supabase email templates](https://supabase.com/docs/guides/auth/auth-email-templates); the local template is included in `supabase/templates/legacy-link.html`); `shouldCreateUser:false` prevents creating an unrelated legacy identity. The backend verifies that proof independently and records an explicit link. A matching email alone never authorizes migration.

For the same local Supabase database, `npm run collaboration:setup -- --legacy` fills the bridge keys without printing them; it refuses a different configured database. Restart the API afterward. It does not link accounts or migrate projects automatically.

Choose an owned project. The desktop saves a recoverable export before publishing. Source and resource bytes are preserved. Readable per-file revisions, author names and timestamps are preserved as text archives in a `legacy-history-<project-id>` directory on GitHub. Original Git commit SHAs and project-wide chronology are not reconstructed; the old system remains their archive. Existing members must be invited through GitHub. The UI shows these limitations.

The migration ledger stores only the file/blob manifest and the verified SHA. Backend validates the full GitHub tree against that manifest before confirming the new link. Exports and manifests are stable on retry; if legacy data changed after reservation, automatic retry stops instead of silently substituting a different export. Current limits are 1000 imported paths, 5 MiB per text file, 10 MiB per binary file and 20 MiB total per publication, including revision archives. Projects/history exceeding these limits need a separately planned batch migration; old data is preserved and migration fails visibly. No cleanup or deletion runs automatically. Cleanup is a separate future operator action requiring explicit confirmation.

## Tests and two-account validation

```sh
npm run lint
npm run typecheck
npm test
npm run github:test
EASY_LATEX_COMPILER_INTEGRATION=1 npm run test --workspace @easy-latex/desktop -- test/CompilerIntegration.spec.ts test/SharedCompileIntegration.spec.ts
npm run build
npm run collaboration:check
```

`github:test` requires a local `DATABASE_URL` with permission to create disposable databases. It creates a separate database, applies all migrations, runs real PostgreSQL race/recovery/auth/migration/SSE tests with **mocked GitHub**, then drops only that disposable database. It never creates GitHub repositories. `npm test` also tests real local Git object creation and metadata/commit consistency, direct shared-folder writes, overwrite-on-open, recovery drafts, renderer reconnect, secure sessions, imports and local functionality. Concurrent snapshot calls share one metadata load; file and directory results come from that same snapshot. Docker compilation integration uses the existing compiler image. Health/configuration checks do not prove live GitHub integration.

After configuring the real App, perform the following with two GitHub accounts, granting repository creation permission explicitly for this manual test:

1. Sign in as owner A in the system browser, install/select the App, and activate a small local project with source, images, PDF resources and an empty folder. Verify a private repository and identical bytes. Retry activation after interrupting the API response; verify one repository.
2. Invite B's GitHub username; sign in as B on a separate desktop profile/device, accept in Projects, finish any required GitHub installation step and open the project. A and B must never share a checkout or draft directory.
3. Request Edit simultaneously on one file, then on two separate files. Verify one winner per file and both different-file editors. Click Done together; verify automatic waiting, both edits and intact resources, and use Retry Done if the bounded wait expires.
4. Disconnect before push, then after successful push before API confirmation. Restart app/API, retry and verify exactly one commit/version for each request, no lost drafts and no force-push.
5. Let a lease/turn expire; submit the stale request, revoke B's repository permission, revoke an app authorization and uninstall/reinstall the App. Verify denied access, preserved drafts, reauthorization and safe recovery.
6. Reconnect SSE after missed commits; publish directly on GitHub while the other client holds a draft. Verify only published content updates and the draft remains recoverable. Test rename/transfer/deletion separately and verify recovery errors.
7. Migrate a disposable legacy project through explicit account confirmation. Verify byte hashes and revision archives on GitHub and untouched legacy database/Storage/Git. Inspect new coordination tables: no source, image, PDF or snapshot fields.

No deployment or real repository creation is performed by automated checks.

The opt-in `npm run github:smoke -- --live` command is different: it signs in interactively, creates a real private repository containing synthetic files, publishes edits, checks history/resources and compiles locally. Obtain permission before using it. Login sessions remain in memory; reports contain no credentials. `npm run github:smoke:webhook -- --live` modifies that same synthetic repository to verify external webhook synchronization after logout. See [the recorded live validation](GITHUB_VERIFICATION.vi.md) for the completed local run and remaining gaps.
