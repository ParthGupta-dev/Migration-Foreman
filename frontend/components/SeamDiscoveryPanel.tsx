"use client";

import { useEffect, useState } from "react";
import type { Discovery, DiscoveredSeam, PlanRisk } from "@/lib/types";

interface SeamDiscoveryPanelProps {
  discovery: Discovery | null;
  discovering: boolean;
  launching: boolean;
  // Autonomous mode runs the identical discovery pipeline; the difference is
  // interaction depth. Instead of per-seam approve/edit/reject it presents
  // the discovered seams with a single confirm-and-execute action — still a
  // mandatory human checkpoint before anything runs.
  autonomous?: boolean;
  onDiscover: (objective: string) => void;
  onApprove: (seams: DiscoveredSeam[]) => void;
  onCancel: () => void;
}

const inputClasses =
  "w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-blue-500";

const RISK_STYLES: Record<PlanRisk, string> = {
  low: "bg-green-900/60 text-green-300 border-green-700",
  medium: "bg-amber-900/60 text-amber-300 border-amber-700",
  high: "bg-red-900/60 text-red-300 border-red-700",
};

type SeamDecision = "approved" | "rejected";

interface SeamEdits {
  title: string;
  beforePattern: string;
  afterPattern: string;
  scopeGlobs: string; // comma-separated in the edit form
  testCommand: string;
}

function editsFrom(seam: DiscoveredSeam): SeamEdits {
  return {
    title: seam.title,
    beforePattern: seam.beforePattern,
    afterPattern: seam.afterPattern,
    scopeGlobs: seam.scopeGlobs.join(", "),
    testCommand: seam.testCommand ?? "",
  };
}

function applyEdits(seam: DiscoveredSeam, edits: SeamEdits): DiscoveredSeam {
  return {
    ...seam,
    title: edits.title.trim() || seam.title,
    beforePattern: edits.beforePattern.trim() || seam.beforePattern,
    afterPattern: edits.afterPattern.trim() || seam.afterPattern,
    scopeGlobs: edits.scopeGlobs
      .split(",")
      .map((glob) => glob.trim())
      .filter(Boolean),
    testCommand: edits.testCommand.trim() || null,
  };
}

export default function SeamDiscoveryPanel({
  discovery,
  discovering,
  launching,
  autonomous = false,
  onDiscover,
  onApprove,
  onCancel,
}: SeamDiscoveryPanelProps) {
  const [objective, setObjective] = useState("");
  const [decisions, setDecisions] = useState<Record<string, SeamDecision>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [editingId, setEditingId] = useState<string | null>(null);
  const [edits, setEdits] = useState<Record<string, SeamEdits>>({});

  // A fresh discovery resets every per-seam decision to "approved".
  useEffect(() => {
    if (!discovery) return;
    setDecisions(
      Object.fromEntries(discovery.seams.map((seam) => [seam.seamId, "approved"]))
    );
    setEdits(Object.fromEntries(discovery.seams.map((seam) => [seam.seamId, editsFrom(seam)])));
    setExpanded({});
    setEditingId(null);
  }, [discovery]);

  const handleDiscover = (event: React.FormEvent) => {
    event.preventDefault();
    if (objective.trim()) onDiscover(objective.trim());
  };

  const effectiveSeams = (discovery?.seams ?? []).map((seam) =>
    edits[seam.seamId] ? applyEdits(seam, edits[seam.seamId]) : seam
  );
  const approvedSeams = effectiveSeams.filter(
    (seam) => decisions[seam.seamId] === "approved"
  );
  const missingTest = approvedSeams.filter((seam) => !seam.testCommand);
  const rejectedIds = new Set(
    effectiveSeams
      .filter((seam) => decisions[seam.seamId] !== "approved")
      .map((seam) => seam.seamId)
  );

  const setDecision = (seamId: string, decision: SeamDecision) =>
    setDecisions((prev) => ({ ...prev, [seamId]: decision }));

  const submit = (seams: DiscoveredSeam[]) => {
    if (seams.length > 0) onApprove(seams);
  };

  return (
    <div className="space-y-4">
      <form onSubmit={handleDiscover} className="space-y-2">
        <label className="text-xs font-medium text-slate-400">
          {autonomous
            ? "Engineering objective (plain English) — the AI discovers the seams end to end; you confirm once and it executes"
            : "Engineering objective (plain English) — the AI discovers the migration seams; nothing executes without your approval"}
        </label>
        <div className="flex gap-2">
          <input
            className={inputClasses}
            placeholder='e.g. "Modernize authentication" or "Upgrade requests to httpx"'
            value={objective}
            onChange={(e) => setObjective(e.target.value)}
            disabled={discovering}
          />
          <button
            type="submit"
            disabled={!objective.trim() || discovering}
            className="whitespace-nowrap rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {discovering ? "Discovering…" : "Discover seams"}
          </button>
        </div>
      </form>

      {discovering && (
        <p className="text-sm text-slate-400 animate-pulse">
          Analyzing the repository and discovering candidate seams… (read-only,
          no code is modified)
        </p>
      )}

      {discovery && !discovering && (
        <div className="space-y-4">
          {/* Discovery summary header */}
          <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-4 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold text-slate-100">
                {discovery.objective}
              </span>
              <span
                className={`rounded border px-2 py-0.5 text-xs font-medium ${RISK_STYLES[discovery.overallRisk]}`}
              >
                overall risk: {discovery.overallRisk}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs text-slate-400 sm:grid-cols-4">
              <p>
                <span className="text-slate-200 font-medium">{discovery.seamCount}</span>{" "}
                seam(s) discovered
              </p>
              <p>
                <span className="text-slate-200 font-medium">
                  {discovery.totalEstimatedFiles}
                </span>{" "}
                file(s) affected
              </p>
              <p>
                ~<span className="text-slate-200 font-medium">{discovery.estimatedMinutes}</span>{" "}
                min execution
              </p>
              <p>
                <span className="text-slate-200 font-medium">
                  {discovery.repoSummary.fileCount}
                </span>{" "}
                files analyzed
              </p>
            </div>
            <p className="text-xs text-slate-500">
              Repo: {Object.entries(discovery.repoSummary.languages)
                .map(([lang, count]) => `${count} .${lang}`)
                .join(", ")}{" "}
              · {discovery.repoSummary.graphEdges} import edge(s) ·{" "}
              {discovery.repoSummary.topDirectories.join(", ") || "flat layout"}
            </p>
            {discovery.droppedSeams.length > 0 && (
              <p className="text-xs text-amber-400">
                {discovery.droppedSeams.length} proposed seam(s) dropped during
                grounding:{" "}
                {discovery.droppedSeams.map((dropped) => dropped.title).join(", ")}
              </p>
            )}
          </div>

          {/* Seam cards */}
          <div className="space-y-3">
            {effectiveSeams.map((seam) => {
              const decision = decisions[seam.seamId] ?? "approved";
              const isOpen = expanded[seam.seamId] ?? false;
              const isEditing = editingId === seam.seamId;
              const blockedDeps = seam.dependsOn.filter((dep) => rejectedIds.has(dep));
              return (
                <div
                  key={seam.seamId}
                  className={`rounded-lg border p-4 space-y-3 ${
                    decision === "approved"
                      ? "border-slate-700 bg-slate-900/60"
                      : "border-slate-800 bg-slate-950 opacity-60"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() =>
                      setExpanded((prev) => ({ ...prev, [seam.seamId]: !isOpen }))
                    }
                    className="flex w-full flex-wrap items-center gap-2 text-left"
                  >
                    <span className="text-xs text-slate-600 font-mono">
                      #{seam.executionOrder + 1}
                    </span>
                    <span className="text-sm font-semibold text-slate-100">
                      {seam.title}
                    </span>
                    <span
                      className={`rounded border px-2 py-0.5 text-xs font-medium ${RISK_STYLES[seam.risk]}`}
                    >
                      {seam.risk}
                    </span>
                    <span className="rounded border border-slate-700 px-2 py-0.5 text-xs text-slate-300">
                      {seam.estimatedFiles} file(s)
                    </span>
                    <span className="rounded border border-slate-700 px-2 py-0.5 text-xs text-slate-300">
                      confidence {seam.confidence.toFixed(2)}
                    </span>
                    {decision === "rejected" && (
                      <span className="rounded border border-red-800 px-2 py-0.5 text-xs text-red-400">
                        rejected
                      </span>
                    )}
                    <span className="ml-auto text-xs text-slate-500">
                      {isOpen ? "▲ collapse" : "▼ details"}
                    </span>
                  </button>

                  {seam.description && (
                    <p className="text-xs text-slate-400">{seam.description}</p>
                  )}
                  {/* Always visible in every mode: the command each unit will
                      be verified with (inferred when the model didn't supply
                      one), pre-filled and editable — never hidden. */}
                  <p className="text-xs">
                    <span className="text-slate-500">Verification command:</span>{" "}
                    {seam.testCommand ? (
                      <span className="font-mono text-slate-300">{seam.testCommand}</span>
                    ) : (
                      <span className="text-amber-400">
                        none inferred — ✏ Edit to add one
                      </span>
                    )}
                  </p>
                  {blockedDeps.length > 0 && decision === "approved" && (
                    <p className="text-xs text-amber-400">
                      ! Depends on rejected seam(s): {blockedDeps.join(", ")}
                    </p>
                  )}

                  {isOpen && !isEditing && (
                    <div className="space-y-2 text-sm border-t border-slate-800 pt-3">
                      <p>
                        <span className="text-slate-500">Transformation:</span>{" "}
                        <span className="font-mono text-xs">
                          {seam.beforePattern} → {seam.afterPattern}
                        </span>
                      </p>
                      <p className="text-xs text-slate-400">
                        <span className="text-slate-500">Occurrences:</span>{" "}
                        {seam.occurrences} across {seam.groundedFiles.length} file(s)
                        {seam.repairedScope && " (scope repaired to grounded files)"}
                        {" · "}
                        <span className="text-slate-500">Breaking changes:</span>{" "}
                        {seam.breakingChanges ? "yes" : "no"}
                        {seam.dependsOn.length > 0 && (
                          <>
                            {" · "}
                            <span className="text-slate-500">Depends on:</span>{" "}
                            {seam.dependsOn.join(", ")}
                          </>
                        )}
                      </p>
                      <p className="text-xs text-slate-300">
                        <span className="text-slate-500">Reasoning:</span>{" "}
                        {seam.reasoning}
                      </p>
                      <p className="text-xs">
                        <span className="text-slate-500">Verification:</span>{" "}
                        <span className="font-mono">
                          {seam.testCommand ?? "(no test command — edit this seam to add one)"}
                        </span>
                      </p>
                      <div className="max-h-28 overflow-y-auto rounded border border-slate-800 bg-slate-950 p-2">
                        {seam.groundedFiles.map((file) => (
                          <p key={file} className="font-mono text-xs text-slate-400">
                            {file}
                          </p>
                        ))}
                      </div>
                    </div>
                  )}

                  {isEditing && (
                    <div className="space-y-2 border-t border-slate-800 pt-3">
                      {(
                        [
                          ["title", "Title"],
                          ["beforePattern", "Before pattern"],
                          ["afterPattern", "After pattern"],
                          ["scopeGlobs", "Scope globs (comma-separated)"],
                          ["testCommand", "Test command"],
                        ] as const
                      ).map(([field, label]) => (
                        <div key={field}>
                          <label className="text-xs font-medium text-slate-400">{label}</label>
                          <input
                            className={inputClasses}
                            value={edits[seam.seamId]?.[field] ?? ""}
                            onChange={(e) =>
                              setEdits((prev) => ({
                                ...prev,
                                [seam.seamId]: {
                                  ...(prev[seam.seamId] ?? editsFrom(seam)),
                                  [field]: e.target.value,
                                },
                              }))
                            }
                          />
                        </div>
                      ))}
                      <button
                        type="button"
                        onClick={() => setEditingId(null)}
                        className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-500"
                      >
                        Done editing
                      </button>
                    </div>
                  )}

                  {/* Edit is available in EVERY mode (the verification command
                      must always be correctable); approve/reject are the
                      AI-Discovery-only per-seam decisions. */}
                  <div className="flex gap-2">
                    {!autonomous && (
                    <button
                      type="button"
                      onClick={() => setDecision(seam.seamId, "approved")}
                      className={`rounded-lg border px-3 py-1.5 text-xs font-medium ${
                        decision === "approved"
                          ? "border-green-700 bg-green-900/60 text-green-300"
                          : "border-slate-700 text-slate-400 hover:border-green-700 hover:text-green-300"
                      }`}
                    >
                      ✓ Approve
                    </button>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        setEditingId(isEditing ? null : seam.seamId);
                        setExpanded((prev) => ({ ...prev, [seam.seamId]: true }));
                      }}
                      className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-300 hover:border-blue-600 hover:text-blue-300"
                    >
                      ✏ Edit
                    </button>
                    {!autonomous && (
                    <button
                      type="button"
                      onClick={() => setDecision(seam.seamId, "rejected")}
                      className={`rounded-lg border px-3 py-1.5 text-xs font-medium ${
                        decision === "rejected"
                          ? "border-red-800 bg-red-950 text-red-400"
                          : "border-slate-700 text-slate-400 hover:border-red-800 hover:text-red-400"
                      }`}
                    >
                      ✕ Reject
                    </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Approval bar — the mandatory human checkpoint (hidden in
              autonomous mode, where the parent auto-approves) */}
          {autonomous ? (
            /* Autonomous: same pipeline, minimal interaction — one confirm
               click covers every executable discovered seam. */
            <div className="space-y-2">
              {effectiveSeams.some((seam) => !seam.testCommand) && (
                <p className="text-xs text-amber-400">
                  ! No confident verification command for:{" "}
                  {effectiveSeams
                    .filter((seam) => !seam.testCommand)
                    .map((seam) => seam.title)
                    .join(", ")}{" "}
                  — excluded from execution until you ✏ Edit and add one
                </p>
              )}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => submit(effectiveSeams.filter((seam) => seam.testCommand))}
                  disabled={
                    launching || !effectiveSeams.some((seam) => seam.testCommand)
                  }
                  className="flex-1 rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-500 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {launching
                    ? "Creating seams & starting…"
                    : `Confirm & execute ${
                        effectiveSeams.filter((seam) => seam.testCommand).length
                      } discovered seam(s)`}
                </button>
                <button
                  type="button"
                  onClick={onCancel}
                  disabled={launching}
                  className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:border-red-800 hover:text-red-400"
                >
                  Cancel
                </button>
              </div>
              <p className="text-xs text-slate-600">
                Autonomous mode discovered these seams end to end — this
                confirmation is the only interaction before execution.
              </p>
            </div>
          ) : (
          <>
          {missingTest.length > 0 && (
            <p className="text-xs text-amber-400">
              ! {missingTest.length} approved seam(s) have no test command — edit
              them before approval: {missingTest.map((seam) => seam.title).join(", ")}
            </p>
          )}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => submit(approvedSeams)}
              disabled={approvedSeams.length === 0 || missingTest.length > 0 || launching}
              className="flex-1 rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-500 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {launching
                ? "Creating seams & starting…"
                : `Approve ${approvedSeams.length} selected seam(s) & execute`}
            </button>
            <button
              type="button"
              onClick={() => submit(effectiveSeams)}
              disabled={effectiveSeams.some((seam) => !seam.testCommand) || launching}
              className="rounded-lg border border-green-700 px-4 py-2 text-sm font-medium text-green-300 hover:bg-green-900/40 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Approve all
            </button>
            <button
              type="button"
              onClick={onCancel}
              disabled={launching}
              className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:border-red-800 hover:text-red-400"
            >
              Cancel migration
            </button>
          </div>
          <p className="text-xs text-slate-600">
            Approval is the safety checkpoint: seams are only created — and the
            first campaign only starts — when you click approve. Multiple seams
            execute one campaign at a time in the order shown.
          </p>
          </>
          )}
        </div>
      )}
    </div>
  );
}
