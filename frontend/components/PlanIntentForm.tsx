"use client";

import { useEffect, useState } from "react";
import type { Plan, PlanRisk } from "@/lib/types";

interface PlanIntentFormProps {
  plan: Plan | null;
  planning: boolean;
  creatingSeam: boolean;
  onGenerate: (intent: string) => void;
  onConfirm: (plan: Plan, testCommand: string) => void;
}

const inputClasses =
  "w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-blue-500";

const RISK_STYLES: Record<PlanRisk, string> = {
  low: "bg-green-900/60 text-green-300 border-green-700",
  medium: "bg-amber-900/60 text-amber-300 border-amber-700",
  high: "bg-red-900/60 text-red-300 border-red-700",
};

export default function PlanIntentForm({
  plan,
  planning,
  creatingSeam,
  onGenerate,
  onConfirm,
}: PlanIntentFormProps) {
  const [intent, setIntent] = useState("");
  const [testCommand, setTestCommand] = useState("");

  // A new plan brings its own (possibly inferred) test command.
  useEffect(() => {
    setTestCommand(plan?.testCommand ?? "");
  }, [plan]);

  const handleGenerate = (event: React.FormEvent) => {
    event.preventDefault();
    if (intent.trim()) onGenerate(intent.trim());
  };

  return (
    <div className="space-y-3">
      <form onSubmit={handleGenerate} className="space-y-2">
        <label className="text-xs font-medium text-slate-400">
          Migration intent (plain English)
        </label>
        <div className="flex gap-2">
          <input
            className={inputClasses}
            placeholder='e.g. "Upgrade requests to httpx"'
            value={intent}
            onChange={(e) => setIntent(e.target.value)}
            disabled={planning}
          />
          <button
            type="submit"
            disabled={!intent.trim() || planning}
            className="whitespace-nowrap rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {planning ? "Planning…" : "Generate plan"}
          </button>
        </div>
      </form>

      {planning && (
        <p className="text-sm text-slate-400 animate-pulse">
          Codex is planning the migration…
        </p>
      )}

      {plan && !planning && (
        <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-4 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-slate-100">
              {plan.migrationName}
            </span>
            <span
              className={`rounded border px-2 py-0.5 text-xs font-medium ${RISK_STYLES[plan.risk]}`}
            >
              risk: {plan.risk}
            </span>
            <span className="rounded border border-slate-700 px-2 py-0.5 text-xs text-slate-300">
              breaking changes: {plan.breakingChanges ? "yes" : "no"}
            </span>
          </div>

          <ul className="space-y-1 text-sm">
            <li className="text-green-400">
              ✓ Found {plan.matchedOccurrences} occurrence(s) across{" "}
              {plan.groundedFiles.length} file(s)
            </li>
            {plan.repairedScope && (
              <li className="text-green-400">
                ✓ Scope repaired to the files containing the pattern
              </li>
            )}
            {plan.unsupportedFiles.length > 0 && (
              <li className="text-amber-400">
                ! {plan.unsupportedFiles.length} in-scope file(s) do not contain
                the pattern
              </li>
            )}
            <li className="text-green-400">
              ✓ Confidence {plan.confidence.toFixed(2)}
            </li>
          </ul>

          <div className="space-y-1 text-sm">
            <p>
              <span className="text-slate-500">Migration:</span>{" "}
              <span className="font-mono text-xs">
                {plan.beforePattern} → {plan.afterPattern}
              </span>
            </p>
            <p className="text-slate-300">
              <span className="text-slate-500">Reason:</span> {plan.reasoning}
            </p>
          </div>

          <div className="max-h-28 overflow-y-auto rounded border border-slate-800 bg-slate-950 p-2">
            {plan.groundedFiles.map((file) => (
              <p key={file} className="font-mono text-xs text-slate-400">
                {file}
              </p>
            ))}
          </div>

          <div>
            <label className="text-xs font-medium text-slate-400">
              Test command
            </label>
            <input
              className={inputClasses}
              placeholder="python -m pytest -q"
              value={testCommand}
              onChange={(e) => setTestCommand(e.target.value)}
            />
          </div>

          <button
            type="button"
            onClick={() => onConfirm(plan, testCommand.trim())}
            disabled={!testCommand.trim() || creatingSeam}
            className="w-full rounded-lg bg-blue-600 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {creatingSeam ? "Creating seam…" : "✓ Ready for execution — use this plan"}
          </button>
        </div>
      )}
    </div>
  );
}
