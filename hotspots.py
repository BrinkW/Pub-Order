"""hotspots.py -- churn x complexity.

Usage (run from anywhere inside your repo):
    pip install radon
    python hotspots.py --since "3 months ago" [--top 10] [--path src]

Churn  = number of commits that touched the file in the window (git log).
Max CC = highest cyclomatic complexity of any function in the file (radon; Python only).
Score  = churn x max_cc. High score = complex code you change often = pay this debt first.
For JS/TS files max_cc shows '-' : use  npx eslint --rule '{"complexity": ["warn", 10]}'  instead.
"""
import argparse
import collections
import subprocess
import sys
from pathlib import Path


def churn(since: str, path: str) -> collections.Counter:
    out = subprocess.run(
        ["git", "log", f"--since={since}", "--name-only", "--format=", "--", path],
        capture_output=True, text=True, check=True).stdout
    return collections.Counter(line for line in out.splitlines() if line.strip())


def repo_root() -> Path:
    out = subprocess.run(["git", "rev-parse", "--show-toplevel"], capture_output=True, text=True, check=True)
    return Path(out.stdout.strip())


def max_cc(file: str, root: Path):
    p = root / file                      # git log paths are relative to the repo root
    if not file.endswith(".py") or not p.exists():
        return None
    try:
        from radon.complexity import cc_visit
        blocks = cc_visit(p.read_text(encoding="utf-8", errors="replace"))
    except Exception:          # syntax errors, non-UTF8 files: skip, do not crash the report
        return None
    return max((b.complexity for b in blocks), default=0)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--since", default="3 months ago")
    ap.add_argument("--top", type=int, default=10)
    ap.add_argument("--path", default=".")
    a = ap.parse_args()
    try:
        counts = churn(a.since, a.path)
        root = repo_root()
    except subprocess.CalledProcessError as e:
        print("git log failed -- run this from inside your repository.", e.stderr, file=sys.stderr)
        return 1
    rows = []
    for f, c in counts.items():
        cc = max_cc(f, root)
        rows.append((c * (cc or 1), f, c, cc))
    rows.sort(reverse=True)
    print(f"{'file':55s} {'churn':>5s} {'max_cc':>6s} {'score':>6s}")
    for score, f, c, cc in rows[: a.top]:
        print(f"{f[-55:]:55s} {c:5d} {('-' if cc is None else cc):>6} {score:6d}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
