"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import type { Discovery, DiscoveredSeam } from "@/lib/types";

export interface SeamApproval {
  approved: boolean;
  testCommand: string;
}

const RISK_PILL: Record<string, string> = {
  low: "bg-foreman-ok-bg text-foreman-ok-text",
  medium: "bg-foreman-retry-bg text-foreman-retry-text",
  high: "bg-foreman-fail-bg text-foreman-fail-text",
};

export default function DiscoveryResult({
  discovery,
  approvals,
  onToggle,
  onEditTestCommand,
}: {
  discovery: Discovery;
  approvals: Record<string, SeamApproval>;
  onToggle: (seamId: string) => void;
  onEditTestCommand: (seamId: string, value: string) => void;
}) {
  const [expanded, setExpanded] = useState<string | null>(discovery.seams[0]?.seamId ?? null);

  return (
    <div className="flex flex-col gap-4">
      <section className="rounded-card border border-foreman-line bg-foreman-card p-6 shadow-card">
        <h2 className="mb-4 text-xs font-semibold uppercase tracking-wide text-foreman-dim">Discovery</h2>
        <div className="grid grid-cols-4 gap-4 text-center">
          <Stat label="Seams" value={String(discovery.seamCount)} />
          <Stat label="Files" value={String(discovery.totalEstimatedFiles)} />
          <Stat label="Risk">
            <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${RISK_PILL[discovery.overallRisk]}`}>
              {discovery.overallRisk}
            </span>
          </Stat>
          <Stat label="Est. minutes" value={String(discovery.estimatedMinutes)} />
        </div>
      </section>

      {discovery.seams.map((seam) => (
        <SeamCard
          key={seam.seamId}
          seam={seam}
          expanded={expanded === seam.seamId}
          onToggleExpand={() => setExpanded(expanded === seam.seamId ? null : seam.seamId)}
          approval={approvals[seam.seamId]}
          onToggleApprove={() => onToggle(seam.seamId)}
          onEditTestCommand={(v) => onEditTestCommand(seam.seamId, v)}
        />
      ))}

      {discovery.droppedSeams.length > 0 && (
        <section className="rounded-card border border-foreman-line bg-foreman-card p-6 shadow-card">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-foreman-dim">
            Dropped seams
          </h2>
          <ul className="flex flex-col gap-2">
            {discovery.droppedSeams.map((d, i) => (
              <li key={i} className="text-sm text-foreman-dim">
                <span className="font-medium text-foreman-ink">{d.title}</span> — {d.reason}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function Stat({ label, value, children }: { label: string; value?: string; children?: React.ReactNode }) {
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-foreman-dim mb-1.5">{label}</p>
      {children ?? <p className="font-mono text-lg font-bold tabular-nums text-foreman-ink">{value}</p>}
    </div>
  );
}

function SeamCard({
  seam,
  expanded,
  onToggleExpand,
  approval,
  onToggleApprove,
  onEditTestCommand,
}: {
  seam: DiscoveredSeam;
  expanded: boolean;
  onToggleExpand: () => void;
  approval: SeamApproval;
  onToggleApprove: () => void;
  onEditTestCommand: (value: string) => void;
}) {
  return (
    <section
      className={`rounded-card border p-6 shadow-card ${
        approval.approved ? "border-foreman-line bg-foreman-card" : "border-foreman-line bg-foreman-bg opacity-70"
      }`}
    >
      <div className="flex items-start gap-3">
        <button type="button" onClick={onToggleExpand} className="mt-0.5 text-foreman-dim">
          {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-sm font-semibold text-foreman-ink">{seam.title}</h3>
            <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${RISK_PILL[seam.risk]}`}>
              {seam.risk}
            </span>
            {seam.breakingChanges && (
              <span className="inline-flex rounded-full bg-foreman-fail-bg px-2 py-0.5 text-[11px] font-semibold text-foreman-fail-text">
                breaking
              </span>
            )}
          </div>
          <p className="mt-1 text-xs text-foreman-dim">{seam.description}</p>
        </div>
        <label className="flex items-center gap-2 text-xs font-medium text-foreman-ink">
          <input type="checkbox" checked={approval.approved} onChange={onToggleApprove} />
          Approve
        </label>
      </div>

      {expanded && (
        <div className="mt-4 flex flex-col gap-3 border-t border-foreman-line pt-4">
          <dl className="grid grid-cols-[160px_1fr] gap-y-2.5 text-[13px]">
            <dt className="text-foreman-dim">Before pattern</dt>
            <dd className="font-mono tabular-nums">{seam.beforePattern}</dd>
            <dt className="text-foreman-dim">After pattern</dt>
            <dd className="font-mono tabular-nums">{seam.afterPattern}</dd>
            <dt className="text-foreman-dim">Scope</dt>
            <dd className="font-mono tabular-nums">{seam.scopeGlobs.join(" · ")}</dd>
            <dt className="text-foreman-dim">Grounding</dt>
            <dd className="font-mono tabular-nums">
              {seam.occurrences} occurrences across {seam.groundedFiles.length} files
              {seam.repairedScope ? " (scope repaired)" : ""}
            </dd>
            <dt className="text-foreman-dim">Confidence</dt>
            <dd className="font-mono tabular-nums">{Math.round(seam.confidence * 100)}%</dd>
          </dl>

          {seam.invariants.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-foreman-dim mb-1">Invariants</p>
              <ul className="list-disc pl-4 text-[13px] text-foreman-ink">
                {seam.invariants.map((inv, i) => (
                  <li key={i}>{inv}</li>
                ))}
              </ul>
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-foreman-dim mb-1" htmlFor={`tc-${seam.seamId}`}>
              Verification command
            </label>
            <input
              id={`tc-${seam.seamId}`}
              type="text"
              value={approval.testCommand}
              onChange={(e) => onEditTestCommand(e.target.value)}
              placeholder="e.g. python -m unittest discover -s tests"
              className="w-full rounded-ctl border border-[#D6C9B5] bg-foreman-card px-3 py-2 font-mono text-[13px] text-foreman-ink"
            />
            {!approval.testCommand.trim() && (
              <p className="mt-1 text-xs text-foreman-fail-text">
                Required before this seam can be approved and executed.
              </p>
            )}
          </div>

          <p className="text-[11px] text-foreman-faint">
            Reasoning: {seam.reasoning}
          </p>
        </div>
      )}
    </section>
  );
}
