# Easy LaTeX

Easy LaTeX is a filesystem-first desktop editor for LaTeX projects. Electron
provides the native shell, React renders the product UI, CodeMirror 6 edits
source, PDF.js renders compile output, and the Electron main process owns all
filesystem and process access. LaTeX compilation runs inside a locked-down
Docker container; no TeX distribution is installed on the host.

The application does not require a web server, database, or cloud account. A
normal project folder remains the canonical source of truth.

## Requirements

- Node.js 22 or newer
- npm 10 or newer
- Docker Desktop with the Docker engine running

Build the compiler image once after cloning:

```bash
npm run compiler:build
npm run compiler:check
```

The image is the complete TeX Live 2026 snapshot from 2026-09-15, pinned by its
multi-architecture manifest digest. It includes `latexmk`, pdfLaTeX, XeLaTeX,
LuaLaTeX, BibTeX, Biber, fonts, language support, and the full package set. No
packages are installed per project, and the app never calls a host TeX
executable.

Run the real compiler fixture matrix after building the image:

```bash
npm run compiler:test
```

The matrix covers Vietnamese, all three engines, BibTeX, Biber, TikZ,
`booktabs`, `hyperref`, `listings`, multi-file projects, diagnostics, and
cancellation.

Compile cleans cached auxiliary state and rebuilds on every click, including after a
failed build or compiler image upgrade. Problems shows the final LaTeX pass for
successful builds and includes BibTeX/Biber errors for failed builds. Successful
PDF previews use a snapshot so a later failed build cannot overwrite them.

## Local projects and files

`New project` creates a named folder containing `main.tex` and `.gitignore`.
New projects are stored in `Documents/Easy LaTeX` by default; the location is
shown in the creation dialog and can be changed with the native folder picker.
`Open project` continues to open any existing local LaTeX folder.

The project explorer can create files and folders or copy selected files and
complete folder trees into the active project. Imported content stays local,
existing paths are never overwritten, and symbolic links are rejected. Files
and folders can also be dropped from Finder, moved between project folders by
dragging, and renamed or deleted from the right-click menu.

For the active `.tex` file, the resizable File outline panel tracks parts,
chapters, sections, and nested subsections while you type. Selecting an entry
jumps directly to its source line in the editor.

## Development

```bash
npm install
npm run dev
```

Quality gates:

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

Create a packaged desktop application with:

```bash
npm run package
```

## Architecture

```text
Renderer (React, CodeMirror, PDF.js)
                 |
                 | window.desktop
                 v
Preload (contextBridge, narrow typed API)
                 |
                 | validated IPC
                 v
Electron Main
  +-- WorkspaceManager
  +-- FileManager / FileWatcher
  +-- CompileManager / DockerLatexCompiler
  +-- SyncTeXManager
  +-- GitManager
  +-- SettingsManager
```

The renderer has no Node.js integration. It cannot import `fs`, spawn a process,
run Git, or send arbitrary IPC messages. Every path received by the main process
is resolved and checked against the active workspace.

The compiler container runs without network access or Linux capabilities. The
project is mounted read-only, while only `.easy-latex/build` is writable. The
container root filesystem is read-only and resource limits are applied. Shell
escape is disabled. `/tmp` is non-executable; Biber receives a separate,
ephemeral executable cache because its packaged Perl runtime must unpack before
it starts.

## Repository layout

```text
apps/desktop/          Electron main, preload, and React renderer
packages/shared-types/ IPC and domain contracts shared across processes
packages/latex/        LaTeX parsing, completion, root detection, diagnostics
docs/design/DESIGN.md  Authoritative desktop UI contract
```

Project-specific metadata and generated files live below `.easy-latex/` inside
the opened project. Source files are never copied into a database.
