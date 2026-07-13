"""End-to-end campaign runner CLI (stdlib only — no pip installs needed).

Drives the backend through the full pipeline without the frontend, using the
same AI planning pipeline as the UI (POST /repo/{id}/discover):
ingest -> repository analysis + seam discovery -> human confirmation ->
seam(s) -> campaign(s) -> live poll -> optional finalize.

Autonomous by default: give it a natural-language goal and it discovers
grounded seams (patterns, scope, verification command) itself — no
--before/--after flags and no .migration-foreman.json required. Discovered
seams are always presented for confirmation before execution (--yes skips
the prompt for unattended runs).

Usage:
  python scripts/run_campaign.py --repo-url /app/data/demo-repo \
      --intent "Migrate legacy_format to format_text"
  python scripts/run_campaign.py --repo-url <github url> \
      --intent "Upgrade requests to httpx" --yes --finalize
  python scripts/run_campaign.py --manual-seam --scope "src/**/*.py" \
      --before old_api --after new_api --test-command "python -m pytest -q"
      (guided mode: you type the seam yourself, discovery is skipped)

--repo-url must be a path/URL valid *from the backend's point of view*
(inside docker compose the demo repo lives at /app/data/demo-repo).
"""

import argparse
import json
import sys
import time
import urllib.error
import urllib.request


def call(base: str, method: str, path: str, body: dict | None = None) -> dict:
    data = json.dumps(body).encode() if body is not None else None
    request = urllib.request.Request(
        base + path, data=data, method=method,
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(request, timeout=300) as response:
            return json.loads(response.read())
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode(errors="replace")
        raise SystemExit(f"{method} {path} -> {exc.code}: {detail}")


def run_campaign(base: str, seam_id: str, label: str, finalize: bool) -> str:
    """Create a campaign for one seam, poll it to the end, return its status."""
    campaign = call(base, "POST", "/campaign", {"seamId": seam_id})
    campaign_id = campaign["campaignId"]
    print(f"      campaignId={campaign_id} units={campaign['unitCount']}  ({label})")

    last_snapshot = ""
    while True:
        state = call(base, "GET", f"/campaign/{campaign_id}")
        snapshot = " | ".join(
            f"{unit['scopeGlob']}={unit['status']}(a{unit['attempt']})" for unit in state["units"]
        )
        if snapshot != last_snapshot:
            print(f"      [{state['status']}] {snapshot}")
            last_snapshot = snapshot
        if state["status"] in ("completed", "failed"):
            break
        time.sleep(2)

    passed = sum(1 for unit in state["units"] if unit["status"] == "passed")
    escalated = sum(1 for unit in state["units"] if unit["status"] == "escalated")
    print(f"      Campaign {state['status']}: {passed} passed, {escalated} escalated")

    if finalize and state["status"] == "completed":
        result = call(base, "POST", f"/campaign/{campaign_id}/finalize")
        print(f"      PR: {result['prUrl']} "
              f"(accepted={result['acceptedUnits']}, escalated={result['escalatedUnits']})")
    return state["status"]


def main() -> None:
    # Windows consoles may default to a legacy codepage; keep ✓ printable.
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")

    parser = argparse.ArgumentParser(description="Run a Migration Foreman campaign end-to-end")
    parser.add_argument("--base-url", default="http://localhost:8000")
    parser.add_argument("--repo-url", default="/app/data/demo-repo",
                        help="Repo URL/path as seen by the backend")
    parser.add_argument("--intent", default=None,
                        help='Natural-language migration goal (e.g. "Upgrade requests to httpx"); '
                             "runs repository analysis + AI seam discovery")
    parser.add_argument("--yes", "-y", action="store_true",
                        help="Skip the confirmation prompt (unattended runs)")
    parser.add_argument("--manual-seam", action="store_true",
                        help="Guided mode: submit a hand-written seam instead of discovering one")
    parser.add_argument("--scope", action="append", default=None,
                        help="Seam scope glob (guided mode, repeatable)")
    parser.add_argument("--before", default=None, help="beforePattern (guided mode)")
    parser.add_argument("--after", default=None, help="afterPattern (guided mode)")
    parser.add_argument("--invariant", action="append", default=None,
                        help="Invariant that must hold post-migration (repeatable)")
    parser.add_argument("--test-command", default=None,
                        help="Verification command (guided mode; discovery infers its own)")
    parser.add_argument("--finalize", action="store_true",
                        help="Open a PR per completed campaign (needs GITHUB_TOKEN + GitHub repo)")
    args = parser.parse_args()
    base = args.base_url.rstrip("/")

    if not args.intent and not args.manual_seam:
        raise SystemExit(
            "Give the foreman a goal: --intent \"<natural-language migration goal>\" "
            "(or --manual-seam for guided mode)"
        )

    print(f"[1/4] Ingesting repo {args.repo_url}")
    repo = call(base, "POST", "/repo", {"repoUrl": args.repo_url})
    print(f"      repoId={repo['repoId']} status={repo['status']}")
    if repo["status"] != "ready":
        raise SystemExit("Repo ingestion failed")

    if args.manual_seam:
        # Guided mode — the operator IS the planner.
        if not args.scope or not args.before or not args.after:
            raise SystemExit("Guided mode needs --scope, --before, and --after")
        seam_specs = [{
            "title": f"{args.before} -> {args.after}",
            "manualSeam": {
                "scopeGlobs": args.scope,
                "beforePattern": args.before,
                "afterPattern": args.after,
                "invariants": args.invariant or ["All existing tests pass"],
                "testCommand": args.test_command
                or "python -m unittest discover -s tests -t . -v",
            },
        }]
    else:
        print(f"[2/4] Repository analysis + AI seam discovery: {args.intent!r}")
        discovery = call(base, "POST", f"/repo/{repo['repoId']}/discover",
                         {"objective": args.intent})
        summary = discovery["repoSummary"]
        print(f"      Analyzed {summary['fileCount']} file(s), "
              f"{summary['graphEdges']} import edge(s)")
        print(f"      {discovery['seamCount']} seam(s) discovered  "
              f"[overall risk: {discovery['overallRisk']}, "
              f"~{discovery['totalEstimatedFiles']} file(s), "
              f"~{discovery['estimatedMinutes']} min]")
        for dropped in discovery["droppedSeams"]:
            print(f"      ! dropped: {dropped['title']} — {dropped['reason']}")

        seam_specs = []
        for seam in discovery["seams"]:
            deps = f"  depends on: {', '.join(seam['dependsOn'])}" if seam["dependsOn"] else ""
            print(f"      #{seam['executionOrder'] + 1} {seam['title']}  "
                  f"[risk: {seam['risk']}, confidence {seam['confidence']:.2f}, "
                  f"{seam['estimatedFiles']} file(s), {seam['occurrences']} occurrence(s)]{deps}")
            print(f"         {seam['beforePattern']} -> {seam['afterPattern']}")
            print(f"         verify: {seam['testCommand'] or '(none inferred)'}")
            print(f"         reason: {seam['reasoning']}")
            if not seam["testCommand"] and not args.test_command:
                print("         ! skipped: no verification command (pass --test-command)")
                continue
            seam_specs.append({
                "title": seam["title"],
                "manualSeam": {
                    "scopeGlobs": seam["scopeGlobs"],
                    "beforePattern": seam["beforePattern"],
                    "afterPattern": seam["afterPattern"],
                    "invariants": seam["invariants"],
                    "testCommand": seam["testCommand"] or args.test_command,
                },
            })
        if not seam_specs:
            raise SystemExit("No executable seams discovered")

        # Human confirmation — mandatory checkpoint before anything executes.
        if not args.yes:
            answer = input(f"      Execute {len(seam_specs)} seam(s)? [y/N] ").strip().lower()
            if answer not in ("y", "yes"):
                raise SystemExit("Cancelled — nothing was executed")

    print(f"[3/4] Creating {len(seam_specs)} seam(s) and running campaigns")
    failed = False
    for spec in seam_specs:
        seam = call(base, "POST", f"/repo/{repo['repoId']}/seam",
                    {"candidateId": None, "manualSeam": spec["manualSeam"]})
        print(f"      seamId={seam['seamId']} scope={len(seam['scopeGlobs'])} file(s)  "
              f"({spec['title']})")
        status = run_campaign(base, seam["seamId"], spec["title"], args.finalize)
        if status == "failed":
            failed = True

    print("[4/4] Done")
    if failed:
        sys.exit(1)


if __name__ == "__main__":
    main()
