"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import { saveCampaign } from "@/lib/campaignStore";
import { writeSeamQueue } from "@/lib/seamQueue";
import type {
  Candidate,
  Discovery,
  DiscoveredSeam,
  HealthResponse,
  LlmProvider,
  Repo,
  SeamRequest,
} from "@/lib/types";
import RepoPicker from "@/components/landing/RepoPicker";
import Composer, { defaultIntentFor } from "@/components/landing/Composer";
import type { ComposerMode } from "@/components/landing/ModeMenu";
import CandidateList from "@/components/landing/CandidateList";
import DiscoveryResult, { type SeamApproval } from "@/components/landing/DiscoveryResult";
import AutoPick from "@/components/landing/AutoPick";
import CampaignBar from "@/components/landing/CampaignBar";

type Result =
  | { kind: "candidates"; candidates: Candidate[]; pickedId: string | null }
  | { kind: "discovery"; discovery: Discovery; approvals: Record<string, SeamApproval> }
  | { kind: "autopick"; discovery: Discovery; top: DiscoveredSeam | null; confirmed: boolean };

function manualSeamRequest(seam: DiscoveredSeam, testCommand: string, model: string | null): SeamRequest {
  return {
    candidateId: null,
    manualSeam: {
      scopeGlobs: seam.scopeGlobs,
      beforePattern: seam.beforePattern,
      afterPattern: seam.afterPattern,
      invariants: seam.invariants,
      testCommand,
    },
    model,
  };
}

function initApprovals(seams: DiscoveredSeam[]): Record<string, SeamApproval> {
  const out: Record<string, SeamApproval> = {};
  for (const seam of seams) {
    out[seam.seamId] = { approved: true, testCommand: seam.testCommand ?? "" };
  }
  return out;
}

export default function LandingPage() {
  return (
    <Suspense fallback={null}>
      <LandingPageInner />
    </Suspense>
  );
}

function LandingPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [providers, setProviders] = useState<LlmProvider[]>([]);
  const [selectedModel, setSelectedModel] = useState<string | null>(null);
  const [repo, setRepo] = useState<Repo | null>(null);
  const [branch, setBranch] = useState<string | null>(null);
  const [pulling, setPulling] = useState(false);

  const [mode, setMode] = useState<ComposerMode>("describe");
  const [intent, setIntent] = useState("");
  const [thinking, setThinking] = useState(false);
  const [picking, setPicking] = useState(false);
  const [starting, setStarting] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  const [notice, setNotice] = useState<{ message: string; kind: "info" | "error" } | null>(null);
  const [githubReturn, setGithubReturn] = useState<"connected" | "cancelled" | "error" | null>(null);

  useEffect(() => {
    api.health().then(setHealth).catch(() => setHealth(null));
    api
      .llmProviders()
      .then((res) => {
        setProviders(res.providers);
        setSelectedModel(res.active ?? res.providers[0]?.models[0]?.model ?? null);
      })
      .catch(() => setProviders([]));
  }, []);

  useEffect(() => {
    const g = searchParams.get("github");
    if (g === "connected" || g === "cancelled" || g === "error") {
      setGithubReturn(g);
      router.replace("/");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const repoReady = repo?.status === "ready";

  const handlePullStart = useCallback(() => {
    setPulling(true);
    setRepo(null);
    setBranch(null);
    setResult(null);
  }, []);

  const handleRepoReady = useCallback((newRepo: Repo, newBranch: string | null) => {
    setPulling(false);
    setRepo(newRepo);
    setBranch(newBranch);
  }, []);

  const handleRepoFailed = useCallback(() => {
    setPulling(false);
    setRepo(null);
    setBranch(null);
  }, []);

  async function handleSend() {
    if (!repo || repo.status !== "ready") return;
    const text = intent.trim() || defaultIntentFor(mode);
    setIntent("");
    setResult(null);
    setThinking(true);
    setNotice(null);
    try {
      if (mode === "scan") {
        const res = await api.getCandidates(repo.repoId);
        setResult({ kind: "candidates", candidates: res.candidates, pickedId: null });
      } else {
        const discovery = await api.discoverSeams(repo.repoId, text, selectedModel);
        if (mode === "describe") {
          setResult({ kind: "discovery", discovery, approvals: initApprovals(discovery.seams) });
        } else {
          setResult({ kind: "autopick", discovery, top: discovery.seams[0] ?? null, confirmed: false });
        }
      }
    } catch (err) {
      setNotice({ message: err instanceof ApiError ? err.message : String(err), kind: "error" });
    } finally {
      setThinking(false);
    }
  }

  async function handlePickCandidate(candidate: Candidate) {
    if (!result || result.kind !== "candidates") return;
    setPicking(true);
    setResult({ ...result, pickedId: candidate.candidateId });
    setPicking(false);
  }

  function handleToggleApproval(seamId: string) {
    if (!result || result.kind !== "discovery") return;
    setResult({
      ...result,
      approvals: {
        ...result.approvals,
        [seamId]: { ...result.approvals[seamId], approved: !result.approvals[seamId].approved },
      },
    });
  }

  function handleEditTestCommand(seamId: string, value: string) {
    if (!result || result.kind !== "discovery") return;
    setResult({
      ...result,
      approvals: { ...result.approvals, [seamId]: { ...result.approvals[seamId], testCommand: value } },
    });
  }

  function handleConfirmAutoPick() {
    if (!result || result.kind !== "autopick") return;
    setResult({ ...result, confirmed: true });
  }

  function handleVetoShowAll() {
    if (!result || result.kind !== "autopick") return;
    setResult({ kind: "discovery", discovery: result.discovery, approvals: initApprovals(result.discovery.seams) });
    setMode("describe");
  }

  const campaignBar = getCampaignBarState(result);

  async function handleStartCampaign() {
    if (!repo || !result) return;
    setStarting(true);
    setNotice(null);
    try {
      const now = new Date().toISOString();
      const jobs: { request: SeamRequest; title: string; discoveredSeam?: DiscoveredSeam }[] = [];

      if (result.kind === "candidates") {
        if (!result.pickedId) return;
        const candidate = result.candidates.find((c) => c.candidateId === result.pickedId);
        if (!candidate) return;
        jobs.push({
          request: { candidateId: candidate.candidateId, manualSeam: null, model: selectedModel },
          title: candidate.scopeGlobs.join(", "),
        });
      } else if (result.kind === "discovery") {
        const approved = result.discovery.seams.filter((s) => result.approvals[s.seamId]?.approved);
        if (approved.length === 0) return;
        const missingTestCommand = approved.find((s) => !result.approvals[s.seamId].testCommand.trim());
        if (missingTestCommand) {
          setNotice({ message: `"${missingTestCommand.title}" needs a verification command before it can start.`, kind: "error" });
          return;
        }
        for (const seam of approved) {
          jobs.push({
            request: manualSeamRequest(seam, result.approvals[seam.seamId].testCommand, selectedModel),
            title: seam.title,
            discoveredSeam: seam,
          });
        }
      } else if (result.kind === "autopick") {
        if (!result.confirmed || !result.top) return;
        jobs.push({
          request: manualSeamRequest(result.top, result.top.testCommand ?? "", selectedModel),
          title: result.top.title,
          discoveredSeam: result.top,
        });
      }

      if (jobs.length === 0) return;

      const created: { seamId: string; testCommand: string; scopeGlobs: string[]; beforePattern: string; afterPattern: string; invariants: string[]; title: string; discoveredSeam?: DiscoveredSeam }[] = [];
      for (const job of jobs) {
        const seam = await api.createSeam(repo.repoId, job.request);
        created.push({ ...seam, title: job.title, discoveredSeam: job.discoveredSeam });
      }

      const [first, ...rest] = created;
      const campaign = await api.createCampaign(first.seamId);

      if (rest.length > 0) {
        writeSeamQueue({
          repoId: repo.repoId,
          seams: rest.map((r) => ({ seamId: r.seamId, title: r.title })),
        });
      }

      const objective = intent.trim() || defaultIntentFor(mode);
      saveCampaign({
        campaignId: campaign.campaignId,
        repoId: repo.repoId,
        repoUrl: repo.repoUrl,
        seamId: first.seamId,
        title: first.title,
        mode,
        model: selectedModel ?? health?.llm ?? "unknown",
        objective,
        plannedAt: now,
        approvedAt: now,
        startedAt: now,
        seam: {
          seamId: first.seamId,
          scopeGlobs: first.scopeGlobs,
          beforePattern: first.beforePattern,
          afterPattern: first.afterPattern,
          invariants: first.invariants,
          testCommand: first.testCommand,
        },
        discovery:
          result.kind !== "candidates" && first.discoveredSeam
            ? {
                seam: first.discoveredSeam,
                repoSummary: result.discovery.repoSummary,
                droppedSeams: result.discovery.droppedSeams,
              }
            : undefined,
        chatExcerpt: [],
      });

      router.push(`/campaign/${campaign.campaignId}/overview`);
    } catch (err) {
      setNotice({ message: err instanceof ApiError ? err.message : String(err), kind: "error" });
    } finally {
      setStarting(false);
    }
  }

  return (
    <main className="min-h-screen bg-foreman-bg flex flex-col items-center justify-center px-6 py-16">
      <div className="w-full max-w-[720px] flex flex-col">
        <div className="text-center mb-7">
          <div className="flex items-center justify-center gap-2.5 pb-3.5">
            <span className="w-2.5 h-2.5 rounded-sm bg-foreman-accent" />
            <span className="font-ui font-bold text-sm tracking-wide">FOREMAN</span>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreman-ink">What should we migrate?</h1>
        </div>

        {notice && (
          <div
            className={`mb-3 rounded-ctl border px-4 py-2.5 text-sm ${
              notice.kind === "error"
                ? "border-[#D9A99A] bg-foreman-fail-bg text-foreman-fail-text"
                : "border-foreman-line bg-foreman-queued-bg text-foreman-ink"
            }`}
          >
            {notice.message}
          </div>
        )}

        {thinking && (
          <p className="mb-3 flex items-center gap-2.5 text-sm text-foreman-dim">
            <span className="h-2 w-2 rounded-full bg-foreman-run animate-pulse" />
            Grounding against the clone…
          </p>
        )}

        {!thinking && result && (
          <div className="mb-3 max-h-[46vh] overflow-y-auto flex flex-col gap-4 pr-1">
            {result.kind === "candidates" && (
              <CandidateList
                candidates={result.candidates}
                pickedId={result.pickedId}
                picking={picking}
                onPick={handlePickCandidate}
              />
            )}
            {result.kind === "discovery" && (
              <DiscoveryResult
                discovery={result.discovery}
                approvals={result.approvals}
                onToggle={handleToggleApproval}
                onEditTestCommand={handleEditTestCommand}
              />
            )}
            {result.kind === "autopick" && (
              <AutoPick
                seam={result.top}
                confirming={false}
                onConfirm={handleConfirmAutoPick}
                onVetoShowAll={handleVetoShowAll}
              />
            )}
          </div>
        )}

        {campaignBar && (
          <div className="mb-2.5">
            <CampaignBar
              label={campaignBar.label}
              hint={campaignBar.hint}
              starting={starting}
              disabled={false}
              onStart={handleStartCampaign}
            />
          </div>
        )}

        <RepoPicker
          repo={repo}
          branch={branch}
          pulling={pulling}
          onPullStart={handlePullStart}
          onRepoReady={handleRepoReady}
          onRepoFailed={handleRepoFailed}
          onNotice={(message, kind) => setNotice({ message, kind })}
          githubReturn={githubReturn}
          onGithubReturnHandled={() => setGithubReturn(null)}
        />

        <Composer
          mode={mode}
          onModeChange={setMode}
          intent={intent}
          onIntentChange={setIntent}
          disabled={!repoReady}
          submitting={thinking}
          providers={providers}
          selectedModel={selectedModel}
          onSelectModel={setSelectedModel}
          onSubmit={handleSend}
        />
      </div>
    </main>
  );
}

function getCampaignBarState(result: Result | null): { label: string; hint: string } | null {
  if (!result) return null;
  if (result.kind === "candidates" && result.pickedId) {
    return { label: "Ready to start.", hint: "Approving starts the campaign and opens the dashboard." };
  }
  if (result.kind === "discovery") {
    const approved = result.discovery.seams.filter((s) => result.approvals[s.seamId]?.approved);
    if (approved.length === 0) return null;
    const files = approved.reduce((sum, s) => sum + s.estimatedFiles, 0);
    return {
      label: `Ready: ${files} units, one per file.`,
      hint:
        approved.length > 1
          ? `Starts with "${approved[0].title}"; ${approved.length - 1} more queued.`
          : "Approving starts the campaign and opens the dashboard.",
    };
  }
  if (result.kind === "autopick" && result.confirmed && result.top) {
    return {
      label: `Ready: ${result.top.estimatedFiles} units, one per file.`,
      hint: "Approving starts the campaign and opens the dashboard.",
    };
  }
  return null;
}
