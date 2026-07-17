"use client";

// Summary publishing cards (mock: summary.html — the Apply-locally + Pull
// request sections). Apply-locally is the default, GitHub-free path
// (POST /campaign/{id}/apply). The PR card uses the OAuth session when
// connected, offers a manual-token field otherwise, and falls back to the
// apply-locally path when the backend returns 502 pr_creation_failed
// (non-GitHub repo / missing token) — frontend_refactor.md §2.

import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import type { ApplyResult, FinalizeResult, GithubStatus } from "@/lib/types";

export default function Publish({ campaignId }: { campaignId: string }) {
  return (
    <>
      <ApplyCard campaignId={campaignId} />
      <PrCard campaignId={campaignId} />
    </>
  );
}

function ApplyCard({ campaignId }: { campaignId: string }) {
  const [result, setResult] = useState<ApplyResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function apply() {
    setLoading(true);
    setError(null);
    try {
      setResult(await api.applyCampaignLocally(campaignId));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Apply failed.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="mt-4 rounded-card border border-foreman-line bg-foreman-card p-6 shadow-card">
      <h2 className="mb-4 text-xs font-semibold uppercase tracking-[0.06em] text-foreman-dim">
        Apply locally
      </h2>
      {!result ? (
        <div className="flex items-center gap-4">
          <p className="text-[13px] text-foreman-dim">
            Merge every accepted unit onto the campaign branch in your local clone — no GitHub
            required.
          </p>
          <button
            type="button"
            onClick={apply}
            disabled={loading}
            className="ml-auto whitespace-nowrap rounded-ctl bg-foreman-primary px-4 py-2 text-sm font-semibold text-white hover:bg-[#5A4A3A] disabled:opacity-60"
          >
            {loading ? "Applying…" : "Apply locally"}
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-3 text-[13px]">
          <p className="text-foreman-ink">
            {result.alreadyApplied ? "Already applied" : "Applied"} —{" "}
            <span className="tabular-nums">{result.acceptedUnits}</span> unit
            {result.acceptedUnits === 1 ? "" : "s"} on{" "}
            <span className="font-mono">{result.campaignBranch}</span>.
          </p>
          <div>
            <SubHead>Changed files ({result.changedFiles.length})</SubHead>
            <ul className="font-mono text-xs text-foreman-dim">
              {result.changedFiles.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          </div>
          <div>
            <SubHead>Git commands</SubHead>
            <pre className="overflow-x-auto whitespace-pre rounded-ctl border border-foreman-line bg-[#F5F0E8] p-3 font-mono text-xs leading-relaxed text-foreman-ink">
              {result.gitCommands.join("\n")}
            </pre>
          </div>
        </div>
      )}
      {error && <p className="mt-3 text-xs text-foreman-fail-text">{error}</p>}
    </section>
  );
}

function PrCard({ campaignId }: { campaignId: string }) {
  const [gh, setGh] = useState<GithubStatus | null>(null);
  const [token, setToken] = useState("");
  const [result, setResult] = useState<FinalizeResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [fallback, setFallback] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api
      .githubStatus()
      .then((s) => alive && setGh(s))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const oauthConnected = gh?.oauthConnected ?? false;

  async function createPr() {
    setLoading(true);
    setError(null);
    setFallback(false);
    try {
      setResult(await api.finalizeCampaign(campaignId, oauthConnected ? undefined : token || undefined));
    } catch (e) {
      if (e instanceof ApiError && e.error === "pr_creation_failed") {
        setFallback(true);
      } else {
        setError(e instanceof ApiError ? e.message : "PR creation failed.");
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="mt-4 rounded-card border border-foreman-line bg-foreman-card p-6 shadow-card">
      <h2 className="mb-4 text-xs font-semibold uppercase tracking-[0.06em] text-foreman-dim">
        Pull request
      </h2>

      {result ? (
        <div className="flex items-center gap-4">
          <span className="h-2 w-2 flex-none rounded-full bg-foreman-ok" />
          <span className="font-mono text-[13px]">
            {result.acceptedUnits} accepted · {result.escalatedUnits} escalated
          </span>
          <a
            href={result.prUrl}
            target="_blank"
            rel="noreferrer"
            className="ml-auto rounded-ctl bg-foreman-primary px-3 py-[5px] text-[13px] font-semibold text-white no-underline hover:bg-[#5A4A3A]"
          >
            View PR →
          </a>
        </div>
      ) : fallback ? (
        <div className="rounded-ctl border border-[#D9A99A] bg-[#F7EEE9] p-4 text-[13px] text-foreman-fail-text">
          <p className="font-semibold">No PR was created</p>
          <p className="mt-1 text-foreman-dim">
            This repo has no GitHub token (non-GitHub clone or missing credentials). Use{" "}
            <strong>Apply locally</strong> above to merge the accepted units into your clone, or
            connect GitHub and retry.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {!oauthConnected && (
            <div>
              <label className="mb-1.5 block text-[13px] font-medium" htmlFor="pr-token">
                GitHub token (optional)
              </label>
              <input
                id="pr-token"
                type="text"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="ghp_… — or connect GitHub on the landing page"
                className="w-full rounded-ctl border border-[#D6C9B5] bg-foreman-card px-3 py-2 font-mono text-[13px]"
              />
            </div>
          )}
          <div className="flex items-center gap-4">
            <p className="text-[13px] text-foreman-dim">
              {oauthConnected
                ? `Open a PR from the campaign branch as ${gh?.username ?? "your GitHub account"}.`
                : "Open a PR from the campaign branch — needs a GitHub token or an OAuth session."}
            </p>
            <button
              type="button"
              onClick={createPr}
              disabled={loading}
              className="ml-auto whitespace-nowrap rounded-ctl bg-foreman-primary px-4 py-2 text-sm font-semibold text-white hover:bg-[#5A4A3A] disabled:opacity-60"
            >
              {loading ? "Creating…" : "Create PR"}
            </button>
          </div>
        </div>
      )}
      {error && <p className="mt-3 text-xs text-foreman-fail-text">{error}</p>}
    </section>
  );
}

function SubHead({ children }: { children: React.ReactNode }) {
  return (
    <h4 className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-foreman-dim">
      {children}
    </h4>
  );
}
