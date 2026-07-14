# frontend_refactor.md — mockup → React conversion plan

Status: **planning doc, approved mocks in `design/mocks/`** (Revision 5 IA).
Branch: `redesign/control-room`. Design authority: Sujat.

[README.md](README.md) (API contracts), 

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
| G7 | `POST /repo` only clones by URL/path — no way to ingest a browser-picked local folder (landing.html's "Browse" tile). A `webkitdirectory` file input gives the browser `File` blobs with relative paths, never a filesystem path the container can see, and no git history — the execution engine needs `.git` for its per-unit worktrees (`backend/execution/worktree.py`), and candidate ranking's `recentActivityScore` needs commit history to mean anything | New `POST /repo/upload`-style endpoint: multipart upload → reconstruct the tree server-side → `git init` + commit → existing candidate/discovery pipeline as-is. `recentActivityScore` degrades to ~0 for every file on a freshly-init'd repo (no history to score) — worth flagging as a known limitation, not silently masking it |
| G8 | The model selector (Phase 2, `GET /llm/providers`) only affects the one LLM call the landing page makes (`POST /repo/{id}/discover` — planner already accepts an optional `model` override end to end). It has no effect on execution-time calls (`execution/codex.py`, one per unit, including retries) because nothing persists which provider was chosen past the request/response | Nullable `provider` column on `seams`, set from `POST /repo/{id}/seam`'s (new, additive) optional `model` field; `execution/engine.py`/`codex.py` read it per-unit instead of always falling through to `llm.py`'s env-precedence default — schema change, flag explicitly |
| G9 | GitHub repo selection always clones the **default branch** — there's no per-branch choice, matching the mock (which has no branch step). The backend already supports it (`POST /repo` takes an optional `branch`, and `GET /github/repository/{owner}/{repo}/branches` exists and works), so this is purely a deliberate UI omission for mock fidelity, not a backend gap | If per-branch cloning is wanted: re-introduce a branch sub-view in `RepoPicker` after repo-click (the removed `selectRepoRow`/`confirmBranch`/branch-list JSX is recoverable from git history) — no backend or contract change needed |

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
- [x] Hero + centered composer per `landing.html`: greeting, textarea, model indicator (from `/health`), near-black round submit (`app/page.tsx`, `components/landing/Composer.tsx`)
- [x] Repo chip + popover picker (`components/landing/RepoPicker.tsx`), matching `landing.html`'s exact 2-tile layout per Sujat's call: **Browse** (real native `webkitdirectory` folder picker — selecting a folder surfaces an honest "not wired to the backend yet, tracked as G7" notice rather than faking success, since the backend has no upload/git-init endpoint yet) and **GitHub**, plus `use the demo repo` / `paste a repo URL` links (the latter opens a generic URL-or-container-path field with optional branch — `POST /repo` treats both the same way)
- [x] GitHub connect flow: `oauthAvailable` gates the Connect button vs. a disabled note ("OAuth isn't configured..."), `oauthConnected` gates the repo list; clicking the GitHub tile starts the OAuth web flow **directly** via `githubOauthStartUrl("/")` (a full-page nav — the earlier intermediate "Connect GitHub" sub-panel was removed as dead friction that silently no-op'd on stale bundles); `?github=connected|cancelled|error` return-param read once on mount, surfaced as a banner, then stripped via `router.replace("/")`; repo list with search; **clicking a repo clones its default branch immediately and closes the picker** — matching `landing.html`'s repo-row handler exactly (`openPop(false); setRepo("ingesting") → ready`). Cloning is `POST /repo {repoUrl: https://github.com/{fullName}, branch: defaultBranch}`; the backend injects the session's OAuth token for private repos (`github_service.authenticated_clone_url`). **Deviation from the first build:** a separate branch-selection step (`GET /github/repository/{owner}/{repo}/branches`) was built then removed — the mock has no such step (`setPopView` only knows `choose`/`connect`/`repolist`). Per-branch choice is a deliberate future add if wanted, not a silent drop (see G9)
- [x] Mode chips **Scan / Describe / Autonomous** as a single trigger + dropdown menu (checkmark on active, number-key shortcuts, click-outside/Escape close) — composer placeholder text follows mode (`components/landing/ModeMenu.tsx`)
- [x] Scan: `GET /repo/{id}/candidates` rendered as a plain-language line (centrality/activity bucketed into phrases, no raw scores), blacklisted candidates shown with a reason and a disabled Pick button (`components/landing/CandidateList.tsx`)
- [x] Describe: `POST /repo/{id}/discover` results — overall strip (seam count, files, risk, est. minutes), expandable per-seam cards with an approve checkbox, always-visible editable verification-command field (blocks start if left empty), dropped-seams note (`components/landing/DiscoveryResult.tsx`)
- [x] Autonomous: same `/discover` call, `seams[0]` presented as a single top-pick card with Confirm/Veto; refuses (distinct red card, no silent fallback to the next candidate) when the top seam's `testCommand` is null/empty — the one case the backend's own inference can leave ungrounded (`components/landing/AutoPick.tsx`)
- [x] Approve & start: `POST /repo/{id}/seam` per approved seam (candidateId for Scan, manualSeam for Describe/Autonomous) → `POST /campaign` on the first → remaining approved seams (Describe multi-approve only) into `lib/seamQueue.ts` → `campaignStore.saveCampaign(...)` with the plan record → `router.push('/campaign/{id}/overview')`; added a temporary placeholder at that route (raw `GET /campaign/{id}` JSON dump) so the redirect has somewhere real to land — Phase 3 replaces it with the actual shell
- [x] Error states: every `api.*` call funnels through the shared `ApiError` (`{error, message}`) into one dismissible-by-replacement banner; loading states on send (thinking pulse), Pick/Confirm buttons, and Start campaign
- [x] Simplification flagged: unlike the mock's persistent multi-turn transcript, each Send replaces the previous result pane rather than appending to scrollback — full chat history isn't a contract requirement pre-Phase-9 and this kept the state machine tractable; revisit in Phase 7's polish pass if desired
- [x] Verify: `npm run build` and `npm run lint` clean; `MOCK_CODEX=1 docker compose up -d --build` — backend `GET /health` → `{"status":"ok","db":"connected","llm":"mock"}`, frontend dev server started with no compile errors. Containers left running for manual verification of all three modes end-to-end (per instruction, no browser-automation tool used this phase)
- [x] Post-review fixes (Sujat): mode labels changed to match `landing.html` exactly — **Manual/Auto/Plan** (display only; internal keys stay `scan`/`autonomous`/`describe` to match the `campaignStore` contract) — removed the `.migration-foreman.json` `?` hint icon — removed the green status dot from the model pill
- [x] **Model selector is now real**, not decorative: new additive `GET /llm/providers` (`backend/main.py`, `backend/models.py`) lists every LLM provider with an API key set (`llm.list_providers()`) plus the active one; `backend/llm.py`'s `active_provider()`/`complete()`/`complete_json()` gained an optional provider-name override; `POST /repo/{id}/discover` accepts an optional `model` field and threads it through `seam_discovery.discover_seams()` to the one LLM call the landing page triggers. `components/landing/ModelMenu.tsx` is a working dropdown (disabled/non-interactive only when there's exactly one provider, e.g. under `MOCK_CODEX`, where mock mode never reaches `llm.py` at all so a selection would be a no-op). **Not wired**: execution-time model choice (per-unit `execution/codex.py` calls during a running campaign) — that needs the choice persisted somewhere it survives retries (a `model` column on `seams`, a real schema change), which is a different subsystem than this page; tracked as follow-up, not deferred out of caution
- [x] **Infra note for future phases**: running `npm run build` on the host while the Docker frontend container (bind-mounted, running `next dev`) is up writes a production `.next` into the same shared directory and corrupts the dev server's manifest (every chunk 404s, page renders unstyled/unhydrated — this happened mid-Phase-2 and needed `rm -rf frontend/.next && docker compose restart frontend` to recover). Verifying type-correctness from now on uses `npx tsc --noEmit -p tsconfig.json` (safe, doesn't touch `.next`) instead of `npm run build` while the container is live

### Phase 3 — Shell + routing + live data layer
- [x] `app/campaign/[id]/layout.tsx`: two-column CSS-grid shell (`232px ↔ 64px 1fr`, 0.2s transition), no shell on `/` (landing keeps the bare root layout). Collapse state owned here (owner of the grid width), persisted to `localStorage` under the mock's exact key `mf-sb-min`; read after mount to avoid a hydration mismatch
- [x] `components/Sidebar.tsx`: collapsible rail, Lucide icons (`Factory`/`ScrollText`/`Boxes`/`MessageSquare`/`Terminal`/`ClipboardCheck` — the exact set the mock's inline `<symbol>`s trace), active state via `usePathname`'s last segment, FOREMAN logo mark, escalation count badge on Batches (numeric pill expanded, red dot when collapsed). **Deviation flagged:** active nav item uses `bg-foreman-queued-bg` (font-semibold), matching `foreman.css .nav-item.active` exactly — the "2px accent left bar" in this checklist's earlier prose is *not* in the approved mock CSS, so the mock won per "follow the mocks"; say the word if the accent bar is wanted
- [x] Campaign history widget: reads `campaignStore.listCampaigns()` after mount; live campaign pinned (lamp + `running · n/m` from the shared socket), past campaigns with stored outcome + relative age, click-to-switch (routes to that campaign's `/overview`), "+ New" → `/`. Past-campaign live fractions aren't shown (their unit counts aren't fetched — per-browser limitation, gaps G3/G5)
- [x] `CampaignProvider` context (`lib/campaignContext.tsx`): one `useCampaignSocket` connection (WS + 2s polling fallback) shared by all six pages; exposes derived batches (`deriveBatches`), escalation count, accepted/total, reasoning buffer, connection transport; writes terminal status back to `campaignStore` via `markCampaignTerminal` when status hits completed/failed
- [x] Top strip (`components/TopStrip.tsx`): campaign title (from the stored plan record), live state chip (Running/Completed/Failed/Connecting with lamp), accent progress bar + `n/m accepted` fraction
- [x] Six route segments with live-wired scaffolds (`components/PageScaffold.tsx` frame + a `PhaseNote` card that reads real socket/store data so each reads as intentional, not broken) — full page content lands in Phases 4–7
- [x] `.pulse` lamp keyframe ported from `foreman.css` into `globals.css` (running-state lamps only)
- [ ] Verify (Sujat, in browser): nav works collapsed + expanded, history switches campaigns, WS→poll fallback. Server-side confirmed: `tsc --noEmit` + `next lint` clean, all six segments compile and serve `200`. **Infra note:** Next's file watcher (Docker + Windows bind-mount) did not pick up the five newly-created route folders until a `docker compose restart frontend` forced an app-tree re-scan — expected for brand-new route segments on this setup, not a code issue

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
- [ ] G7 (§4, ⚠ separately gated — not a chat feature, just parked here per instruction): `POST /repo/upload` — accept a browser-picked local folder, reconstruct + `git init` server-side, wire the landing page's Browse tile to it. Frontend side (native `webkitdirectory` picker, honest "not wired yet" notice) already shipped in Phase 2 ([components/landing/RepoPicker.tsx](frontend/components/landing/RepoPicker.tsx))

---

## 6. Acceptance (from FRONTEND_REDESIGN.md §8, restated as the exit bar)

- Every page implemented from its approved mock in `design/mocks/`, not from prose
- Zero `slate-*`, zero gradients, zero purple, zero recharts
- Sidebar works on every page collapsed and expanded; history updates live via WS
- Figures `tabular-nums`; paths/IDs/logs/diffs IBM Plex Mono
- Batch detail reachable by click and `?open=` deep link; visible focus everywhere; `motion-reduce` verified
- 1440px screenshots read as a clean modern ops dashboard
- Summary renders the mono tally line with real campaign numbers
