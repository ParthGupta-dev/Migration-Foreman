"""Generate the frozen demo repository used for the hackathon demo.

Creates a small git repo (default: server/data/demo-repo) with a genuine
migration seam: a deprecated ``legacy_format()`` helper being replaced by the
strict ``format_text()``. The repo is engineered so a campaign demonstrates
every path the judges need to see:

- src/reports.py, src/notifications.py — clean swaps, units PASS
- src/exporter.py — passes None to the helper; the strict replacement raises
  TypeError, so a naive migration FAILS tests -> retry -> ESCALATED
- payments/charge.py — same seam, but the payments/ path is BLACKLISTED
- .migration-foreman.json — seam config consumed when a candidate is confirmed
- 3 commits with src/ touched most recently, so Discovery ranks src/ on top

Usage: python scripts/setup_demo_repo.py [output_dir]
"""

import subprocess
import sys
from pathlib import Path

GIT_ID = ["-c", "user.name=Demo Author", "-c", "user.email=demo@example.com"]

FILES_ROUND_1 = {
    "README.md": """# textkit-demo

Internal text utilities.

## Usage

All report and notification text is normalized with `legacy_format`:

```python
from lib.textkit import legacy_format

print(legacy_format("  hello ", uppercase=True))
```

## Modules

- `lib/textkit.py` — the text helpers
- `src/reports.py` — report rendering built on `legacy_format`
- `src/notifications.py` — notification builder

## Testing

Run tests: `python -m unittest discover -s tests -t . -v`
""",
    ".migration-foreman.json": """{
  "beforePattern": "legacy_format",
  "afterPattern": "format_text",
  "invariants": [
    "All unit tests pass",
    "Behavior for string inputs is unchanged"
  ],
  "testCommand": "python -m unittest discover -s tests -t . -v"
}
""",
    "lib/__init__.py": "",
    "lib/textkit.py": '''"""Text helpers.

legacy_format is DEPRECATED: it silently coerces any value (including None)
to a string. format_text is the strict replacement: str input only.
"""


def legacy_format(value, uppercase=False):
    """Deprecated. Tolerates None and non-str values."""
    if value is None:
        return ""
    text = str(value).strip()
    return text.upper() if uppercase else text


def format_text(value, uppercase=False):
    """Strict replacement for legacy_format. Accepts str only."""
    if not isinstance(value, str):
        raise TypeError(f"format_text expects str, got {type(value).__name__}")
    text = value.strip()
    return text.upper() if uppercase else text
''',
    "payments/__init__.py": "",
    "payments/charge.py": '''"""Payment receipt formatting — SAFETY-CRITICAL, blacklisted from campaigns."""

from lib.textkit import legacy_format


def receipt_line(customer, amount):
    name = legacy_format(customer, uppercase=True)
    return f"{name}: ${amount:.2f}"
''',
    "tests/__init__.py": "",
    "tests/test_textkit.py": '''import unittest

from lib.textkit import format_text, legacy_format


class TextkitTests(unittest.TestCase):
    def test_legacy_format_tolerates_none(self):
        self.assertEqual(legacy_format(None), "")

    def test_legacy_format_strips_and_uppercases(self):
        self.assertEqual(legacy_format("  hi ", uppercase=True), "HI")

    def test_format_text_strict(self):
        with self.assertRaises(TypeError):
            format_text(None)
        self.assertEqual(format_text("  hi ", uppercase=True), "HI")


if __name__ == "__main__":
    unittest.main()
''',
    "tests/test_payments.py": '''import unittest

from payments.charge import receipt_line


class PaymentsTests(unittest.TestCase):
    def test_receipt_line(self):
        self.assertEqual(receipt_line(" ada ", 12.5), "ADA: $12.50")


if __name__ == "__main__":
    unittest.main()
''',
    "tests/test_reports.py": '''import unittest

from src.reports import render_report


class ReportsTests(unittest.TestCase):
    def test_render_report(self):
        rows = [{"title": "  Q1 ", "owner": "ada"}, {"title": "Q2", "owner": " bob "}]
        self.assertEqual(render_report(rows), "Q1 :: ADA\\nQ2 :: BOB")


if __name__ == "__main__":
    unittest.main()
''',
    "tests/test_notifications.py": '''import unittest

from src.notifications import build_notification


class NotificationsTests(unittest.TestCase):
    def test_build_notification(self):
        self.assertEqual(
            build_notification("  ada  ", "deploy done "),
            "To: ada | deploy done",
        )


if __name__ == "__main__":
    unittest.main()
''',
    "tests/test_exporter.py": '''import unittest

from src.exporter import export_rows


class ExporterTests(unittest.TestCase):
    def test_export_handles_missing_notes(self):
        rows = [{"name": "ada", "note": "pioneer"}, {"name": "bob", "note": None}]
        self.assertEqual(export_rows(rows), ["ada,pioneer", "bob,"])


if __name__ == "__main__":
    unittest.main()
''',
}

FILES_ROUND_2 = {
    "src/__init__.py": "",
    "src/reports.py": '''"""Report rendering — strings in, strings out (clean migration target)."""

from lib.textkit import legacy_format


def render_report(rows):
    lines = []
    for row in rows:
        title = legacy_format(row["title"])
        owner = legacy_format(row["owner"], uppercase=True)
        lines.append(f"{title} :: {owner}")
    return "\\n".join(lines)
''',
    "src/notifications.py": '''"""Notification text builder — strings only (clean migration target)."""

from lib.textkit import legacy_format


def build_notification(recipient, message):
    return f"To: {legacy_format(recipient)} | {legacy_format(message)}"
''',
    "src/exporter.py": '''"""CSV-ish exporter.

NOTE: `note` fields are frequently None in real data — legacy_format absorbs
that silently. A naive swap to the strict format_text() breaks this module,
which is exactly the escalation scenario the demo exercises.
"""

from lib.textkit import legacy_format


def export_rows(rows):
    out = []
    for row in rows:
        name = legacy_format(row.get("name"))
        note = legacy_format(row.get("note"))
        out.append(f"{name},{note}")
    return out
''',
}

FILES_ROUND_3 = {
    "src/reports.py": FILES_ROUND_2["src/reports.py"].replace(
        "clean migration target", "clean migration target, actively developed"
    ),
    "src/notifications.py": FILES_ROUND_2["src/notifications.py"].replace(
        "clean migration target", "clean migration target, actively developed"
    ),
    "src/exporter.py": FILES_ROUND_2["src/exporter.py"] + "\n# TODO: stream large exports\n",
}


def git(repo: Path, *args: str) -> None:
    subprocess.run(["git", *GIT_ID, *args], cwd=repo, check=True, capture_output=True, text=True)


def write_files(repo: Path, files: dict[str, str]) -> None:
    for rel_path, content in files.items():
        path = repo / rel_path
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8", newline="\n")


def main() -> None:
    default = Path(__file__).resolve().parent.parent / "server" / "data" / "demo-repo"
    repo = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else default

    if repo.exists():
        import shutil
        import stat

        def make_writable(func, path, _exc):
            # Windows: git object files are read-only and block rmtree.
            Path(path).chmod(stat.S_IWRITE)
            func(path)

        shutil.rmtree(repo, onerror=make_writable)
    repo.mkdir(parents=True)

    subprocess.run(["git", "init", "-b", "main"], cwd=repo, check=True, capture_output=True, text=True)

    write_files(repo, FILES_ROUND_1)
    git(repo, "add", "-A")
    git(repo, "commit", "-m", "feat: text utilities, payments, test suite")

    write_files(repo, FILES_ROUND_2)
    git(repo, "add", "-A")
    git(repo, "commit", "-m", "feat: reports, notifications, exporter on legacy_format")

    # src/ touched again last -> highest recent-activity score for Discovery.
    write_files(repo, FILES_ROUND_3)
    git(repo, "add", "-A")
    git(repo, "commit", "-m", "chore: iterate on src modules")

    result = subprocess.run(
        [sys.executable, "-m", "unittest", "discover", "-s", "tests", "-t", ".", "-v"],
        cwd=repo,
        capture_output=True,
        text=True,
    )
    print(result.stderr.strip().splitlines()[-1] if result.stderr else result.stdout)
    if result.returncode != 0:
        print(result.stdout, result.stderr)
        raise SystemExit("Demo repo test suite is NOT clean — fix before freezing")

    print(f"Demo repo ready at {repo} (test suite clean)")
    print("Ingest with: POST /repo {\"repoUrl\": \"" + repo.as_posix() + "\"}")
    print("Inside docker compose the server sees it at /app/data/demo-repo")


if __name__ == "__main__":
    main()
