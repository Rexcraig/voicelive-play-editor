"""The real VoiceSupport <-> pedal conversation (tools/capture.txt) must match what the editor assumes."""
import unittest

from helpers import ROOT
from tch import parse_syx

HEAD = [0xF0, 0x00, 0x01, 0x38, 0x00, 0x69]


def load_capture():
    sent, received = [], bytearray()
    for line in (ROOT / "tools" / "capture.txt").read_text().splitlines():
        parts = line.split()
        data = [int(x, 16) for x in parts[2:]]
        if parts[1] == "OUT":
            sent.append(data)
        else:
            received += bytes(data)
    return sent, bytes(received)


class Capture(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.sent, cls.received = load_capture()
        cls.pedal = [m for m in cls.sent if m[:6] == HEAD]

    def test_session_wraps_the_read(self):
        self.assertEqual(self.pedal[0], HEAD + [0x57, 0x00, 0x00, 0xF7])
        ends = [i for i, m in enumerate(self.pedal) if m == HEAD + [0x57, 0x00, 0x01, 0xF7]]
        reads = [i for i, m in enumerate(self.pedal) if m[6] == 0x45]
        self.assertTrue(ends and ends[0] > reads[-1])

    def test_reads_every_slot_1_to_500_in_order(self):
        slots = [(m[7] << 7) | m[8] for m in self.pedal if m[6] == 0x45]
        self.assertEqual(slots, list(range(1, 501)))

    def test_replies_are_presets_or_empty(self):
        presets = parse_syx(self.received)
        self.assertEqual([p["number"] for p in presets], list(range(1, 247)))
        empty = self.received.count(bytes(HEAD + [0x34, 0x02, 0x00, 0x00, 0xF7]))
        self.assertEqual(len(presets) + empty, 500)

    def test_known_presets_in_capture(self):
        by_slot = {p["number"]: p for p in parse_syx(self.received)}
        self.assertEqual(by_slot[1]["name"], "POP TRIO")
        self.assertEqual(by_slot[12]["name"], "AMERICAN GRNDAY")  # 15-character name, no terminator
        self.assertEqual(by_slot[246]["params"][32:34], [1, 1])  # Store on the unit turned Harmony on


if __name__ == "__main__":
    unittest.main()
