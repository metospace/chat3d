# Scenivo UI system

Studio pages share one visual language built on libraries already in the repo. Extend these tokens and wrappers instead of adding parallel CSS or another component kit.

## Stack roles

| Layer | Package | Use for |
| --- | --- | --- |
| **Theme & density** | `@radix-ui/themes` (`AppearanceProvider` → `Theme`) | Page chrome, forms, dialogs, cards, badges, text fields, dropdowns, tooltips |
| **Icons** | `@radix-ui/react-icons` | Consistent stroke icons in nav, lists, empty states |
| **Workbench controls** | `@heroui/react` | Icon/toolbar buttons, primary workbench actions (save, canvas tools) where a compact press target is needed |
| **Utility layout** | Tailwind 4 (`@import "tailwindcss"` in `src/index.css`) | Rare one-off spacing in new code; prefer CSS variables below |
| **Layout & studio skin** | `src/ui/studio/*.css` + existing `frosted-studio.css` | Shell grid, home density, frosted surfaces — mapped to Radix gray/accent scales |

HeroUI global styles come from `@heroui/styles` in `src/index.css`. Radix component CSS is imported in `App.tsx`.

## Design tokens

Defined in `src/ui/studio/tokens.css` on `.redesigned-studio.canvas-studio.frosted-studio`:

- **Spacing** — `--sc-space-1` … `--sc-space-6` (4px step)
- **Type** — `--sc-text-xs` … `--sc-text-2xl`, `--sc-leading-*`
- **Radius** — `--sc-radius-sm|md|lg|pill` (aliases Radix `--radius-*` where possible)
- **Surfaces** — `--sc-surface-page`, `--sc-surface-elevated`, `--sc-surface-muted`
- **Ink** — `--sc-ink`, `--sc-ink-muted`, borders `--sc-border`, `--sc-border-subtle`
- **Accent** — `--sc-accent`, `--sc-accent-soft` (maps to Radix `--accent-*`)
- **Atmosphere** — `--sc-gradient-page`, `--sc-gradient-accent`, `--sc-gradient-panel` (page background + primary actions)
- **Elevation** — `--sc-shadow-panel`, `--sc-shadow-float`, `--sc-shadow-inset`
- **Chrome** — `--sc-nav-height`, `--sc-utility-size` (top bar and utility control sizing)

Legacy `--studio-*` and `--glass-*` names in frosted CSS are bridged to the same Radix scales so older rules keep working.

Sidebar rhythm is defined once in `src/ui/studio/studio-shell.css` and shared by studio navigation, session history (including its portaled dialog), and library category trees/managers. Use `--sidebar-pad-x: 12px`, `--sidebar-radius: 7px`, `--sidebar-font: 14px`, `--sidebar-font-meta: 11px`, `--sidebar-font-caption: 12px`, `--sidebar-icon: 12px`, `--sidebar-icon-gap: 8px`, `--sidebar-row-min-h: 44px`, `--sidebar-category-row-min-h: 36px`, `--sidebar-gap-in: 3px`, and `--sidebar-gap-group: 20px`. Rail insets are symmetric; the icon-only shell uses 7px on both sides. Preserve each rail's existing palette and state styling.

## Shared React wrappers (`src/ui/studio/`)

| Component | Source | Purpose |
| --- | --- | --- |
| `StudioShell` | Radix `Button` + existing `TaskQueue` / `AppearanceMenu` | Top nav: brand, pill routes, utilities |
| `StudioPanel` | Semantic `<section>` + optional Radix `Card` inset | Home/library panel frames |
| `StudioSectionHeader` | Radix `Badge` | Title + optional count badge |
| `StudioEmptyState` | Plain markup + tokens | Centered empty lists (tasks, projects) |
| `StudioTextLink` | Native `<button>` styled as text link | “查看全部” style actions |

Prefer these over new one-off class names. Page-specific layout may still use BEM-style hooks (e.g. `home-composer`) where tests or legacy CSS depend on them.

## Composition guidelines

### Cards and panels

- **Lists and selectable tiles** — Radix `Card` (`asChild` when the whole card is a `<button>`).
- **Grouped home blocks** — `StudioPanel` + `studio-home.css` surfaces.
- **Do not** hand-roll hover/active colors on `.rt-Button`; use Radix `variant` / `color`.

### Buttons

- **Primary commit** (生成, 保存) — Radix solid `color="blue"` on marketing/home flows; HeroUI `variant="primary"` on workbench chrome.
- **Secondary / navigation** — Radix `variant="ghost"` or `soft`.
- **Toolbar** — HeroUI `Button` + Radix `Tooltip` (`ToolbarAction`).

### Inputs

- Multi-line prompts — Radix `TextArea`.
- Search/filter — Radix `TextField`.
- Model/method pickers — existing `ModelPicker` / `GenerationMethodPicker`; generation methods are direct and Blender, sharing one high-quality standard.

### Empty states

Use `StudioEmptyState`: icon (Radix icon), short title, one supporting line. Keep `role`/`aria` on parent regions (`aria-labelledby`).

### Tabs / segments

- Asset vs scene on home — segmented `<button aria-pressed>` group (`home-kind-switch`) until a route needs Radix `SegmentedControl`.

## Studio page shell

All routes render inside:

1. `AppearanceProvider` (Radix theme + light/dark)
2. `StudioShell` — top navigation (hidden in workbench via `canvas-studio.css`)
3. `StudioMain` (`studio-main`) — page body

### Pages using `StudioPage`

| Route | Component | Notes |
| --- | --- | --- |
| 首页 | `StudioHome` | Composer, tasks, recent projects |
| 资产 / 场景 | `ProjectLibrary` | Category tree, grid/list, detail pane |
| 团队 | `TeamStudioPage` + `TeamLibraryPane` | Shared segments + server library |
| 任务记录 | `TaskCenter` | Project list + `TaskPanel` |
| 设置 | `StudioSettings` | Grouped preference rows |
| 工作台 | `editor-workspace` in `App` | Chrome only: rails, transform bar, conversation, dialogs |

Workbench 3D viewport and modeling engine are unchanged; `studio-workbench.css` only restyles surrounding panels.

### Assistant progress disclosure

The conversation process starts collapsed, with one keyboard-accessible action/elapsed row. Expanding reveals public explanations and known executed actions in one flat flow; do not add phase sub-accordions. Streaming and termination must not override the user's open/closed choice. The stop action remains visible outside the disclosure. Pending streamed tool instructions are preparation, not execution. Never synthesize private reasoning or expose raw tool payloads as progress. Blender script/stage details live inside the same process disclosure.


## Changing the UI safely

1. Add or adjust tokens in `tokens.css` first.
2. Update `studio-shell.css` / `studio-home.css` before editing scattered legacy files.
3. Run `node tests/home-layout.mjs` (includes header utility overlap regression), `node tests/studio-redesign.mjs`, and `node tests/appearance.mjs`.

### Top bar utilities

`StudioShell` utilities must each reserve their own flex box. The 「关于与更新」 entry (`app-update-nav-entry`) uses a text pill width; the task queue trigger stays a compact icon (`--sc-utility-size`). Do not reintroduce shared `.navigation-utilities .rt-Button { width: 36px }` rules that crush labels — override in `studio-shell.css` if legacy frosted CSS is touched.
