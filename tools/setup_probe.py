"""Read the pedal's SETUP block (read-only) and diff it against the previous reading.

usage: setup_probe.py <label>      e.g. setup_probe.py base, then change ONE setting on the box, setup_probe.py mic-condenser

Request `15 00` (captured from VoiceSupport 2026-09-16); the pedal answers with cmd 0x13 packets:
F0 00 01 38 00 69 13 01 34 <index> <data: 4-byte 7-bit signed values> <checksum> F7.
Snapshots are saved in tools/setup_snapshots/<n>-<label>.json.
"""
import json
import pathlib
import sys
import time

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))
from server import PedalLink  # noqa: E402
from tch import checksum, decode28  # noqa: E402

SNAPS = pathlib.Path(__file__).resolve().parent / "setup_snapshots"


def read_setup():
    with PedalLink() as link:
        link.drain()
        link.out.send_message(link.HEAD + [0x15, 0x00, 0xF7])
        packets, last = {}, time.time()
        while time.time() - last < 0.5:
            m = link.inp.get_message()
            if not m:
                time.sleep(0.002)
                continue
            m = m[0]
            if m[:7] != link.HEAD + [0x13]:
                continue
            last = time.time()
            index, data, check = m[9], m[10:-2], m[-2]
            if checksum(data) != check:
                raise SystemExit(f"packet {index}: checksum mismatch")
            packets[index] = [decode28(data[i:i + 4]) for i in range(0, len(data) - len(data) % 4, 4)]
    if not packets:
        raise SystemExit("The pedal didn't answer the setup request.")
    return [v for i in sorted(packets) for v in packets[i]]


def main(label):
    SNAPS.mkdir(exist_ok=True)
    values = read_setup()
    old = sorted(SNAPS.glob("*.json"))
    path = SNAPS / f"{len(old):02d}-{label}.json"
    path.write_text(json.dumps({"label": label, "time": time.time(), "values": values}))
    print(f"{len(values)} values saved to {path.name}")
    if old:
        prev = json.loads(old[-1].read_text())
        changes = [(i, a, b) for i, (a, b) in enumerate(zip(prev["values"], values)) if a != b]
        print(f"changes since '{prev['label']}':", changes or "none")
    else:
        print({i: v for i, v in enumerate(values) if v})


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "snapshot")
