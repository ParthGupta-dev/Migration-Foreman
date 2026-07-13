# FRONTEND_REDESIGN.md — handoff for Claude Code

Design authority: Sujat. This is the only frontend redesign doc — do not create or reference any other design/spec file.

> **Revision 2 (2026-07-13, approved by Sujat):** direction changed from dark
> industrial charcoal to a **clean light dashboard** — white cards on a soft
> gray canvas, rounded corners, tinted status pills, minimal color. §2, §3,
> §5.1, §6, §7 and §8 updated to match.
>
> **Revision 3 (2026-07-13, Sujat):** Overview stays the **isometric flow
> scene** (restyled to the light palette), not a KPI dashboard — that variant
> was built and rejected. Mock: `design/mocks/overview.html`.
>
> **Revision 4 (2026-07-13, Sujat):** the dashboard is **gated by a standalone
> landing page** at `/` — a centered composer (repo-source chips above, mode
> chips below, model indicator inside), no sidebar shell. Repo intake, mode
> choice and plan approval all happen there; **Start campaign is the moment
> the shell first exists.** This replaces the old rule "no campaign → shell
> with Seam active, others disabled". The in-dashboard Seam page becomes the
> read-only record of the approved seam (mock rework pending). Mock:
> `design/mocks/landing.html`.
>
> **Revision 5 (2026-07-13, Sujat):** IA rework. Sidebar becomes
> **collapsible** (220px ↔ icon rail) with Lucide icons per page, and the
> ACTIVE widget is replaced by a **campaign history** list (live campaign
> pinned, past campaigns switch the whole dashboard; finished ones can be
> **replayed** in the Overview scene). Page changes: **Seam → Plan**
> (read-only record of the full agreed plan), **Units → Batches** (batch
> tiles → full-width detail with every diff/test/attempt; **absorbs and
> deletes the Review page**; failed batches get a **"Discuss in chat"**
> button that deep-links Chat with a prefilled failure prompt), new **Chat**
> page (the landing planning session continues in the shell — conversational
> endpoint is Phase-6 gated), **Log** becomes a terminal-style tail (the one
> deliberate dark surface), **Summary** becomes the post-run report
> (figures, outcome-by-batch bars, replay CTA). §4, §5, §6 updated. Mocks:
> `plan/batches/chat/log/summary.html`; `seam/units/review.html` deleted.

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
4. **Motion lives in the flow scene; the chrome stays still.** Expressive animation belongs to the Overview scene only. Elsewhere: drawer slide, log auto-scroll, lamp pulse — nothing else moves. `prefers-reduced-motion` respected everywhere.
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
│ 220px⇄ │                                               │
│ ▪ FORE-│  (collapsible to a 64px icon rail; state in   │
│   MAN  │   localStorage; icons = Lucide)               │
│ ────── │                                               │
│ ⌂ Over-│  factory                                      │
│    view│                                               │
│ ≡ Plan │  scroll-text                                  │
│ ▤ Batch│  boxes — red count badge when escalations > 0 │
│ ◉ Chat │  message-square                               │
│ ▹ Log  │  terminal                                     │
│ ✓ Summ.│  clipboard-check                              │
│ ────── │                                               │
│CAMPAIGN│  ← history list, like a chat app: live one    │
│ ● lgcy…│    pinned (lamp + 9/15, live via WS), past    │
│ ● httpx│    ones below (outcome + age). Click switches │
│ + New  │    the whole dashboard to that campaign;      │
└────────┴─   finished ones replay in Overview. ─────────┘
```

- Sidebar: fixed, `surface` bg, 1px `line` right border. Logo = 8px accent square + FOREMAN wordmark (Archivo semibold, uppercase). Nav items 13px, `dim` → `ink` active with 2px accent left bar. Batches shows a red count badge when escalations > 0 (a red dot on the icon when collapsed).
- Routes: `/campaign/[id]/overview | plan | batches | chat | log | summary`. `/` is the **standalone landing page** (Rev 4) — no shell; the shell only ever renders with a live campaign behind it. "New campaign" in the history list routes to `/`.
- Top of content area: campaign name (mono), state chip, thin accent progress bar + `9/15 accepted` fraction. Pause/resume lands here in Phase 6.

## 5. Pages

**5.0 Landing** (mock: `design/mocks/landing.html`) — the pre-dashboard gate at `/`. Centered composer, Claude-style: greeting CTA ("What should we migrate?"), repo-source chip row above the input (Local path — container-visible only, since the backend is in Docker — or Remote URL, with the demo repo as a preset; popover picker), textarea whose role follows the mode, model indicator (mono, from `GET /health`'s `llm` field, display-only) + near-black round submit inside the card, mode chips below (**Scan / Describe / Autonomous** = the existing candidates / plan / autonomous modes). Results grow downward: Describe → grounded-plan card; Scan → ranked candidates; Autonomous → single top-pick with approve/veto. Approved plan shows blast radius + **Start campaign**, which creates the campaign and routes into the shell.

**5.1 Overview** — the live flow scene, light theme (mock: `design/mocks/overview.html`). Pipeline as spatial flow, driven by WS events: PLAN → WORKTREES (parallel lanes) → GATE → ACCEPTED → PR, plus a RETRY LOOP (amber, back into a lane) and ESCALATION DOCK (red siding). Unit tokens move on `unit_status` events; light-gray isometric slabs on a white card, tokens in status colors. Isometric 2.5D SVG + GSAP, not Three.js. Click a token → same drawer as Units. Idle state doubles as the product explainer, one caption line beneath. 5 states: idle, running, retry looping, escalation docked, complete.

**5.2 Plan** (Rev 5, was Seam; mock: `design/mocks/plan.html`) — the **read-only record of the full agreed plan**: intent as a quoted mono hero + meta (mode, model, planned/approved times, link to the Chat session), grounded spec with a rendered before/after code pair, scope + blacklist, **batch breakdown in the Overview scene's category colors** (the legend doubles as the scene's color key), test command + invariants + retry policy, grounding stats, blast-radius graph with legend. `CandidateList` plain-language score line applies on Landing.

**5.3 Batches** (Rev 5, was Units; mock: `design/mocks/batches.html`) — batch tiles (category dot, status pill, files/done/tests), sorted escalated → retrying → running → queued → accepted. Click a batch → **full-width detail below the board** (not the old 480px drawer): per-file cards with every diff, test fraction, rounds; failed files add the failure reason, failure log and attempt timeline. **Absorbs the Review page** — escalated batches sit first with red tint and reason on the tile. Escalated batch detail has a red **"Discuss in chat →"** button deep-linking `chat?ref=B-xx`. Deep link in: `batches?open=B-xx`.

**5.4 Chat** (Rev 5, new; mock: `design/mocks/chat.html`) — the landing-page planning session continues inside the shell: one thread per campaign, foreman left / user right, plan mini-card in the planning excerpt, sticky composer. Arriving via `?ref=B-xx` prefills "Batch x failed verification — explain why it failed and propose a fix" with an amber ring + reference chip. **Backend note: no conversational endpoint exists in the frozen contracts — real implementation is Phase-6 gated**; the mock is approved design only.

**5.5 Log** (Rev 5; mock: `design/mocks/log.html`) — terminal-style live tail: the **one deliberate dark surface** in the light shell (near-black card, everything around it stays light). Mono lines `14:32:07  export·U-07  RETRY  round 2 dispatched…`, verb in status color, batch tag in the batch's category hue, blinking cursor on the tail line. Verb filter chips + batch select. Merges `unit_reasoning` + `unit_status` WS events + `UnitEvent` history (no new endpoints).

**5.6 Summary** (Rev 5; mock: `design/mocks/summary.html`) — the post-run **report**: mono tally line (peak-end, unchanged), what-changed figures row (files, ±loc, retries caught, escalated), **Replay in Overview** CTA, outcome-by-batch bars (batch color + red escalated slice), PR card, follow-up card linking into Batches, per-unit table with a batch column. Delete `CampaignSummaryChart.tsx` and the recharts dependency.

## 6. File mapping (patch, don't regenerate)

| Current | Becomes |
|---|---|
| `app/layout.tsx` | Shell: sidebar + content grid, fonts |
| `app/page.tsx` | Standalone landing page (repo intake → mode → plan approval), no shell |
| `app/campaign/[id]/page.tsx` | Split into the 6 route segments above |
| NEW `components/Sidebar.tsx` | Collapsible nav (Lucide icons) + campaign history list |
| `UnitStatusTable.tsx` | → NEW `BatchBoard.tsx` + `BatchTile.tsx` (batch grouping) |
| NEW `BatchDetail.tsx` | Full-width detail: per-file diffs (`DiffView`), failure log, attempt timeline, `UnitPreviewPanel` |
| `ReasoningLog.tsx` | → `LogTerminal.tsx` (page) |
| `EscalationPanel.tsx` | DELETE — content lives in `BatchDetail.tsx` |
| NEW `ChatThread.tsx` + `ChatComposer.tsx` | Chat page (UI now; live endpoint Phase 6) |
| `CampaignSummaryChart.tsx` | DELETE (+ recharts from package.json) |
| `StatusBadge.tsx` | Keep; recolor, purple → red |
| `PlanIntentForm/ManualSeamForm/ModeToggle` | Stay on Landing (seam creation moved there, Rev 4) |
| `CandidateList/DependencyGraph` | `CandidateList` on Landing; `DependencyGraph` on Plan page, recolor to tokens |
| NEW `components/FlowScene.tsx` | Overview scene — built only after mock approval |
| `globals.css` | Charcoal body, focus rings, scrollbar to tokens |

## 7. Phases (each = one PR on `redesign/control-room`)

1. **Tokens + fonts + dead code** — recolor in place, purple → red, focus rings, delete dead tokens/dup hex map. No layout changes.
2. **Shell + routing** — collapsible sidebar, 6 route segments (overview/plan/batches/chat/log/summary), campaign history widget, top strip.
3. **Batches page** — batch board, tiles, full-width detail (absorbs Review).
4. **Plan + Log + Summary pages** — plan record, terminal log merge, report + tally line, delete recharts. Chat page ships its UI here too, wired only to history/reasoning until Phase 6 unlocks the conversational endpoint.
5. **Overview flow scene — mock first.** The standalone mock lives at `design/mocks/overview.html` (no app wiring, static/fake data): 5 states (idle, running, retry looping, escalation docked, complete) + the gate-fail → retry transition. Iterate on this file directly with Sujat until he approves it. Only after approval does real `components/FlowScene.tsx` begin, wired to live WS data.
6. **GATED (backend + team approval):** pause/resume, escalation actions, per-unit token cost, **conversational Chat endpoint** (continue the planning session, re-dispatch from chat), campaigns-list endpoint for the history widget if none exists, event-history replay feed. New routes — flag per CLAUDE.md before touching.

## 8. Acceptance (reject any phase that fails)

- Every page was implemented from an approved mock in `design/mocks/`, not invented from prose
- Zero `slate-*` classes, zero gradients, zero purple, zero recharts
- Sidebar nav works on every page, collapsed and expanded; history widget updates live via WS
- Figures use `tabular-nums`; paths/IDs/logs/diffs in IBM Plex Mono
- Batch detail reachable by click and by `?open=` deep link; visible focus everywhere; `motion-reduce` verified
- 1440px screenshots read as a clean, modern ops dashboard, not a template
- Summary renders the mono tally line with real campaign numbers
