# FRONTEND_REDESIGN.md — handoff for Claude Code

Design authority: Sujat. This is the only frontend redesign doc — do not create or reference any other design/spec file.

> **Revision 2 (2026-07-13, approved by Sujat):** direction changed from dark
> industrial charcoal to a **clean light dashboard** — white cards on a soft
> gray canvas, rounded corners, tinted status pills, minimal color. §2, §3,
> §5.1, §6, §7 and §8 updated to match. The round-1 dark flow scene survives
> only as `design/mocks/overview-scene.html` (superseded, reference only).

## 0. Process — read this first

**Design happens in HTML mocks before any React is written.** Claude Code builds a static HTML/CSS mockup for each page/state and commits it to `design/mocks/`. Sujat reviews and iterates on the mock directly — asking for changes, rejecting, approving — before any real Next.js component exists. Do not build a page's React implementation until its mock in `design/mocks/` is explicitly approved. If unsure whether a mock is approved, ask.

**Repo constraints (from CLAUDE.md, binding):**
- REST/WS contracts and DB schema are FROZEN. Phases 1–5 below are frontend-only. Phase 6 needs new endpoints and explicit team approval — do not start without written go-ahead.
- All work on branch `redesign/control-room`. Never commit to main.
- `hooks/useCampaignSocket.ts`, `lib/api.ts`, `lib/types.ts` keep their behavior; only their consumers change.

## 1. Verdict on the current UI

Functional skeleton, zero identity: default Tailwind slate + blue-600, no fonts loaded, a centered form wizard flowing into a table and a bar chart. No navigation, no explanation of what the product is, raw debug scores shipped as UI. The data layer underneath (WS + polling fallback, typed API, preview iframes, dependency graph) is solid. This is a reskin + restructure, NOT a rewrite.

## 2. Design principles (binding on every mock and every implementation)

1. **Clean light, not slate-dark.** White cards on a soft gray canvas. Color is reserved for status; the chrome is neutral. If a surface shouts, it's wrong.
2. **Aggressive removal.** Raw algorithm scores, decorative charts, redundant labels — delete, don't restyle. In doubt: remove.
3. **Effort heuristic.** Precision is the aesthetic: 8px grid, `tabular-nums` on every figure, consistent 12px card radii, aligned 1px borders, one shadow token.
4. **The chrome stays still.** Motion is limited to drawer slide, log auto-scroll, and lamp pulse — nothing else moves. `prefers-reduced-motion` respected everywhere.
5. **Peak-end.** The Summary page's mono tally line ("14/15 units migrated and verified autonomously · 1 escalated · 47 min") is the demo's final frame. Build it as carefully as the live views.

## 3. Design tokens (replace, don't extend)

In `tailwind.config.ts` under `theme.extend.colors.foreman.*`. Delete the dead `status.*` tokens (zero usages, per audit) and the duplicate hex map in `utils/formatUnitStatus.ts` — after this, that util maps status → token name, one source of truth. The live reference implementation is `design/mocks/foreman.css`.

```
bg #F6F7F9 · card #FFFFFF · line #E6E8EC
ink #101828 · dim #667085 · faint #98A2B3
primary #111827 (near-black buttons) · link #2563EB
accent #E85D04 (brand/logo mark ONLY)

status (solid / tint-bg / tint-text):
ok     #16A34A / #ECFDF3 / #067647
run    #2563EB / #EFF4FF / #1D4ED8
retry  #F59E0B / #FFFAEB / #B54708
fail   #EF4444 / #FEF3F2 / #B42318
queued #98A2B3 / #F2F4F7 / #475467
```

Rules: status colors ONLY on lamps, pills, bars, tile tints and log verbs — never on chrome. Pills use the tint-bg/tint-text pairs (soft rounded badges, like "Paid" in a payments dashboard). Primary buttons are near-black `primary`; links are `link` blue. **Escalated = `fail` red. Current purple is off-system — remove everywhere** (badge, graph node, panel).

Fonts via `next/font/google`: Inter (400/500/600/700) for UI including big bold KPI figures (`tabular-nums`), IBM Plex Mono (400/500) for paths, IDs, log lines, diffs, code. Radii: cards 12px, controls 8px, pills/lamps round. One shadow token (`0 1px 2px rgba(16,24,40,.05)`) on cards, a stronger one on the drawer only. No gradients. Restore visible focus rings (2px `link` blue) globally — current `focus:outline-none` pattern is banned.

## 4. Shell & information architecture

Two columns. No third column — background task status lives in the sidebar, not a rail.

```
┌────────┬──────────────────────────────────────────────┐
│ SIDEBAR│  PAGE CONTENT                                 │
│ 220px  │                                               │
│ ▪ FORE-│                                               │
│   MAN  │                                               │
│ ────── │                                               │
│ Over-  │                                               │
│  view  │                                               │
│ Seam   │                                               │
│ Units  │                                               │
│ Log    │                                               │
│ Review │                                               │
│ Summary│                                               │
│ ────── │                                               │
│ ACTIVE │  ← one chip per running campaign: lamp + name │
│ ● api  │    + 9/15 fraction, mono. Click switches.     │
│   9/15 │    Live via WS. Nothing else goes here.       │
└────────┴──────────────────────────────────────────────┘
```

- Sidebar: fixed, `surface` bg, 1px `line` right border. Logo = 8px accent square + FOREMAN wordmark (Archivo semibold, uppercase). Nav items 13px, `dim` → `ink` active with 2px accent left bar. Review shows a red count badge when escalations > 0.
- Routes: `/campaign/[id]/overview | seam | units | log | review | summary`. No campaign yet → `/` renders the shell with Seam active, other pages disabled.
- Top of content area: campaign name (mono), state chip, thin accent progress bar + `9/15 accepted` fraction. Pause/resume lands here in Phase 6.

## 5. Pages

**5.1 Overview** — a clean KPI dashboard (mock: `design/mocks/overview.html`), live via the existing WS events. Four KPI cards (Accepted x/y, In flight, First-pass rate, Escalated) · a "Needs attention" chip row linking to Review/Units · a Live activity feed (recent `unit_status` events as pill rows, "View all" → Log) · Units-by-status distribution bars · a compact seam summary. No decorative charts — every figure is real campaign state. Idle (no campaign) state doubles as the product explainer. *(Supersedes the round-1 isometric flow scene, kept at `design/mocks/overview-scene.html` for reference.)*

**5.2 Seam** — current wizard content as a page: repo input → mode → seam definition → grounded plan review → dependency graph → confirm & start. `CandidateList`: raw `combined/centrality/activity` scores become one plain-language line, exact scores in a tooltip. Keep `DependencyGraph`, recolor to tokens, add a legend.

**5.3 Units** — tile board default (table as a density toggle). Tile: lamp (pulse on running/retrying), scope path mono, files/loc, test fraction, amber `round 2/3` when retrying. Sort: escalated → retrying → running → queued → accepted. Click → drawer (480px, Esc closes, focus trap): attempt timeline per round, tabs for Diff and Live Preview (existing components move in unchanged).

**5.4 Dispatch Log** — full-page feed merging `unit_reasoning` + `unit_status` WS events + `UnitEvent` history (all already available, no new endpoints). Format: `14:32:07  U-07  RETRY   round 2 dispatched…`, verb in status color. Filter by unit/verb.

**5.5 Review** — escalation queue: red lamp, scope, reason, time, failure log, diff. Read-only until Phase 6. Empty state: "Nothing needs you. The foreman will call."

**5.6 Summary** — mono tally line, per-unit results, PR section. Delete `CampaignSummaryChart.tsx` and the recharts dependency.

## 6. File mapping (patch, don't regenerate)

| Current | Becomes |
|---|---|
| `app/layout.tsx` | Shell: sidebar + content grid, fonts |
| `app/page.tsx` | Shell with Seam page active (no-campaign state) |
| `app/campaign/[id]/page.tsx` | Split into the 6 route segments above |
| NEW `components/Sidebar.tsx` | Nav + ACTIVE campaign widget |
| `UnitStatusTable.tsx` | Table-toggle inside NEW `UnitBoard.tsx` + `UnitTile.tsx` |
| NEW `UnitDrawer.tsx` | Hosts attempt timeline + `DiffView` + `UnitPreviewPanel` as tabs |
| `ReasoningLog.tsx` | → `DispatchLog.tsx` (page) |
| `EscalationPanel.tsx` | → `ReviewQueue.tsx` (page) |
| `CampaignSummaryChart.tsx` | DELETE (+ recharts from package.json) |
| `StatusBadge.tsx` | Keep; recolor, purple → red |
| `PlanIntentForm/ManualSeamForm/ModeToggle/CandidateList/DependencyGraph` | Keep on Seam page, reskin |
| NEW `components/OverviewDashboard.tsx` (+ `KpiCard`, `StatusBars`, `ActivityFeed`) | Overview page — built only after mock approval |
| `globals.css` | Charcoal body, focus rings, scrollbar to tokens |

## 7. Phases (each = one PR on `redesign/control-room`)

1. **Tokens + fonts + dead code** — recolor in place, purple → red, focus rings, delete dead tokens/dup hex map. No layout changes.
2. **Shell + routing** — sidebar, 6 route segments, ACTIVE widget, top strip.
3. **Units page** — board, tiles, drawer migration.
4. **Log + Review + Summary pages** — DispatchLog merge, ReviewQueue, tally line, delete recharts.
5. **Overview dashboard** — KPI cards, needs-attention row, activity feed, status bars, wired to live WS + campaign data. Mock: `design/mocks/overview.html`; implement only after its approval.
6. **GATED (backend + team approval):** pause/resume, escalation actions, per-unit token cost. New routes — flag per CLAUDE.md before touching.

## 8. Acceptance (reject any phase that fails)

- Every page was implemented from an approved mock in `design/mocks/`, not invented from prose
- Zero `slate-*` classes, zero gradients, zero purple, zero recharts
- Sidebar nav works on every page; ACTIVE widget updates live via WS
- Figures use `tabular-nums`; paths/IDs/logs/diffs in IBM Plex Mono
- Esc closes drawer; visible focus everywhere; `motion-reduce` verified
- 1440px screenshots read as a clean, modern ops dashboard, not a template
- Summary renders the mono tally line with real campaign numbers
