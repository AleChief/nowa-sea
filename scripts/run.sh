#!/usr/bin/env sh
# Start the NOWA Sea server and open the aquarium in the browser. Extra args go to the server.
set -eu
cd "$(dirname "$0")/.."
if [ -x .venv/bin/python ]; then VPY=.venv/bin/python; elif [ -x .venv/Scripts/python.exe ]; then VPY=.venv/Scripts/python.exe; else
  echo "Not set up yet: run scripts/setup.sh first"; exit 1; fi
[ "${1:-}" = "--" ] && shift
exec "$VPY" -m nowasea.server --open "$@"
