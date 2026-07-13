"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ApiError, api } from "@/lib/api";
import type {
  Discovery,
  DiscoveredSeam,
  GraphResponse,
  ManualSeam,
  Repo,
  Seam,
  SeamQueue,
} from "@/lib/types";
import { clearSeamQueue, writeSeamQueue } from "@/lib/seamQueue";
import { matchesAnyGlob } from "@/utils/matchGlob";
import DependencyGraph from "@/components/DependencyGraph";
import ManualSeamForm from "@/components/ManualSeamForm";
import SeamDiscoveryPanel from "@/components/SeamDiscoveryPanel";
import ModeToggle, { type SeamMode } from "@/components/ModeToggle";

const DEMO_REPO_PATHS = [
  { label: "Demo repo (in-container fixture)", value: "/app/data/demo-repo" },
];

type Step = "input" | "ingesting" | "review" | "launching";

export default function RepoInputPage() {
  const router = useRouter();

  const [step, setStep] = useState<Step>("input");
  const [repoUrl, setRepoUrl] = useState("");
  const [mode, setMode] = useState<SeamMode>("discover");
  const [error, setError] = useState<string | null>(null);

  const [repo, setRepo] = useState<Repo | null>(null);
  const [graph, setGraph] = useState<GraphResponse | null>(null);
  const [seam, setSeam] = useState<Seam | null>(null);
  const [creatingSeam, setCreatingSeam] = useState(false);
  const [discovery, setDiscovery] = useState<Discovery | null>(null);
  const [discovering, setDiscovering] = useState(false);

  const resetSeam = () => {
    setSeam(null);
    setDiscovery(null);
  };

  async function handleIngest(url: string) {
    setError(null);
    setStep("ingesting");
    try {
      const created = await api.createRepo(url);
      if (created.status !== "ready") {
        throw new Error(`Repo ingestion ended in status "${created.status}"`);
      }
      setRepo(created);

      try {
        setGraph(await api.getGraph(created.repoId));
      } catch {
        setGraph(null);
      }
      setStep("review");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
      setStep("input");
    }
  }

  async function submitManualSeam(manualSeam: ManualSeam) {
    if (!repo) return;
    setCreatingSeam(true);
    setError(null);
    try {
      const created = await api.createSeam(repo.repoId, {
        candidateId: null,
        manualSeam,
      });
      setSeam(created);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setCreatingSeam(false);
    }
  }

  // Both AI modes run the exact same planning pipeline (POST /repo/{id}/
  // discover). The only behavioural difference: "discover" pauses on the
  // approval screen, "autonomous" auto-approves every discovered seam and
  // continues straight to execution.
  async function runDiscovery(objective: string) {
    if (!repo) return;
    setDiscovering(true);
    setError(null);
    setDiscovery(null);
    setSeam(null);
    try {
      const result = await api.discoverSeams(repo.repoId, objective);
      setDiscovery(result);
      if (mode === "autonomous") {
        const executable = result.seams.filter((seam) => seam.testCommand);
        if (executable.length === 0) {
          throw new Error(
            "Autonomous mode cannot proceed: no discovered seam has a test command"
          );
        }
        await approveDiscoveredSeams(executable);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setDiscovering(false);
    }
  }

  // The mandatory human checkpoint has been passed: convert every approved
  // discovered seam into a real Seam row (execution order preserved), queue
  // all but the first, and start the first campaign.
  async function approveDiscoveredSeams(approved: DiscoveredSeam[]) {
    if (!repo || approved.length === 0) return;
    setStep("launching");
    setError(null);
    try {
      const created: SeamQueue["seams"] = [];
      for (const discovered of approved) {
        const seamRow = await api.createSeam(repo.repoId, {
          candidateId: null,
          manualSeam: {
            scopeGlobs: discovered.scopeGlobs,
            beforePattern: discovered.beforePattern,
            afterPattern: discovered.afterPattern,
            invariants: discovered.invariants,
            testCommand: discovered.testCommand ?? "",
          },
        });
        created.push({ seamId: seamRow.seamId, title: discovered.title });
      }

      const [first, ...rest] = created;
      writeSeamQueue({ repoId: repo.repoId, seams: rest });

      const campaign = await api.createCampaign(first.seamId);
      router.push(`/campaign/${campaign.campaignId}?repoId=${repo.repoId}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
      setStep("review");
    }
  }

  function cancelDiscovery() {
    setDiscovery(null);
    setError(null);
  }

  async function confirmAndLaunch() {
    if (!seam || !repo) return;
    setStep("launching");
    setError(null);
    try {
      clearSeamQueue();
      const campaign = await api.createCampaign(seam.seamId);
      router.push(`/campaign/${campaign.campaignId}?repoId=${repo.repoId}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
      setStep("review");
    }
  }

  const highlightSet = seam ? new Set(seam.scopeGlobs) : null;

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
          1. Repo input
        </h2>
        <div className="flex gap-2">
          <input
            className="flex-1 rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm placeholder:text-slate-600 focus:outline-none focus:border-blue-500"
            placeholder="https://github.com/org/repo.git"
            value={repoUrl}
            onChange={(e) => setRepoUrl(e.target.value)}
            disabled={step === "ingesting"}
          />
          <button
            type="button"
            onClick={() => handleIngest(repoUrl)}
            disabled={!repoUrl.trim() || step === "ingesting"}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {step === "ingesting" ? "Ingesting…" : "Ingest"}
          </button>
        </div>
        <div className="flex flex-wrap gap-2 text-xs text-slate-500">
          {DEMO_REPO_PATHS.map((preset) => (
            <button
              key={preset.value}
              type="button"
              onClick={() => {
                setRepoUrl(preset.value);
                handleIngest(preset.value);
              }}
              className="underline decoration-dotted hover:text-slate-300"
            >
              {preset.label}
            </button>
          ))}
        </div>
        {error && <p className="text-sm text-red-400">{error}</p>}
      </section>

      {(step === "review" || step === "launching") && repo && (
        <>
          <section className="space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
              2. Mode
            </h2>
            <ModeToggle
              mode={mode}
              onChange={(next) => {
                setMode(next);
                resetSeam();
              }}
            />
          </section>

          <section className="space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
              {mode === "guided" ? "3. Seam definition" : "3. AI seam discovery"}
            </h2>
            {mode === "guided" ? (
              <ManualSeamForm onSubmit={submitManualSeam} submitting={creatingSeam} />
            ) : (
              <SeamDiscoveryPanel
                discovery={discovery}
                discovering={discovering}
                launching={step === "launching"}
                autonomous={mode === "autonomous"}
                onDiscover={runDiscovery}
                onApprove={approveDiscoveredSeams}
                onCancel={cancelDiscovery}
              />
            )}
          </section>

          {seam && mode !== "discover" && (
            <section className="space-y-3">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
                4. Seam review
              </h2>
              <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-4 space-y-2 text-sm">
                <p>
                  <span className="text-slate-500">Scope:</span>{" "}
                  <span className="font-mono text-xs">{seam.scopeGlobs.join(", ")}</span>
                </p>
                <p>
                  <span className="text-slate-500">Migration:</span>{" "}
                  <span className="font-mono text-xs">
                    {seam.beforePattern} → {seam.afterPattern}
                  </span>
                </p>
                <p>
                  <span className="text-slate-500">Test command:</span>{" "}
                  <span className="font-mono text-xs">{seam.testCommand}</span>
                </p>
                {seam.invariants.length > 0 && (
                  <ul className="list-disc list-inside text-xs text-slate-400">
                    {seam.invariants.map((inv, i) => (
                      <li key={i}>{inv}</li>
                    ))}
                  </ul>
                )}
              </div>

              {graph && (
                <DependencyGraph
                  nodes={graph.nodes}
                  edges={graph.edges}
                  colorForNode={(id) =>
                    highlightSet && matchesAnyGlob(id, [...highlightSet])
                      ? "#dc2626"
                      : undefined
                  }
                />
              )}

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={resetSeam}
                  className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:border-slate-500"
                >
                  Edit seam
                </button>
                <button
                  type="button"
                  onClick={confirmAndLaunch}
                  disabled={step === "launching"}
                  className="flex-1 rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-500 disabled:opacity-40"
                >
                  {step === "launching" ? "Starting campaign…" : "Confirm seam & start campaign"}
                </button>
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
