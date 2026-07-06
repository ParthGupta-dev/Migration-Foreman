"""End-to-end campaign runner CLI (stdlib only — no pip installs needed).

Drives the backend through the full pipeline without the frontend:
ingest -> candidates -> seam -> campaign -> live poll -> optional finalize.

Usage:
  python scripts/run_campaign.py --repo-url /app/data/demo-repo
  python scripts/run_campaign.py --repo-url <github url> --finalize
  python scripts/run_campaign.py --manual-seam  (uses demo seam values)

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
        with urllib.request.urlopen(request, timeout=120) as response:
            return json.loads(response.read())
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode(errors="replace")
        raise SystemExit(f"{method} {path} -> {exc.code}: {detail}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Run a Migration Foreman campaign end-to-end")
    parser.add_argument("--base-url", default="http://localhost:8000")
    parser.add_argument("--repo-url", default="/app/data/demo-repo",
                        help="Repo URL/path as seen by the backend")
    parser.add_argument("--candidate", default=None, help="candidateId to confirm (default: top non-blacklisted)")
    parser.add_argument("--manual-seam", action="store_true",
                        help="Submit the demo repo's seam manually instead of confirming a candidate")
    parser.add_argument("--finalize", action="store_true", help="Call finalize (needs GITHUB_TOKEN + GitHub repo)")
    args = parser.parse_args()
    base = args.base_url.rstrip("/")

    print(f"[1/5] Ingesting repo {args.repo_url}")
    repo = call(base, "POST", "/repo", {"repoUrl": args.repo_url})
    print(f"      repoId={repo['repoId']} status={repo['status']}")
    if repo["status"] != "ready":
        raise SystemExit("Repo ingestion failed")

    print("[2/5] Fetching ranked candidates")
    cands = call(base, "GET", f"/repo/{repo['repoId']}/candidates")["candidates"]
    for cand in cands:
        flag = " [BLACKLISTED]" if cand["blacklisted"] else ""
        print(f"      {cand['candidateId']}  score={cand['combinedScore']:.4f}  {cand['scopeGlobs']}{flag}")

    print("[3/5] Creating seam")
    if args.manual_seam:
        seam_body = {
            "candidateId": None,
            "manualSeam": {
                "scopeGlobs": ["src/**/*.py"],
                "beforePattern": "legacy_format",
                "afterPattern": "format_text",
                "invariants": ["All unit tests pass"],
                "testCommand": "python -m unittest discover -s tests -t . -v",
            },
        }
    else:
        candidate_id = args.candidate
        if candidate_id is None:
            eligible = [cand for cand in cands if not cand["blacklisted"]]
            if not eligible:
                raise SystemExit("No non-blacklisted candidates (autonomous mode refuses to proceed)")
            candidate_id = eligible[0]["candidateId"]
        seam_body = {"candidateId": candidate_id, "manualSeam": None}
    seam = call(base, "POST", f"/repo/{repo['repoId']}/seam", seam_body)
    print(f"      seamId={seam['seamId']} scope={seam['scopeGlobs']} "
          f"{seam['beforePattern']} -> {seam['afterPattern']}")

    print("[4/5] Starting campaign")
    campaign = call(base, "POST", "/campaign", {"seamId": seam["seamId"]})
    campaign_id = campaign["campaignId"]
    print(f"      campaignId={campaign_id} units={campaign['unitCount']}")

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
    print(f"[5/5] Campaign {state['status']}: {passed} passed, {escalated} escalated")

    if args.finalize:
        result = call(base, "POST", f"/campaign/{campaign_id}/finalize")
        print(f"      PR: {result['prUrl']} "
              f"(accepted={result['acceptedUnits']}, escalated={result['escalatedUnits']})")
    if state["status"] == "failed":
        sys.exit(1)


if __name__ == "__main__":
    main()
