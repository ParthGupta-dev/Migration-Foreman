import type { Candidate } from "@/lib/types";

interface CandidateListProps {
  candidates: Candidate[];
  selectedId: string | null;
  onSelect: (candidateId: string) => void;
}

export default function CandidateList({
  candidates,
  selectedId,
  onSelect,
}: CandidateListProps) {
  if (candidates.length === 0) {
    return <p className="text-sm text-slate-500">No candidates found for this repo.</p>;
  }

  return (
    <div className="space-y-2">
      {candidates.map((candidate) => {
        const selectable = !candidate.blacklisted;
        const selected = selectedId === candidate.candidateId;
        return (
          <button
            key={candidate.candidateId}
            type="button"
            disabled={!selectable}
            onClick={() => selectable && onSelect(candidate.candidateId)}
            className={`w-full text-left rounded-lg border p-3 transition-colors ${
              selected
                ? "border-blue-500 bg-blue-950/40"
                : "border-slate-800 bg-slate-900/60"
            } ${selectable ? "hover:border-slate-600" : "opacity-50 cursor-not-allowed"}`}
          >
            <div className="flex items-center justify-between">
              <span className="font-mono text-xs text-slate-300">
                {candidate.scopeGlobs.join(", ")}
              </span>
              {candidate.blacklisted && (
                <span className="text-xs font-medium text-red-400">BLACKLISTED</span>
              )}
            </div>
            <div className="mt-1 flex gap-4 text-xs text-slate-500">
              <span>combined: {candidate.combinedScore.toFixed(4)}</span>
              <span>centrality: {candidate.centralityScore.toFixed(3)}</span>
              <span>activity: {candidate.recentActivityScore.toFixed(3)}</span>
            </div>
          </button>
        );
      })}
    </div>
  );
}
