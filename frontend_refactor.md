# frontend_refactor.md — mockup → React conversion plan

Status: **planning doc, approved mocks in `design/mocks/`** (Revision 5 IA).
Branch: `redesign/control-room`. Design authority: Sujat.
Companion docs: [FRONTEND_REDESIGN.md](FRONTEND_REDESIGN.md) (tokens, IA, page specs),
[README.md](README.md) (API contracts), [CLAUDE.md](CLAUDE.md) (repo rules).

Progress convention: check a box only when the item is implemented **and verified
in the browser against the running backend** (MOCK_CODEX=1 demo repo run).

---

## 1. Decision summary

| Decision | Choice |
|---|---|
| Old `frontend/` | **Deleted entirely**, replaced by a fresh app in the same `frontend/` directory (keeps Docker Compose, port 3000, bind-mount, `npm install && npm run dev` untouched) |
| Framework | Next.js 14 App Router + React 18 + TypeScript (same major versions as today — no Docker/Node changes needed) |
| Styling | Tailwind with the `foreman.*` token set from `design/mocks/foreman.css` as the **only** palette; Inter + IBM Plex Mono via `next/font/google` |
| Dependencies | keep: `next`, `react`, `reactflow` (Plan-page blast radius). add: `lucide-react` (sidebar icons), `gsap` (Overview scene). drop: `recharts` |
| Contract layer | The old app's `lib/api.ts`, `lib/types.ts`, `lib/config.ts`, `lib/seamQueue.ts`, `hooks/useCampaignSocket.ts`, `utils/*` are **ported verbatim** into the new app (they mirror the frozen contracts and were just updated by the main merge) — everything above them is new |
| Routes | `/` = standalone landing (no shell) · `/campaign/[id]/overview\|plan\|batches\|chat\|log\|summary` = the shell |
| Batches | **A frontend-only concept.** The backend has units (one per file), no batches. Units are grouped client-side by top-level directory of `scopeGlob`; batch IDs `B-01…` assigned in sorted order; category colors from a fixed palette cycled deterministically. One shared `lib/batches.ts` derivation used by Overview, Batches, Log, Summary so grouping/colors never disagree between pages |
| Campaign history + Plan record | **Client-side store first** (`localStorage`, see §3) so Phases 1–7 need zero backend change; swapped for server data in Phase 8 when the additive endpoints land |

---

## 2. Page → backend contract map

Every endpoint below already exists on `main` (post-merge). No page in Phases 1–7
calls anything that isn't in [README.md](README.md)'s API table.

### `/` Landing (`design/mocks/landing.html`)
| UI element | Contract |
|---|---|
| Model indicator in composer | `GET /health` → `llm` field (display-only) |
| Repo chip → demo preset / remote URL | `POST /repo` `{repoUrl, branch?}` |
| Repo chip → "Connect GitHub" popover | `GET /github/status` (`oauthAvailable` gates Connect button vs. manual-token note; `oauthConnected` gates the repo list) |
| Connect GitHub button | full-page navigation to `githubOauthStartUrl("/")`; on return, `?github=connected\|cancelled\|error` query param → toast + reopen picker |
| Repo list + search in popover | `GET /github/repositories` |
| Branch chip | `GET /github/repository/{owner}/{repo}/branches` |
| **Scan** mode | `GET /repo/{id}/candidates` (+ `GET /repo/{id}/graph` for blast radius) |
| **Describe** mode | `POST /repo/{id}/discover` `{objective}` → grounded seam cards (approve / edit / reject per card) |
| **Autonomous** mode | same `POST /repo/{id}/discover`, single top-pick presented with one Confirm & execute (seams with `testCommand: null` excluded from execution, per backend rule) |
| Approve & start | `POST /repo/{id}/seam` per approved seam → first seam `POST /campaign` → route to `/campaign/{id}/overview`; remaining approved seams into `lib/seamQueue.ts` (already exists, ported) |

### Overview (`design/mocks/overview.html`)
- `WS /ws/campaign/{id}` (`unit_status` moves tokens, `unit_escalated` → dock, `unit_blocked` → dock with distinct label, `campaign_completed/failed` → end state) with the existing 2s `GET /campaign/{id}` polling fallback.
- KPI strip (accepted / in-flight / escalated / elapsed) derived from the unit array; elapsed from campaign start time in the client store.
- Replay for finished campaigns: Phase 1–7 replays a **synthesized** timeline from final unit states; true event-accurate replay needs the Phase-8 events endpoint.

### Plan (`design/mocks/plan.html`)
- Everything on this page (intent, mode, model, timestamps, grounded spec, batch breakdown, grounding stats, invariants, test command) comes from the **plan record captured at Start campaign** (§3) — the backend does not persist discovery output and `GET /campaign/{id}` doesn't return seam fields or `repoId` (see gap G1/G2).
- Blast-radius graph: `GET /repo/{id}/graph` (`repoId` from the plan record), rendered with reactflow recolored to tokens.

### Batches (`design/mocks/batches.html`)
- Board + tiles: units from `GET /campaign/{id}` + WS, grouped via `lib/batches.ts`; sort escalated → retrying → running → queued → accepted; `blocked`/`generation_failed`/`system_error` shown as a separate "blocked" strip (they are **not** escalations — post-merge distinction).
- Full-width detail: per-file cards use `unit.diff`, `unit.failureLog`, attempt count; **Live Preview / full test log** via `GET /campaign/{id}/unit/{id}/preview` (before/after/`testLog`, rendered per `fileType` — port `renderMarkdown.ts` + iframe sandbox approach).
- Deep links: `?open=B-xx` opens detail; escalated detail's "Discuss in chat →" links `chat?ref=B-xx`.

### Chat (`design/mocks/chat.html`)
- **No conversational endpoint exists — frozen contracts, Phase-9 gated.**
- Until then: the thread renders the captured planning session (objective, discovery summary, plan mini-card, approval) from the plan record, plus foreman-side system messages synthesized from campaign lifecycle events; `?ref=B-xx` prefills the failure prompt with the amber ring + reference chip; the composer is present but disabled with an explanatory hint ("live chat lands with the conversational endpoint").

### Log (`design/mocks/log.html`)
- Live tail: `unit_status` + `unit_reasoning` + `unit_escalated` + `unit_blocked` WS events appended as terminal lines (verb chip in status color, batch tag in category hue).
- On mount mid-campaign or for finished campaigns: synthesize a coarse backfill from `GET /campaign/{id}` unit states (real `unit_events` history needs the Phase-8 endpoint).
- Verb filter chips + batch select are client-side filters over the accumulated line buffer.

### Summary (`design/mocks/summary.html`)
- Figures + tally line + outcome-by-batch bars + per-unit table: `GET /campaign/{id}` (±loc parsed from unit diffs; "retries caught" = passed units with `attempt > 1`; duration from client-store timestamps until Phase 8).
- **Apply locally** (default publish): `POST /campaign/{id}/apply` → changed files, diff summary, local path, copyable git commands, `alreadyApplied` idempotence.
- **Create PR**: if `oauthConnected` → `POST /github/pull-request` `{campaignId}`; else `POST /campaign/{id}/finalize` `{githubToken?}` with the manual-token field; `502 pr_creation_failed` → fall back to aggregated diffs view.
- **Start next seam campaign**: pops `lib/seamQueue.ts` → `POST /campaign` → routes to the new campaign's overview.
- Follow-up card links into `batches?open=` of the first escalated batch.

### Shell (all campaign routes)
- Sidebar: collapsible 220px ↔ 64px icon rail (Lucide: factory, scroll-text, boxes, message-square, terminal, clipboard-check), state in `localStorage`; Batches nav item gets a red count badge when escalations > 0 (red dot when collapsed).
- Campaign history widget: from the client store (§3); the live campaign's lamp + `9/15` fraction updates via the shared WS context; clicking a past campaign switches the whole dashboard; "+ New" routes to `/`.
- Top strip: campaign name (mono), state chip, accent progress bar + accepted fraction — all from the shared campaign context.

---

## 3. Client-side campaign store (the no-backend-change enabler)

`lib/campaignStore.ts` — `localStorage`, versioned schema (`mf.campaigns.v1`). Written
at **Start campaign** on the landing page; the only source for Plan/Chat/history
data that the backend doesn't persist:

```ts
interface StoredCampaign {
  campaignId: string;
  repoId: string;            // GET /campaign/{id} doesn't return this (gap G1)
  repoUrl: string;
  seamId: string;
  title: string;             // discovered seam title / manual seam summary
  mode: "scan" | "describe" | "autonomous";
  model: string;             // /health llm at planning time
  objective: string;         // the typed intent
  plannedAt: string; approvedAt: string; startedAt: string;
  completedAt?: string; outcome?: "completed" | "failed";
  seam: Seam;                // patterns, scope, invariants, testCommand
  discovery?: {              // Describe/Autonomous: the approved DiscoveredSeam +
    seam: DiscoveredSeam;    // repoSummary for grounding stats on the Plan page
    repoSummary: RepoSummary;
    droppedSeams: DroppedSeam[];
  };
  chatExcerpt: ChatMessage[]; // landing-session messages replayed on the Chat page
}
```

Known, accepted limitations (all erased by Phase 8): history is per-browser;
opening a campaign URL on another machine shows live pages fine but Plan/Chat
render a "plan record not available on this browser" empty state; durations are
client-clock based.

---

## 4. Backend gap analysis

The contracts are frozen (CLAUDE.md); every item here is **additive**, requires
flagging to the team before implementation, and is deliberately parked in
Phase 8/9 so the entire UI ships first without touching the backend.

| # | Gap | Smallest additive fix |
|---|---|---|
| G1 | `GET /campaign/{id}` returns no `repoId` and no seam fields — a reloaded/foreign browser can't reach the graph or seam record | Enrich the response with `repoId` + embedded seam object (additive fields, no breakage) |
| G2 | Discovery output (intent, title, reasoning, grounding stats, mode, model) is never persisted — Plan page has no server source | Nullable `title`/`plan` (JSONB) columns on `seams`, written by `POST /repo/{id}/seam`; returned via G1 |
| G3 | No campaigns-list endpoint — sidebar history is per-browser | `GET /campaigns` (id, title, status, repo, created/completed, accepted/escalated counts) |
| G4 | `unit_events` table exists but has no read endpoint — Log backfill and Overview replay are synthesized approximations | `GET /campaign/{id}/events` (ordered, paginated) |
| G5 | `campaigns` has no `completed_at` — true durations impossible server-side | Nullable `completed_at` column set by the engine (schema change — flag explicitly) |
| G6 | No conversational chat endpoint | Full Phase-9 feature (endpoint + session persistence + engine hooks) — needs its own design + team approval, biggest lift by far |

---

## 5. Phases

Each phase = one reviewable PR on `redesign/control-room`. Phases 1–7 are
frontend-only. Phase 8 and 9 touch the backend and are **gated on team approval**.

### Phase 1 — Demolition + scaffold + tokens
- [x] Delete the old app: everything under `frontend/` except the ported files listed in §1 (old wizard `app/page.tsx`/`layout.tsx`/`globals.css`, all 14 old dashboard `components/*.tsx`, and the stale `app/campaign/[campaignId]/{page,summary/page}.tsx` routes)
- [x] Fresh Next.js 14 App Router scaffold in `frontend/` — `package.json` name fixed `frontend_2` → `frontend` (flagged here per the plan; harmless, `docker-compose.yml` bind-mounts by path not name, zero compose changes needed)
- [x] `tailwind.config.ts` with `theme.extend.colors.foreman.*` exactly matching `design/mocks/foreman.css` (the live/approved token values — note FRONTEND_REDESIGN.md §3's prose table is stale from an earlier revision and was not used); no default slate/blue usage anywhere
- [x] Inter (400–700) + IBM Plex Mono (400/500) via `next/font/google`; `tabular-nums` utility; 12px card / 8px control radii; the one card shadow token; global 2px `link`-blue focus rings; `prefers-reduced-motion` base rules
- [x] Port `lib/api.ts`, `lib/types.ts`, `lib/config.ts`, `lib/seamQueue.ts`, `hooks/useCampaignSocket.ts`, `utils/formatUnitStatus.ts`, `utils/matchGlob.ts`, `utils/renderMarkdown.ts` unchanged; `npm run build` passes with a placeholder page (also added missing `.eslintrc.json` — `next lint` had no config to run against; `npm run lint` is clean)
- [x] New `lib/batches.ts` (unit → batch derivation + category palette) with the sort order from §2
- [x] New `lib/campaignStore.ts` (§3) with versioned localStorage schema
- [x] Verify: container comes up, `/` renders the placeholder, `GET /health` round-trip works from the browser (MOCK_CODEX=1 docker compose run — confirmed `backend: ok · llm: mock` rendered live, screenshot taken, no console errors)

### Phase 2 — Landing page (`/`)
- [ ] Hero + centered composer per `landing.html`: greeting, textarea, model indicator (from `/health`), near-black round submit
- [ ] Repo chip + popover picker: demo preset, remote URL entry, folder/local path entry (container-visible path note)
- [ ] GitHub connect flow: `oauthAvailable`/`oauthConnected` gating, OAuth redirect + return-param handling, repo list with search, branch picker chip, private-repo clone via `POST /repo {repoUrl, branch}`
- [ ] Mode chips **Scan / Describe / Autonomous** with the mock's dropdown behavior; composer role follows mode
- [ ] Scan: ranked candidates (plain-language score line — no raw algorithm scores), blacklisted candidates visibly disabled
- [ ] Describe: discovery result cards — overall strip (seam count, files, risk, est. minutes), expandable per-seam cards with approve/edit/reject, always-visible editable verification command, dropped-seams note
- [ ] Autonomous: single top-pick card + Confirm & execute; refuses when top candidate is blacklisted (surface the backend error shape)
- [ ] Approve & start: seam creation, seam queue population, campaign creation, plan-record write to `campaignStore`, route to `/campaign/{id}/overview`
- [ ] Error states for every call using the uniform `{error, message}` shape; loading states on all async chips/buttons
- [ ] Verify end-to-end against MOCK_CODEX demo repo: all three modes reach a running campaign

### Phase 3 — Shell + routing + live data layer
- [ ] `app/campaign/[id]/layout.tsx`: two-column shell, content area, no shell on `/`
- [ ] `components/Sidebar.tsx`: collapsible rail (localStorage persistence), Lucide icons, active state with 2px accent bar, FOREMAN logo mark, escalation count badge on Batches
- [ ] Campaign history widget: live campaign pinned (lamp + fraction), past campaigns with outcome + age, click-to-switch, "+ New" → `/`
- [ ] `CampaignProvider` context: one `useCampaignSocket` connection + 2s polling fallback shared by all six pages; accumulates the WS event buffer (feeds Log) and derived batch state; writes terminal status back to `campaignStore`
- [ ] Top strip: campaign title (mono), state chip, accent progress bar + `n/m accepted` fraction
- [ ] Six route segments with real layout scaffolds (placeholder content allowed)
- [ ] Verify: navigation works collapsed + expanded, history switches campaigns, WS reconnect/poll fallback observed

### Phase 4 — Batches page
- [ ] `BatchBoard.tsx` + `BatchTile.tsx`: category dot, status pill, files/done/tests, sorted per §2; escalated tiles first with red tint + reason
- [ ] Blocked strip: `blocked`/`generation_failed`/`system_error` units presented separately from escalations (post-merge `unit_blocked` semantics)
- [ ] `BatchDetail.tsx` full-width below the board: per-file cards with diff (`DiffView` rebuilt to tokens), test fraction, attempt/round timeline; failure reason + failure log on failed files
- [ ] Live Preview integration per file type (markdown render / sandboxed HTML / CSS sample / side-by-side code) + full test log via the preview endpoint
- [ ] Deep links: `?open=B-xx` in, "Discuss in chat →" (`chat?ref=B-xx`) out
- [ ] Verify with a demo-repo run containing escalations: board reorders live, detail updates, deep links round-trip

### Phase 5 — Plan + Log + Summary
- [ ] Plan: quoted mono intent hero + meta row (mode, model, planned/approved times, Chat link), grounded before/after code pair, scope + blacklist, batch breakdown in category colors (legend = Overview color key), test command/invariants/retry policy, grounding stats, reactflow blast-radius graph recolored to tokens; graceful empty state when no plan record (§3)
- [ ] Log: terminal card (the one dark surface), mono lines `HH:MM:SS batch·unit VERB detail`, verb color + batch hue, blinking tail cursor, auto-scroll with scroll-lock-on-hover, verb filter chips + batch select, coarse backfill on mount
- [ ] Summary: mono tally line with real numbers (peak-end), figures row (files, ±loc, retries caught, escalated), outcome-by-batch bars (pure CSS/SVG — recharts stays deleted), per-unit table with batch column
- [ ] Summary publishing: Apply-locally card (changed files, git commands, `alreadyApplied`), PR card (session vs. manual-token vs. `pr_creation_failed` fallback per §2), follow-up card → Batches deep link, **Start next seam campaign** from the queue
- [ ] Verify: full demo campaign read end-to-end on all three pages; a queued second seam starts from Summary

### Phase 6 — Overview flow scene
- [ ] Port the isometric SVG scene from `overview.html` into `components/FlowScene.tsx` (GSAP timelines; `prefers-reduced-motion` → static state swaps)
- [ ] Wire to `CampaignProvider`: tokens per unit in batch category colors, moved by `unit_status`; retry loop on `retrying`; escalation dock on `unit_escalated`; blocked units to the dock with distinct treatment; complete state on `campaign_completed`
- [ ] KPI strip bound to derived campaign state; caption line; idle state = product explainer
- [ ] Token click → routes to `batches?open=B-xx` for that unit's batch
- [ ] Replay for finished campaigns (synthesized timeline from final states; clearly labeled)
- [ ] Verify all 5 states (idle, running, retry looping, escalation docked, complete) against a live mock run

### Phase 7 — Chat page (UI only) + polish pass
- [ ] `ChatThread.tsx` + `ChatComposer.tsx` per `chat.html`: foreman left / user right, plan mini-card in the planning excerpt (from `campaignStore`), synthesized lifecycle messages, sticky composer **disabled** with the Phase-9 hint
- [ ] `?ref=B-xx` prefill: amber ring + reference chip + failure prompt text
- [ ] Full acceptance sweep (FRONTEND_REDESIGN.md §8): zero slate/gradients/purple/recharts, tabular-nums audit, mono audit, focus-visible audit, `motion-reduce` audit, 1440px screenshots of all pages
- [ ] Remove any leftover dead files; `npm run lint` + `npm run build` clean
- [ ] Verify: full demo walkthrough — landing → campaign → escalation → summary → apply locally → next seam — with no dev-console errors

### Phase 8 — Backend additive endpoints (⚠ requires team flag per CLAUDE.md before starting)
- [ ] Flag G1–G5 (§4) to the team; get written go-ahead
- [ ] G1: enrich `GET /campaign/{id}` with `repoId` + embedded seam
- [ ] G2: persist `title` + plan JSONB on seam creation; return via G1
- [ ] G3: `GET /campaigns` list endpoint
- [ ] G4: `GET /campaign/{id}/events` (unit_events read API)
- [ ] G5: `campaigns.completed_at` set on completion
- [ ] Frontend swap: history widget + Plan page + Log backfill + Overview replay + durations read server data; `campaignStore` demoted to a write-through cache
- [ ] Verify: fresh browser (empty localStorage) renders every page of an existing campaign correctly

### Phase 9 — Conversational Chat (⚠ gated: new architecture, own design doc + team approval)
- [ ] Design doc: chat persistence model, endpoint contract, LLM session continuation, re-dispatch-from-chat semantics
- [ ] Team approval recorded
- [ ] Backend implementation
- [ ] Enable the composer; failed-batch discussion flow live end-to-end
- [ ] (Same gate, if approved) pause/resume + escalation actions on the top strip

---

## 6. Acceptance (from FRONTEND_REDESIGN.md §8, restated as the exit bar)

- Every page implemented from its approved mock in `design/mocks/`, not from prose
- Zero `slate-*`, zero gradients, zero purple, zero recharts
- Sidebar works on every page collapsed and expanded; history updates live via WS
- Figures `tabular-nums`; paths/IDs/logs/diffs IBM Plex Mono
- Batch detail reachable by click and `?open=` deep link; visible focus everywhere; `motion-reduce` verified
- 1440px screenshots read as a clean modern ops dashboard
- Summary renders the mono tally line with real campaign numbers
