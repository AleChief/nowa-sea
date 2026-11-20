#!/usr/bin/env sh
# Pull the newest NOWA from upstream, check it against our host contract, and switch only if it passes.
#   scripts/update-nowa.sh [--ref main] [--force]      scripts/update-nowa.sh status
set -eu
cd "$(dirname "$0")/.."
if [ -x .venv/bin/python ]; then VPY=.venv/bin/python; elif [ -x .venv/Scripts/python.exe ]; then VPY=.venv/Scripts/python.exe; else
  echo "Not set up yet: run scripts/setup.sh first"; exit 1; fi
if [ "${1:-}" = "status" ]; then shift; exec "$VPY" scripts/nowa_tool.py status "$@"; fi
exec "$VPY" scripts/nowa_tool.py update "$@"
