#!/usr/bin/env sh
# Prepare NOWA Sea: venv, Python deps, NOWA at the locked commit, renderer build.
set -eu
cd "$(dirname "$0")/.."

PY=${PYTHON:-python3}
command -v "$PY" >/dev/null 2>&1 || PY=python
"$PY" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)' || { echo "Python 3.10+ required"; exit 1; }
# Only what cannot run is an error; a version other than the tested one is a warning.
"$PY" -c 'import sys; sys.exit(0 if sys.version_info[:2] == (3, 14) else 1)' || echo "WARNING: NOWA Sea is tested on Python 3.14"

[ -d .venv ] || "$PY" -m venv .venv
if [ -x .venv/bin/python ]; then VPY=.venv/bin/python; else VPY=.venv/Scripts/python.exe; fi
"$VPY" -m pip install --upgrade pip --quiet
# Tested package versions first (constraints.txt, needs Python 3.12+); otherwise the newest compatible ones.
if ! "$VPY" -m pip install -r requirements-dev.txt -c constraints.txt --quiet; then
  echo "WARNING: the tested package versions (constraints.txt) cannot be installed here; installing the newest compatible ones"
  "$VPY" -m pip install -r requirements-dev.txt --quiet
fi

"$VPY" scripts/nowa_tool.py fetch
"$VPY" scripts/nowa_tool.py check

if [ -f renderer/package.json ]; then
  command -v npm >/dev/null 2>&1 || { echo "Node.js 18+ (npm) is required to build the renderer"; exit 1; }
  (cd renderer && { [ -f package-lock.json ] && npm ci --no-audit --no-fund || npm install --no-audit --no-fund; } && npm run build)
fi
echo
echo "Setup complete. Start with: scripts/run.sh"
