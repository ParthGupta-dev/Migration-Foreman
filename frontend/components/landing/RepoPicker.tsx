"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Folder, GitBranch, Github, Loader2, Search } from "lucide-react";
import { api, ApiError, githubOauthStartUrl } from "@/lib/api";
import type { GithubBranch, GithubRepository, GithubStatus, Repo } from "@/lib/types";

type PopView = "choose" | "remote" | "connect" | "repolist";

interface RepoPickerProps {
  repo: Repo | null;
  branch: string | null;
  pulling: boolean;
  onPullStart: () => void;
  onRepoReady: (repo: Repo, branch: string | null) => void;
  onRepoFailed: () => void;
  onNotice: (message: string, kind: "info" | "error") => void;
  githubReturn: "connected" | "cancelled" | "error" | null;
  onGithubReturnHandled: () => void;
}

const DEMO_REPO_PATH = "/app/data/demo-repo";

export default function RepoPicker({
  repo,
  branch,
  pulling,
  onPullStart,
  onRepoReady,
  onRepoFailed,
  onNotice,
  githubReturn,
  onGithubReturnHandled,
}: RepoPickerProps) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<PopView>("choose");
  const [githubStatus, setGithubStatus] = useState<GithubStatus | null>(null);

  const [remoteUrl, setRemoteUrl] = useState("");
  const [remoteBranch, setRemoteBranch] = useState("");

  const [repos, setRepos] = useState<GithubRepository[] | null>(null);
  const [repoSearch, setRepoSearch] = useState("");
  const [reposLoading, setReposLoading] = useState(false);

  // Branch chip dropdown (separate from the repo popover) — matches the mock's
  // second chip: shows the current branch, opens the full branch list on click.
  const [branchOpen, setBranchOpen] = useState(false);
  const [branchList, setBranchList] = useState<GithubBranch[] | null>(null);
  const [branchLoading, setBranchLoading] = useState(false);

  const popRef = useRef<HTMLDivElement>(null);
  const branchRef = useRef<HTMLDivElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  // Only GitHub repos have a listable set of branches; parse owner/name back
  // out of the clone URL (demo repo / arbitrary paths have no branch API).
  const ghRepo = repo?.status === "ready" ? parseGithubOwnerRepo(repo.repoUrl) : null;

  useEffect(() => {
    api.githubStatus().then(setGithubStatus).catch(() => setGithubStatus(null));
  }, []);

  useEffect(() => {
    if (!githubReturn) return;
    api
      .githubStatus()
      .then((status) => {
        setGithubStatus(status);
        if (githubReturn === "connected" && status.oauthConnected) {
          onNotice(`Connected to GitHub as ${status.username ?? "your account"}.`, "info");
          setOpen(true);
          loadRepoList();
        } else if (githubReturn === "cancelled") {
          onNotice("GitHub connection was cancelled.", "info");
        } else {
          onNotice("GitHub connection failed. You can try again or use a repo URL instead.", "error");
        }
      })
      .catch(() => onNotice("Could not confirm GitHub connection status.", "error"))
      .finally(() => onGithubReturnHandled());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [githubReturn]);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      const target = e.target as Node;
      if (open && popRef.current && !popRef.current.contains(target)) {
        setOpen(false);
      }
      if (branchOpen && branchRef.current && !branchRef.current.contains(target)) {
        setBranchOpen(false);
      }
    }
    document.addEventListener("click", onDocClick);
    return () => document.removeEventListener("click", onDocClick);
  }, [open, branchOpen]);

  // A brand-new repo (different clone URL) invalidates any cached branch list;
  // re-selecting the same repo on another branch keeps it (same URL).
  useEffect(() => {
    setBranchList(null);
    setBranchOpen(false);
  }, [repo?.repoUrl]);

  function openPop() {
    setOpen(true);
    // Already connected → jump straight to the repo list (mock: openPop does
    // `githubConnected ? showRepoList() : showChoose()`); otherwise the tiles.
    if (githubStatus?.oauthConnected) {
      loadRepoList();
    } else {
      setView("choose");
    }
  }

  async function pull(url: string, useBranch?: string) {
    setOpen(false);
    onPullStart();
    try {
      const result = await api.createRepo(url, useBranch || undefined);
      if (result.status === "ready") {
        onRepoReady(result, useBranch || null);
      } else {
        onRepoFailed();
        onNotice(`Cloning ${url} failed — check the URL/path and try again.`, "error");
      }
    } catch (err) {
      onRepoFailed();
      onNotice(err instanceof ApiError ? err.message : String(err), "error");
    }
  }

  function submitDemo() {
    pull(DEMO_REPO_PATH);
  }

  function submitRemote() {
    if (!remoteUrl.trim()) return;
    pull(remoteUrl.trim(), remoteBranch.trim());
  }

  async function handleFolderSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    e.target.value = "";
    if (!files || files.length === 0) return;
    const folderName = (files[0] as File & { webkitRelativePath: string }).webkitRelativePath.split("/")[0];
    setOpen(false);
    onPullStart();
    try {
      const result = await api.uploadRepo(files);
      if (result.status === "ready") {
        onRepoReady(result, null);
      } else {
        onRepoFailed();
        onNotice(`Uploading "${folderName}" failed — check the folder and try again.`, "error");
      }
    } catch (err) {
      onRepoFailed();
      onNotice(err instanceof ApiError ? err.message : String(err), "error");
    }
  }

  async function loadRepoList() {
    setView("repolist");
    setReposLoading(true);
    try {
      const res = await api.githubRepositories();
      setRepos(res.repositories);
    } catch (err) {
      onNotice(err instanceof ApiError ? err.message : String(err), "error");
      setRepos([]);
    } finally {
      setReposLoading(false);
    }
  }

  function selectGithub() {
    if (!githubStatus?.oauthAvailable) {
      // Not configured server-side — send the user to the URL field instead of
      // silently doing nothing.
      setView("remote");
      return;
    }
    if (githubStatus.oauthConnected) {
      loadRepoList();
    } else {
      // Kick off the OAuth web flow immediately: a full-page navigation to the
      // backend's /github/oauth/start, which 302s to GitHub's authorize screen.
      continueWithGithub();
    }
  }

  function continueWithGithub() {
    window.location.href = githubOauthStartUrl("/");
  }

  function selectRepoRow(r: GithubRepository) {
    // Matches the mock: picking a repo clones its default branch immediately
    // and closes the picker — branch switching happens on the branch chip.
    pull(`https://github.com/${r.fullName}`, r.defaultBranch);
  }

  async function toggleBranch() {
    if (!ghRepo) return;
    const next = !branchOpen;
    setBranchOpen(next);
    if (next && branchList === null) {
      setBranchLoading(true);
      try {
        const res = await api.githubBranches(ghRepo.owner, ghRepo.name);
        setBranchList(res.branches);
      } catch (err) {
        onNotice(err instanceof ApiError ? err.message : String(err), "error");
        setBranchList([]);
      } finally {
        setBranchLoading(false);
      }
    }
  }

  function pickBranch(name: string) {
    setBranchOpen(false);
    if (!repo || name === branch) return;
    // Re-clone the same repo on the chosen branch (the backend clones per repo
    // row; the clone URL is unchanged so the cached branch list survives).
    pull(repo.repoUrl, name);
  }

  const filteredRepos = (repos ?? []).filter((r) =>
    r.fullName.toLowerCase().includes(repoSearch.toLowerCase())
  );

  const chipLabel = pulling
    ? null
    : repo && repo.status === "ready"
    ? repoLabel(repo.repoUrl)
    : githubStatus?.oauthConnected
    ? "Select repo"
    : "Select a codebase…";

  return (
    <div className="relative mb-2.5">
      <div className="flex items-center gap-2 flex-wrap">
        <button
          type="button"
          onClick={openPop}
          aria-haspopup="dialog"
          aria-expanded={open}
          className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[13px] font-medium font-ui ${
            !repo || repo.status !== "ready"
              ? "border-dashed border-foreman-faint text-foreman-dim"
              : "border-foreman-line bg-foreman-card text-foreman-ink hover:border-foreman-faint"
          }`}
        >
          {pulling ? (
            <>
              <Loader2 size={13} className="animate-spin text-foreman-dim" />
              <span>cloning &amp; scanning…</span>
            </>
          ) : (
            <>
              <Folder size={13} className="text-foreman-dim" />
              <span className={repo?.status === "ready" ? "font-mono text-[12.5px]" : ""}>{chipLabel}</span>
              <ChevronDown size={8} className="text-foreman-faint ml-0.5" />
            </>
          )}
        </button>

        {repo?.status === "ready" && (
          <div className="relative" ref={branchRef}>
            <button
              type="button"
              onClick={toggleBranch}
              disabled={!ghRepo}
              aria-haspopup={ghRepo ? "listbox" : undefined}
              aria-expanded={branchOpen}
              className="inline-flex items-center gap-1.5 rounded-full border border-foreman-line bg-foreman-card px-3 py-1.5 text-[13px] font-medium text-foreman-ink hover:border-foreman-faint disabled:cursor-default disabled:hover:border-foreman-line"
            >
              <GitBranch size={13} className="text-foreman-dim" />
              <span className="font-mono text-[12.5px]">{branch || "default"}</span>
              {ghRepo && <ChevronDown size={8} className="text-foreman-faint ml-0.5" />}
            </button>

            {branchOpen && ghRepo && (
              <div
                role="listbox"
                className="absolute top-[calc(100%+6px)] left-0 z-30 w-[260px] rounded-card border border-foreman-line bg-foreman-card p-1.5 shadow-[0_12px_32px_rgba(16,24,40,0.14)]"
              >
                {branchLoading && <p className="px-2.5 py-2 text-xs text-foreman-dim">Loading branches…</p>}
                {!branchLoading && (branchList ?? []).length === 0 && (
                  <p className="px-2.5 py-2 text-xs text-foreman-dim">No branches found.</p>
                )}
                {!branchLoading &&
                  (branchList ?? []).map((b) => (
                    <button
                      key={b.name}
                      type="button"
                      role="option"
                      aria-selected={b.name === branch}
                      onClick={() => pickBranch(b.name)}
                      className={`flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-[13px] font-mono ${
                        b.name === branch
                          ? "bg-foreman-queued-bg text-foreman-ink font-semibold"
                          : "text-foreman-ink hover:bg-foreman-bg"
                      }`}
                    >
                      <span className="truncate">{b.name}</span>
                      {b.name === branch && <Check size={13} className="ml-auto flex-none text-foreman-dim" />}
                    </button>
                  ))}
              </div>
            )}
          </div>
        )}
      </div>

      {open && (
        <div
          ref={popRef}
          role="dialog"
          aria-label="Select a codebase"
          className="absolute top-[calc(100%+8px)] left-0 z-30 w-[440px] rounded-card border border-foreman-line bg-foreman-card p-4 shadow-[0_12px_32px_rgba(16,24,40,0.14)]"
        >
          {view === "choose" && (
            <div className="flex flex-col gap-2">
              <PickerOption
                title="Browse"
                hint="Pick a folder already on this machine."
                iconLabel={<Folder size={16} />}
                onClick={() => folderInputRef.current?.click()}
              />
              <PickerOption
                title="GitHub"
                hint={
                  githubStatus?.oauthAvailable
                    ? "Connect your account and pick a repo."
                    : "GitHub OAuth isn't configured on this server — use a repo URL instead."
                }
                iconLabel={<Github size={16} />}
                dark
                disabled={githubStatus ? !githubStatus.oauthAvailable : true}
                onClick={selectGithub}
              />
              <input
                ref={folderInputRef}
                type="file"
                // @ts-expect-error non-standard attributes, no directory
                // picker equivalent exists in the DOM typings
                webkitdirectory=""
                directory=""
                multiple
                hidden
                onChange={handleFolderSelect}
              />
              <p className="text-center text-xs text-foreman-dim mt-1">
                or{" "}
                <button type="button" onClick={submitDemo} className="text-foreman-link underline">
                  use the demo repo
                </button>{" "}
                or{" "}
                <button type="button" onClick={() => setView("remote")} className="text-foreman-link underline">
                  paste a repo URL
                </button>
              </p>
              <div className="flex justify-end mt-1">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded-ctl border border-[#D6C9B5] bg-foreman-card px-3 py-1.5 text-[13px] font-semibold text-foreman-ink hover:bg-foreman-bg"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {view === "remote" && (
            <div>
              <BackLink onClick={() => setView("choose")} />
              <label className="block text-[13px] font-medium text-foreman-ink mb-1.5" htmlFor="remote-url">
                Repository URL or container-visible path
              </label>
              <input
                id="remote-url"
                type="text"
                value={remoteUrl}
                onChange={(e) => setRemoteUrl(e.target.value)}
                placeholder="https://github.com/owner/repo.git or /app/data/demo-repo"
                className="w-full rounded-ctl border border-[#D6C9B5] bg-foreman-card px-3 py-2 font-mono text-[13px] text-foreman-ink"
              />
              <p className="text-xs text-foreman-dim mt-1.5">
                A path must exist on the filesystem the backend container can see — not your local machine.
              </p>
              <label className="block text-[13px] font-medium text-foreman-ink mb-1.5 mt-2.5" htmlFor="remote-branch">
                Branch <span className="text-foreman-dim font-normal">(optional)</span>
              </label>
              <input
                id="remote-branch"
                type="text"
                value={remoteBranch}
                onChange={(e) => setRemoteBranch(e.target.value)}
                placeholder="default branch"
                className="w-full rounded-ctl border border-[#D6C9B5] bg-foreman-card px-3 py-2 font-mono text-[13px] text-foreman-ink"
              />
              <div className="flex justify-end gap-2 mt-2.5">
                <button
                  type="button"
                  onClick={() => setView("choose")}
                  className="rounded-ctl border border-[#D6C9B5] bg-foreman-card px-3 py-1.5 text-[13px] font-semibold text-foreman-ink hover:bg-foreman-bg"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={submitRemote}
                  disabled={!remoteUrl.trim()}
                  className="rounded-ctl bg-foreman-primary px-3 py-1.5 text-[13px] font-semibold text-white hover:bg-[#5A4A3A] disabled:opacity-50"
                >
                  Clone
                </button>
              </div>
            </div>
          )}

          {view === "connect" && (
            <div>
              <BackLink onClick={() => setView("choose")} />
              <div className="flex items-center gap-2.5 rounded-ctl border border-foreman-line bg-foreman-bg p-2.5">
                <span className="flex h-[26px] w-[26px] flex-none items-center justify-center rounded-md bg-foreman-primary font-mono text-[11px] font-semibold text-white">
                  <Github size={14} />
                </span>
                <div>
                  <p className="text-[13px] font-semibold text-foreman-ink">Connect GitHub</p>
                  <p className="text-xs text-foreman-dim">
                    Foreman needs access to list your repos and open a pull request once a migration finishes.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={continueWithGithub}
                className="mt-2.5 w-full justify-center rounded-ctl border border-[#D6C9B5] bg-foreman-card px-3 py-1.5 text-[13px] font-semibold text-foreman-ink hover:bg-foreman-bg"
              >
                Continue with GitHub
              </button>
            </div>
          )}

          {view === "repolist" && (
            <div>
              <label className="block text-[13px] font-medium text-foreman-ink mb-1.5" htmlFor="repo-search">
                Repositories
              </label>
              <div className="relative mb-2">
                <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-foreman-faint" />
                <input
                  id="repo-search"
                  type="text"
                  value={repoSearch}
                  onChange={(e) => setRepoSearch(e.target.value)}
                  placeholder="Search…"
                  className="w-full rounded-ctl border border-[#D6C9B5] bg-foreman-card py-2 pl-8 pr-3 text-[13px] text-foreman-ink"
                />
              </div>
              <div className="flex max-h-[220px] flex-col gap-0.5 overflow-y-auto">
                {reposLoading && <p className="px-1 py-2 text-xs text-foreman-dim">Loading repositories…</p>}
                {!reposLoading && filteredRepos.length === 0 && (
                  <p className="px-1 py-2 text-xs text-foreman-dim">No matches.</p>
                )}
                {!reposLoading &&
                  filteredRepos.map((r) => (
                    <button
                      key={r.fullName}
                      type="button"
                      onClick={() => selectRepoRow(r)}
                      className="flex items-center gap-2 rounded-md px-2.5 py-2 text-left text-[13px] text-foreman-ink hover:bg-foreman-bg"
                    >
                      <GitBranch size={13} className="text-foreman-faint" />
                      <span className="font-mono">{r.fullName}</span>
                      {r.private && <span className="ml-auto text-[10px] text-foreman-faint">private</span>}
                    </button>
                  ))}
              </div>
              <div className="flex justify-end mt-2.5">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded-ctl border border-[#D6C9B5] bg-foreman-card px-3 py-1.5 text-[13px] font-semibold text-foreman-ink hover:bg-foreman-bg"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

        </div>
      )}
    </div>
  );
}

function repoLabel(repoUrl: string): string {
  const trimmed = repoUrl.replace(/\.git$/, "");
  const parts = trimmed.split("/");
  return parts[parts.length - 1] || repoUrl;
}

// Pull owner/name back out of a GitHub clone URL so the branch chip can call
// GET /github/repository/{owner}/{repo}/branches. Returns null for non-GitHub
// sources (demo repo, container paths) — those have no branch list.
function parseGithubOwnerRepo(repoUrl: string): { owner: string; name: string } | null {
  const m = repoUrl.match(/github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?\/?$/i);
  return m ? { owner: m[1], name: m[2] } : null;
}

function PickerOption({
  title,
  hint,
  iconLabel,
  dark,
  disabled,
  onClick,
}: {
  title: string;
  hint: string;
  iconLabel: React.ReactNode;
  dark?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex w-full items-center gap-3 rounded-ctl border border-foreman-line bg-foreman-card px-3.5 py-3 text-left hover:border-foreman-faint hover:bg-foreman-bg disabled:opacity-45 disabled:hover:bg-foreman-card disabled:hover:border-foreman-line"
    >
      <span
        className={`flex h-8 w-8 flex-none items-center justify-center rounded-lg font-mono text-xs font-semibold ${
          dark ? "bg-foreman-primary text-white" : "bg-foreman-queued-bg text-foreman-dim"
        }`}
      >
        {iconLabel}
      </span>
      <span className="flex flex-col gap-0.5">
        <span className="text-[13.5px] font-semibold text-foreman-ink">{title}</span>
        <span className="text-xs text-foreman-dim">{hint}</span>
      </span>
    </button>
  );
}

function BackLink({ onClick, label = "← Back" }: { onClick: () => void; label?: string }) {
  return (
    <button type="button" onClick={onClick} className="mb-3 inline-block text-xs text-foreman-link underline">
      {label}
    </button>
  );
}
