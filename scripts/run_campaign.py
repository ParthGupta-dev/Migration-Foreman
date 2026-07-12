"""End-to-end campaign runner CLI (stdlib only — no pip installs needed).

Drives the backend through the full pipeline without the frontend:
ingest -> candidates -> seam -> campaign -> live poll -> optional finalize.

Usage:
  python scripts/run_campaign.py --repo-url /app/data/demo-repo
  python scripts/run_campaign.py --repo-url <github url> --finalize
  python scripts/run_campaign.py --repo-url <github url> \
      --intent "Upgrade requests to httpx"
  python scripts/run_campaign.py --repo-url <github url> \
      --before old_api --after new_api --test-command "python -m pytest -q"
  python scripts/run_campaign.py --manual-seam
      (scope defaults to the top discovered candidate; --scope/--before/--after
       --invariant/--test-command override; demo patterns are the fallback)

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
    # Windows consoles may default to a legacy codepage; keep ✓ printable.
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")

    parser = argparse.ArgumentParser(description="Run a Migration Foreman campaign end-to-end")
    parser.add_argument("--base-url", default="http://localhost:8000")
    parser.add_argument("--repo-url", default="/app/data/demo-repo",
                        help="Repo URL/path as seen by the backend")
    parser.add_argument("--intent", default=None,
                        help='Natural-language migration intent (e.g. "Upgrade requests to httpx"); '
                             "runs the AI Planning Stage and uses the generated seam")
    parser.add_argument("--candidate", default=None, help="candidateId to confirm (default: top non-blacklisted)")
    parser.add_argument("--manual-seam", action="store_true",
                        help="Submit a manual seam instead of confirming a candidate "
                             "(scope defaults to the top discovered candidate)")
    parser.add_argument("--scope", action="append", default=None,
                        help="Seam scope glob (repeatable; manual mode default: top candidate's scope)")
    parser.add_argument("--before", default=None,
                        help="beforePattern (default: repo config; demo value in manual mode)")
    parser.add_argument("--after", default=None,
                        help="afterPattern (default: repo config; demo value in manual mode)")
    parser.add_argument("--invariant", action="append", default=None,
                        help="Invariant that must hold post-migration (repeatable)")
    parser.add_argument("--test-command", default=None,
                        help="Verification command (default: repo config or backend inference)")
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
    eligible = [cand for cand in cands if not cand["blacklisted"]]
    if args.intent:
        print(f"      Planning from intent: {args.intent!r} ...")
        plan = call(base, "POST", f"/repo/{repo['repoId']}/plan", {"intent": args.intent})
        breaking = "yes" if plan["breakingChanges"] else "no"
        print(f"      ✓ Migration: {plan['migrationName']}  "
              f"[risk: {plan['risk']}, breaking changes: {breaking}]")
        print(f"      ✓ Found {plan['matchedOccurrences']} occurrence(s) "
              f"across {len(plan['groundedFiles'])} file(s)")
        if plan["repairedScope"]:
            print("      ✓ Scope repaired to the files containing the pattern")
        if plan["unsupportedFiles"]:
            print(f"      ! {len(plan['unsupportedFiles'])} in-scope file(s) "
                  "do not contain the pattern")
        print(f"      ✓ Confidence {plan['confidence']:.2f}")
        patterns = f"{plan['beforePattern']} -> {plan['afterPattern']}"
        goal = plan["migrationName"]
        if goal != patterns:
            goal += f" ({patterns})"
        print(f"      Goal:   {goal}")
        print(f"      Reason: {plan['reasoning']}")
        print("      ✓ Ready for execution")
        test_command = args.test_command or plan["testCommand"]
        if not test_command:
            raise SystemExit("Plan has no test command; pass --test-command")
        seam_body = {
            "candidateId": None,
            "manualSeam": {
                "scopeGlobs": args.scope or plan["scopeGlobs"],
                "beforePattern": args.before or plan["beforePattern"],
                "afterPattern": args.after or plan["afterPattern"],
                "invariants": args.invariant or plan["invariants"],
                "testCommand": test_command,
            },
        }
    elif args.manual_seam:
        # Repository-aware manual mode: scope comes from the discovered
        # candidates unless overridden, so this works beyond the demo repo.
        scope = args.scope or (eligible[0]["scopeGlobs"] if eligible else None)
        if scope is None:
            raise SystemExit("No candidates discovered and no --scope given; pass --scope")
        if args.before is None or args.after is None:
            print("      note: --before/--after not given; using demo defaults "
                  "(legacy_format -> format_text)")
        seam_body = {
            "candidateId": None,
            "manualSeam": {
                "scopeGlobs": scope,
                "beforePattern": args.before or "legacy_format",
                "afterPattern": args.after or "format_text",
                "invariants": args.invariant or ["All unit tests pass"],
                "testCommand": args.test_command
                or "python -m unittest discover -s tests -t . -v",
            },
        }
    else:
        candidate_id = args.candidate
        if candidate_id is None:
            if not eligible:
                raise SystemExit("No non-blacklisted candidates (autonomous mode refuses to proceed)")
            candidate_id = eligible[0]["candidateId"]
        seam_body = {"candidateId": candidate_id, "manualSeam": None}
        # Only send overrides that were explicitly given, so a repo's
        # .migration-foreman.json still wins by default.
        for key, value in (
            ("beforePattern", args.before),
            ("afterPattern", args.after),
            ("testCommand", args.test_command),
        ):
            if value:
                seam_body[key] = value
        if args.invariant:
            seam_body["invariants"] = args.invariant
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
