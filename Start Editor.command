#!/bin/bash
# Double-click to start the VoiceLive Play Editor. Keep this window open while you use it.
cd "$(dirname "$0")" || exit 1
PORT=8730
URL="http://localhost:$PORT"

if curl -s -o /dev/null "$URL/api/status"; then
  echo "The editor is already running. Opening it…"
  open "$URL"
  exit 0
fi

if ! .venv/bin/python -c "import rtmidi" >/dev/null 2>&1; then
  echo "First-time setup. This takes about a minute."
  if ! xcode-select -p >/dev/null 2>&1; then
    echo
    echo "Your Mac needs Apple's free command line tools first."
    echo "A window will ask to install them: click Install and wait until it finishes."
    echo "Then double-click Start Editor again."
    xcode-select --install >/dev/null 2>&1
    read -r -p "Press Return to close this window."
    exit 1
  fi
  rm -rf .venv
  if ! { python3 -m venv .venv && .venv/bin/pip install --quiet --disable-pip-version-check python-rtmidi; }; then
    echo
    echo "Setup didn't finish. Check the internet connection and try again,"
    echo "or take a screenshot of this window."
    read -r -p "Press Return to close this window."
    exit 1
  fi
  echo "Setup done."
fi

(sleep 1.5; open "$URL") &
echo
echo "VoiceLive Play Editor is running at $URL"
echo "Keep this window open while you use the editor. Close it to stop."
echo "If the pedal shows as not found: check the USB cable, and quit VoiceSupport."
exec .venv/bin/python server.py "$PORT"
