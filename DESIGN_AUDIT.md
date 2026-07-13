# Frontend Design Audit — Migration Foreman

Factual, literal snapshot of the current UI as of the code in this repo. No changes were made to any code as part of this audit. Verified against the running dev server (`docker compose`, `http://localhost:3000`) via DOM/accessibility-tree reads and page-text extraction; pixel screenshots could not be captured (see §9).

---

## 1. Stack & structure

**Framework:** Next.js 14.2.35, App Router (`frontend/app/`), React 18.3.1, TypeScript, `"use client"` on every interactive component (no server components with real logic — the root layout is the only server component).

**Build tool:** Next's own toolchain (`next dev` / `next build` / `next start`). `npm` as package manager (`package-lock.json` present). No bundler config beyond `next.config.js` (`reactStrictMode: false`, nothing else set).

**Styling approach:** Tailwind CSS 3.4.1 utility classes written inline in JSX, 100% of the time. No CSS Modules, no styled-components/emotion, no CSS-in-JS. One global stylesheet, `app/globals.css`, containing only Tailwind directives, a `body` base style, and custom `::-webkit-scrollbar` rules. `postcss.config.js` + `autoprefixer` are the only PostCSS plugins.

**Component library:** None (no shadcn/MUI/Chakra/Ant/Radix). All interactive primitives (buttons, inputs, tables, badges) are hand-rolled `<button>`/`<input>`/`<table>` elements styled with Tailwind. Two visualization libraries are used as drawing engines, not UI kits:
- **reactflow** 11.11.4 — the dependency graph (`DependencyGraph.tsx`), with its own imported stylesheet `reactflow/dist/style.css`.
- **recharts** 2.12.7 — the summary bar chart (`CampaignSummaryChart.tsx`).

**package.json name field is still `"frontend_2"`** — a leftover from a documented folder rename (noted in `PROJECT.md` §9); cosmetic only, doesn't affect the app.

### Routes (3 total)

| Route | File | Renders |
|---|---|---|
| `/` | `app/page.tsx` | Repo input → mode select → seam definition (AI Plan / Guided / Autonomous) → seam review → launch campaign. Single-page wizard, no sub-routes. |
| `/campaign/[campaignId]` | `app/campaign/[campaignId]/page.tsx` | Live campaign dashboard: dependency graph, unit table, reasoning log, diff/preview drill-down, escalation panel. Auto-redirects to the summary route when the campaign finishes. |
| `/campaign/[campaignId]/summary` | `app/campaign/[campaignId]/summary/page.tsx` | Final tally chart, unit table, diff/preview drill-down, PR finalize button/result. |

### Components (13 files, all in `frontend/components/`, flat — no subfolders)

| File | Renders |
|---|---|
| `ModeToggle.tsx` | 3-way segmented button switch: AI Plan / Guided / Autonomous |
| `PlanIntentForm.tsx` | Intent text input + "Generate plan" button + resulting plan card (risk badge, grounding checklist, editable test command) |
| `CandidateList.tsx` | List of ranked-candidate buttons with scores, blacklist disabling |
| `ManualSeamForm.tsx` | 4-field manual seam form (scope globs, before/after pattern, invariants, test command) |
| `DependencyGraph.tsx` | React Flow graph, auto-laid-out grid positions, optional per-node color override |
| `UnitStatusTable.tsx` | HTML `<table>` of units: scope glob, status badge, attempt count, optional Diff/Preview action buttons |
| `StatusBadge.tsx` | Small pill showing a unit's status, colored per status |
| `ReasoningLog.tsx` | Auto-scrolling monospace terminal-style feed of agent reasoning lines |
| `EscalationPanel.tsx` | Cards for escalated units: diff + failure log |
| `UnitPreviewPanel.tsx` | Before/After panes rendered per file type (markdown/html/css/code), collapsible test log |
| `DiffView.tsx` | Line-by-line colored unified diff (`<pre>` with per-line `<div>`) |
| `CampaignSummaryChart.tsx` | Recharts vertical bar chart, one bar per status (passed/failed/escalated) |

### Supporting code (not components)

- `hooks/useCampaignSocket.ts` — WebSocket client with polling fallback for one campaign
- `lib/api.ts`, `lib/types.ts`, `lib/config.ts` — typed fetch wrapper, shared TS interfaces, env config
- `utils/formatUnitStatus.ts`, `utils/matchGlob.ts`, `utils/renderMarkdown.ts` — pure helper functions

### Dead / unused UI-adjacent code found

- **`tailwind.config.ts` `theme.extend.colors.status.*`** (6 custom color tokens: `status-pending #6b7280`, `status-running #2563eb`, `status-passed #16a34a`, `status-failed #dc2626`, `status-retrying #d97706`, `status-escalated #9333ea`) — grepped across the whole `frontend/` tree, **zero usages** as Tailwind classes anywhere (no `bg-status-*`, `text-status-*`, etc.). All status coloring is instead done via hardcoded hex strings in `utils/formatUnitStatus.ts`'s `NODE_COLORS` map, which duplicates 5 of these 6 values exactly but disagrees on `pending` (`#475569` slate-600 vs. the unused token's `#6b7280` gray-500). The Tailwind config entry is fully dead.
- **`useCampaignSocket`'s `escalations` state** (`Record<unitId, failureLog>`, populated by the `unit_escalated` WS event) is returned from the hook but never destructured or read by `app/campaign/[campaignId]/page.tsx`. `EscalationPanel` instead derives its list independently by filtering `campaign.units` for `status === "escalated"` (populated via the `unit_status` event). The `unit_escalated` event handling and its state are wired but functionally inert.
- **`utils/formatUnitStatus.ts`'s exported `UNIT_STATUS_ORDER`** array is defined but not imported/used anywhere else in the codebase.

---

## 2. Design tokens (extracted from source)

### Colors — exact classes/values, by role

**Backgrounds**
- `bg-slate-950` — page body (`globals.css`), code/diff `<pre>` blocks, markdown-preview iframe internal `pre` (`#0f172a` inline)
- `bg-slate-900` — input/textarea fields, table header row, seam-review/plan-result card wrapper (as `bg-slate-900/60`), toggle inactive segment
- `bg-slate-900/60` — translucent card backgrounds (seam review card, plan result card, unit preview panel wrapper)
- `bg-slate-950/60`-style not used; `bg-black/40` — ReasoningLog panel background, EscalationPanel's failure-log `<pre>`
- `bg-blue-600` (hover `bg-blue-500`) — primary action buttons ("Ingest", "Generate plan", "Confirm seam & start campaign" is green not blue — see below, "Submit manual seam", active `ModeToggle` segment), `running` status color
- `bg-green-600` (hover `bg-green-500`) — "Confirm seam & start campaign", "Finalize & open PR" buttons; `passed` status color
- `bg-red-600` — `failed` status badge fill
- `bg-amber-600` — `retrying` status badge fill
- `bg-purple-600` — `escalated` status badge fill
- `bg-slate-700` — `pending` status badge fill
- `bg-green-950` / `bg-red-950` — diff view added/removed line backgrounds
- `bg-green-900/60`, `bg-amber-900/60`, `bg-red-900/60` — plan risk badges (low/medium/high)

**Text**
- `text-slate-100` — base body text (via `body` class)
- `text-slate-300` — secondary body text, scope-glob mono values, diff default lines
- `text-slate-400` — form labels, muted descriptions, section-4 sub-headers, inactive toggle text
- `text-slate-500` — uppercase section eyebrows ("1. REPO INPUT" etc.), placeholder-style hint text, empty-state copy
- `text-slate-600` — input placeholder color, disabled/inactive demo-preset link text
- `text-green-300/400` — risk=low badge text, grounding-checklist ✓ lines, diff added-line text, PR link accepted-count text
- `text-amber-300/400` — risk=medium badge text, "unsupported files" warning, polling-indicator label
- `text-red-300/400` — risk=high badge text, error banners, diff removed-line text, escalation failure-log text
- `text-purple-400` — "Escalated after N attempts" label
- `text-blue-400` — PR link, "Show/Hide test output" toggle link

**Borders**
- `border-slate-800` — near-universal container/card/input border color
- `border-slate-700` — secondary buttons ("Edit seam"), unselected diff/preview action buttons, plan-card confidence chip border
- `border-purple-900` — escalated-unit card border
- `border-green-700` / `border-amber-700` / `border-red-700` — risk-badge borders (paired with their `*-900/60` bg and `*-300` text)
- `border-blue-500` — focused input ring/border, active diff/preview toggle button, selected candidate card

**Status color system** (the one semantically-named palette in the app, defined twice — see §1 dead-code note):
| Status | Badge (`unitStatusBadgeClasses`) | Graph node hex (`unitStatusNodeColor`) |
|---|---|---|
| pending | `bg-slate-700 text-slate-200` | `#475569` |
| running | `bg-blue-600 text-white` | `#2563eb` |
| passed | `bg-green-600 text-white` | `#16a34a` |
| failed | `bg-red-600 text-white` | `#dc2626` |
| retrying | `bg-amber-600 text-white` | `#d97706` |
| escalated | `bg-purple-600 text-white` | `#9333ea` |

**Gradients:** none found anywhere in the codebase. No `bg-gradient-*`, no `from-*`/`via-*`/`to-*` classes, no inline CSS gradients.

**Fonts:** No font is explicitly loaded (no `next/font`, no `@font-face`, no Google Fonts link, no font-family override in `globals.css` or Tailwind config) — the app runs entirely on the browser/OS default sans-serif stack (Tailwind's default `font-sans`) for body text. `font-mono` (Tailwind's default monospace stack) is used extensively for all data/code values: scope globs, patterns, diffs, reasoning log lines, JSON-ish values, campaign/unit ID fragments, test commands, file paths. No custom weights are set beyond Tailwind's `font-medium`/`font-semibold` utilities — no explicit `font-light`/`font-bold`/numeric weights anywhere.

**Type scale in use (Tailwind size classes found in the code):**
- `text-lg` (18px) — page header title only ("Migration Foreman")
- `text-sm` (14px) — the default body/UI text size across nearly all copy, labels, buttons, table cells
- `text-xs` (12px) — the second most common size: section eyebrows, badges, mono data values, hints, chart axis labels (`fontSize={12}` prop, not a class), scores
- No `text-base`, `text-xl`+, or any larger display sizes anywhere — there is no hero/headline typography in this app.

**Border radius:**
- `rounded-lg` — the dominant radius: cards, inputs, buttons, table wrapper, graph container, diff/pre blocks
- `rounded` (default, 4px) — small elements: badges' border variant chips (risk, confidence), action-button borders
- `rounded-full` — status badges (`StatusBadge`), scrollbar thumb
- ReactFlow node style sets `borderRadius: 8` inline (matches `rounded-lg`'s 8px)

**Shadows:** none. No `shadow-*` Tailwind classes appear anywhere in the codebase — every surface is flat, differentiated only by background/border color, never elevation.

**Spacing:** Fairly consistent utility-driven rhythm, not a hardcoded grid:
- Page-level vertical rhythm: `space-y-6` (repo-input and live-campaign pages) or `space-y-8` (summary page) between major sections
- Card/form internal rhythm: `space-y-2`/`space-y-3` between fields
- Padding: `p-3` (small cards, table cells use `px-3 py-2`), `p-4` (larger cards — seam review, plan result, preview panel), `px-4 py-2` (buttons)
- Gaps: `gap-2` (button rows, badge rows), `gap-4`/`gap-6` (grid layouts)
- No 4px/8px design-token system is declared explicitly; it's just Tailwind's default spacing scale used directly and fairly consistently (multiples of 4px via `-1`, `-2`, `-3`, `-4`, `-6`, `-8` suffixes).

---

## 3. Layout (per screen)

### Shell (all screens)

Single fixed header, no sidebar, no footer. Body is a full-height flex column:

```
┌──────────────────────────────────────────────┐
│ Migration Foreman                             │  <- header, border-b, px-6 py-4
├──────────────────────────────────────────────┤
│                                                │
│              <page content>                   │  <- main, flex-1, px-6 py-6
│                                                │
└──────────────────────────────────────────────┘
```

All page content is centered in a constrained column (`mx-auto`) — this is a dense, app-style layout (not a wide/full-bleed dashboard, not a centered-marketing-page style either; more like a single-column form/console).

### Screen A — `/` (repo input & seam review), `max-w-3xl mx-auto space-y-6`

Sections appear progressively as state advances, each preceded by a numbered uppercase eyebrow label (`1. REPO INPUT`, `2. MODE`, `3. SEAM DEFINITION`, `4. SEAM REVIEW`):

```
┌─────────────────────────────────────────┐
│ 1. REPO INPUT                            │
│ [ repo URL input........... ] [ Ingest ] │
│ Demo repo (in-container fixture)         │  <- underlined text-link style
│ (error text, if any)                     │
├─────────────────────────────────────────┤
│ 2. MODE            [AI Plan|Guided|Auto] │  <- segmented control, only after ingest
├─────────────────────────────────────────┤
│ 3. SEAM DEFINITION                       │
│   (PlanIntentForm | CandidateList |      │
│    ManualSeamForm, depending on mode)    │
├─────────────────────────────────────────┤
│ 4. SEAM REVIEW            (only if seam) │
│ ┌───────────────────────────────────┐   │
│ │ Scope: ...                        │   │
│ │ Migration: before → after         │   │
│ │ Test command: ...                 │   │
│ │ • invariant bullets                │   │
│ └───────────────────────────────────┘   │
│ [ dependency graph, React Flow canvas ]  │
│ [ Edit seam ] [ Confirm seam & start... ]│
└─────────────────────────────────────────┘
```

Data display: no cards/grid for the graph — it's a canvas (React Flow) with auto-computed grid positions (`Math.ceil(sqrt(n))` columns, fixed 220×90px cell pitch), boxy 190px-wide rounded nodes, gray edges. Candidates (Autonomous mode) render as a vertical stack of full-width bordered buttons, not a card grid.

### Screen B — `/campaign/[campaignId]` (live view), `max-w-5xl mx-auto space-y-6`

```
┌───────────────────────────────────────────────────┐
│ Live campaign — a1b2c3d4      ● live (WebSocket)   │
├───────────────────────────────────────────────────┤
│ [ dependency graph, nodes recolored by status ]    │
├──────────────────────────┬──────────────────────────┤
│ Units                    │ Agent reasoning           │
│ ┌──────────────────────┐ │ ┌────────────────────────┐│
│ │ Unit | Status | Att. │ │ │ [8-char-id] reasoning..││
│ │      | Result       │ │ │ (monospace terminal,    ││
│ │ (table rows)         │ │ │  black/40 bg, h-64,     ││
│ └──────────────────────┘ │ │  auto-scroll)           ││
│                          │ └────────────────────────┘│
├───────────────────────────────────────────────────┤
│ (Unit diff | Live preview, if a row is selected)   │
├───────────────────────────────────────────────────┤
│ Escalations                                         │
│ (card per escalated unit: scope, attempt count,     │
│  diff, failure log)                                 │
└───────────────────────────────────────────────────┘
```

`grid grid-cols-1 lg:grid-cols-2 gap-6` — units table and reasoning log sit side-by-side ≥ the `lg` breakpoint (1024px), stack vertically below it.

### Screen C — `/campaign/[campaignId]/summary`, `max-w-4xl mx-auto space-y-8`

```
┌───────────────────────────────────────┐
│ Campaign summary — a1b2c3d4            │
│ [ bar chart: Passed | Failed | Escalated ]│
│ [ unit status table, same as live view ]│
├───────────────────────────────────────┤
│ (Unit diff | Live preview, if selected)│
├───────────────────────────────────────┤
│ Pull request                           │
│ [ Finalize & open PR ] or PR link      │
│ (error fallback text, if finalize 502s)│
└───────────────────────────────────────┘
```

### Unit data representation (all screens)

Always an HTML `<table>` (`UnitStatusTable.tsx`) — never a card grid. Columns: `Unit` (monospace scope glob, e.g. `src/exporter.py`), `Status` (colored pill), `Attempt` (plain integer), and conditionally `Result` (two small outlined buttons: "View Diff" / "Live Preview"). No pagination, sorting, or filtering controls exist on this table.

---

## 4. Component inventory

### Buttons

| Component/label | Visual | Copy |
|---|---|---|
| Primary ingest | `bg-blue-600 hover:bg-blue-500`, `rounded-lg px-4 py-2 text-sm font-medium text-white`, disables to `opacity-40` | "Ingest" / "Ingesting…" |
| Demo preset link | Plain text, `text-xs text-slate-500`, `underline decoration-dotted`, hover `text-slate-300` — styled as a link, not a button | "Demo repo (in-container fixture)" |
| Mode toggle segments | Segmented group, `rounded-lg border border-slate-800 overflow-hidden`; active segment `bg-blue-600 text-white`, inactive `bg-slate-900 text-slate-400 hover:text-slate-200`; no radius/border between segments (single outer rounded rect) | "AI Plan" / "Guided" / "Autonomous" |
| "Generate plan" | Same primary blue style as Ingest | "Generate plan" / "Planning…" |
| "✓ Ready for execution — use this plan" | Full-width blue primary, `w-full` | exact string incl. leading check-mark glyph |
| "Submit manual seam" | Full-width blue primary | "Submit manual seam" / "Submitting seam…" |
| Candidate row (button, not really a "button" visually — a selectable card) | Full-width left-aligned bordered block; selected = `border-blue-500 bg-blue-950/40`; unselected = `border-slate-800 bg-slate-900/60`; blacklisted = `opacity-50 cursor-not-allowed`, disabled | shows scope globs + scores; blacklisted rows carry a `text-red-400` "BLACKLISTED" tag top-right |
| "Edit seam" | Secondary/outline style: `border border-slate-700 text-slate-300`, hover `border-slate-500`, no fill | "Edit seam" |
| "Confirm seam & start campaign" | Primary green, `flex-1 bg-green-600 hover:bg-green-500` | "Confirm seam & start campaign" / "Starting campaign…" |
| Diff/Preview toggle (per unit row) | Small outline chip, `rounded border px-2 py-0.5 text-xs`; active = colored border+text (`border-blue-500 text-blue-300` for diff, `border-green-500 text-green-300` for preview); inactive = `border-slate-700 text-slate-400 hover:text-slate-200` | "View Diff" / "Live Preview" |
| "Finalize & open PR" | Primary green | "Finalize & open PR" / "Opening PR…" |
| "Show/Hide test output" | Plain text link, `text-xs text-blue-400 underline decoration-dotted hover:text-blue-300` | "Show test output" / "Hide test output" |

No icon-only buttons anywhere — every control is text-labeled. No hamburger/kebab menus.

### Badges / chips

- **`StatusBadge`** — `inline-block px-2 py-0.5 rounded-full text-xs font-medium`, colored per the status table in §2. Labels: "Pending", "Running", "Passed", "Failed", "Retrying", "Escalated" (title case, via `formatUnitStatusLabel`).
- **Risk badge** (plan card) — `rounded border px-2 py-0.5 text-xs font-medium`, colors per risk (green/amber/red as in §2). Copy: `risk: low` / `risk: medium` / `risk: high` (lowercase value, literal template).
- **Breaking-changes chip** — plain `border-slate-700` outline chip. Copy: `breaking changes: yes` / `breaking changes: no`.
- **BLACKLISTED tag** — no border/bg, just bold red text, `text-xs font-medium text-red-400`.

### Tabs

None — `ModeToggle` is a segmented button group acting as a tab-like switch but it's not built with any tab/ARIA-tab semantics (plain `<button>`s, `onClick` swaps state; no `role="tablist"`).

### Modals / drawers / toasts

**None exist in this codebase.** No modal, dialog, drawer, sheet, popover, or toast component anywhere. All secondary content (diff view, unit preview, escalation details) renders inline in the page flow below the triggering table, not in an overlay.

### Tables

`UnitStatusTable` is the only table. Plain semantic HTML `<table>`/`<thead>`/`<tbody>`, header row `bg-slate-900 text-slate-400`, body rows `border-t border-slate-800`, no zebra striping, no row hover state, no sticky header.

### Iframes (notable, not a typical "component" but structurally significant)

`UnitPreviewPanel` renders **sandboxed iframes** (`sandbox=""`, i.e. maximally restrictive — no scripts, no same-origin, no forms) via `srcDoc` for markdown/html/css previews, `h-72 w-full rounded border border-slate-800 bg-white` (white background regardless of the app's dark theme, since it's rendering the *migrated file's* content, not app UI).

---

## 5. Data & state handling

**Wired to real data end-to-end** — no mock data, no hardcoded/sample JSX content, no fixture files imported into any component. Every screen's content originates from the FastAPI backend via `lib/api.ts`'s `fetch`-based `request()` wrapper, hitting the real REST endpoints (`/repo`, `/repo/{id}/candidates`, `/repo/{id}/graph`, `/repo/{id}/plan`, `/repo/{id}/seam`, `/campaign`, `/campaign/{id}`, `/campaign/{id}/unit/{id}/preview`, `/campaign/{id}/finalize`) plus the `/ws/campaign/{id}` WebSocket. (A **backend-side** offline mock exists — `MOCK_CODEX=1` — but that fakes the LLM call server-side; the frontend has zero knowledge of it and consumes identical response shapes either way.)

**Feature checklist:**

| Feature | Status |
|---|---|
| Unit status display | **Exists fully** — `UnitStatusTable` + `StatusBadge`, 6-state enum (pending/running/passed/failed/retrying/escalated), also reflected as graph node color |
| Retry counter | **Exists fully** — `attempt` integer column in the unit table, sourced from `unit.attempt`, live-updated via `unit_status` WS events |
| Test results per unit | **Exists fully** — `UnitPreviewPanel`'s collapsible "Show test output" `<pre>` block (`preview.testLog`, full stdout/stderr from the verification gate) |
| Diff view | **Exists fully** — `DiffView`, unified-diff text with colored +/- lines, triggered per-unit from the table |
| Event/activity log | **Exists partially** — `ReasoningLog` streams `unit_reasoning` WS events (agent's per-unit rationale text) as a scrolling terminal feed; this is the *only* activity/event log surfaced in the UI. There is no generic audit-trail/timeline view of the backend's `UnitEvent` table (created/running/retrying/etc. transitions) — only live reasoning text and the current status column are shown; historical event sequence isn't rendered anywhere. |
| Metrics (convergence/pass rate/cost) | **Exists partially** — `CampaignSummaryChart` shows a raw count bar chart of passed/failed/escalated units. No pass-rate percentage, no convergence-over-time metric, no cost/token/dollar figures anywhere in the UI. |
| Review queue | **Exists partially** — `EscalationPanel` lists escalated units with diff + failure log for human review, but it's a flat read-only list on the same page (no dedicated queue route, no triage/action controls — no "resolve"/"retry"/"dismiss" buttons on an escalated unit). |
| Campaign progress | **Exists fully** — implicit via the live-updating unit table + graph coloring + connection-status pill; no separate progress bar/percentage widget, but the unit-by-unit state is fully visible. |
| Pause/resume controls | **Missing entirely.** No pause, resume, cancel, or abort control exists anywhere in the frontend for a running campaign. |

**Live-update mechanism:** `hooks/useCampaignSocket.ts` — native `WebSocket` to `ws(s)://<backend>/ws/campaign/{id}`, listening for `unit_status`, `unit_reasoning`, `unit_escalated`, `campaign_completed`, `campaign_failed` events (server→client only, per the backend contract). On socket `onclose`/`onerror` it falls back to polling `GET /campaign/{id}` every 2000ms (`POLL_INTERVAL_MS`) until reconnection isn't attempted again (no auto-reconnect — polling is permanent once it drops). Connection state surfaces as a text pill: "● live (WebSocket)" / "● polling fallback" / "● connecting…".

---

## 6. Motion & effects

Extremely minimal — this app has almost no motion design:

- **`animate-pulse`** (Tailwind's built-in opacity pulse keyframe) — the only true animation in the app, applied to two loading-state text lines: "Codex is planning the migration…" (`PlanIntentForm`) and "Loading preview…" (`UnitPreviewPanel`). No skeleton loaders (gray placeholder blocks) anywhere — loading states are plain pulsing text.
- **`transition-colors`** — applied to `CandidateList` row buttons, `ManualSeamForm`'s submit button, `ModeToggle` segments, `UnitStatusTable`'s diff/preview action chips. This is a hover/state color transition only (no duration class specified, so it uses Tailwind's default `150ms`); no transform/scale/opacity transitions tied to it.
- **No hover-scale, shimmer, parallax, or scroll-reveal effects** exist anywhere in the codebase — confirmed by grep across `app/` and `components/` for `scale-`, `shimmer`, `parallax`, `animate-` (beyond `animate-pulse`), and `transition-transform`.
- **`scrollIntoView({ block: "end" })`** in `ReasoningLog` — a programmatic (non-CSS) auto-scroll-to-bottom behavior on new log lines, not a CSS animation.
- **`prefers-reduced-motion` is not referenced anywhere** in the codebase (no media query, no `motion-safe`/`motion-reduce` Tailwind variants used). Given the only animation present is a low-intensity opacity pulse on transient loading text, the practical impact of this gap is minor, but it is technically unhandled.

---

## 7. Copy audit

**Page title / meta** (`app/layout.tsx`): `<title>Migration Foreman</title>`, meta description: *"Autonomous, test-verified code migration campaigns"*.

**Header:** "Migration Foreman" (plain `<h1>`, no tagline rendered in the UI itself — the meta description above is not visibly rendered anywhere on-page).

**Section eyebrows (exact strings, rendered uppercase via CSS `tracking-wide` + literal text is title-case in source):** "1. Repo input", "2. Mode", "3. Seam definition", "4. Seam review", "Units", "Agent reasoning", "Escalations", "Pull request".

**Empty-state copy (exact quotes):**
- "No candidates found for this repo."
- "No graph data available — falling back to the unit status table."
- "Waiting for agent reasoning…"
- "No escalations — every unit is still within its retry budget."
- "No units yet."
- "No dependency graph available for this campaign — showing the unit table only."
- "No diff recorded for this unit."
- "Not merged into the campaign branch (unit escalated) — no after version."
- "File does not exist on this branch."
- "No accepted or escalated units."
- "Loading campaign…" / "Loading campaign summary…" / "Loading preview…"

**Button labels:** see full table in §4 — representative exact strings: "Ingest", "Generate plan", "✓ Ready for execution — use this plan", "Submit manual seam", "Edit seam", "Confirm seam & start campaign", "View Diff", "Live Preview", "Finalize & open PR", "Show test output" / "Hide test output".

**Form labels/placeholders (exact):** "Migration intent (plain English)" with placeholder `e.g. "Upgrade requests to httpx"`; "Scope globs (comma or newline separated)" with placeholder `src/**/*.py`; "Before pattern" / "After pattern"; "Invariants (one per line)" with placeholder `All unit tests pass`; "Test command" with placeholder `python -m pytest tests/ -v` (manual form) / `python -m pytest -q` (plan form).

**Error/fallback copy:** "PR creation failed ({error}) — use View Diff / Live Preview on the units above to inspect the changes instead."; "Preview failed: {error}"; generic `err.message` pass-through for most other errors (no custom copy layer over API errors elsewhere — raw backend `message` strings surface directly in `text-red-400` paragraphs).

### Marketing / "AI magic" language flag

**None found.** No instance of "supercharge", "AI-powered", "revolutionize", "seamless", "magic", sparkle emoji (✨), or similar hype language anywhere in the UI copy. The only AI-attributed copy is the plain, functional "Codex is planning the migration…" loading line — naming the actual tool doing the work, not selling it. Tone throughout is terse, technical, and status-report-like (closer to a CI/CD dashboard's voice than a product-marketing voice).

---

## 8. Accessibility & quality floor

- **No modals/drawers exist**, so there's nothing to Esc-close — not applicable rather than failing.
- **Focus states:** Inputs get an explicit `focus:outline-none focus:border-blue-500` — the browser's default focus ring is *removed* and replaced with only a border-color change, no visible focus ring/glow (`focus:ring-*` is never used anywhere in the codebase). This is a real, code-verifiable a11y gap: keyboard focus on text inputs is a subtle 1px border-color change with no outline, and buttons/links get no explicit focus style overrides at all (they rely entirely on unstyled browser default, which varies by browser but is generally faint on a dark background).
- **No ARIA attributes found anywhere** in the codebase (no `aria-label`, `aria-live`, `role`, etc.) — grep across `app/` and `components/` returns zero matches. The `ModeToggle` segmented control, the live-updating status pill, and the streaming reasoning log all lack `aria-live`/`role` semantics that would announce state changes to assistive tech.
- **No `alt` text audit needed** — the app contains zero `<img>` tags; the only visual/graphical content is the React Flow SVG canvas (no descriptive text layer) and the Recharts SVG chart (also no `aria-label` on the chart container).
- **Color contrast:** Not independently measured (no tool available in this pass), but several literal combinations are worth flagging for a contrast check in the next phase: `text-slate-500`/`text-slate-600` on `bg-slate-950` (used for placeholders, hints, and the empty-state/eyebrow text) is a low-contrast gray-on-near-black combination that's a common WCAG AA failure pattern at 12–14px.
- **Responsive behavior:** Only one responsive breakpoint variant exists in the whole codebase — `lg:grid-cols-2` in the live-campaign page (units table vs. reasoning log go side-by-side ≥1024px, stacked below it). Everything else uses fixed `max-w-*` centered columns with no additional breakpoint-specific classes, so at 768px the layout simply narrows the same single-column content (acceptable, nothing breaks structurally from source inspection) and at 1440px there's a large amount of unused horizontal margin outside the `max-w-3xl`/`max-w-4xl`/`max-w-5xl` centered column (expected/intentional dense-app framing, not a bug).
- **Console errors on load:** None observed. `read_console_messages` on the live dev server returned only React's standard dev-mode "Download React DevTools" info messages — no warnings or errors.
- **Actual rendering confirmed live:** the dev server (`docker compose`, `MOCK_CODEX=1`) was reachable at `http://localhost:3000` at audit time; `GET /` returned 200, and a DOM/accessibility-tree read confirmed the expected initial-state markup (`1. Repo input` section, "Ingest" button, "Demo repo (in-container fixture)" preset link) rendered correctly with no visible error boundary or blank-page state.

---

## 9. Screenshots

**Pixel screenshots could not be captured in this session** — the available browser-automation tool's screenshot/zoom actions timed out repeatedly (30s) against the dev server tab, despite the page being reachable and interactive (network requests, DOM structure, and page text all resolved correctly through non-screenshot tool calls). This appears to be an environment/tooling limitation, not an application fault — see the confirmation in §8.

In place of screenshots, this report relies on:
1. Full source reads of every route and component file (cited by path throughout this report).
2. A live accessibility-tree read (`read_page`) and text extraction (`get_page_text`) of the running `/` route, confirming the described initial state renders as expected.
3. The ASCII wireframes in §3, built directly from the JSX structure and Tailwind layout classes.

No `audit-screenshots/` directory was created since no captures succeeded.

---

## 10. Summary of dominant look

A dark-slate, monospace-heavy, single-column developer console — closer to a CI/CD pipeline dashboard than a product UI, with flat colored status pills (blue/green/red/amber/purple) as the only real visual accent against near-black backgrounds. There is no illustration, gradient, shadow, or custom typography anywhere; every surface is a bordered rectangle differentiated by border and background shade alone. The overall impression is deliberately utilitarian and technical, prioritizing legible data (diffs, logs, scores, patterns) over polish or brand expression.
