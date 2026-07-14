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
| G1 | `GET /campaign/{id}` returns no `repoId` and no seam fields — a reloaded/foreign browser can't reach the graph or seam record | **✅ Landed & live.** Response now carries `repoId` + embedded `seam` (with nullable `title`/`plan`) + `createdAt`/`completedAt`. **Consumed** by Plan (spec/scope/graph from the server seam, so it renders with no plan record) and Summary (real durations). No longer frontend-scope. |
| G2 | Discovery output (intent, title, reasoning, grounding stats, mode, model) is never persisted — Plan page has no server source | Nullable `title`/`plan` (JSONB) columns on `seams`, written by `POST /repo/{id}/seam`; returned via G1 |
| G3 | No campaigns-list endpoint — sidebar history is per-browser | **✅ Landed & live.** `GET /campaigns` returns id/title/status/repo/created/completed + accepted/escalated counts. A typed `getCampaigns` fetcher is in `lib/api.ts`; merging it into `Sidebar.tsx`'s history widget (still client-store-only) is the one remaining optional wire-up (nice-to-have, not done — the per-browser store already works). |
| G4 | `unit_events` table exists but has no read endpoint — Log backfill and Overview replay are synthesized approximations | **✅ Landed & live.** `GET /campaign/{id}/events` returns the real ordered/paginated history (`created`/`status_change`/`codex_rationale`). **Consumed** by the Log page (real verb feed via `lib/logLines.ts`, no synthesised backfill) and the Overview replay (event-accurate token motion). The synthesised approach was dropped as throwaway. No longer frontend-scope. |
| G5 | `campaigns` has no `completed_at` — true durations impossible server-side | **✅ Landed & live.** `GET /campaign/{id}` now returns `createdAt`/`completedAt`. **Consumed** by Summary + Overview for real durations (`lib/format.ts` `duration()`), falling back to client-clock only when absent. No longer frontend-scope. |
| G6 | No conversational chat endpoint | **✅ Landed & live (Phase 9 backend done).** `GET`/`POST /campaign/{id}/chat` (persists both turns, real mock-aware reply) + `POST /campaign/{id}/chat/retry-unit/{unitId}` (real re-dispatch). **Consumed** by the Chat page — composer enabled for real with the retry action, typed fetchers in `lib/api.ts`. The doc's "composer disabled with a Phase-9 hint" is superseded. No longer frontend-scope. |
| G7 | `POST /repo` only clones by URL/path — no way to ingest a browser-picked local folder (landing.html's "Browse" tile). A `webkitdirectory` file input gives the browser `File` blobs with relative paths, never a filesystem path the container can see, and no git history — the execution engine needs `.git` for its per-unit worktrees (`backend/execution/worktree.py`), and candidate ranking's `recentActivityScore` needs commit history to mean anything | New `POST /repo/upload`-style endpoint: multipart upload → reconstruct the tree server-side → `git init` + commit → existing candidate/discovery pipeline as-is. `recentActivityScore` degrades to ~0 for every file on a freshly-init'd repo (no history to score) — worth flagging as a known limitation, not silently masking it |
| G8 | The model selector (Phase 2, `GET /llm/providers`) only affected the one LLM call the landing page makes (`POST /repo/{id}/discover`) — no effect on execution-time calls | **✅ Landed & live.** Nullable `provider` column on `seams` (`schema.sql`); `SeamIn.model` (frontend's `SeamRequest.model`) persisted by `POST /repo/{id}/seam`, returned as `SeamOut.provider`; `POST /campaign` and the chat `retry-unit` endpoint both thread it into the `seam` dict handed to `verification/gate.py` → `execution/codex.py`'s `migrate_file(..., provider_name=...)` → `llm.complete(provider_name=...)`. So the model picked on the landing page now drives **every** execution/retry call for that campaign, not just the one planning call. `app/page.tsx` sends `selectedModel` on all three seam-creation paths (scan/describe/autonomous). Verified live end-to-end: created a seam with `model=groq`, ran a real (non-mock) campaign, confirmed the unit's `codex_rationale` event was genuine LLM prose (not the `MOCK_CODEX:` template) — the provider selection is real, not decorative. **Also fixed the same day:** the demo stack was running under `MOCK_CODEX=1`, which forces `GET /llm/providers` to return only `{"name":"mock"}` regardless of configured keys — that's why the selector showed only "mock". Restarted the stack without that override (`.env`'s `MOCK_CODEX=0` + a real `GROQ_API_KEY` already present) so the selector now shows **groq** for real; **codex won't appear until a real `OPENAI_API_KEY` is added to `.env`** (no code change needed — `llm.py`'s `_known_providers()` already wires it, `list_providers()` just filters on the key being non-empty) |
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
- [x] `BatchBoard.tsx` + `BatchTile.tsx`: category dot, id, status pill, counts line, sorted attention-first (`sortBatchesForBoard`, §2); escalated tiles get the `#F7EEE9`/`#D9A99A` tint, retrying the `#F8F1E4`/`#D9BC8E` tint, plus a fail/retry-text reason line (`batchReason`) — matches `batches.html` `.btile.b-fail`/`.b-retry` exactly. Counts are honest (`batchCounts` = files · accepted/total); the mock's invented `tests n/m` fractions are deliberately omitted (no backend source). Verified against the demo run (6 units → 4 batches `.`/`lib`/`src`/`tests`): escalated `lib`,`src`,`tests` sort before accepted `.`
- [x] Blocked strip (`BlockedStrip.tsx`): `blocked`/`generation_failed`/`system_error` units filtered out of the board (`activeUnits`) and rendered as their own labelled group with a count pill — never mixed into escalations (post-merge `unit_blocked` semantics). The demo run has none, so the strip correctly renders nothing
- [x] `BatchDetail.tsx` + `FileCard.tsx` full-width below the board: per-file cards (lamp · path · meta), failure log (`LogBlock`), a derived attempt timeline (N attempts → N-1 failed rounds + the final outcome; per-round timestamps/prose are gap G4, left out honestly), and the diff via `DiffView` (`CodeBlock.tsx`, GitHub-style add/del tinting, all tokens). Verified `lib/textkit.py`/`src/exporter.py` escalated cards render the real `unit.failureLog` + `unit.diff` from `GET /campaign/{id}`
- [x] Live Preview per file type (`LivePreview.tsx`): lazy `GET /campaign/{id}/unit/{id}/preview` on open, rendered per `fileType` — markdown via `renderMarkdown` (HTML-escaped first), html in an empty-sandbox iframe, css/code as before→after `PlainBlock` pairs, plus the full test log
- [x] Deep links: `?open=B-xx` read once on mount and reflected back into the URL via `history.replaceState` (shareable); escalated detail's "Discuss in chat →" links `chat?ref=B-xx` (`BatchDetail.tsx`). Round-trips confirmed against the live campaign
- [x] Verify: demo-repo run with mixed passed/escalated (3/3) opened at `batches?open=B-02` etc.; board reorders attention-first, detail + blocked strip render real unit data; `tsc --noEmit` + `next lint` clean, route serves 200 with no SSR/compile errors. (No browser-automation tool available this session — verification is route-serve + real-data-shape + code-against-mock, same approach as Phase 2/3)

### Phase 5 — Plan + Log + Summary
- [x] Plan (`app/campaign/[id]/plan/page.tsx`): quoted mono intent hero + meta row (mode/model/planned/approved from the plan record, Chat link), grounded before/after pair pulled from a **real** unit diff (`sampleBeforeAfter` — the plan is grounded in the actual clone), scope + server-side blacklist note, batch breakdown via `deriveGlobBatches` in category colours (same id/colour assignment as `deriveBatches` so a batch keeps one colour everywhere), test command/invariants/retry policy, grounding stats (from `stored.discovery`), and a reactflow blast-radius graph (`components/plan/BlastGraph.tsx`, `GET /repo/{repoId}/graph`, recoloured to tokens: in-scope=run border, blacklist=fail dashed, unaffected=faint). Spec/scope/verification/graph come from the **server-embedded seam + repoId** (gap G1 now live) so they render even with no plan record; intent/mode/model/grounding degrade to a slim note when `stored` is null; full empty state only when neither seam nor stored exists
- [x] Log (`app/campaign/[id]/log/page.tsx` + `lib/logLines.ts`): the one dark surface (`#1B1713`), mono `HH:MM:SS batch·unit VERB detail` grid, verb colour (dark-terminal palette from the mock) + batch hue on the tag, blinking tail cursor (`.log-cursor` keyframe in globals.css), auto-scroll with scroll-lock-on-hover, verb filter chips + batch `<select>`. Built from the **real** `GET /campaign/{id}/events` history (gap G4 now live — `status_change` → DISPATCH/PASS/FAIL/RETRY/ESCALATE/BLOCK, `codex_rationale` → REASON), re-fetched every 2.5s while running for a live tail rather than the synthesised backfill the doc originally called for
- [x] Summary (`app/campaign/[id]/summary/page.tsx`): mono peak-end tally line (`n/m … · k escalated · <duration>`), figures row (files changed, ±loc parsed from accepted-unit diffs via `diffLineCounts`, retries caught = passed with `attempt>1`, escalated hot), outcome-by-batch bars (pure CSS flex segments — no chart library), per-unit table (batch dot/label · scope · result lamp · rounds; the mock's `tests`/`time` columns dropped — no backend source). Duration is real from `createdAt`/`completedAt` (gap G5 now live)
- [x] Summary publishing (`components/summary/Publish.tsx`): Apply-locally card (`POST /campaign/{id}/apply` → changed files, git commands, `alreadyApplied`; shape verified against the live endpoint), PR card (OAuth-session vs. manual-token field vs. `502 pr_creation_failed` → fall-back-to-apply message per §2, via the existing `finalizeCampaign` fetcher), follow-up card → `batches?open=` of the first escalated batch, and **Start next seam campaign** popping `lib/seamQueue.ts` → `POST /campaign` → route
- [x] Verify: full demo campaign (3 passed / 3 escalated) read end-to-end — Plan renders the grounded spec + graph, Log tails real events, Summary figures/bars/table/publish cards all bind to real data; `tsc` + `next lint` clean, all three routes 200 with no SSR/compile errors

### Phase 6 — Overview flow scene
- [x] Ported the isometric SVG scene from `overview.html` into `components/overview/FlowScene.tsx` — the projection math (`P`/`pts`), prism/belt/label builders, wall labels, gate lamp, PR crate, marching belts and the scene CSS are 1:1 with the mock (static scene built imperatively once). GSAP tweens token moves between zones (`gsap.to` on the transform); `prefers-reduced-motion` snaps instantly and disables belt/pulse/riding animations
- [x] Wired to `CampaignProvider`: one token per unit in its **batch category colour** (`batch.color`, matching every other page), laid out by status — pending→Yard, running/retrying→Build bench (retrying gets the amber `↻` badge + `riding` loop), passed→Shipping dock, escalated/blocked→Review siding. Gate lamp reflects the most urgent live state; PR crate lights when everything's terminal and something shipped. Moves are driven by the shared socket's `unit_status` updates flowing through `campaign.units`
- [x] KPI strip bound to derived state (accepted `n/m` + %, on-the-bench = running+retrying, escalated hot, elapsed from `createdAt`/`completedAt`); caption line derived per state; idle state (no units) shows the product-explainer caption + dimmed scene
- [x] Token click → `router.push(batches?open=B-xx)` for that unit's batch (keyboard-activatable too — `tabindex`/Enter/Space)
- [x] Replay for finished campaigns: **event-accurate** from `GET /campaign/{id}/events` (gap G4 now live) — starts all tokens pending, then applies each `status_change` in order on a timed cadence so tokens move through the real zones, not a synthesised guess from final states. Auto-runs on `?replay=1` (the Summary "Replay in Overview" link); a "Replay the run" / "show live state" toggle is offered on finished campaigns. `prefers-reduced-motion` jumps straight to the final state
- [x] Verify: idle (fresh campaign, 0 units), running (live socket updates), escalation-docked and complete states all exercised against the demo run (3 passed on the dock, 3 escalated on the siding); replay steps through the real 45-event history; `tsc` + `next lint` clean, route 200 clean

### Phase 7 — Chat page (live) + polish pass
- [x] `app/campaign/[id]/chat/page.tsx` per `chat.html`: foreman-left / user-right bubbles, the landing planning excerpt (from `campaignStore.chatExcerpt`) with a plan mini-card (seam/scope/batches/gate + "view the full plan"), `system`-role messages rendered as centred divider lines. **Composer is enabled for real** (the doc's "disabled with Phase-9 hint" is stale — Phase 9 backend is live): `POST /campaign/{id}/chat` persists both turns and returns a real reply; optimistic user bubble + typing dots while awaiting; history loaded from `GET /campaign/{id}/chat`. Added `getChat`/`postChat`/`retryUnit` fetchers to `lib/api.ts`
- [x] Retry action: when the discussion is scoped to a retryable unit (escalated/failed/blocked-family — resolved from `?ref` or the last message's `unitRef`), a "↻ Retry {file}" button calls `POST /campaign/{id}/chat/retry-unit/{unitId}` (a real re-dispatch) and appends the returned system message. All chat + retry endpoint shapes verified live under `MOCK_CODEX`
- [x] `?ref=B-xx` prefill: resolves the batch → its escalated unit, sets the amber composer ring + reference chip + the failure-prompt text, and threads that unit id as `unitRef` so the foreman sees the failure log
- [x] Full acceptance sweep: banned-token grep across `*.{ts,tsx,css}` is clean (zero `bg-slate`/`bg-blue`/`bg-purple`/`indigo`/`violet`/`gradient`/`recharts` — the only hits were a rule-restating comment); figures carry `tabular-nums`, paths/ids/logs/diffs use `font-mono`, focus rings inherit the global 2px `link` ring, `prefers-reduced-motion` handled in the Log cursor, FlowScene tweens/animations and globals base rules
- [x] Removed dead files: `utils/formatUnitStatus.ts` (ported in Phase 1, never imported, and the one place still using slate/blue/purple) and `utils/matchGlob.ts` (unused). `renderMarkdown.ts` stays (used by LivePreview). `tsc --noEmit` + `next lint` clean after removal
- [x] Verify: all six routes serve 200 with no SSR/compile errors; every backend contract the pages consume (`/campaign/{id}` enriched, `/events`, `/campaigns`, `/apply`, chat GET/POST/retry, `/graph`) tested directly with shapes matching `lib/types.ts`. **Not done:** in-browser click-through (no browser-automation tool available this session — same constraint as Phase 2/3); `npm run build` deliberately skipped while the dev container is live (corrupts `.next`, per the Phase-2 infra note) — `tsc --noEmit` used instead

### Phase 8 — Backend additive endpoints (team-boundary gate lifted — whole repo is one owner now, see project decision; shipped ahead of the frontend phases that consume it)
- [x] Flag G1–G5 (§4): superseded — no team-approval process gates this repo anymore; proceeded directly
- [x] G1: `GET /campaign/{id}` now returns `repoId` + the full embedded `seam` object + `createdAt`/`completedAt` (`backend/main.py`, `backend/models.py`)
- [x] G2: `title`/`plan` (JSONB) columns added to `seams`, settable via `POST /repo/{id}/seam`, returned via G1 (`backend/schema.sql`, `backend/models.py`) — **not yet called** by the landing page's Approve&start flow (still writes to `campaignStore` only), so this is live plumbing without a live producer yet; a real follow-up, not a bug
- [x] G3: `GET /campaigns` list endpoint (id, title, status, repo, created/completed, accepted/escalated counts) — `backend/main.py`
- [x] G4: `GET /campaign/{id}/events` (paginated `unit_events` read API, oldest-first) — `backend/main.py`
- [x] G5: `campaigns.completed_at` set by `execution/engine.py` on both the completed and failed terminal paths
- [x] Frontend swap: done in Phases 5–6 — Plan (`repoId`+embedded seam), Log (real event backfill/tail), Overview (event-accurate replay) all read server data now instead of synthesizing it; `campaignStore` still owns the plan-record fields G2 doesn't have a producer for yet (objective/mode/model/discovery summary) — not yet demoted to a pure write-through cache, since there's nothing writing the server side of that data
- [x] Verify: full `docker compose` run (`MOCK_CODEX=1`), a real campaign driven end to end via `scripts/run_campaign.py` (3 passed / 3 escalated), every endpoint above hit directly and cross-checked against `lib/types.ts`/the frontend's actual consumption in Phase 5–7; JSONB metadata/plan decode correctly (asyncpg needs an explicit `json.loads`, handled in `db.parse_jsonb`)

### Phase 9 — Conversational Chat (team-boundary gate lifted; shipped ahead of Phase 7 which now consumes it live)
- [x] Design doc: the module docstring at the top of `backend/chat.py` — persistence model (`chat_messages`, one row per turn, campaign-scoped), endpoint contract (`GET`/`POST /campaign/{id}/chat`, `POST /campaign/{id}/chat/retry-unit/{unitId}`), LLM session continuation (stateless `llm.complete()`, so each turn replays the stored transcript + live campaign/seam/unit context into one prompt, capped at the last 20 turns), re-dispatch-from-chat semantics (exactly one explicit action — retrying a unit already in a terminal failure state, re-entering `verification.gate.run_unit`, never inferred from free text)
- [x] Team approval: superseded — no team-approval process gates this repo anymore
- [x] Backend implementation: `backend/chat.py` + `chat_messages` table (`backend/schema.sql`) + the three routes in `backend/main.py`
- [x] Enable the composer; failed-batch discussion flow live end-to-end: done in Phase 7 (`app/campaign/[id]/chat/page.tsx`) — composer is live against the real endpoints, not the disabled placeholder this line originally described
- [ ] Pause/resume + escalation actions on the top strip: not built — genuinely separate scope from chat, nobody asked for it yet
- [x] G7 (§4): `POST /repo/upload` (`backend/main.py`) — multipart upload (each `File`'s part-filename carries its `webkitRelativePath`), server-side path-traversal guard (`_safe_upload_path`, rejects `..`/absolute paths/anything resolving outside the repo dir — verified live: a `../../../etc/...` attempt correctly fails ingestion with nothing written outside the sandbox), tree reconstructed under `DATA_DIR`, `git init` + one commit (`execution/worktree.GIT_IDENTITY`), then the same `_bootstrap_repo` candidate/profile pipeline `POST /repo` uses. Frontend `RepoPicker.tsx`'s Browse tile calls the new `api.uploadRepo` (`lib/api.ts`, FormData) instead of showing the old "not wired yet" notice. Verified live end-to-end: uploaded a real two-file tree, confirmed the reconstructed tree + git log + a real `GET /repo/{id}/candidates` response (`recentActivityScore: 1.0` for every file — no commit-history variance to differentiate on, exactly the flagged limitation, not a crash). `recentActivityScore` degrading to *uniform 1.0* rather than ~0 as originally guessed: harmless either way (centrality still differentiates), correcting the earlier prediction for accuracy. `tsc --noEmit` + `next lint` clean

---

## 6. Acceptance (from FRONTEND_REDESIGN.md §8, restated as the exit bar)

- Every page implemented from its approved mock in `design/mocks/`, not from prose
- Zero `slate-*`, zero gradients, zero purple, zero recharts
- Sidebar works on every page collapsed and expanded; history updates live via WS
- Figures `tabular-nums`; paths/IDs/logs/diffs IBM Plex Mono
- Batch detail reachable by click and `?open=` deep link; visible focus everywhere; `motion-reduce` verified
- 1440px screenshots read as a clean modern ops dashboard
- Summary renders the mono tally line with real campaign numbers
