# Easy LaTeX Desktop Design System

- **Status:** authoritative implementation contract
- **Scope:** desktop LaTeX workspace
- **Default theme:** light
- **Source of truth:** this document

Easy LaTeX is a focused desktop application for opening, editing, compiling,
and previewing ordinary LaTeX projects. It is not a browser dashboard and it
must not look or behave like a general-purpose IDE.

## 1. Product principles

1. The document is the center of the workspace.
2. The filesystem is visible but visually secondary to the active document.
3. Compile status and problems are understandable without reading raw logs.
4. PDF is contextual and resizable, not a permanently forced half-screen.
5. User source is never silently overwritten, relocated, or stored in a database.
6. System activity is calm: save, watch, and compile states use concise status.
7. Advanced infrastructure such as Git and SyncTeX stays behind product language.
8. The application has its own product shell; it does not reproduce another editor.

The MVP hierarchy is:

1. LaTeX source editor;
2. compile and PDF feedback;
3. project files and document structure;
4. advanced history and synchronization infrastructure.

Authentication, cloud sync, collaboration, AI writing, terminal access, and a
visual/WYSIWYG document editor are outside this release.

## 2. Canonical workspace

```text
┌────────────────────────────────────────────────────────────────────┐
│ Project   Root document   Engine      Saved   PDF   Compile        │
├──────────────┬───────────────────────────────┬─────────────────────┤
│ Project      │ Active source                 │ PDF preview         │
│ explorer     │                               │ (optional)          │
│              │                               │                     │
│              ├───────────────────────────────┤                     │
│              │ Problems (collapsible)        │                     │
├──────────────┴───────────────────────────────┴─────────────────────┤
│ Filesystem workspace       active file       engine / history     │
└────────────────────────────────────────────────────────────────────┘
```

Canonical dimensions:

```css
--topbar-height: 49px;
--statusbar-height: 25px;
--explorer-width: 232px;
--pdf-width: 520px;
--problems-height: 220px;
```

- The editor always receives the largest stable area.
- The explorer may narrow to 180px but never becomes a dense icon-only IDE rail.
- The PDF panel is 360–900px, defaults to 520px, and overlays on a narrow window.
- The Problems panel is 120–480px and collapses to a 40px heading.
- Opening PDF must not reduce the editor below a usable width; overlay it instead.

## 3. Design tokens

Components use semantic variables. Raw colors or one-off shadows must not appear
inside feature components.

```css
:root {
  --color-bg-canvas: #fafafa;
  --color-bg-surface: #ffffff;
  --color-bg-subtle: #f7f7f7;
  --color-bg-muted: #f2f2f2;
  --color-bg-hover: #f5f5f5;
  --color-bg-pressed: #eeeeee;

  --color-text-primary: #171717;
  --color-text-secondary: #525252;
  --color-text-muted: #737373;
  --color-text-disabled: #a3a3a3;

  --color-border-subtle: #efefef;
  --color-border-default: #e5e5e5;
  --color-border-strong: #d4d4d4;

  --color-accent: #047857;
  --color-accent-hover: #065f46;
  --color-accent-pressed: #064e3b;
  --color-accent-soft: #ecfdf5;
  --color-selection: rgba(5, 150, 105, 0.18);
  --color-focus: #059669;

  --color-info: #1d4ed8;
  --color-warning: #b45309;
  --color-danger: #b91c1c;
  --color-success: #047857;
}
```

Emerald is used for the primary action, focus, selection, successful compilation,
and the active editor cursor. Warning and danger colors are semantic only.

## 4. Typography and spacing

Use Geist Sans for product UI and Geist Mono for source, file paths, logs, and
technical values. System fallbacks are required when fonts are unavailable.

| Role | Size / line | Weight |
| --- | --- | --- |
| Workspace UI | 13 / 18px | 400 |
| Control | 13 / 18px | 500 |
| Panel title | 12 / 16px | 600 |
| Empty-state title | 14 / 20px | 600 |
| Source | 13 / 21px | 400 |
| Welcome title | 36 / 42px | 600 |

Spacing follows a 4px scale: 4, 8, 12, 16, 20, 24, 32, 40, and 48px.
Functional controls use 4–16px most often. Avoid nested card layouts.

## 5. Surfaces and elevation

1. Canvas: application background.
2. Surface: editor, top bar, inputs, and PDF page.
3. Subtle surface: explorer, status bar, and PDF viewport.
4. Selected surface: white or accent-soft plus a non-color selection indicator.
5. Floating surface: menus and toasts with one hairline and restrained shadow.

Sidebars and ordinary panels have no shadows. Shadows indicate actual overlap.
Borders are 1px. Focus rings are 2px.

## 6. Controls

- Primary button: one principal action per region, 32px high.
- Secondary button: neutral surface and default border.
- Icon button: square, named with `aria-label`, tooltip when meaning is unclear.
- Select: visible label, 28–32px high, native keyboard behavior.
- Destructive actions: explicit label and confirmation naming the affected object.
- Disabled controls remain readable and explain their state when necessary.

All controls implement default, hover, focus-visible, pressed, disabled, and
loading states where applicable. Hover-only actions are prohibited.

## 7. Top bar and compile behavior

The top bar contains:

- product mark and project folder name;
- root document selector;
- engine selector;
- save state;
- PDF toggle;
- Compile or Cancel.

It does not contain a browser navigation bar, a dense menu strip, cloud presence,
or unrelated future actions.

Compile states:

| State | Label and behavior |
| --- | --- |
| Idle | `Ready to compile` |
| Starting | `Starting pdfLaTeX/XeLaTeX/LuaLaTeX` |
| Running | `Compiling`; Cancel is available |
| Cancelling | `Cancelling…`; repeated cancellation is disabled |
| Success | `PDF updated`; quiet success indicator |
| Failed | `Compilation failed`; open actionable Problems |
| Cancelled | `Compilation cancelled`; preserve previous PDF |

A thin progress edge may animate while running. Never invent a percentage.

## 8. Project explorer

- Row height: 30–32px.
- Directories precede files and use disclosure arrows.
- Nesting is represented by indentation, not nested bordered containers.
- The selected file uses surface contrast and a 2px accent edge.
- The root document has a star and accessible label.
- Generated build files, `.git`, and internal application files are hidden.
- Symlinks outside the workspace never appear as traversable project content.

The explorer shows implementation structure because source editing is the MVP,
but it remains visually quieter than the active document.

## 9. LaTeX editor

The editor is an independent `LatexEditor` component. Configuration is split
into language, completion, extensions, and theme modules.

Required behavior:

- line numbers, search, selection matching, history, and bracket matching;
- syntax highlighting for LaTeX source;
- basic commands and environment completion;
- error and warning decorations;
- `Mod+S` save;
- jump to file/line from Problems;
- preserve dirty content during a filesystem conflict.

Do not add a minimap, activity bar, terminal, extension marketplace, or generic
IDE decoration. Source text uses the neutral surface and the product token system.

## 10. Save and external changes

Save states are `Saved`, `Modified`, `Saving…`, `Changed on disk`, and
`Save failed`.

- Routine successful saves remain quiet.
- A failed save preserves the editor buffer.
- A changed-on-disk conflict never chooses a side automatically.
- File switching and Compile must first resolve or successfully save dirty source.
- External clean-file changes reload from disk.
- External dirty-file changes retain the local buffer and show a recoverable alert.

## 11. Problems panel

Problems are grouped into errors and warnings but displayed in one keyboard
navigable list for the MVP. Each row contains severity icon, plain message, and
file/line. Clicking a row opens the source and places the cursor at the location.

Raw compiler output is collapsed under `Technical log`. Do not make the raw log
the default failure UI.

## 12. PDF preview

The PDF panel uses PDF.js rendered canvas content. Browser PDF plugins and
external viewers are not the embedded preview.

Header controls:

- current page and total pages;
- previous/next;
- zoom out/in and reset;
- stale indicator;
- close.

Keep the last successful PDF visible while a new compile runs, fails, or is
cancelled. Mark it `Out of date` after source changes. A successful compile
reloads the artifact automatically.

## 13. Problems and error hierarchy

1. Inline editor diagnostic for a source location.
2. Problems panel for compile results.
3. Toast for a recoverable operation failure.
4. Full workspace state only when the project cannot be used.

Errors say what failed and what was preserved. Do not display raw stack traces,
internal IPC channel names, or absolute system paths unless the user asks for
technical details.

## 14. Empty and loading states

- No project: one focused explanation and `Open project folder` action.
- Empty folder: explain that no files exist; do not fabricate a template.
- No selected file: direct the user to the explorer.
- No PDF: provide Compile guidance.
- PDF loading: restrained spinner and text.
- Missing compiler: explain that `latexmk` must be installed or configured.

## 15. Status bar

The status bar is informational, not a second toolbar. It may show:

- filesystem workspace indicator;
- active relative file path;
- internal history availability;
- selected engine.

Do not show branch names, commit hashes, remote status, container status, server
ports, authentication, or cloud controls in the MVP.

## 16. Responsive desktop behavior

| Width | Behavior |
| --- | --- |
| 1280px+ | Explorer, editor, and optional PDF side by side |
| 960–1279px | PDF overlays the editor edge; editor remains usable |
| Below 960px | Unsupported as a packaged window minimum |

The app is desktop-only for this release. Touch-first and mobile layouts are not
implemented, but controls remain accessible at 200% zoom.

## 17. Accessibility

Target WCAG 2.2 AA.

- Logical DOM and tab order follow explorer → editor → PDF → Problems.
- Trees, buttons, selects, details, and status regions use native semantics.
- Icon-only controls have accessible names.
- Color never communicates severity or selection alone.
- Save failure and compile completion/failure are announced.
- Routine successful save is not announced.
- Focus-visible is never removed without replacement.
- Reduced motion removes looping decorative movement.
- Keyboard access must cover open, save, compile, cancel, file selection,
  diagnostics, PDF navigation, and panel close.

## 18. Security-visible UX

- Only a user-selected project folder can become the active workspace.
- File paths displayed in UI are project-relative.
- No arbitrary shell command or terminal is exposed.
- External links and new windows are blocked by default.
- PDF artifacts are accessed through an opaque application URL.
- A rejected path operation produces a normal recoverable error, never fallback
  access outside the workspace.

## 19. Future capabilities

SyncTeX may add forward and inverse navigation to the existing editor and PDF
components. Git may power `History` and `Restore version`. Cloud synchronization
may be added through a `SyncManager` that observes the same filesystem events.

These capabilities must not replace the filesystem as local source of truth or
introduce technical Git vocabulary into the ordinary workspace.

## 20. Implementation checklist

Before a feature is complete, verify:

- empty, populated, loading, success, error, and cancellation states;
- dirty-buffer preservation;
- external-file conflict behavior;
- keyboard-only operation;
- accessible names and status announcements;
- 200% zoom and reduced motion;
- narrow-window behavior;
- no Node or Electron object leaks into renderer code;
- no raw style value when a semantic token already exists;
- no business logic embedded in a React presentation component.
