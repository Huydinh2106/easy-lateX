# Easy LaTeX

Easy LaTeX is a filesystem-first desktop editor for LaTeX projects. Electron
provides the native shell, React renders the product UI, CodeMirror 6 edits
source, PDF.js renders compile output, and the Electron main process owns all
filesystem and process access.

The application does not require a web server, database, Docker, code-server,
Code-OSS, or a cloud account. A normal project folder remains the canonical
source of truth.

## Requirements

- Node.js 22 or newer
- npm 10 or newer
- A TeX distribution that provides `latexmk`

The selected TeX distribution must also provide the engine used by the project:
`pdflatex`, `xelatex`, or `lualatex`.

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
  +-- CompileManager / LatexmkCompiler
  +-- SyncTeXManager
  +-- GitManager
  +-- SettingsManager
```

The renderer has no Node.js integration. It cannot import `fs`, spawn a process,
run Git, or send arbitrary IPC messages. Every path received by the main process
is resolved and checked against the active workspace.

## Repository layout

```text
apps/desktop/          Electron main, preload, and React renderer
packages/shared-types/ IPC and domain contracts shared across processes
packages/latex/        LaTeX parsing, completion, root detection, diagnostics
docs/design/DESIGN.md  Authoritative desktop UI contract
```

Project-specific metadata and generated files live below `.easy-latex/` inside
the opened project. Source files are never copied into a database.
