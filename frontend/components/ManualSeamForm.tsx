"use client";

import { useState } from "react";
import type { ManualSeam } from "@/lib/types";

interface ManualSeamFormProps {
  onSubmit: (seam: ManualSeam) => void;
  submitting: boolean;
}

const inputClasses =
  "w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-blue-500";

export default function ManualSeamForm({ onSubmit, submitting }: ManualSeamFormProps) {
  const [scopeGlobs, setScopeGlobs] = useState("");
  const [beforePattern, setBeforePattern] = useState("");
  const [afterPattern, setAfterPattern] = useState("");
  const [invariants, setInvariants] = useState("");
  const [testCommand, setTestCommand] = useState("");

  const canSubmit =
    scopeGlobs.trim() && beforePattern.trim() && afterPattern.trim() && testCommand.trim();

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!canSubmit) return;
    onSubmit({
      scopeGlobs: scopeGlobs
        .split(/[\n,]/)
        .map((glob) => glob.trim())
        .filter(Boolean),
      beforePattern,
      afterPattern,
      invariants: invariants
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean),
      testCommand,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div>
        <label className="text-xs font-medium text-slate-400">
          Scope globs (comma or newline separated)
        </label>
        <textarea
          className={inputClasses}
          rows={2}
          placeholder="src/**/*.py"
          value={scopeGlobs}
          onChange={(e) => setScopeGlobs(e.target.value)}
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-medium text-slate-400">Before pattern</label>
          <input
            className={inputClasses}
            value={beforePattern}
            onChange={(e) => setBeforePattern(e.target.value)}
          />
        </div>
        <div>
          <label className="text-xs font-medium text-slate-400">After pattern</label>
          <input
            className={inputClasses}
            value={afterPattern}
            onChange={(e) => setAfterPattern(e.target.value)}
          />
        </div>
      </div>
      <div>
        <label className="text-xs font-medium text-slate-400">
          Invariants (one per line)
        </label>
        <textarea
          className={inputClasses}
          rows={2}
          placeholder="All unit tests pass"
          value={invariants}
          onChange={(e) => setInvariants(e.target.value)}
        />
      </div>
      <div>
        <label className="text-xs font-medium text-slate-400">Test command</label>
        <input
          className={inputClasses}
          placeholder="python -m pytest tests/ -v"
          value={testCommand}
          onChange={(e) => setTestCommand(e.target.value)}
        />
      </div>
      <button
        type="submit"
        disabled={!canSubmit || submitting}
        className="w-full rounded-lg bg-blue-600 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {submitting ? "Submitting seam…" : "Submit manual seam"}
      </button>
    </form>
  );
}
