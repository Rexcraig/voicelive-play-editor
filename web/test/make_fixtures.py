#!/usr/bin/env python3
"""Regenerate web/test/fixtures.json from the Python tch.py reference implementation.

Run with the project's venv:
  python3 web/test/make_fixtures.py
"""
import base64
import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
import tch  # noqa: E402

FIXTURES_DIR = ROOT / "tests" / "fixtures"
OUT = pathlib.Path(__file__).resolve().parent / "fixtures.json"


def b64(data):
    return base64.b64encode(bytes(data)).decode("ascii")


def main():
    files = {}
    for path in sorted(FIXTURES_DIR.glob("*.syx")):
        raw = path.read_bytes()
        presets = tch.parse_syx(raw)
        entries = []
        for p in presets:
            rebuilt = tch.build_syx(p["number"], p["name"], p["tags"], p["params"])
            entries.append({
                "number": p["number"],
                "name": p["name"],
                "tags": p["tags"],
                "params": p["params"],
                "syx_b64": b64(p["syx"]),
                "build_syx_b64": b64(rebuilt),
            })
        files[path.name] = entries

    OUT.write_text(json.dumps(files, indent=2) + "\n")
    print(f"wrote {OUT} ({sum(len(v) for v in files.values())} presets across {len(files)} files)")


if __name__ == "__main__":
    main()
