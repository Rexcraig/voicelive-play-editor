"""Write ONE setup value: read the block, change that value, send all 0x13 packets back, read back.

usage: setup_write_test.py <index> <value>     e.g. setup_write_test.py 21 4   (LCD Contrast)

Proven 2026-09-17 on the unit (LCD Contrast 2 -> 4 shown on screen): the write must be sent OUTSIDE a 57 00 00 session.
Inside a session each packet is refused with 34 09 00 00; outside, the pedal acks 34 01 00 00 once for the block.
"""
import rtmidi
import pathlib
import sys
import time

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))
from server import PedalLink  # noqa: E402
from tch import checksum, decode28, encode28  # noqa: E402


def read_raw(link):
    link.drain()
    link.out.send_message(link.HEAD + [0x15, 0x00, 0xF7])
    packets, last = {}, time.time()
    while time.time() - last < 0.5:
        m = link.inp.get_message()
        if not m:
            time.sleep(0.002)
            continue
        m = m[0]
        if m[:7] == link.HEAD + [0x13]:
            packets[m[9]] = list(m)
            last = time.time()
    return packets


def values(packets):
    out = []
    for i in sorted(packets):
        data = packets[i][10:-2]
        out += [decode28(data[j:j + 4]) for j in range(0, len(data) - len(data) % 4, 4)]
    return out


def main(index, value):
    from server import DEVICE
    with PedalLink() as link:
        packets = read_raw(link)
    before = values(packets)
    per = (len(packets[0]) - 12) // 4
    p, k = divmod(index, per)
    print(f"value {index} is {before[index]} -> {value}")
    msg = packets[p]
    data = msg[10:-2]
    data[k * 4:k * 4 + 4] = list(encode28(value))
    packets[p] = msg[:10] + data + [checksum(data), 0xF7]
    out, inp = rtmidi.MidiOut(), rtmidi.MidiIn()
    inp.ignore_types(sysex=False)
    out.open_port(out.get_ports().index(DEVICE))
    inp.open_port(inp.get_ports().index(DEVICE))
    try:
        for i in sorted(packets):
            out.send_message(packets[i])
            time.sleep(0.02)
        replies, deadline = [], time.time() + 1.5
        while time.time() < deadline:
            m = inp.get_message()
            if m:
                replies.append(" ".join(f"{b:02X}" for b in m[0]))
            else:
                time.sleep(0.002)
    finally:
        inp.close_port()
        out.close_port()
    print("replies:", replies or "none")
    with PedalLink() as link:
        after = values(read_raw(link))
    changed = [(i, a, b) for i, (a, b) in enumerate(zip(before, after)) if a != b]
    print("read back changes:", changed or "none")


if __name__ == "__main__":
    main(int(sys.argv[1]), int(sys.argv[2]))
