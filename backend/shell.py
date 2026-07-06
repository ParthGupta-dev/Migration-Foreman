"""Small subprocess helper used by git and test-runner code paths."""

import subprocess
from pathlib import Path


class ShellResult:
    def __init__(self, returncode: int, stdout: str, stderr: str) -> None:
        self.returncode = returncode
        self.stdout = stdout
        self.stderr = stderr

    @property
    def ok(self) -> bool:
        return self.returncode == 0

    @property
    def output(self) -> str:
        return (self.stdout + "\n" + self.stderr).strip()


def run(
    args: list[str] | str,
    cwd: str | Path | None = None,
    timeout: int | None = None,
    shell: bool = False,
) -> ShellResult:
    try:
        proc = subprocess.run(
            args,
            cwd=str(cwd) if cwd else None,
            shell=shell,
            capture_output=True,
            text=True,
            errors="replace",
            timeout=timeout,
        )
        return ShellResult(proc.returncode, proc.stdout or "", proc.stderr or "")
    except subprocess.TimeoutExpired as exc:
        stdout = exc.stdout.decode(errors="replace") if isinstance(exc.stdout, bytes) else (exc.stdout or "")
        stderr = exc.stderr.decode(errors="replace") if isinstance(exc.stderr, bytes) else (exc.stderr or "")
        return ShellResult(124, stdout, stderr + f"\n[timeout after {timeout}s]")


def run_git(args: list[str], cwd: str | Path | None = None, timeout: int = 120) -> ShellResult:
    return run(["git", *args], cwd=cwd, timeout=timeout)
