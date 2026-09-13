# Easy LaTeX Design System

- **Status:** authoritative implementation contract
- **Scope:** marketing, application, editor, collaboration, administration, and public views
- **Default theme:** light
- **Last updated:** 2026-09-11

This file is the single source of truth for Easy LaTeX product design. Implementers must not consult or copy the reference files in `docs/design/references/` when building product UI. Those files are research inputs, not parallel specifications. If existing UI conflicts with this document, this document wins unless a later product requirement explicitly changes it.

---

## 1. Product design philosophy

Easy LaTeX is an AI-first collaborative academic writing environment. It gives ordinary writers the structural and typesetting power of LaTeX without making syntax, files, compilation mechanics, or an IDE the center of the experience.

The product must feel like a calm workspace for thinking:

- precise enough for researchers and technical authors;
- approachable to users who have never written LaTeX;
- fast and compact enough for daily professional use;
- trustworthy when AI edits important academic work;
- document-native rather than dashboard-like;
- technically capable without looking like an IDE.

Hierarchy comes from typography, spacing, alignment, restrained surface changes, and thin dividers. A border or card is not the default answer to grouping. Content should feel placed on a coherent workspace, not packed into nested containers.

### 1.1 Interaction hierarchy

The product has one intentional hierarchy:

1. **AI Agent — primary.** Users state intent, ask questions, create or transform content, fix problems, and review structured work.
2. **Visual Editor — secondary.** Users inspect document meaning and make focused manual edits without handling syntax.
3. **Source / Advanced Mode — tertiary.** Expert users directly control source, unusual packages, macros, Git, and terminal workflows.

Do not present these as three equal tabs. AI actions belong throughout the document and workspace. Visual editing is the default representation of the document. Source Mode is discoverable but visually separated and explicitly advanced.

The primary workspace mental model is:

> Intent + visual document + contextual output

It is never `Files | Code | PDF` and never a code editor with a chatbot attached.

### 1.2 Product behavior principles

1. **Start from intent.** The most prominent first action is to ask AI, continue writing, or open recent work—not to create a `.tex` file.
2. **Show document meaning.** Headings, citations, equations, tables, figures, and references appear as semantic objects.
3. **Reveal controls in context.** Persistent chrome contains only frequent navigation and status. Formatting and block actions appear on hover, focus, selection, or command search.
4. **Make agency visible.** AI work shows concise progress, scope, applied state, impact, and undo or approval controls.
5. **Preserve source fidelity.** Unsupported LaTeX is retained byte-for-byte where possible and is never silently simplified or deleted.
6. **Keep system activity calm.** Autosave, compilation, collaboration, and agent work communicate useful state without constant banners or chatty narration.
7. **Prefer reversible actions.** Destructive and high-impact changes require explicit review. Applied AI changes remain recoverable through undo and history.
8. **Keep advanced power nearby, not central.** Source, logs, files, Git, and terminal tools are one deliberate step away.

---

## 2. Reference responsibilities and conflict resolution

The final system uses the references by responsibility, not by copying their brands.

| Concern | Governing direction | Product adaptation |
| --- | --- | --- |
| Visual foundation | Vercel-like precision and restraint | Light neutral palette, Geist, compact controls, hairlines, minimal elevation |
| Document and workspace behavior | Notion-like content-first interaction | Semantic blocks, low chrome, contextual tools, document-native comments and presence |
| Agent and command behavior | Linear-like speed and structure | Keyboard-first actions, terse progress, compact statuses, low-noise activity |
| Product hierarchy and safety | Easy LaTeX requirements | AI first, Visual second, Source third; lossless LaTeX preservation; reviewable AI changes |

Resolved conflicts:

- **Light versus dark:** light wins. The dark Linear palette and visual identity are not part of this system.
- **Accent:** emerald replaces every reference brand color. Blue, purple, and multicolor brand palettes do not carry over.
- **Typography:** Geist Sans and Geist Mono are the only product families. Reference-specific faces do not carry over.
- **Marketing display scale:** large type is allowed, but the application never inherits marketing-sized headings.
- **Document warmth:** the behavioral calm of a document tool is retained, but surfaces use the neutral system below rather than Notion's warm brand palette.
- **Gradients and decoration:** reference gradients, night bands, sticker palettes, and glows are removed. Product demonstrations and strong typography provide visual interest.
- **Corners:** functional UI uses tight radii; marketing CTAs may use pills. Cards are not automatically rounded containers.
- **Depth:** borders and surface contrast precede shadows. Dark surface ladders and heavy shadows are removed.
- **Success and action:** emerald can mean the primary action or success only when role and accompanying icon/text make the meaning clear.

### 2.1 Shared principles retained

The references agree on a compact 4px-derived rhythm, sparse accent color, strong sans-serif typography, thin borders, minimal elevation, restrained radii, and product UI as the proof of capability. Those shared principles are canonical here.

### 2.2 Brand-specific rules rejected

Do not reproduce reference logos, proprietary type, signature gradients, lavender or blue accents, dark marketing identity, sticker illustrations, brand-specific wording, or distinctive layouts. Inspiration governs quality and behavior; Easy LaTeX must read as one original product.

---

## 3. Design foundations

### 3.1 Color tokens

Use semantic tokens in components. Raw color values may appear only in the central theme definition, tests that verify the theme, or imported third-party content. Do not name product tokens after hue numbers such as `green-600`.

```css
:root {
  color-scheme: light;

  /* Backgrounds and surfaces */
  --color-bg-canvas: #fafafa;
  --color-bg-surface: #ffffff;
  --color-bg-subtle: #f7f7f7;
  --color-bg-muted: #f2f2f2;
  --color-bg-hover: #f5f5f5;
  --color-bg-pressed: #eeeeee;
  --color-bg-overlay: rgba(0, 0, 0, 0.42);

  /* Text */
  --color-text-primary: #171717;
  --color-text-secondary: #525252;
  --color-text-muted: #737373;
  --color-text-disabled: #a3a3a3;
  --color-text-on-accent: #ffffff;
  --color-text-inverse: #ffffff;

  /* Structure */
  --color-border-subtle: #efefef;
  --color-border-default: #e5e5e5;
  --color-border-strong: #d4d4d4;

  /* Primary accent */
  --color-accent: #047857;
  --color-accent-hover: #065f46;
  --color-accent-pressed: #064e3b;
  --color-accent-soft: #ecfdf5;
  --color-accent-soft-hover: #d1fae5;
  --color-accent-border: #a7f3d0;
  --color-accent-text: #065f46;
  --color-selection: rgba(5, 150, 105, 0.18);
  --color-focus: #059669;
  --color-focus-ring: rgba(5, 150, 105, 0.22);

  /* Semantic status */
  --color-info: #1d4ed8;
  --color-info-soft: #eff6ff;
  --color-info-border: #bfdbfe;
  --color-warning: #b45309;
  --color-warning-soft: #fffbeb;
  --color-warning-border: #fde68a;
  --color-danger: #b91c1c;
  --color-danger-hover: #991b1b;
  --color-danger-soft: #fef2f2;
  --color-danger-border: #fecaca;
  --color-success: #047857;
  --color-success-soft: #ecfdf5;
  --color-success-border: #a7f3d0;

  /* AI change review */
  --color-change-added-bg: #ecfdf5;
  --color-change-added-line: #059669;
  --color-change-removed-bg: #fef2f2;
  --color-change-removed-line: #dc2626;
  --color-change-modified-bg: #eff6ff;
  --color-change-modified-line: #2563eb;
  --color-change-pending-bg: #fffbeb;
  --color-change-pending-line: #d97706;

  /* Collaborator identity; never structural UI color */
  --color-presence-1: #059669;
  --color-presence-2: #2563eb;
  --color-presence-3: #7c3aed;
  --color-presence-4: #d97706;
  --color-presence-5: #e11d48;
  --color-presence-6: #0891b2;
}
```

Usage rules:

- `bg-canvas` is the outer application and marketing canvas.
- `bg-surface` is the document surface, menus, dialogs, inputs, and intentional containers.
- `bg-subtle` separates regions such as a sidebar or table header.
- `bg-muted` is for skeletons, empty preview wells, or stronger inset areas—not nested card backgrounds.
- `text-muted` is the lightest text allowed for meaningful body-sized information. `text-disabled` is only for disabled or nonessential text.
- `accent` is limited to the primary action, active/focus state, selected object, successful compilation, and selected AI confirmation. A screen should usually contain one solid emerald action at a time.
- `info`, `warning`, and `danger` are semantic only. Never use them decoratively.
- AI diff colors communicate change type and always appear with text, symbols, or line treatment.
- There is no decorative gradient token. Do not introduce gradients without updating this contract.
- A future dark theme must be defined as a complete semantic-token override. Do not add isolated dark components.

#### Collaborator colors

Presence needs distinguishable identities but must not become application chrome. Derive a stable collaborator color from `color-presence-1` through `color-presence-6`. Use it only on avatar rings, cursors, selections at 12–18% opacity, and presence labels. Pair every presence color with a name or initials.

### 3.2 Typography

Load **Geist Sans** for all product UI and visual-document text. Load **Geist Mono** for source, code, logs, shortcuts, identifiers, and technical values. Fallbacks:

```css
--font-sans: "Geist Sans", "Geist", Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
--font-mono: "Geist Mono", ui-monospace, "SFMono-Regular", Menlo, Monaco, Consolas, monospace;
```

Use only weights 400, 500, and 600. Body copy is 400, labels and controls are 500, and headings are 600. Do not synthesize 700+ weights.

| Token | Size / line | Weight | Tracking | Use |
| --- | --- | --- | --- | --- |
| `display-hero` | 64 / 64px | 600 | -2.6px | Marketing hero only; 44 / 48px on mobile |
| `display-section` | 44 / 48px | 600 | -1.6px | Major marketing sections |
| `page-title` | 24 / 32px | 600 | -0.6px | Application page title |
| `section-title` | 20 / 28px | 600 | -0.4px | App section or dialog title |
| `component-title` | 16 / 24px | 600 | -0.2px | Cards, rows, panel headings |
| `body-lg` | 16 / 24px | 400 | 0 | Marketing lead, auth explanation |
| `body` | 14 / 20px | 400 | 0 | Default application text |
| `body-compact` | 13 / 18px | 400 | 0 | Dense navigation, agent steps, metadata |
| `label` | 13 / 18px | 500 | 0 | Form labels, navigation, tabs |
| `button` | 14 / 20px | 500 | 0 | Buttons and menu actions |
| `caption` | 12 / 16px | 400 | 0 | Timestamps, helper text, secondary status |
| `eyebrow` | 12 / 16px | 500 | 0.04em | Rare marketing taxonomy; uppercase allowed |
| `mono` | 13 / 20px | 400 | 0 | Code, source, console, identifiers |

Visual editor typography remains Geist-based and semantic:

| Document role | Size / line | Weight | Notes |
| --- | --- | --- | --- |
| Document title | 32 / 40px | 600 | Maximum in the editor; not a PDF simulation |
| Heading 1 | 28 / 36px | 600 | Starts a major document section |
| Heading 2 | 22 / 30px | 600 | Section hierarchy |
| Heading 3 | 18 / 26px | 600 | Subsection hierarchy |
| Document body | 16 / 26px | 400 | Optimal long-form editing rhythm |
| Caption / footnote | 13 / 20px | 400 | Never below 12px |
| Inline math | 1em / inherited | 400 | Rendered math face supplied by the math renderer |

The compiled PDF always retains the typography chosen by the LaTeX document. Never impose product fonts on PDF output.

### 3.3 Spacing

All layout values use this 4px-derived scale. Values between tokens are prohibited unless required by a 1px border, optical icon alignment, or third-party embedded UI.

| Token | Value | Typical use |
| --- | --- | --- |
| `space-0` | 0 | Reset |
| `space-1` | 4px | Icon/text micro-gap, compact inset |
| `space-2` | 8px | Control gap, menu inset |
| `space-3` | 12px | Row padding, form gap |
| `space-4` | 16px | Standard panel padding |
| `space-5` | 20px | Dense section separation |
| `space-6` | 24px | Page gutter, dialog padding |
| `space-8` | 32px | App section separation |
| `space-10` | 40px | Large app separation |
| `space-12` | 48px | Compact marketing band |
| `space-16` | 64px | Marketing section, mobile hero |
| `space-24` | 96px | Desktop marketing section |
| `space-32` | 128px | Maximum hero breathing room |

Application density uses `4–16px` most often. Marketing uses the same scale but may use `48–128px` between major narrative sections. Do not copy marketing spacing into application pages.

### 3.4 Borders

- Default width: `1px`.
- Default style: solid.
- Use `border-subtle` for region dividers, `border-default` for controls and containers, and `border-strong` for emphasized boundaries or drag handles.
- Use `2px` only for focus outlines, current insertion targets, selected resizers, and active collaborator cursors.
- Do not stack a border and a divider at the same boundary.
- Do not use colored borders to decorate cards.

### 3.5 Radius

| Token | Value | Use |
| --- | --- | --- |
| `radius-none` | 0 | Dividers, table regions, full-bleed panels |
| `radius-sm` | 4px | Tags, code tokens, tiny status surfaces |
| `radius-control` | 6px | Buttons, inputs, menu items, tabs |
| `radius-panel` | 10px | Popovers, dialogs, bounded content panels |
| `radius-showcase` | 16px | Marketing product frames and large media only |
| `radius-full` | 9999px | Avatars, status dots, marketing CTA pills |

Application cards do not default to `radius-panel`; use a divider or flat section first. Nested rounded containers are prohibited.

### 3.6 Shadows and elevation

```css
--shadow-none: none;
--shadow-whisper: 0 1px 2px rgba(0, 0, 0, 0.04);
--shadow-popover: 0 2px 4px rgba(0, 0, 0, 0.05), 0 12px 28px rgba(0, 0, 0, 0.08);
--shadow-dialog: 0 8px 20px rgba(0, 0, 0, 0.08), 0 24px 64px rgba(0, 0, 0, 0.12);
```

| Level | Treatment | Use |
| --- | --- | --- |
| 0 | Surface difference or hairline, no shadow | Pages, sidebars, editor, lists, ordinary panels |
| 1 | Hairline + `shadow-whisper` | Selected or slightly raised content, sticky toolbar |
| 2 | Hairline + `shadow-popover` | Menus, command palette, tooltips, floating selection toolbar |
| 3 | `shadow-dialog` + overlay | Dialogs and blocking approval flows |

Cards never receive shadows merely to look polished. Elevation indicates overlap or modality.

### 3.7 Icons

Use one outline family: **Lucide** through `lucide-react`, at `1.75px` stroke, round caps, and round joins.

- Default app icon: 16px.
- Comfortable control or empty-state icon: 20px.
- Marketing feature icon: 24px maximum.
- Status dots: 8px; avatars: 24, 28, or 32px.
- Icons inherit text color. Semantic icons use the relevant semantic token.
- Important or unfamiliar actions require a visible label. Icon-only actions require a tooltip and accessible name.
- Use custom icons only for genuinely product-specific concepts such as a semantic LaTeX block. Match Lucide geometry and stroke.
- Do not use emoji as interface icons.

### 3.8 Motion

```css
--duration-instant: 80ms;
--duration-fast: 120ms;
--duration-normal: 180ms;
--duration-slow: 240ms;
--ease-standard: cubic-bezier(0.2, 0, 0, 1);
--ease-exit: cubic-bezier(0.4, 0, 1, 1);
```

- Hover and pressed feedback: 80–120ms.
- Menus, popovers, and contextual controls: 120–180ms fade plus at most 4px translation.
- Sheets and panels: 180–240ms.
- Progress indicators may loop, but must not pulse large surfaces.
- Agent steps transition by icon and text, not by celebratory animation.
- Never animate layout for decoration, use exaggerated springs, or delay access to controls.
- Under `prefers-reduced-motion: reduce`, remove translations and looping decoration; retain instant state changes and non-motion status text.

---

## 4. Surface hierarchy and density

### 4.1 Canonical surfaces

1. **Canvas:** near-white outer background.
2. **Primary surface:** white document, content column, input, or intentional bounded region.
3. **Subtle surface:** neutral separation for sidebars, table headers, hover, empty preview wells.
4. **Selected surface:** accent-soft plus an accent icon, label, check, or edge.
5. **Floating surface:** white popover/menu above content with Level 2 elevation.
6. **Modal surface:** white dialog over the overlay with Level 3 elevation.

Do not skip directly from canvas to a dramatic floating card. Avoid placing a rounded surface inside another rounded surface. Within a bounded panel, group content with headings, spacing, and dividers.

### 4.2 Density contexts

| Context | Typical type | Control height | Section rhythm |
| --- | --- | --- | --- |
| Marketing | 16px body, 44–64px display | 40–44px | 64–128px |
| Auth / onboarding | 14–16px | 40px | 24–48px |
| Dashboard / settings | 14px | 32–36px | 24–40px |
| Workspace | 13–14px UI, 16px document | 28–32px | 12–24px |
| Source Mode | 12–14px UI/mono | 28–32px | Embedded editor rules |

Desktop productivity density is deliberate. Touch layouts increase interactive hit areas to 44px without proportionally enlarging type.

---

## 5. Core components

Every interactive component must implement default, hover, focus-visible, pressed, disabled, and loading states where applicable. Selection and validation states are additional, not substitutes.

### 5.1 Buttons

Canonical variants:

| Variant | Treatment | Use | Do not use |
| --- | --- | --- | --- |
| `primary` | Accent fill, white text | One principal action in a region | Repeated row actions or low-commitment choices |
| `secondary` | White fill, default border, primary text | Paired alternative or ordinary form action | As the only visual hierarchy across many actions |
| `ghost` | Transparent; hover uses `bg-hover` | Toolbars, rows, low-emphasis actions | On a busy image without a backing surface |
| `destructive` | Danger fill for final confirmation; danger text ghost before confirmation | Irreversible deletion or revocation | Ordinary errors or cancel actions |
| `link` | Text only, underline on hover | Inline navigation | Primary submit actions |

Sizes:

| Size | Height | Horizontal padding | Icon |
| --- | --- | --- | --- |
| `sm` | 28px | 8px | 14px |
| `md` | 32px | 12px | 16px |
| `lg` | 40px | 16px | 18px |
| `marketing` | 44px | 20px | 18px |

- Radius is `radius-control`; only `marketing` may use `radius-full`.
- Hover darkens a primary button and uses `bg-hover` for neutral buttons.
- Pressed uses the pressed token and may translate `1px` vertically for 80ms.
- Focus-visible uses a 2px accent outline with 2px offset. Do not remove browser focus without replacing it.
- Disabled lowers contrast, blocks pointer events, and retains a readable label. Never use only reduced opacity for a still-interactive control.
- Loading replaces the leading icon with a 14–16px spinner, preserves width, changes the label when useful (`Compiling…`), and sets `aria-busy`.

### 5.2 IconButton

Uses the same variants and heights as Button, with equal width and height. Every IconButton has an accessible name and a tooltip unless the visible surrounding label makes its meaning unambiguous. Destructive icon actions must reveal a text label in menus and require confirmation when irreversible.

### 5.3 Inputs and textarea

- App input height: 32px; auth/onboarding input height: 40px.
- Background: `bg-surface`; border: `border-default`; radius: `radius-control`.
- Horizontal padding: 10px app, 12px comfortable.
- Text: `body`; label above at `label`; helper/error below at `caption`.
- Hover strengthens the border. Focus-visible uses `border-strong` plus the accent focus ring.
- Error uses danger border, an error icon, and explicit message. It does not erase entered content.
- Disabled uses `bg-subtle`, disabled text, and remains legible.
- Textarea minimum height is 88px and grows until a context-specific maximum, then scrolls.
- Placeholder text is an example, not a replacement for a label.

### 5.4 Select, combobox, and search

- Use Select for short closed sets; Combobox for searchable sets; Search for filtering existing content.
- The trigger follows Input sizing. A chevron is always present for Select.
- Search includes a leading search icon, a clear action when populated, and a shortcut hint only when the shortcut works.
- Results show query context and use `No results for “…”` rather than a generic empty state.
- Selecting a result closes single-select menus. Multi-select remains open and exposes checked state textually and visually.

### 5.5 Checkbox, radio, and switch

- Checkbox and radio visual control: 16px with at least a 32px desktop hit wrapper and 44px touch wrapper.
- Checkbox is for independent choices; radio is for one choice from a set; Switch is for an immediately applied setting.
- Switch track: 28×16px compact or 36×20px comfortable. On state uses accent; off uses strong neutral border/fill.
- Labels are clickable. Indeterminate checkbox shows a minus icon and announces `mixed`.
- Do not use a switch for a destructive or submit-required choice.

### 5.6 Tabs and segmented controls

- Tabs switch peer content within the same page. Default style is text on a flat row with a 2px active bottom edge.
- Segmented controls switch compact views such as `Visual / PDF` inside a context panel. They use one subtle background and a bordered selected segment.
- Do not use pill tabs as navigation decoration.
- Tabs support arrow-key movement, Home/End, visible focus, and the correct ARIA tab pattern.
- Source Mode is never a peer tab beside Visual and AI.

### 5.7 Tooltip

- Appears after 400ms pointer dwell or immediately on keyboard focus.
- Uses inverse neutral background, inverse text, `caption`, 6px vertical and 8px horizontal padding, `radius-control`.
- May include a shortcut. It must not contain required instructions or interactive content.

### 5.8 Popover, DropdownMenu, and ContextMenu

- White floating surface, default border, `radius-panel`, Level 2 shadow.
- Standard width: 200–280px; content-driven to a 360px maximum.
- Menu row height: 32px desktop, 40–44px touch.
- Group related actions with spacing or one divider; avoid more than two divider groups.
- Leading icons are optional but consistent within a group. Shortcuts align on the trailing edge in Mono.
- Selected items use a checkmark; destructive items use danger text and live in the last group.
- Arrow keys move, Enter activates, Escape closes, and focus returns to the trigger.

### 5.9 Dialog and Sheet

- Dialog is for focused decisions and blocking forms. Widths: 400px small, 560px standard, 720px review. Maximum height: `min(80vh, 760px)`.
- Dialog padding is 24px; header-to-body gap 16px; action gap 8px. Long content scrolls inside the body while header and footer remain visible.
- Sheet is for persistent contextual work such as comments, references, agent activity, or project settings. Desktop width: 360px default, resizable 320–480px.
- Destructive confirmation names the object and consequence. The final destructive action is explicit (`Delete project`), never `OK`.
- Dialogs and sheets trap focus when modal, close on Escape unless work would be lost, and restore focus on close.

### 5.10 Toast, banner, and inline feedback

- Toast is for completed or transient background events. Width 320–420px, one line of title plus optional detail/action, maximum two simultaneous.
- Success toasts disappear after 5 seconds; undo toasts after 8 seconds; error toasts persist until dismissed or resolved.
- Banner is for page- or workspace-wide states such as offline, permission, or failed sync.
- Inline feedback is preferred for form validation and errors attached to a block or agent step.
- Never report the same event with a toast, banner, and inline message simultaneously.

### 5.11 Badge and status

Badges are compact metadata, not buttons. Height 20–24px, `caption` or `body-compact`, `radius-full`, 6–8px horizontal padding. Neutral is default. Semantic badges use a soft background, matching text, an icon or dot, and a text label. Status copy uses sentence case (`Needs review`, not `NEEDS REVIEW`).

### 5.12 Avatar and AvatarGroup

- Sizes: 24px compact, 28px default, 32px profile or comment.
- Image avatars fall back to initials on a stable presence color.
- Online state uses an 8px dot with a surface-colored 2px keyline.
- AvatarGroup overlaps by 6px maximum and shows at most four avatars plus `+N`.
- Hover/focus reveals name and current location. Never identify a collaborator by color alone.

### 5.13 Breadcrumb

Use for project and settings hierarchy, not every page. Truncate middle items first, preserve the current document, and expose the full path in a tooltip. Breadcrumb items are 13px and the current item is primary text. The separator is a 12px chevron.

### 5.14 Sidebar and NavigationItem

- Sidebar uses `bg-subtle`, a single trailing hairline, and no shadow.
- Navigation row: 32px high desktop, 8px horizontal inset, `radius-control`.
- Default text is secondary; hover uses `bg-hover`; selected uses surface background, primary text, and an optional 2px accent leading edge. Selection never relies on emerald text alone.
- Leading icon 16px; trailing count/status at caption size.
- Row actions appear on hover or focus-within but remain keyboard reachable.

### 5.15 EmptyState, LoadingState, and ErrorState

All share one anatomy: optional restrained icon, direct title, one-sentence explanation, primary recovery action, optional secondary action. They are placed in the empty region without a decorative card unless a boundary is necessary to explain the region.

### 5.16 FileItem

Files are advanced objects. FileItem appears only in Source Mode, asset management, or a file picker. Use a 32px row with file-type icon, truncated name, optional modified state, and contextual actions. Never use `.tex` file rows as the primary project dashboard representation.

---

## 6. Application architecture and navigation

### 6.1 Application shell

Canonical measurements:

```css
--app-topbar-height: 48px;
--app-sidebar-width: 232px;
--app-sidebar-collapsed-width: 48px;
--project-sidebar-width: 216px;
--context-panel-width: 360px;
--context-panel-min-width: 320px;
--context-panel-max-width: 480px;
--pdf-panel-default-width: 520px;
--document-column-width: 760px;
--document-text-width: 680px;
--settings-content-width: 680px;
--marketing-content-width: 1200px;
```

The top bar is white, 48px high, and separated with a hairline. It contains location/breadcrumb, document save/compile status, collaborator presence, Share, and contextual view actions. It does not contain a dense IDE menu bar.

The product-level sidebar is 232px on dashboard/settings surfaces. The project workspace uses a 216px project sidebar or a collapsed 48px rail. Sidebars are independently scrollable; the primary document remains centered in available space.

Panels are resizable only when extra width changes their usefulness. Resize handles have a 1px visible divider and a 6px hit target. Double-click restores default width. Store user width preferences per device.

### 6.2 Navigation model

Product-level navigation:

1. Home
2. Recent
3. All projects
4. Shared with me
5. Favorites
6. Templates
7. Inbox

Workspace/team switcher sits above the list. Account, preferences, billing, and help sit at the bottom or in the account menu.

Project-level navigation:

1. Document
2. References
3. Figures & assets
4. Comments
5. History
6. Collaborators
7. Project settings
8. divider
9. Source / Advanced

Outline belongs beside or within Document, not as a competing product area. Source / Advanced is always separated, labeled, and lower in priority.

Document-level navigation uses an outline of title, sections, subsections, figures, tables, and appendices. It is structural, not file-based. Selecting an item scrolls and focuses its semantic block. Unsaved or changed states attach to the document title, not raw files.

### 6.3 Global search

Global search is available from the sidebar and Command Palette. Results group Projects, Documents, People, Comments, and References. Each result shows title, project/context, matching excerpt, and last activity where useful. Keyboard arrows traverse one continuous result list; group headings are not focusable.

Search opens results after two characters, debounces network work, preserves the query when navigating back, and supports a recent-search state. Permissions filter results before display; never reveal inaccessible document titles in snippets.

---

## 7. Marketing surfaces

Marketing is more spacious than the application but uses the same tokens, type families, controls, and neutral discipline.

### 7.1 Global marketing layout

- Header: 64px, white/near-white, 1200px centered content, no heavy shadow.
- Page gutter: 24px mobile, 32px tablet, 40px desktop.
- Section width: 1200px maximum; reading copy 640px maximum.
- Section spacing: 64px mobile, 96px standard desktop, 128px only for the hero or final CTA.
- Hero: 64px display maximum, short explanatory copy, one primary and at most one secondary action.
- Product frames: real or faithful product UI in a `radius-showcase` frame with a hairline and whisper shadow.

The product, not abstract AI decoration, is the visual protagonist. Demonstrations should show intent flowing to a structured agent run, a visual document change, citations, and a compiled PDF. Do not use floating prompt bubbles, glowing orbs, mesh gradients, fake code streams, or generic AI sparkle motifs.

### 7.2 Landing page narrative

Recommended order:

1. **Hero:** focus on research and writing while Easy LaTeX handles typesetting mechanics.
2. **Primary product demonstration:** ask AI to build or improve an academic section; show concise steps and reviewable changes.
3. **Visual editing:** semantic document editing without syntax.
4. **Academic workflows:** verified citations, equations, tables, figures, and compilation recovery.
5. **Collaboration:** comments, presence, shared AI runs, and history.
6. **Advanced control:** Source Mode shown as optional depth, not the hero.
7. **Templates / trust / final CTA.**

Feature sections use open layouts or one shared product frame. Do not wrap every paragraph in a card. Avoid generic three-card feature grids unless the content genuinely forms three peers.

### 7.3 Pricing marketing

Pricing tiers may use a restrained comparison grid. The recommended tier is distinguished by `bg-subtle`, an accent badge, and primary CTA—not a bright border or oversized card. Feature comparison becomes an accordion on mobile. Pricing language must make AI usage units, collaboration limits, storage, and compiler limits explicit.

---

## 8. Authentication and onboarding

### 8.1 Sign in, sign up, and recovery

- Use a single centered column, 400px maximum, with 24px mobile gutters.
- Place brand/product context above the form. Do not create a large marketing split-screen by default.
- Auth fields are 40px high with visible labels. Place password reveal inside the field as an IconButton.
- Primary action spans the form width. Social/SSO actions are secondary and separated by a labeled divider.
- Errors are inline and retain entered email. Authentication failures use safe, non-enumerating copy.
- Password recovery confirms that instructions were sent without revealing account existence.
- Loading preserves button size and disables duplicate submission.

### 8.2 Onboarding

Onboarding should get the user to a meaningful document quickly. Use at most four visible steps:

1. name/profile and optional organization;
2. writing goal or document type;
3. create from a prompt, import, or choose a template;
4. optional collaborator invitation.

The primary onboarding surface is an intent prompt: `What are you writing?` with examples such as a paper, thesis chapter, report, or CV. Template and import are adjacent alternatives. A small progress label (`Step 2 of 4`) is sufficient; do not use oversized step cards.

### 8.3 First-project creation

Offer three peer paths:

- **Describe it to AI** — recommended and visually primary.
- **Use a template** — browse academic templates.
- **Import existing work** — upload `.tex`, `.zip`, BibTeX, or supported document formats.

Before creation, collect only the minimum required information. Advanced compiler, engine, or package choices belong under `Advanced options`, collapsed by default. After creation, open the visual document with the Intent Bar focused and an unobtrusive agent suggestion tailored to the chosen path.

---

## 9. Project dashboard and templates

### 9.1 Dashboard

The dashboard is a document/project workspace, never an analytics dashboard.

Canonical composition:

- 232px product sidebar;
- top row with `Projects`, Search, and one `New project` primary action;
- `Continue writing` or Recent projects first;
- compact filters for All, Mine, Shared, and Favorites;
- project list or preview grid selected by the user;
- a short template strip after recent work;
- relevant collaboration activity as a plain list, not a feed of cards.

Do not add KPI cards, charts, usage graphs, or administrative widgets to Home. Usage belongs in Billing / Usage.

Project row anatomy: document icon/thumbnail, title, optional organization, collaborators, last edited time, compile status only when actionable, favorite control, and overflow menu. The entire row opens the project. Destructive actions live only in the overflow menu and require confirmation.

Recent, All, Shared, and Favorites use the same canonical row/grid component and filters. Empty filters explain the state and provide one relevant action.

### 9.2 Template gallery

Academic categories include Research paper, Thesis, Dissertation, Conference paper, Journal article, IEEE, ACM, CV, Report, Poster, and Presentation.

- Gallery header contains search and category filters.
- Grid: four columns wide desktop, three laptop, two tablet, one mobile.
- Template tile has a 4:5 document preview, title, institution/publisher where relevant, and compact metadata. It is flat or hairline-bounded; no decorative gradient.
- Official format badges are neutral and factual.
- Hover reveals `Preview` and `Use template`; keyboard focus reveals the same actions.

Template detail uses a large document preview with a 360px information column. Show included structure, document class, compiler compatibility, package requirements, last update, and accessibility notes. `Use template` is primary; `Preview PDF` is secondary. Do not require Source Mode to understand a template.

---

## 10. Primary workspace

### 10.1 Canonical workspace layout

From left to right:

1. project navigation or collapsed project rail;
2. primary visual document canvas;
3. optional contextual panel for the active task, comments, references, agent activity, or PDF.

The document gets the largest stable area. Do not open the PDF or agent panel by default merely because space exists. Only one ordinary right context panel is open at a time; PDF comparison may intentionally create a second pane on wide screens.

The top bar contains breadcrumb, save state, compile state, avatars, Share, a PDF action, and overflow. It does not contain AI/Visual/Source peer tabs.

### 10.2 Intent Bar: primary AI entry

The Intent Bar is the primary workspace control, not a chat sidebar. It sits above the document column when the workspace first opens and can collapse into a compact `Ask AI…` command row after use.

Anatomy:

- optional scope chip (`Document`, `Selection`, `Section: Methods`);
- auto-growing prompt field;
- attachment/context action;
- primary submit action;
- one row of context-sensitive suggested actions when the field is empty.

Default width follows the document column. Height is 44px collapsed and up to 160px expanded. `Mod+J` focuses it. `Mod+Enter` submits while focused. The bar never contains a bot avatar, greeting, or message bubbles.

### 10.3 Context panel

Context panel header names the current function (`Agent activity`, `Comments`, `References`, `PDF`). It has close and optional overflow actions. Panel content may be pinned; otherwise selecting another contextual function replaces it. Preserve drafts and scroll state when switching.

### 10.4 Document outline

Outline is a narrow structural tree inside the project sidebar or a context panel. It shows semantic headings and numbered figure/table entries. Active section follows scroll with a short delay to avoid jitter. Drag reorder is available only when the structure can be moved safely; otherwise offer `Move section` through AI or a menu.

### 10.5 Figures and assets

Figures & assets is a searchable list/grid with thumbnail, filename/title, type, usage count, and upload/replace actions. Referenced assets cannot be deleted silently. Deletion explains affected figures and offers replace or remove-reference options. AI-generated assets are labeled with provenance and follow the same approval rules as document changes.

### 10.6 Document and version history

History is a chronological list grouped by day. Entries name the actor, summary, scope, and timestamp. Agent runs appear as one grouped event with expandable steps, not dozens of edits.

Version history opens a side-by-side or inline semantic diff. Restore creates a new version; it never erases subsequent history. Named versions support a short label and optional description. Source-level diff is available from an advanced action.

---

## 11. AI agent experience

AI is ambient and contextual. Entry points include the Intent Bar, selection toolbar, slash menu, block menu, command palette, empty states, compilation errors, references, figures, and review flows. These entry points all launch the same AgentRun model.

### 11.1 AIInput

AIInput uses Input/Textarea foundations plus scope and context. It must always make the target clear before submission. If scope is ambiguous, default to the smallest reasonable scope and show it as a removable chip.

Examples of contextual actions:

- selected prose: Rewrite, Make more academic, Make concise, Expand, Add citation, Comment;
- equation: Explain, Edit equation, Convert form, Add explanation;
- figure: Replace, Edit caption, Describe, Open source;
- table: Add row/column, Summarize, Edit caption, Convert data;
- compile error: Explain, Fix safely, Open source, View log.

### 11.2 AIAction

AIAction is a compact, verb-led command with optional icon and shortcut. It never impersonates a conversation. Use specific labels (`Add citations`, `Restructure section`) rather than `Improve with AI`. Actions that will immediately mutate content include scope in the confirmation or preview.

### 11.3 AgentRun anatomy

An AgentRun contains:

1. concise verb-led title (`Updating Related Work`);
2. scope and initiator;
3. current status;
4. compact step list;
5. changes or result summary;
6. required decision or completion actions;
7. timestamp and optional `View details`.

Preferred progress:

```text
Updating Related Work                         Editing
✓ Read document structure
✓ Checked bibliography
✓ Updated 3 paragraphs
✓ Added 4 citations
● Compiling
```

Do not narrate plans conversationally. Hide internal tool names, tokens, model routing, chain-of-thought, and raw system logs. Translate tool use into user-meaningful steps such as `Searching Crossref` or `Checking bibliography`.

### 11.4 Agent states

| State | Visual | Copy and behavior |
| --- | --- | --- |
| Queued | Clock icon, neutral | `Queued`; show position only if meaningful; Cancel available |
| Reading | Spinner, neutral | Names the scope being inspected; no document mutation |
| Editing | Animated status dot, info | Shows affected section/count as known; Cancel stops future steps |
| Compiling | Spinner, neutral | Shows pass or page count when useful; links to log only on issue |
| Waiting for user | Question icon, warning soft | One clear question and explicit options; run pauses safely |
| Needs review | Review icon, warning soft | Shows impact and number of proposed changes |
| Completed | Check icon, success soft | Outcome summary, Review changes if any, Undo if applied |
| Partial failure | Warning icon | Separates successful/applied work from failed steps; Retry failed step |
| Failed | Error icon, danger soft | Plain-language cause, preserved work, Retry or recovery action |
| Cancelled | Stop icon, muted | States what, if anything, was already applied; Resume if safe |

Only the current step may animate. Completed steps use static checks. Collapse completed runs to a one-line summary after the user leaves the context; keep them in history.

### 11.5 Agent question and suggestion

An AgentQuestion is blocking: one question, short supporting context, and two to four direct responses or a freeform field. It visually belongs to the run and announces itself with `aria-live="polite"` once.

An AgentSuggestion is non-blocking: a one- or two-line recommendation with `Apply`, `Ask why`, or Dismiss. Suggestions may appear after a relevant event but never repeatedly after dismissal. They must not cover document text.

### 11.6 Shared agent actions

Runs show initiator identity and are visible to collaborators with access to affected content. High-impact approval records who approved. Two overlapping mutating runs must either serialize, operate on independent scopes, or pause with a conflict explanation. Never silently apply the later run over earlier collaborator edits.

---

## 12. AI change and approval UX

### 12.1 Impact levels

| Impact | Examples | Default behavior |
| --- | --- | --- |
| Low | Grammar, punctuation, formatting correction, small wording edit in one block | May auto-apply when explicitly requested and preference allows; always mark and provide Undo |
| Medium | Multiple-block rewrite, added citations, new table/figure, section expansion | Stage changes and open a compact review before apply; user may `Accept all` |
| High | Delete/move sections, substantial rewrite, replace citations, bibliography restructuring, macro/package/file changes | Never auto-apply; require explicit review and approval with scope summary |

If impact is uncertain, choose the higher level. User instructions such as `apply directly` may lower friction for low/medium changes but never bypass high-impact review or source-safety checks.

### 12.2 AgentChange states

- `proposed → accepted/applying → applied → reverted`
- `proposed → rejected`
- Any applying state may become `conflict` or `partial failure`.

Each change records actor, run, timestamp, target, impact, applied state, and reversible history operation. A summary must answer what changed, where, and whether it is already applied.

### 12.3 Inline markers

- Changed block: 2px gutter line plus a small change icon outside the text column.
- Proposed change: warning-colored gutter and `Proposed` label on focus/hover.
- Applied AI change: accent gutter and `Applied by AI` label on focus/hover.
- Collaborator edit and AI edit are visually distinct through icon and label, not merely color.
- Markers fade from persistent to history-only after review or the current session, but remain accessible in version history.

Markers must not shift text width or interrupt reading. Selecting a marker opens the change review anchored to that block.

### 12.4 AgentDiff

Visual Mode shows semantic diffs:

- prose: word-level additions/removals within readable paragraphs;
- structure: before/after outline with moved, added, and removed blocks;
- citations: old/new citation chips with source metadata;
- table/figure: property and content changes, not serialized LaTeX;
- source-only constructs: rendered preview plus a clearly labeled source diff.

Additions use added background and underline/plus label. Removals use removed background and strike-through/minus label. Modifications use info treatment. Screen readers receive inserted/deleted labels and a linear before/after representation.

### 12.5 AgentApproval

Approval header states impact, scope, and count (`High impact · 2 sections · 14 changes`). Actions:

- `Accept` / `Reject` for one change;
- `Accept all` / `Reject all` for the visible run;
- `Review later` when changes can remain staged safely;
- `Undo` after application;
- `Retry` only for failed work.

High-impact `Accept all` requires a summary view first. A deletion confirmation names removed sections or references. Never preselect destructive acceptance.

After apply, show an 8-second Undo toast and retain undo in History. Undo creates a new history entry and warns before overwriting subsequent conflicting edits.

---

## 13. Visual editor and document blocks

### 13.1 Editor philosophy and geometry

The visual editor is WYSIWYM: it represents semantic meaning, not final PDF pagination. It must be comfortable for continuous writing while exposing structure that maps safely to LaTeX.

- Editor surface: white on canvas, no simulated sheet shadow in the normal writing view.
- Document column: 760px; text measure: 680px maximum.
- Vertical content padding: 48px laptop, 64px wide desktop, 24px mobile.
- Block gap: semantic by type, using spacing tokens; paragraphs do not become cards.
- Page boundaries appear only in PDF or an explicit paginated preview.
- Autosave state lives in the top bar and is announced only on failure or meaningful delay.

### 13.2 Block interaction

Every block has a stable semantic ID. On pointer hover, show a subtle gutter handle and relevant quick action. On keyboard focus, expose the same actions through a reachable block menu. Dragging is allowed only for structures that can move without invalidating source; otherwise provide AI-assisted move.

The selection toolbar appears above or below the selection without covering it. Order frequent actions: formatting, Comment, Ask AI, More. Ask AI may be visually emphasized with an accent icon but the toolbar itself remains neutral.

Typing `/` at an empty block opens the insertion menu. Typing `@` opens mention/reference suggestions according to context. These triggers must not activate inside source or ordinary inline math input unexpectedly.

### 13.3 Canonical document blocks

| Block | Visual representation | Primary contextual actions |
| --- | --- | --- |
| Heading | Semantic hierarchy, optional numbering indicator | Rename, move, Ask AI, link, comment |
| Paragraph | 16/26px document body | Format, comment, Ask AI, convert |
| List | Ordered/unordered semantic list with nesting guides on focus | Change type, indent/outdent, Ask AI |
| Quotation | 2px neutral leading rule; no card | Cite, convert, Ask AI |
| Code | Subtle surface, Mono, language label | Copy, change language, open source |
| Inline math | Rendered expression with source edit popover | Explain, edit, convert |
| Display equation | Centered rendered math with equation number when present | Explain, edit, label/reference, open source |
| Citation | Compact semantic chip in prose | Inspect source, replace, add locator, open reference |
| Cross-reference | Labeled target chip | Open target, change target, repair broken link |
| Figure | Asset preview, semantic caption and label | Replace, crop where safe, caption, reference, Ask AI |
| Table | Accessible grid editor, caption, label | Add/remove row/column, align, caption, Ask AI |
| Caption | Connected to owning figure/table | Edit, generate, citation, comment |
| Bibliography | Generated semantic list or configured style summary | Add/import reference, style settings |
| Raw/custom LaTeX | Rendered or source-preserving fallback block | Open source, copy source, retry parse |

### 13.4 Inline formatting

Bold, italic, link, code, citation, cross-reference, subscript, and superscript use a single selection toolbar and keyboard-native semantics. Do not expose LaTeX commands in labels. A link editor shows text and URL with open/remove actions. Invalid formatting combinations must be prevented or represented as a lossless custom span.

### 13.5 Unsupported LaTeX

Unsupported constructs are never silently normalized, flattened, or dropped. Choose the safest representation in this order:

1. rendered custom block with a plain-language type label;
2. read-only preview with `Open in Source`;
3. raw LaTeX block with preserved source;
4. explicit warning when no safe render is possible.

Examples include custom macros, custom environments, TikZ, package-specific syntax, and uncommon environments. A fallback block displays whether Visual Mode can move, duplicate, or delete it safely. Editing adjacent supported blocks must not rewrite the unsupported source region. Round-trip tests are mandatory for all supported and fallback block types.

---

## 14. Contextual actions

Context controls are progressive disclosure, not hidden functionality. Every hover-only action must also be available by keyboard, focus, or a menu.

| Context | Quick actions | Overflow |
| --- | --- | --- |
| Text selection | Format, Comment, Ask AI | Link, citation, convert, copy |
| Equation | Explain, Edit, Add explanation | Number, label, source |
| Figure | Replace, Edit caption, Ask AI | Download, reference, source, delete |
| Table | Add row, Add column, Ask AI | Alignment, caption, source, delete |
| Citation | Open reference, Add locator | Replace, suppress author/year, remove |
| Compile error | Fix with AI, Explain | Open log, open source, copy details |

Place destructive actions last. Keep the quick row to four visible actions maximum. Use specific labels and preserve the user's selection while menus are open.

---

## 15. Collaboration and comments

### 15.1 Presence

- Top bar AvatarGroup shows collaborators currently in the project.
- The document shows remote caret and selection only while the collaborator is active nearby.
- A caret label with the collaborator's name appears briefly on movement/focus, then reduces to the colored caret.
- Avoid persistent large name flags or multiple overlapping selection fills.
- Presence status distinguishes `Viewing`, `Editing`, and `Offline` in text where relevant.

### 15.2 Concurrent editing

Remote changes animate only as a short neutral highlight. Never move the local user's cursor because of remote edits. If two edits conflict, preserve both when possible and show a conflict block with author, timestamp, and resolution choices. Saving and sync state are document-level, not per-user badges scattered through the page.

### 15.3 CommentThread

Comments attach to stable text ranges or semantic blocks. A highlighted range uses a low-alpha collaborator color and a gutter comment icon. The comments panel opens to the selected thread.

Thread anatomy: author/avatar, timestamp, quoted context, message, replies, reaction/mention support if implemented, Resolve, and overflow. Reply input is compact and expands on focus. Resolved threads collapse and remain available through a filter. Reopening records the actor.

Mentions autocomplete accessible project members and notify according to permissions. Assigned comments add an assignee chip and open/resolved state, but assignment is optional and should not turn writing into issue tracking.

### 15.4 Permissions

Canonical roles: Owner, Editor, Commenter, Viewer. Every invitation and share surface explains the effective permission in plain language. Disabled editing UI includes the reason. Viewers do not see inert edit toolbars; Commenters see only comment-capable controls.

---

## 16. References and citations

References are first-class semantic data, not just text in a `.bib` file.

### 16.1 Reference manager

Use a list/detail layout. Each row includes title, authors, year, venue, verification/source state, usage count, and overflow. Search spans title, author, DOI, key, and venue. Duplicate detection appears before import and offers merge with a field-level comparison.

The detail view exposes human-readable fields first and a collapsed BibTeX/source section for advanced users. Changes that could break citation keys show affected citations before apply.

### 16.2 Citation insertion

`Add citation` opens a searchable combobox with recent references, library matches, and an explicit `Find sources with AI` action. A result shows enough metadata to distinguish it. Inserting creates a semantic Citation chip, not raw `\cite{}` text.

AI-found sources must show provenance and verification state. Suggested metadata is never presented as verified merely because the agent generated it. Unverified citations require confirmation before final insertion or are clearly labeled in document review.

Broken, missing, or ambiguous citations use warning treatment and direct recovery actions: Find reference, Relink, or Open source. Never silently invent a source or citation key.

---

## 17. PDF preview and compilation

### 17.1 PDF forms

PDF is contextual and supports:

- collapsed status/action;
- resizable right-side preview;
- temporary quick preview;
- full-page focused preview;
- visual/PDF comparison;
- Source/PDF comparison in Advanced Mode.

Do not force a permanent 50/50 split. On first open, the right preview uses 520px or 40% of workspace width, whichever is smaller while preserving at least 600px for the document. Users may resize to 420–720px.

### 17.2 PDFPanel

Header: title/status, current page / total, zoom, fit control, open full view, close. Page controls remain visible while the document scrolls. Zoom steps are 75, 90, 100, 110, 125, 150, and Fit width/page.

Forward sync from a visual/source block highlights the destination PDF region briefly. Reverse sync from PDF selects the closest safe semantic block; when ambiguous, show likely targets instead of jumping unpredictably.

### 17.3 Compilation states

| State | Treatment | Behavior |
| --- | --- | --- |
| Not compiled | Neutral | `Compile` action |
| Queued | Clock | Cancel if meaningful |
| Compiling | Spinner + `Compiling` | Keep last successful PDF visible with stale label |
| Success | Check + `PDF updated` | Reduce to quiet top-bar status after 3 seconds |
| Warnings | Warning icon + count | PDF remains usable; open summarized issues |
| Error | Error icon + `Compilation failed` | Keep last PDF, show first actionable issue and Fix with AI |
| Stale | Neutral clock | State that PDF predates current edits |

Compilation errors are translated into plain language, grouped by likely root cause, and linked to affected content. Raw logs are available under `Technical details` or Source Mode. Never replace the user's document with a failed generated version.

---

## 18. Command palette and keyboard UX

### 18.1 CommandPalette

`Mod+K` opens a centered palette, 640px wide, up to 70vh. It includes a search field and grouped results for AI, document, navigation, collaboration, and settings. Recent and context-relevant actions appear before generic navigation.

High-value commands include Ask AI, Ask AI about selection, Rewrite, Add citation, Insert figure, Insert table, Compile, Open PDF, Search document, Search projects, Invite collaborator, View history, Open settings, and Open Source / Advanced.

Commands are verb-led, show scope when relevant, and display shortcuts on the trailing edge. Destructive commands require their normal confirmation after selection. The palette is not a substitute for the primary Intent Bar.

### 18.2 Canonical shortcuts

| Shortcut | Action | Scope |
| --- | --- | --- |
| `Mod+K` | Open Command Palette | Product shell |
| `Mod+J` | Focus Ask AI / ask about selection | Workspace |
| `Mod+Enter` | Submit prompt | AIInput focused |
| `Mod+Shift+C` | Compile | Workspace |
| `Mod+Shift+P` | Toggle PDF preview | Workspace |
| `Mod+Z` / `Mod+Shift+Z` | Undo / redo | Active editor context |
| `/` | Insert block menu | Empty Visual Editor block |
| `Esc` | Close top transient layer | Global |

Do not add a shortcut without command-palette discoverability and conflict review. Source Mode may own keystrokes while its embedded editor is focused; the surrounding shell must not intercept standard editor shortcuts unexpectedly.

---

## 19. Source / Advanced Mode

Source Mode is an expert capability powered by code-server and LaTeX Workshop. It is not the product's visual center.

### 19.1 Discovery and entry

- Place `Source / Advanced` after a divider at the bottom of project navigation.
- Contextual fallback blocks and compilation details may offer `Open in Source` at the exact construct or line.
- The first entry shows a concise explainer: direct LaTeX editing, advanced tools, and the possibility of changes not representable visually.
- Do not promote Source Mode during ordinary onboarding.

### 19.2 Advanced shell

Keep the Easy LaTeX top bar visible above the embedded editor with project identity, save/compile state, collaborators, PDF, and a clearly labeled `Back to Visual Editor` action. A compact `Advanced Mode` label distinguishes the environment without recoloring the entire product.

code-server may use its own editor theme and density within the embed, but the surrounding shell remains this design system. Do not imitate VS Code elsewhere to make the transition feel uniform.

### 19.3 Round trip and exit

Source edits update the parsed visual model only after a safe parse checkpoint. If new unsupported constructs appear, preserve them as fallback blocks. Before exit, show only actionable parse/compile issues; do not block exit merely for warnings. Return the user to the last relevant visual block when mapping is possible.

Raw files, Git, terminal, packages, and logs exist inside Advanced Mode or explicit advanced panels. They never replace document-first navigation in the default workspace.

Mobile Source Mode is read-only or explicitly unsupported beyond simple raw-text inspection. Explain the limitation and offer desktop continuation.

---

## 20. Settings patterns

Settings use a 220px local navigation column and a 680px content column. Page title is `page-title`; sections use `component-title`, description, fields, then a divider. Do not wrap every section in a card.

- Apply simple switches/selects immediately and confirm quietly.
- Forms with dependent fields use one Save action in a sticky or clearly visible footer.
- Unsaved navigation prompts only when work would be lost.
- Dangerous operations live in a final `Danger zone` section with neutral framing and danger action, not a large red panel.

### 20.1 Project settings

Sections: General, Document defaults, Compiler, AI behavior, Collaboration, Permissions, Integrations, and Danger zone. Compiler choices expose engine and advanced arguments progressively. Changing compiler or document root explains impact and may trigger a test compile.

### 20.2 Account settings and preferences

- **Account:** profile, email, password/security, sessions, and account deletion.
- **Preferences:** language, time zone, notifications, accessibility, editor density, default document behavior, PDF behavior, and keyboard hints.
- **AI:** allowed data/context, default review policy, low-impact auto-apply preference, model/usage choice if product-supported, and history/privacy controls.

Do not imply that disabling UI hints disables safety review. High-impact approval remains mandatory.

### 20.3 Team / organization

Team pages cover members, groups if supported, invitations, default project permissions, integrations, billing ownership, and audit activity. Member rows show name, email, role, status, and overflow. Role changes explain inherited access before apply.

Invitations use a compact table with email, intended role, inviter, sent/expiry date, and Resend/Revoke. Bulk invites validate individually and preserve valid rows when others fail.

### 20.4 Collaboration and permission settings

The share dialog starts with invitee entry and role select, then lists existing access. Link sharing is a separate controlled row with Off / Restricted / Anyone with link states if supported. Each state describes whether viewers can comment, download, or duplicate. Copy link confirms via a quiet toast.

Permission downgrade or collaborator removal summarizes affected access. Ownership transfer requires explicit identity confirmation and cannot be bundled with another change.

---

## 21. Notifications, inbox, and activity

Use compact rows grouped by Today, Earlier this week, and Older. Row anatomy: actor/status icon, one-line event, context, timestamp, unread indicator, and relevant quick action.

Supported events include mentions, comment replies, assigned comments, shared projects, invitations, AI completion requiring review, document updates, and compilation problems requiring action.

- Unread uses a small accent dot plus stronger text.
- Clicking navigates to the exact comment, change, or document region.
- Similar passive events are grouped (`Mina and 3 others edited Methods`).
- AI step-by-step progress is not a notification stream; only completion, failure, or needed input enters Inbox.
- Compilation success is not an inbox event. Repeated non-actionable events are suppressed.
- Filters: All, Mentions, Comments, Reviews, and System.

Activity within a project follows the same row component and grouping but may include full history. Avoid notification cards and celebratory icons.

---

## 22. Billing and usage

Billing uses Settings layout, not the project dashboard.

Sections:

- current plan and renewal;
- AI usage with clear unit definition and reset date;
- storage/compilation limits where applicable;
- seats and member count;
- payment method;
- invoices;
- change/cancel plan.

Use progress bars only for real limits. A progress bar includes used, limit, unit, and reset period in text. Neutral below 70%, warning at 70–89%, danger at 90%+ or product-defined critical threshold. Do not use decorative charts.

Plan comparison uses a table or restrained tier grid. Upgrade is primary only when the user intentionally enters an upgrade flow. Cancellation explains timing and retained access without guilt-oriented design.

---

## 23. Shared, public, and read-only views

Read-only views prioritize the document. Use a minimal 48–56px header with title, author/project context, permission label, optional collaborators, PDF action, and sign-in/open-in-app action.

- Hide editing, agent mutation, and project administration chrome.
- Show comments only when permission allows.
- Public documents use a centered visual document or focused PDF; preserve author-selected default.
- Viewer mode may expose outline, search, citations, and safe download.
- Commenter mode adds selection/comment controls but no formatting toolbar.
- Expired, revoked, or permission-denied links use a direct full-page state with Request access or Sign in when applicable.
- Do not reveal hidden project names, team members, source files, or history to public viewers.

---

## 24. Empty states

Empty states are task-oriented and specific.

| Context | Title | Primary action |
| --- | --- | --- |
| No projects | `Create your first project` | `Describe it to AI` |
| No document content | `Start with an idea` | Focus Intent Bar |
| No recent projects | `No recent projects` | `View all projects` |
| No shared projects | `Nothing shared with you yet` | None or `Learn about sharing` |
| No comments | `No comments yet` | `Add a comment` only with selection/context |
| No references | `Build your reference library` | `Add reference` |
| No figures | `No figures or assets` | `Upload asset` |
| Empty history | `No earlier versions` | None |
| No search results | `No results for “query”` | `Clear filters` |
| No notifications | `You're all caught up` | None |

Use restrained line icons or a small document illustration. No giant empty-state art, confetti, or decorative cards.

---

## 25. Loading and progress

- Under 400ms: show no spinner to prevent flicker.
- 400ms–3s: use an inline spinner or skeleton matching final geometry.
- Over 3s: add specific progress text and cancellation/retry only when supported.
- Skeletons use `bg-muted`, have no gradients, and respect reduced motion.
- Preserve previous content during refresh; do not replace an entire document with a skeleton.
- Loading a project may stage shell → outline → document, but focus and layout must not jump.
- Agent work uses AgentRun states, not generic page spinners.
- Compilation keeps the last successful PDF visible.
- File upload shows per-item progress, success/failure, and safe retry.

Indeterminate progress never invents percentages. Determinate progress uses real measured work and includes text accessible to screen readers.

---

## 26. Error and system states

### 26.1 Error hierarchy

1. Field/block inline error when the problem is local.
2. Panel banner when the function or context failed.
3. Workspace banner when sync, connection, or permissions affect the whole document.
4. Full-page error only when the surface cannot be used.

Every error says what failed, what was preserved, and what the user can do next. Technical details are collapsed. Avoid blame, raw stack traces, and dramatic red surfaces.

### 26.2 Offline and disconnected

A slim persistent banner states `Offline — edits are saved on this device` or the accurate storage behavior. Continue local visual editing when safe, queue sync, and show queued state. Disable network-only AI/reference actions with an explanation. On reconnect, sync automatically and report only conflicts or failure.

States: `Disconnected`, `Reconnecting…`, `Back online`, and `Sync conflict`. `Back online` becomes a short toast and the banner disappears.

### 26.3 Save failure and conflict

Save failure keeps local content, shows `Not synced`, and offers Retry / Download backup where supported. A conflict never silently chooses one version. Show both actor/timestamps, semantic differences, and Keep mine / Keep theirs / Review merge. For complex or unsupported source conflicts, open Advanced Mode with a preserved backup.

### 26.4 Permission denied

Remove controls the user cannot use when that improves clarity; when the control explains a discoverable capability, leave it disabled with the reason. A blocked page names the required permission and offers Request access, Switch account, or Back where applicable.

### 26.5 Failed AI action

Keep any successfully applied changes identified. State whether failure occurred before or after mutation. Offer Retry failed step, Review applied changes, Undo applied changes, or Open technical details. Never retry a mutating step automatically when it could duplicate content.

---

## 27. Responsive behavior

Canonical breakpoints:

| Token | Width | Purpose |
| --- | --- | --- |
| `sm` | 640px | Large phone |
| `md` | 768px | Tablet portrait |
| `lg` | 1024px | Small laptop / tablet landscape |
| `xl` | 1280px | Standard desktop |
| `2xl` | 1440px | Wide desktop |

### 27.1 Desktop and wide desktop

- `xl+`: full sidebar and document; optional context panel.
- `2xl+`: document plus one context panel comfortably; PDF comparison may open beside it if minimum document width remains.
- Do not expand document text beyond 680px merely because more space exists.

### 27.2 Smaller laptop

At `lg–xl`, collapse project navigation to the 48px rail or let the user toggle it. Context panels overlay or replace the rail if opening them would reduce the document below 600px. PDF opens at roughly 40% width and can switch to full view.

### 27.3 Tablet

Use one primary pane plus an overlay sheet. Document remains primary; AIInput docks above the on-screen keyboard or at the top of the document without obscuring selection. Sidebars become sheets. Touch targets are at least 44px. Advanced multi-panel review becomes sequential.

### 27.4 Mobile

Priority order:

1. read/open document;
2. ask AI and answer agent questions;
3. make simple visual edits and comments;
4. access essential navigation;
5. preview/download PDF.

Use a single-column document, 16px gutters, and bottom sheets for actions. Keep Intent Bar reachable as a compact action near the bottom safe area, expanding above the keyboard. PDF uses full-screen view. Complex table editing and Source Mode may be read-only or deferred to desktop with clear explanation.

Marketing grids collapse to one column below `md`; display hero becomes 44/48px. Auth remains one column. Template previews preserve aspect ratio and never shrink text into illegibility.

---

## 28. Accessibility

Target WCAG 2.2 AA for all product surfaces.

### 28.1 Focus and keyboard

- Every interactive element is keyboard reachable in a logical DOM order.
- Focus-visible uses a 2px `color-focus` outline with 2px offset or equivalent inset treatment where clipping requires it.
- Menus, listboxes, tabs, dialogs, trees, and comboboxes implement their established ARIA keyboard patterns.
- Skip links move to main content and, in the workspace, to the document editor.
- Hover-revealed controls appear on `focus-within` and remain reachable.
- Drag actions have menu/keyboard alternatives.

### 28.2 Contrast and state

- Body text and controls meet 4.5:1; large text meets 3:1; meaningful component boundaries and focus indicators meet 3:1 against adjacent colors.
- `text-disabled` is never used for required instructions or active content.
- Color is never the sole signal. Pair with icon, shape, label, pattern, or position.
- Error and success announcements name the affected item.

### 28.3 Screen readers and live regions

- Use semantic headings and landmarks; do not style generic divs as controls.
- IconButtons have names; status-only icons are hidden if adjacent text already names the state.
- Agent progress uses one polite live region for meaningful step changes. Do not announce spinner frames or every token/operation.
- Compilation completion/failure and save failure are announced; routine autosave success is not.
- Diffs expose insertion/deletion semantics and a linear before/after alternative.
- Collaborator cursors announce only entry into the user's current region, not every movement.

### 28.4 Editor accessibility

Document blocks expose semantic roles and hierarchy. Equations include MathML or an accessible textual representation. Figures require alt text status; AI-generated alt text is marked for review. Tables provide header associations and keyboard cell navigation. Citations announce author/year or configured citation label plus reference action.

### 28.5 Target size and motion

Desktop compact controls may render at 28–32px but maintain at least a 32px interaction wrapper. Touch targets are at least 44×44px with 8px separation where practical. Respect reduced motion and user zoom to 200% without losing actions or forcing two-dimensional page scrolling outside large data/PDF content.

---

## 29. Canonical layout patterns

| Pattern | Structure | Constraints |
| --- | --- | --- |
| Marketing page | Header → hero → narrative sections → product proof → CTA → footer | 1200px max; 64–128px vertical rhythm; product UI over decoration |
| Auth | Centered 400px form column | 24px gutter; 40px controls; no unnecessary split view |
| Onboarding | Centered 680px step column | Four steps maximum; intent first; advanced options collapsed |
| Dashboard | 232px sidebar + fluid content | Recent work first; no KPI grid; 1200px content max |
| List management | Page header + filters + flat list/table | Dividers between rows; overflow actions; empty state in place |
| Settings | 220px section nav + 680px form | Flat sections with dividers; one save model per page |
| Visual workspace | 216px project nav + centered document + optional 360px context | Preserve 600px document viewport; no forced PDF split |
| Review workspace | Document/diff + 360–480px approval panel | Scope and impact always visible; high-impact summary first |
| Full PDF | Minimal toolbar + centered page viewport | Persistent page/zoom controls; outline optional |
| Public viewer | Minimal header + centered document/PDF | Hide edit chrome; permission-specific comment actions only |
| Source / Advanced | Product top bar + embedded code-server | Back to Visual always visible; product shortcuts scoped safely |

### 29.1 Tables and lists

Prefer a list for rich project/document rows and a table for consistently comparable data. Table headers use `label` on `bg-subtle`, 40px minimum height. Body rows are 44–56px with one divider. Numeric values align right; actions align right; names align left. On narrow screens, convert to labeled stacked rows, not horizontally compressed unreadable tables.

### 29.2 Cards

Use a card only when an item is independently selectable, portable, previewable, or meaningfully bounded—template previews, pricing tiers, product demonstrations, and modal review summaries qualify. Settings sections, ordinary page sections, list rows, agent steps, comments, and paragraphs generally do not.

---

## 30. Component usage rules

1. Search for an existing primitive or product pattern before creating a component.
2. Product components compose primitives and semantic tokens; they do not introduce private color, radius, or shadow systems.
3. A variant must represent a repeated semantic distinction, not one screen's aesthetic preference.
4. Size variants use the canonical control heights. Do not add `mediumCompact`, `slightlyLarge`, or pixel-specific variants.
5. Controlled and uncontrolled behaviors, focus restoration, loading, errors, and disabled semantics must be defined in the component API.
6. Contextual actions use the same Button/Menu components as persistent actions.
7. Do not overload badges as buttons, buttons as tabs, popovers as dialogs, or toasts as error logs.
8. Product-specific patterns—AIInput, AgentRun, AgentDiff, AgentApproval, DocumentBlock, CommentThread, PresenceIndicator, PDFPanel—must have Storybook/examples for every state before reuse.
9. Third-party embeds are visually bounded and labeled; do not restyle the product shell to match them.

---

## 31. Do / Don't

### Do

- Use semantic design tokens and canonical components.
- Keep light neutral surfaces dominant and emerald scarce.
- Use typography, spacing, alignment, and thin separators for hierarchy.
- Keep application controls compact and marketing surfaces spacious.
- Make AI entry contextual, intent-led, and available throughout the product.
- Show agent progress as structured, terse, meaningful steps.
- Make scope, applied state, impact, approval, and undo obvious for AI changes.
- Prefer the visual document over raw files and source.
- Preserve unsupported LaTeX and offer Source Mode without forcing it.
- Keep PDF contextual and retain the last successful compile during errors.
- Make comments, presence, citations, and history document-native.
- Provide keyboard and non-drag alternatives for every important interaction.
- Test empty, loading, error, offline, permission, and conflict states.

### Don't

- Invent arbitrary colors, spacing, radii, shadows, or type sizes.
- Add gradients, glassmorphism, glow, or decorative emerald fields.
- Turn every section into a rounded card or nest cards.
- Build a generic SaaS dashboard with KPI cards and charts.
- Use marketing-sized headings or spacing inside the application.
- Make the agent a permanent generic chat sidebar.
- Use verbose conversational narration for agent progress.
- Auto-apply high-impact AI changes or hide whether work was applied.
- Expose LaTeX syntax in ordinary visual workflows.
- Silently normalize or delete unsupported LaTeX.
- Force a 50/50 editor/PDF split.
- Present AI, Visual, and Source as equal modes.
- Let code-server or VS Code determine the product's visual identity.
- Copy reference brand colors, gradients, typefaces, illustrations, or layouts.
- Rely on color, hover, or pointer input alone.

---

## 32. Implementation rules for AI coding agents

When implementing or changing UI, follow this order:

1. Identify the product surface and density context.
2. Identify the canonical layout pattern.
3. Reuse tokens and existing primitives.
4. Reuse a product pattern or add a deliberately named repeated variant.
5. Implement all relevant interaction states.
6. Verify the AI > Visual > Source hierarchy remains intact.
7. Verify unsupported content and user work cannot be lost.
8. Verify keyboard, screen-reader, contrast, reduced-motion, and touch behavior.
9. Verify desktop, small-laptop, tablet, and reasonable mobile behavior.
10. Remove any one-off styling made unnecessary by a token or shared component.

### 32.1 Non-negotiable code rules

- No raw hex, RGB, spacing number, radius, or shadow in component styles when a token exists.
- No new global token without a repeated semantic need and an update to this document.
- No custom button, input, menu, dialog, toast, tooltip, or badge built ad hoc inside a feature.
- No hover-only functionality.
- No destructive mutation without named confirmation and recovery strategy.
- No mutating AI flow without an impact classification and visible applied state.
- No visual-editor transform without a round-trip fidelity test.
- No new Source Mode entry point that gives it parity with the primary AI/Visual experience.
- No responsive layout that reduces the editable document below usable width when a panel could collapse or overlay.

### 32.2 Required state checklist

For each new screen or feature, explicitly verify:

- first-use/empty;
- populated;
- loading/slow;
- success;
- partial success where relevant;
- recoverable error;
- permission denied/read-only;
- offline/reconnecting where relevant;
- keyboard-only;
- screen reader naming and announcements;
- 200% zoom;
- reduced motion;
- narrow laptop and touch viewport.

### 32.3 Review questions

Before considering UI complete, answer yes to all:

- Is the user's document or intent more prominent than implementation mechanics?
- Is there one clear primary action in each region?
- Can hierarchy work without adding another card or color?
- Are AI scope, progress, impact, and applied state understandable at a glance?
- Can the user review and reverse consequential changes?
- Is source fidelity preserved, including unsupported constructs?
- Does PDF remain secondary and contextual?
- Are Source Mode and raw files appropriately advanced?
- Are all controls available without hover and without a mouse?
- Does the screen look like the same product as every other surface defined here?

If any answer is no, revise the implementation before shipping.
