#!/bin/sh
# Run the automated tests. Add VLP_HARDWARE=1 in front to include read-only checks on the plugged-in pedal.
cd "$(dirname "$0")/tests" || exit 1
PY="${PYTHON:-$HOME/vocal-analyzer/.venv/bin/python}"
[ -x "$PY" ] || PY=../.venv/bin/python
exec "$PY" -m unittest -v "$@"
