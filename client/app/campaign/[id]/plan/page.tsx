"use client";

// Plan page (frontend_refactor.md Phase 5, mock: design/mocks/plan.html).
// The approved migration plan — the contract this campaign runs against.
// Grounded spec / scope / verification / batch breakdown / blast-radius come
// from the server-embedded seam + repoId (gap G1/G2 now live); the quoted
// intent, mode, model, timestamps and grounding stats come from the per-browser
// plan record (campaignStore) since the backend doesn't persist discovery
// output. When neither is available the page degrades gracefully.

import Link from "next/link";
import { useMemo } from "react";
import { useCampaign } from "@/lib/campaignContext";
import { deriveGlobBatches } from "@/lib/batches";
import { clockTime } from "@/lib/format";
import BlastGraph from "@/components/plan/BlastGraph";
import type { Unit } from "@/lib/types";

const MODE_LABEL: Record<string, string> = {
  scan: "Manual (scan)",
  describe: "AI Plan",
  autonomous: "Autonomous",
};

export default function PlanPage() {
  const { campaign, stored, campaignId } = useCampaign();

  // Prefer the server seam (survives reload/foreign browser); fall back to the
  // stored plan record's seam.
  const seam = campaign?.seam ?? stored?.seam ?? null;
  const repoId = campaign?.repoId ?? stored?.repoId ?? null;
  const discovery = stored?.discovery;

  const scopeGlobs = useMemo(() => seam?.scopeGlobs ?? [], [seam]);
  const globBatches = useMemo(() => deriveGlobBatches(scopeGlobs), [scopeGlobs]);
  const beforeAfter = useMemo(
    () => sampleBeforeAfter(campaign?.units ?? [], seam?.beforePattern, seam?.afterPattern),
    [campaign, seam]
  );

  const seamName =
    stored?.title ??
    (seam ? `${seam.beforePattern} → ${seam.afterPattern}` : campaignId.slice(0, 8));

  if (!seam) {
    return (
      <div className="p-8" style={{ maxWidth: 1200 }}>
        <h1 className="mb-1 text-lg font-bold tracking-[-0.01em]">Plan</h1>
        <p className="mb-6 text-[13px] text-foreman-dim">
          The approved migration plan — the contract this campaign runs against.
        </p>
        <div className="rounded-card border border-dashed border-[#D6C9B5] bg-foreman-card p-12 text-center text-foreman-dim">
          <p className="mb-1 text-[15px] font-semibold text-foreman-ink">Plan record not available</p>
          <p className="text-[13px]">
            {campaign
              ? "Connecting to the campaign…"
              : "This campaign has no seam record on this browser (gap G2)."}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-8" style={{ maxWidth: 1200 }}>
      <h1 className="mb-1 text-lg font-bold tracking-[-0.01em]">Plan</h1>
      <p className="mb-6 text-[13px] text-foreman-dim">
        The approved migration plan — the contract this campaign runs against. Locked when the
        campaign started; the conversation that produced it continues in{" "}
        <Link href={`/campaign/${campaignId}/chat`}>Chat</Link>.
      </p>

      {/* Intent hero */}
      <Card>
        <p className="py-2 font-mono text-[17px] leading-[1.7]">
          <span className="text-foreman-faint">&ldquo;</span>
          {stored?.objective ?? seamName}
          <span className="text-foreman-faint">&rdquo;</span>
        </p>
        <div className="mt-3.5 flex flex-wrap gap-5 text-xs text-foreman-dim">
          <span>
            mode <span className="font-mono text-foreman-ink">{stored ? MODE_LABEL[stored.mode] ?? stored.mode : "—"}</span>
          </span>
          <span>
            model <span className="font-mono text-foreman-ink">{stored?.model ?? "—"}</span>
          </span>
          <span>
            planned <span className="font-mono text-foreman-ink">{clockTime(stored?.plannedAt ?? campaign?.createdAt)}</span>
          </span>
          <span>
            approved <span className="font-mono text-foreman-ink">{clockTime(stored?.approvedAt ?? campaign?.createdAt)}</span>
          </span>
          <Link href={`/campaign/${campaignId}/chat`}>view planning conversation →</Link>
        </div>
        {!stored && (
          <p className="mt-3 text-xs text-foreman-faint">
            Planning record isn&rsquo;t on this browser — showing the grounded spec from the server
            (gap G2, per-browser until Phase 8).
          </p>
        )}
      </Card>

      {/* Grounded spec */}
      <Card title="Grounded spec">
        <Kv
          rows={[
            ["Seam name", seamName],
            ["Before pattern", seam.beforePattern],
            ["After pattern", seam.afterPattern],
          ]}
        />
        <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <SpecHead>Before</SpecHead>
            <CodeLines lines={beforeAfter.before} kind="del" />
          </div>
          <div>
            <SpecHead>After</SpecHead>
            <CodeLines lines={beforeAfter.after} kind="add" />
          </div>
        </div>
        <p className="mt-3 text-xs text-foreman-dim">
          Keyword arguments are preserved verbatim — the seam is a mechanical call-site swap;
          behaviour is pinned by the test suite, not by the pattern.
        </p>
      </Card>

      {/* Scope & safety */}
      <Card title="Scope & safety">
        <Kv
          rows={[
            ["Scope", seam.scopeGlobs.join(" · ")],
            [
              "Matched",
              `${seam.scopeGlobs.length} ${seam.scopeGlobs.length === 1 ? "file" : "files"}${
                discovery ? ` · ${discovery.seam.occurrences} call sites` : ""
              }`,
            ],
          ]}
        />
        <p className="mt-3.5 text-xs text-foreman-retry-text">
          The safety blacklist (auth/, payments/, **/migrations/, …) is enforced server-side and
          excluded from every scope — not just in this plan.
        </p>
      </Card>

      {/* Batch breakdown */}
      <Card title="Batches — one block per file, grouped by module">
        {globBatches.map((b) => (
          <div
            key={b.id}
            className="flex items-baseline gap-3 border-b border-foreman-line py-[11px] last:border-b-0"
          >
            <span className="relative top-px h-2.5 w-2.5 flex-none rounded-[3px]" style={{ background: b.color }} />
            <span className="min-w-[72px] text-[13px] font-semibold">{b.label}</span>
            <span className="flex-1 font-mono text-xs text-foreman-dim">
              {b.globs.map((g) => g.split("/").slice(-1)[0]).join(" · ")}
            </span>
            <span className="font-mono text-xs tabular-nums text-foreman-dim">
              {b.globs.length} {b.globs.length === 1 ? "file" : "files"}
            </span>
          </div>
        ))}
        <p className="mt-3 text-xs text-foreman-dim">
          Batch colours are the block colours in the Overview scene — a batch keeps its colour
          through the whole run.
        </p>
      </Card>

      {/* Verification */}
      <Card title="Verification">
        <Kv
          rows={[
            ["Test command", seam.testCommand],
            ["Retry policy", "3 rounds max, failure log attached on retry, then escalate"],
            ["Isolation", "one git worktree per file — failures never touch the campaign branch"],
          ]}
        />
        {seam.invariants.length > 0 && (
          <>
            <SpecHead className="mb-0.5 mt-[18px]">Invariants</SpecHead>
            <ul className="mt-1">
              {seam.invariants.map((inv, i) => (
                <li key={i} className="flex gap-2.5 py-1.5 text-[13px]">
                  <span className="text-foreman-faint">▪</span>
                  <span>{inv}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>

      {/* Grounding stats — only when the discovery record is on this browser */}
      {discovery && (
        <Card title="Grounding — the plan was verified against the real clone before you saw it">
          <div className="grid grid-cols-3 gap-4">
            <Ground n={discovery.seam.occurrences} label="occurrences counted in the clone" />
            <Ground
              n={discovery.seam.groundedFiles.length || discovery.seam.estimatedFiles}
              label="files matched by scope"
            />
            <Ground n={discovery.seam.repairedScope ? 1 : 0} label="scopes repaired (globs widened to real paths)" />
          </div>
        </Card>
      )}

      {/* Blast radius */}
      {repoId && (
        <Card title="Blast radius">
          <BlastGraph repoId={repoId} scopeGlobs={seam.scopeGlobs} />
        </Card>
      )}
    </div>
  );
}

// --- small building blocks (foreman.css `.card` / `.kv`) ---

function Card({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <section className="mt-4 rounded-card border border-foreman-line bg-foreman-card p-6 shadow-card first:mt-0">
      {title && (
        <h2 className="mb-4 text-xs font-semibold uppercase tracking-[0.06em] text-foreman-dim">{title}</h2>
      )}
      {children}
    </section>
  );
}

function Kv({ rows }: { rows: [string, string][] }) {
  return (
    <dl className="grid grid-cols-[160px_1fr] gap-y-2.5 text-[13px]">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-foreman-dim">{k}</dt>
          <dd className="break-words font-mono tabular-nums">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function SpecHead({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <h4 className={`mb-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-foreman-dim ${className}`}>
      {children}
    </h4>
  );
}

function Ground({ n, label }: { n: number; label: string }) {
  return (
    <div>
      <div className="text-[26px] font-bold tracking-[-0.02em] tabular-nums">{n}</div>
      <div className="mt-0.5 text-xs text-foreman-dim">{label}</div>
    </div>
  );
}

function CodeLines({ lines, kind }: { lines: string[]; kind: "del" | "add" }) {
  const cls = kind === "del" ? "text-[#CF222E] bg-[#FFEBE9]" : "text-[#1A7F37] bg-[#DAFBE1]";
  return (
    <div className="overflow-x-auto whitespace-pre rounded-ctl border border-foreman-line bg-[#F5F0E8] py-2 font-mono text-xs leading-[1.7] tabular-nums text-foreman-ink">
      {lines.map((line, i) => (
        <span key={i} className={`block px-4 ${line ? cls : ""}`}>
          {line || " "}
        </span>
      ))}
    </div>
  );
}

// Pull a representative before/after pair straight from a real unit diff (the
// plan is grounded in the actual clone). Falls back to a generic pattern line.
function sampleBeforeAfter(
  units: Unit[],
  before?: string,
  after?: string
): { before: string[]; after: string[] } {
  for (const u of units) {
    if (!u.diff || !before) continue;
    const lines = u.diff.split("\n");
    const dels: string[] = [];
    const adds: string[] = [];
    for (const line of lines) {
      if (line.startsWith("-") && !line.startsWith("---") && line.includes(before)) dels.push(line.slice(1).trim());
      if (line.startsWith("+") && !line.startsWith("+++") && after && line.includes(after)) adds.push(line.slice(1).trim());
      if (dels.length >= 2 && adds.length >= 2) break;
    }
    if (dels.length && adds.length) {
      return { before: dels.slice(0, 3), after: adds.slice(0, 3) };
    }
  }
  return {
    before: before ? [`result = ${before}(value, width=12)`] : ["—"],
    after: after ? [`result = ${after}(value, width=12)`] : ["—"],
  };
}
