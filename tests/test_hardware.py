"""Read-only checks against the real pedal. Never writes. Run with: VLP_HARDWARE=1 (pedal plugged in, VoiceSupport closed)."""
import os
import unittest

from helpers import REAL_RTMIDI
import server


@unittest.skipUnless(os.environ.get("VLP_HARDWARE") == "1", "set VLP_HARDWARE=1 with the pedal plugged in")
class RealPedal(unittest.TestCase):
    def setUp(self):
        server.rtmidi = REAL_RTMIDI

    def test_pedal_answers_identity_request(self):
        self.assertTrue(server.pedal_answers())

    def test_reads_look_sane(self):
        with server.PedalLink() as link:
            first = link.read(1)
            self.assertIsNotNone(first, "preset 1 should not be empty")
            self.assertEqual(len(first["params"]), 50)
            self.assertTrue(all(p in (0, 1, 2) for p in first["params"][30:37]))
            self.assertIsNone(link.read(500), "preset 500 is expected to be empty")


if __name__ == "__main__":
    unittest.main()
