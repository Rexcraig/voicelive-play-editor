#!/usr/bin/env python3
"""Bakes /api/spec's exact payload (spec.py + defaults.json + name rules) into web/src/spec.json
for the browser build, which has no Python server to serve it live. spec.py stays the single
source of truth here; spec.json is generated, never hand-edited. Re-run after touching spec.py,
defaults.json, or the name constants in tch.py."""
import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))  # spec/tch live at the project root, not on sys.path by default

import spec  # noqa: E402
from tch import NAME_CHARS, NAME_LENGTH  # noqa: E402

OUT = ROOT / "web/src/spec.json"


def payload():
    """Mirrors server.py's GET /api/spec handler exactly."""
    _defaults = json.loads((ROOT / "defaults.json").read_text())
    defaults = _defaults["params"]
    return {**spec.as_json(), "defaults": defaults, "tags": _defaults["tags"],
            "name_chars": "".join(sorted(NAME_CHARS)), "name_length": NAME_LENGTH}


def main():
    OUT.parent.mkdir(parents=True, exist_ok=True)
    # sort_keys is cosmetic (dict order isn't meaningful JSON); makes diffs stable across regens.
    OUT.write_text(json.dumps(payload(), indent=2, sort_keys=True) + "\n")
    print(f"wrote {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
