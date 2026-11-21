"""Fetch, check and update the NOWA dependency without copying it into this repository.

    python scripts/nowa_tool.py fetch [--allow-upstream]   # vendor/nowa at the commit in nowa.lock
    python scripts/nowa_tool.py check            # compatibility check of vendor/nowa
    python scripts/nowa_tool.py status           # lock vs checkout vs upstream
    python scripts/nowa_tool.py update [--ref main] [--force]
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import shutil
import stat
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
LOCK = ROOT / "nowa.lock"
VENDOR = ROOT / "vendor"
CHECKOUT = VENDOR / "nowa"
CANDIDATE = VENDOR / "nowa-candidate"
PREVIOUS = VENDOR / "nowa-previous"
BASELINE = VENDOR / "nowa-baseline.json"   # machine-local, never committed


def git(*args: str, cwd: Path | None = None, capture: bool = True) -> str:
    out = subprocess.run(["git", *args], cwd=cwd, check=True, text=True,
                         stdout=subprocess.PIPE if capture else None)
    return (out.stdout or "").strip()


def read_lock() -> dict:
    return json.loads(LOCK.read_text(encoding="utf-8"))


def write_lock(commit: str) -> None:
    lock = read_lock()
    lock["commit"] = commit
    lock["checked_at"] = dt.date.today().isoformat()
    LOCK.write_text(json.dumps(lock, indent=2) + "\n", encoding="utf-8")


def head_of(path: Path) -> str | None:
    if not (path / ".git").exists():
        return None
    # stderr silenced: a fresh, still empty checkout has no HEAD, and git's advice text would only confuse
    out = subprocess.run(["git", "rev-parse", "HEAD"], cwd=path, text=True,
                         stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    return out.stdout.strip() if out.returncode == 0 else None


def _rmtree(path: Path) -> None:
    def onerror(func, p, _exc):
        os.chmod(p, stat.S_IWRITE)  # git pack files are read-only on Windows
        func(p)

    if path.exists():
        shutil.rmtree(path, onexc=onerror) if sys.version_info >= (3, 12) else shutil.rmtree(path, onerror=onerror)


def checkout_commit(path: Path, repo: str, commit: str) -> None:
    if head_of(path) == commit:
        return
    if not (path / ".git").exists():
        _rmtree(path)
        path.mkdir(parents=True)
        git("init", "-q", cwd=path)
        git("remote", "add", "origin", repo, cwd=path)
    git("fetch", "-q", "--depth", "1", "origin", commit, cwd=path, capture=False)
    git("-c", "advice.detachedHead=false", "checkout", "-q", "--force", "FETCH_HEAD", cwd=path, capture=False)


def upstream_commit(repo: str, ref: str) -> str:
    line = git("ls-remote", repo, f"refs/heads/{ref}")
    if not line:
        raise SystemExit(f"ref {ref} not found at {repo}")
    return line.split()[0]


def run_check(path: Path, write_baseline: bool = False) -> int:
    cmd = [sys.executable, "-m", "nowasea.brains.compat", "--nowa", str(path), "--baseline", str(BASELINE)]
    if write_baseline:
        cmd.append("--write-baseline")
    return subprocess.run(cmd, cwd=ROOT).returncode


def cmd_fetch(a) -> int:
    lock = read_lock()
    VENDOR.mkdir(exist_ok=True)
    try:
        checkout_commit(CHECKOUT, lock["repository"], lock["commit"])
        print(f"NOWA {lock['commit'][:12]} -> {CHECKOUT}")
    except subprocess.CalledProcessError:
        # The tested commit is gone upstream (history rewritten, repository moved). Another NOWA version is used only
        # with the user's explicit consent: a flag, or "y" at the prompt. The default keeps the install stable.
        head = upstream_commit(lock["repository"], "main")
        print(f"WARNING: NOWA commit {lock['commit'][:12]} from nowa.lock (the tested version) is not available "
              f"upstream. The current NOWA is {head[:12]}; this project has not been tested with it.", file=sys.stderr)
        allow = a.allow_upstream
        if not allow and sys.stdin.isatty():
            try:
                allow = input(f"Use NOWA {head[:12]} instead? [y/N] ").strip().lower() in ("y", "yes", "д", "да")
            except EOFError:                      # no input at all counts as "no"
                print()
                allow = False
        if not allow:
            print("Setup stopped: NOWA was not changed. To accept the current version, run "
                  "`python scripts/nowa_tool.py fetch --allow-upstream`, then the setup again.", file=sys.stderr)
            return 1
        checkout_commit(CHECKOUT, lock["repository"], head)
        print(f"NOWA {head[:12]} -> {CHECKOUT} (not the tested version; nowa.lock unchanged)")
    return 0


def cmd_check(_a) -> int:
    first = not BASELINE.exists()
    return run_check(CHECKOUT, write_baseline=first)


def cmd_status(a) -> int:
    lock = read_lock()
    print(f"lock:     {lock['commit']}  ({lock.get('checked_at', '?')})")
    print(f"checkout: {head_of(CHECKOUT) or 'missing (run scripts/setup)'}")
    try:
        print(f"upstream: {upstream_commit(lock['repository'], a.ref)}  ({a.ref})")
    except Exception as exc:  # noqa: BLE001
        print(f"upstream: unavailable ({exc})")
    return 0


def cmd_update(a) -> int:
    lock = read_lock()
    new = upstream_commit(lock["repository"], a.ref)
    if new == lock["commit"] and not a.force:
        print(f"Already at upstream {a.ref}: {new[:12]}")
        return 0
    print(f"Candidate {new[:12]} (locked {lock['commit'][:12]}); fetching...")
    _rmtree(CANDIDATE)
    checkout_commit(CANDIDATE, lock["repository"], new)
    print("Running compatibility check on the candidate...")
    if run_check(CANDIDATE) != 0:
        print(f"\nCandidate {new[:12]} FAILED the check. Kept {lock['commit'][:12]}; candidate left in {CANDIDATE}.")
        return 1
    _rmtree(PREVIOUS)
    if CHECKOUT.exists():
        CHECKOUT.rename(PREVIOUS)
    CANDIDATE.rename(CHECKOUT)
    write_lock(new)
    run_check(CHECKOUT, write_baseline=True)
    print(f"\nUpdated NOWA to {new[:12]}. nowa.lock rewritten; previous checkout kept in {PREVIOUS}.")
    return 0


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = p.add_subparsers(dest="cmd", required=True)
    f = sub.add_parser("fetch")
    f.add_argument("--allow-upstream", action="store_true",
                   help="if the locked commit is gone upstream, accept the current main (untested) instead of stopping")
    f.set_defaults(fn=cmd_fetch)
    sub.add_parser("check").set_defaults(fn=cmd_check)
    s = sub.add_parser("status")
    s.add_argument("--ref", default="main")
    s.set_defaults(fn=cmd_status)
    u = sub.add_parser("update")
    u.add_argument("--ref", default="main")
    u.add_argument("--force", action="store_true", help="re-check even if the lock already matches upstream")
    u.set_defaults(fn=cmd_update)
    a = p.parse_args(argv)
    return a.fn(a)


if __name__ == "__main__":
    sys.exit(main())
