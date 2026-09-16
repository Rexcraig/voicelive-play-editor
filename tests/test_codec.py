"""Preset file format: decoding and encoding must match TC's own files byte for byte."""
import unittest

from helpers import FIXTURES, fixture_presets
from tch import build_syx, checksum, decode28, encode28, parse_syx


class Codec(unittest.TestCase):
    def test_28bit_values_round_trip_including_negatives(self):
        for v in (0, 1, -1, -51, 50, -50, 300, 2400, 922, (1 << 27) - 1, -(1 << 27)):
            self.assertEqual(decode28(encode28(v)), v)

    def test_real_presets_decode(self):
        chorus, fx, right = fixture_presets()
        self.assertEqual([p["name"] for p in (chorus, fx, right)], ["TREAT ME CHORUS", "TREAT ME FX", "TREAT ME RIGHT"])
        self.assertEqual([p["number"] for p in (chorus, fx, right)], [263, 264, 265])
        # block states µMod, Delay, Reverb, Harmony, Double, Transducer, HardTune (0 off, 1 on, 2 HIT)
        self.assertEqual(right["params"][30:37], [0, 0, 1, 2, 2, 0, 0])
        self.assertEqual(chorus["params"][30:37], [0, 0, 0, 1, 1, 0, 0])
        self.assertEqual(fx["params"][30:37], [0, 0, 1, 0, 0, 0, 0])
        self.assertEqual(len(right["params"]), 50)

    def test_every_fixture_rebuilds_byte_for_byte(self):
        for path in sorted(FIXTURES.glob("*.syx")):
            raw = path.read_bytes()
            presets = parse_syx(raw)
            rebuilt = b"".join(build_syx(p["number"], p["name"], p["tags"], p["params"]) for p in presets)
            self.assertEqual(rebuilt, raw, path.name)

    def test_voicesupport_export_of_slot_245(self):
        (p,) = parse_syx((FIXTURES / "Preset_245_15_9_2026.syx").read_bytes())
        self.assertEqual((p["number"], p["name"], p["tags"]), (245, "POP TRIO", 4096))

    def test_damaged_file_is_rejected(self):
        raw = bytearray((FIXTURES / "Treat Me Right.syx").read_bytes())
        raw[40] ^= 0x01  # flip a bit inside the first data packet
        with self.assertRaisesRegex(ValueError, "damaged"):
            parse_syx(bytes(raw))

    def test_non_preset_file_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "No VoiceLive Play presets"):
            parse_syx(b"this is not a preset file")

    def test_checksum_is_7bit_sum(self):
        self.assertEqual(checksum(bytes([0x7F, 0x7F, 0x02])), (0x7F + 0x7F + 0x02) & 0x7F)


if __name__ == "__main__":
    unittest.main()
