#!/usr/bin/env python3
"""Fingerprints of TC-Helicon's own presets, so Community can refuse exact copies of them.

Reads every .tch pack in ~/vocal-analyzer/presets/packs and writes web/worker/tc-hashes.json: a sorted list of
SHA-256 hashes of each preset's 50 values joined by commas (the same string web/worker/index.js hashes).
Only hashes are stored: TC's presets themselves are never shipped. Re-run if more packs are added.
"""
import hashlib
import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from tch import parse_syx  # noqa: E402

PACKS = pathlib.Path.home() / "vocal-analyzer/presets/packs"


def fingerprint(params):
    return hashlib.sha256(",".join(str(v) for v in params).encode()).hexdigest()


def main():
    hashes = set()
    for pack in sorted(PACKS.glob("*.tch")):
        for p in parse_syx(pack.read_bytes()):
            hashes.add(fingerprint(p["params"]))
    out = ROOT / "web/worker/tc-hashes.json"
    out.write_text(json.dumps(sorted(hashes)))
    print(f"wrote {out.relative_to(ROOT)}: {len(hashes)} fingerprints from {len(list(PACKS.glob('*.tch')))} packs")


if __name__ == "__main__":
    main()
