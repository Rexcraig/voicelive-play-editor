"""The Setup tab: reading and writing the pedal's whole-pedal settings, against a simulated pedal."""
import unittest

from helpers import ServerTest
import spec


class SetupTests(ServerTest):
    def test_read_returns_all_75_values(self):
        status, body = self.get("/api/setup")
        self.assertEqual(status, 200)
        self.assertEqual(len(body["values"]), 75)
        self.assertEqual(body["values"][14], 880)  # 440.0 Hz

    def test_write_goes_outside_a_session_and_is_verified(self):
        status, body = self.post("/api/setup", {"index": 21, "value": 4})
        self.assertEqual(status, 200, body)
        self.assertTrue(body["ok"])
        self.assertEqual(self.pedal.setup[21], 4)
        self.assertEqual(body["values"][21], 4)
        writes = [m for m in self.pedal.log if m[6:7] == [0x13]]
        self.assertEqual(len(writes), 3)

    def test_only_the_chosen_setting_changes(self):
        before = list(self.pedal.setup)
        self.post("/api/setup", {"index": 23, "value": 60})
        changed = [i for i, (a, b) in enumerate(zip(before, self.pedal.setup)) if a != b]
        self.assertEqual(changed, [23])

    def test_roomsense_voice_switches_input_like_the_pedal_menu(self):
        self.pedal.setup[9] = self.pedal.setup[10] = 1  # Condenser
        self.post("/api/setup", {"index": 28, "value": 2})
        self.assertEqual((self.pedal.setup[9], self.pedal.setup[27], self.pedal.setup[28]), (7, 1, 2))
        self.post("/api/setup", {"index": 28, "value": 0})
        self.assertEqual((self.pedal.setup[9], self.pedal.setup[27], self.pedal.setup[28]), (1, 0, 0))

    def test_choosing_a_mic_records_it_as_last_mic(self):
        self.post("/api/setup", {"index": 9, "value": 4})
        self.assertEqual((self.pedal.setup[9], self.pedal.setup[10]), (4, 4))

    def test_value_the_pedal_does_not_keep_is_reported(self):
        self.pedal.setup_clamp[1] = 0
        status, body = self.post("/api/setup", {"index": 1, "value": 5})
        self.assertEqual(status, 502)
        self.assertFalse(body["ok"])
        self.assertIn("USB Out", body["message"])
        self.assertEqual(body["values"][1], 0)

    def test_settings_outside_the_menu_are_refused(self):
        for index, value in ((25, 3), (9, 7), (6, 3), (43, 113), (-1, 0)):
            status, body = self.post("/api/setup", {"index": index, "value": value})
            self.assertEqual(status, 400, (index, value))
        self.assertFalse([m for m in self.pedal.log if m[6:7] == [0x13]])

    def test_unplugged_pedal_gives_clear_error(self):
        self.pedal.connected = False
        status, body = self.get("/api/setup")
        self.assertEqual(status, 503)
        self.assertIn("not found", body["message"])

    def test_spec_lists_every_page_with_known_indices(self):
        pages = spec.as_json()["setup"]
        self.assertEqual([p["title"] for p in pages],
                         ["Input", "Output", "Global", "Loop", "System", "Switch-3", "Mic Control"])
        indices = [f["index"] for p in pages for f in p["fields"]]
        self.assertEqual(len(indices), len(set(indices)))


if __name__ == "__main__":
    unittest.main()
