"use client";

import { useEffect, useState } from "react";
import { ApiError, api, githubOauthStartUrl } from "@/lib/api";
import type { ApplyResult, FinalizeResult, GithubStatus } from "@/lib/types";

interface CompletionPanelProps {
  campaignId: string;
  passedUnits: number;
  escalatedUnits: number;
}

// "Connect GitHub" is the OAuth web flow when the backend has an OAuth App
// configured (githubStatus.oauthAvailable): the browser authorizes on
// github.com and the token stays server-side, keyed to the session cookie.
// Fallbacks that both remain live: a backend GITHUB_TOKEN env var, and this
// manually pasted token kept in sessionStorage and sent per finalize request.
const GITHUB_TOKEN_KEY = "mf-github-token";

const buttonPrimary =
  "rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-500 disabled:opacity-40 disabled:cursor-not-allowed";
const buttonSecondary =
  "rounded-lg border border-slate-700 px-4 py-2 text-sm font-medium text-slate-300 hover:border-slate-500 disabled:opacity-40 disabled:cursor-not-allowed";

export default function CompletionPanel({
  campaignId,
  passedUnits,
  escalatedUnits,
}: CompletionPanelProps) {
  const [applyResult, setApplyResult] = useState<ApplyResult | null>(null);
  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);

  const [githubStatus, setGithubStatus] = useState<GithubStatus | null>(null);
  const [sessionToken, setSessionToken] = useState("");
  const [tokenInput, setTokenInput] = useState("");
  const [showConnect, setShowConnect] = useState(false);
  const [oauthNotice, setOauthNotice] = useState<string | null>(null);

  const [finalizeResult, setFinalizeResult] = useState<FinalizeResult | null>(null);
  const [finalizing, setFinalizing] = useState(false);
  const [finalizeError, setFinalizeError] = useState<string | null>(null);

  const [copied, setCopied] = useState(false);

  useEffect(() => {
    api.githubStatus().then(setGithubStatus).catch(() => {});
    setSessionToken(sessionStorage.getItem(GITHUB_TOKEN_KEY) ?? "");

    // Landing back from the OAuth redirect: ?github=connected|cancelled|error
    const params = new URLSearchParams(window.location.search);
    const outcome = params.get("github");
    if (outcome) {
      if (outcome === "cancelled") {
        setOauthNotice("GitHub authorization was cancelled — still disconnected.");
      } else if (outcome === "error") {
        setOauthNotice("GitHub connection failed — try again or paste a token instead.");
      }
      params.delete("github");
      const query = params.toString();
      window.history.replaceState(
        null, "", window.location.pathname + (query ? `?${query}` : "")
      );
    }
  }, []);

  const githubConnected = (githubStatus?.connected ?? false) || sessionToken.length > 0;

  function handleOauthConnect() {
    // Full-page navigation: GitHub renders its authorize screen, then the
    // backend callback redirects straight back to this page.
    window.location.href = githubOauthStartUrl(
      window.location.pathname + window.location.search
    );
  }

  async function handleApply() {
    setApplying(true);
    setApplyError(null);
    try {
      setApplyResult(await api.applyCampaignLocally(campaignId));
    } catch (err) {
      setApplyError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setApplying(false);
    }
  }

  function handleConnect() {
    const token = tokenInput.trim();
    if (!token) return;
    sessionStorage.setItem(GITHUB_TOKEN_KEY, token);
    setSessionToken(token);
    setTokenInput("");
    setShowConnect(false);
  }

  async function handleCreatePr() {
    setFinalizing(true);
    setFinalizeError(null);
    try {
      setFinalizeResult(
        await api.finalizeCampaign(campaignId, sessionToken || undefined)
      );
    } catch (err) {
      setFinalizeError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setFinalizing(false);
    }
  }

  async function copyGitCommands() {
    if (!applyResult) return;
    try {
      await navigator.clipboard.writeText(applyResult.gitCommands.join("\n"));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable (non-secure context); commands stay visible */
    }
  }

  return (
    <section className="space-y-4">
      {/* Completion header */}
      <div className="rounded-lg border border-green-900 bg-green-950/30 p-4 space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-green-400">
          Migration complete
        </h2>
        <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-slate-300">
          <span>✓ Verification passed</span>
          <span>
            Changed files:{" "}
            <span className="font-medium text-slate-100">
              {applyResult ? applyResult.changedFiles.length : passedUnits}
            </span>
          </span>
          <span>
            Passed units:{" "}
            <span className="font-medium text-green-400">{passedUnits}</span>
          </span>
          <span>
            Escalated:{" "}
            <span className="font-medium text-amber-400">{escalatedUnits}</span>
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {/* Option 1 — apply locally (default) */}
        <div className="rounded-lg border border-slate-700 bg-slate-900/60 p-4 space-y-3">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-slate-100">Apply locally</h3>
            <span className="rounded border border-green-700 bg-green-900/60 px-2 py-0.5 text-xs text-green-300">
              default
            </span>
          </div>
          <p className="text-xs text-slate-400">
            Apply the verified migration directly to your local repository. No
            GitHub connection required.
          </p>
          {!applyResult ? (
            <>
              <button
                type="button"
                onClick={handleApply}
                disabled={applying}
                className={`w-full ${buttonPrimary}`}
              >
                {applying ? "Applying…" : "Apply changes locally"}
              </button>
              {applyError && <p className="text-sm text-red-400">{applyError}</p>}
            </>
          ) : (
            <div className="space-y-3 text-sm">
              <p className="text-green-400">
                ✓ {applyResult.alreadyApplied
                  ? "Changes were already applied"
                  : "Changes applied"}{" "}
                to <span className="font-mono text-xs">{applyResult.baseBranch}</span>
              </p>
              <p>
                <span className="text-slate-500">Local repository:</span>{" "}
                <span className="font-mono text-xs break-all">{applyResult.localPath}</span>
              </p>
              <div className="max-h-28 overflow-y-auto rounded border border-slate-800 bg-slate-950 p-2">
                {applyResult.changedFiles.map((file) => (
                  <p key={file} className="font-mono text-xs text-slate-400">
                    {file}
                  </p>
                ))}
              </div>
              {applyResult.diffSummary && (
                <pre className="overflow-x-auto rounded border border-slate-800 bg-slate-950 p-2 font-mono text-xs text-slate-400">
                  {applyResult.diffSummary}
                </pre>
              )}
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-slate-400">
                    Next steps from your repository
                  </span>
                  <button
                    type="button"
                    onClick={copyGitCommands}
                    className="rounded border border-slate-700 px-2 py-1 text-xs text-slate-300 hover:border-slate-500"
                  >
                    {copied ? "✓ Copied" : "Copy git commands"}
                  </button>
                </div>
                <pre className="overflow-x-auto rounded border border-slate-800 bg-slate-950 p-2 font-mono text-xs text-slate-300">
                  {applyResult.gitCommands.join("\n")}
                </pre>
              </div>
            </div>
          )}
        </div>

        {/* Option 2 — GitHub pull request (optional) */}
        <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-4 space-y-3">
          <h3 className="text-sm font-semibold text-slate-100">Create pull request</h3>
          <p className="text-xs text-slate-400">
            Push the verified migration to GitHub and automatically open a Pull
            Request. Optional — requires a GitHub connection.
          </p>
          {finalizeResult ? (
            <p className="text-sm">
              <a
                href={finalizeResult.prUrl}
                target="_blank"
                rel="noreferrer"
                className="text-blue-400 underline"
              >
                {finalizeResult.prUrl}
              </a>{" "}
              <span className="text-slate-500">
                ({finalizeResult.acceptedUnits} accepted, {finalizeResult.escalatedUnits} escalated)
              </span>
            </p>
          ) : githubConnected ? (
            <>
              <p className="text-xs text-green-400">
                ● GitHub connected
                {githubStatus?.username
                  ? ` as ${githubStatus.username}`
                  : sessionToken
                    ? " (this session)"
                    : " (server)"}
              </p>
              <button
                type="button"
                onClick={handleCreatePr}
                disabled={finalizing}
                className={`w-full ${buttonSecondary}`}
              >
                {finalizing ? "Opening PR…" : "Create pull request"}
              </button>
            </>
          ) : showConnect ? (
            <div className="space-y-2">
              <label className="text-xs font-medium text-slate-400">
                GitHub personal access token (repo scope) — kept for this browser
                session only, sent per request, never stored server-side
              </label>
              <input
                type="password"
                className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 font-mono text-xs text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-blue-500"
                placeholder="github_pat_…"
                value={tokenInput}
                onChange={(e) => setTokenInput(e.target.value)}
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleConnect}
                  disabled={!tokenInput.trim()}
                  className={buttonSecondary}
                >
                  Connect
                </button>
                <button
                  type="button"
                  onClick={() => setShowConnect(false)}
                  className="text-xs text-slate-500 hover:text-slate-300"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : githubStatus?.oauthAvailable ? (
            <div className="space-y-2">
              <button
                type="button"
                onClick={handleOauthConnect}
                className={`w-full ${buttonSecondary}`}
              >
                Connect GitHub
              </button>
              <button
                type="button"
                onClick={() => setShowConnect(true)}
                className="text-xs text-slate-500 hover:text-slate-300"
              >
                …or paste a personal access token instead
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setShowConnect(true)}
              className={`w-full ${buttonSecondary}`}
            >
              Connect GitHub
            </button>
          )}
          {oauthNotice && <p className="text-xs text-amber-400">{oauthNotice}</p>}
          {finalizeError && (
            <p className="text-sm text-red-400">
              PR creation failed ({finalizeError}) — apply locally instead, or use
              View Diff / Live Preview on the units above to inspect the changes.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
