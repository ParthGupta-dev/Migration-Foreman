"use client";

import { useEffect, useState } from "react";
import { ApiError, api, githubOauthStartUrl } from "@/lib/api";
import type { GithubBranch, GithubRepository, GithubStatus } from "@/lib/types";

interface GithubRepoConnectProps {
  // Called with a full https://github.com/owner/repo.git URL (and, when the
  // user picked one, a specific branch) when the user picks one of their
  // repos. The caller (repo-input page) treats the URL exactly like a
  // pasted one — the backend clones it authenticated when needed.
  onSelectRepo: (repoUrl: string, branch?: string) => void;
  disabled?: boolean;
}

const buttonSecondary =
  "rounded-lg border border-slate-700 px-4 py-2 text-sm font-medium text-slate-300 hover:border-slate-500 disabled:opacity-40 disabled:cursor-not-allowed";

export default function GithubRepoConnect({ onSelectRepo, disabled }: GithubRepoConnectProps) {
  const [status, setStatus] = useState<GithubStatus | null>(null);
  const [oauthNotice, setOauthNotice] = useState<string | null>(null);

  const [repos, setRepos] = useState<GithubRepository[] | null>(null);
  const [loadingRepos, setLoadingRepos] = useState(false);
  const [reposError, setReposError] = useState<string | null>(null);
  const [selected, setSelected] = useState("");

  const [branches, setBranches] = useState<GithubBranch[] | null>(null);
  const [loadingBranches, setLoadingBranches] = useState(false);
  const [branchesError, setBranchesError] = useState<string | null>(null);
  const [selectedBranch, setSelectedBranch] = useState("");

  useEffect(() => {
    api.githubStatus().then(setStatus).catch(() => {});

    const params = new URLSearchParams(window.location.search);
    const outcome = params.get("github");
    if (outcome) {
      if (outcome === "cancelled") {
        setOauthNotice("GitHub authorization was cancelled — still disconnected.");
      } else if (outcome === "error") {
        setOauthNotice("GitHub connection failed — try again.");
      } else if (outcome === "connected") {
        api.githubStatus().then(setStatus).catch(() => {});
      }
      params.delete("github");
      const query = params.toString();
      window.history.replaceState(
        null, "", window.location.pathname + (query ? `?${query}` : "")
      );
    }
  }, []);

  // Deliberately not status?.connected: that flag is also true when the
  // backend merely has a GITHUB_TOKEN env fallback configured, which isn't
  // "this browser is signed in" and can't be used to browse "your" repos.
  const connected = status?.oauthConnected ?? false;

  useEffect(() => {
    if (!connected || repos !== null) return;
    setLoadingRepos(true);
    setReposError(null);
    api
      .githubRepositories()
      .then((res) => setRepos(res.repositories))
      .catch((err) => setReposError(err instanceof ApiError ? err.message : String(err)))
      .finally(() => setLoadingRepos(false));
  }, [connected, repos]);

  const selectedRepo = repos?.find((repo) => repo.fullName === selected) ?? null;

  // Load the branch list whenever the picked repo changes, and default the
  // selection to that repo's own default branch.
  useEffect(() => {
    setBranches(null);
    setSelectedBranch("");
    setBranchesError(null);
    if (!selectedRepo) return;
    setLoadingBranches(true);
    api
      .githubBranches(selectedRepo.owner, selectedRepo.name)
      .then((res) => {
        setBranches(res.branches);
        setSelectedBranch(selectedRepo.defaultBranch);
      })
      .catch((err) => setBranchesError(err instanceof ApiError ? err.message : String(err)))
      .finally(() => setLoadingBranches(false));
  }, [selectedRepo?.fullName]);

  function handleOauthConnect() {
    window.location.href = githubOauthStartUrl(
      window.location.pathname + window.location.search
    );
  }

  function handleUseSelected() {
    if (!selected) return;
    const branch =
      selectedBranch && selectedBranch !== selectedRepo?.defaultBranch
        ? selectedBranch
        : undefined;
    onSelectRepo(`https://github.com/${selected}.git`, branch);
  }

  if (!connected) {
    if (!status?.oauthAvailable) return null; // no OAuth App configured server-side
    return (
      <div className="space-y-1">
        <button
          type="button"
          onClick={handleOauthConnect}
          disabled={disabled}
          className={buttonSecondary}
        >
          Connect GitHub
        </button>
        <p className="text-xs text-slate-500">
          Connect to pick one of your own repositories instead of pasting a URL.
        </p>
        {oauthNotice && <p className="text-xs text-amber-400">{oauthNotice}</p>}
      </div>
    );
  }

  return (
    <div className="space-y-2 rounded-lg border border-slate-800 bg-slate-900/60 p-3">
      <p className="text-xs text-green-400">
        ● GitHub connected{status?.username ? ` as ${status.username}` : ""}
      </p>
      {loadingRepos ? (
        <p className="text-xs text-slate-500">Loading your repositories…</p>
      ) : reposError ? (
        <p className="text-xs text-red-400">{reposError}</p>
      ) : repos && repos.length > 0 ? (
        <div className="space-y-2">
          <div className="flex gap-2">
            <select
              className="flex-1 rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-blue-500"
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
              disabled={disabled}
            >
              <option value="">Select one of your repositories…</option>
              {repos.map((repo) => (
                <option key={repo.fullName} value={repo.fullName}>
                  {repo.fullName}
                  {repo.private ? " (private)" : ""}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={handleUseSelected}
              disabled={!selected || disabled}
              className={buttonSecondary}
            >
              Use repo
            </button>
          </div>

          {selectedRepo && (
            <div className="flex items-center gap-2 pl-1">
              <span className="text-xs text-slate-500 shrink-0">Branch:</span>
              {loadingBranches ? (
                <span className="text-xs text-slate-500">Loading branches…</span>
              ) : branchesError ? (
                <span className="text-xs text-red-400">{branchesError}</span>
              ) : branches && branches.length > 0 ? (
                <select
                  className="flex-1 rounded-lg border border-slate-800 bg-slate-950 px-2 py-1 text-xs text-slate-100 focus:outline-none focus:border-blue-500"
                  value={selectedBranch}
                  onChange={(e) => setSelectedBranch(e.target.value)}
                  disabled={disabled}
                >
                  {branches.map((branch) => (
                    <option key={branch.name} value={branch.name}>
                      {branch.name}
                      {branch.name === selectedRepo.defaultBranch ? " (default)" : ""}
                      {branch.protected ? " 🔒" : ""}
                    </option>
                  ))}
                </select>
              ) : (
                <span className="text-xs text-slate-500">No branches found.</span>
              )}
            </div>
          )}
        </div>
      ) : (
        <p className="text-xs text-slate-500">No repositories found for this account.</p>
      )}
    </div>
  );
}
