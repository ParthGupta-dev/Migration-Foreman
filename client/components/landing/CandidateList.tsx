"use client";

import type { Candidate } from "@/lib/types";

function centralityPhrase(score: number): string {
  if (score >= 0.66) return "central to many files";
  if (score >= 0.33) return "used by a moderate number of files";
  return "used by relatively few files";
}

function activityPhrase(score: number): string {
  if (score >= 0.66) return "changed frequently recently";
  if (score >= 0.33) return "changed occasionally recently";
  return "rarely changed recently";
}

export default function CandidateList({
  candidates,
  pickedId,
  picking,
  onPick,
}: {
  candidates: Candidate[];
  pickedId: string | null;
  picking: boolean;
  onPick: (candidate: Candidate) => void;
}) {
  if (candidates.length === 0) {
    return (
      <section className="rounded-card border border-foreman-line bg-foreman-card p-6 shadow-card">
        <p className="text-sm text-foreman-dim">No migration candidates were found in this repo.</p>
      </section>
    );
  }

  return (
    <section className="rounded-card border border-foreman-line bg-foreman-card p-6 shadow-card">
      <h2 className="mb-4 text-xs font-semibold uppercase tracking-wide text-foreman-dim">
        Candidates — highest-leverage first
      </h2>
      {candidates.map((c) => (
        <div
          key={c.candidateId}
          className="flex items-baseline gap-4 border-b border-foreman-line py-3 last:border-b-0"
        >
          <span
            className={`h-2 w-2 flex-none rounded-full ${c.blacklisted ? "bg-foreman-fail" : "bg-foreman-queued"}`}
          />
          <span className="font-mono text-[13px] text-foreman-ink">{c.scopeGlobs.join(", ")}</span>
          <span className="flex-1 text-xs text-foreman-dim">
            {c.blacklisted
              ? "Blacklisted — touches protected paths and cannot be selected."
              : `${centralityPhrase(c.centralityScore)}, ${activityPhrase(c.recentActivityScore)}.`}
          </span>
          <button
            type="button"
            disabled={c.blacklisted || picking}
            onClick={() => onPick(c)}
            className="rounded-ctl border border-[#D6C9B5] bg-foreman-card px-3 py-1.5 text-[13px] font-semibold text-foreman-ink hover:bg-foreman-bg disabled:opacity-40"
          >
            {pickedId === c.candidateId && picking ? "Picking…" : "Pick"}
          </button>
        </div>
      ))}
    </section>
  );
}
