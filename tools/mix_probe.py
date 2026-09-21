"""Read the setup block through the running editor (read-only) and diff it against the previous reading.

usage: mix_probe.py <label>   (the editor must be running on 8730; going through it avoids two programs on the USB port)
Snapshots share tools/setup_snapshots/ with setup_probe.py, so the history stays in one place.
"""
import json
import pathlib
import sys
import urllib.request

SNAPS = pathlib.Path(__file__).resolve().parent / "setup_snapshots"
UNMAPPED = [0, 2, 3, 4, 5, 11, 12, 16, 25, 26, 29, 33]


def main(label):
    data = json.load(urllib.request.urlopen("http://localhost:8730/api/setup", timeout=10))
    if not data.get("ok"):
        sys.exit(data.get("message"))
    values = data["values"]
    snaps = sorted(SNAPS.glob("*.json"), key=lambda p: int(p.name.split("-")[0]))
    n = int(snaps[-1].name.split("-")[0]) + 1 if snaps else 0
    prev = json.loads(snaps[-1].read_text())["values"] if snaps else None
    (SNAPS / f"{n}-{label}.json").write_text(json.dumps({"label": label, "values": values}))
    print(f"saved {n}-{label}")
    if prev:
        changed = {i: (a, b) for i, (a, b) in enumerate(zip(prev, values)) if a != b}
        print("changed:", ", ".join(f"[{i}] {a} -> {b}" for i, (a, b) in changed.items()) or "nothing")
    print("unmapped now:", {i: values[i] for i in UNMAPPED})


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "reading")
