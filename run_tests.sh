#!/bin/sh
# Run the automated tests. Add VLP_HARDWARE=1 in front to include read-only checks on the plugged-in pedal.
cd "$(dirname "$0")/tests" || exit 1
PY="${PYTHON:-../.venv/bin/python}"
[ -x "$PY" ] || PY=python3
exec "$PY" -m unittest -v "$@"
