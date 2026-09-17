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

    def test_rig_asks_only_the_questions_the_answers_call_for(self):
        answers = {"mic": "dynamic"}
        asked = [q["id"] for q in spec.RIG_QUESTIONS if spec.rig_visible(q, answers)]
        self.assertIn("wireless", asked)
        self.assertNotIn("mp75button", asked)
        self.assertNotIn("mp76buttons", asked)
        asked = [q["id"] for q in spec.RIG_QUESTIONS if spec.rig_visible(q, {"mic": "mp75"})]
        self.assertIn("mp75button", asked)
        asked = [q["id"] for q in spec.RIG_QUESTIONS if spec.rig_visible(q, {"mic": "roomsense"})]
        self.assertNotIn("wireless", asked)

    def test_rig_plan_leaves_out_settings_already_right(self):
        answers = {"mic": "dynamic", "wireless": "yes", "outputs": "one", "aux": "nothing",
                   "key": "myself", "switch3": "none"}
        values = [0] * 75
        plan = spec.rig_plan(answers, values)
        self.assertEqual({p["index"] for p in plan}, {28, 17, 22})  # the rest already match
        for row in plan:
            self.assertTrue(row["reason"] and row["label"] and row["to"])
        for row in plan:  # applying them makes the plan empty
            values[row["index"]] = row["value"]
        self.assertEqual(spec.rig_plan(answers, values), [])

    def test_rig_never_proposes_a_value_the_pedal_refuses(self):
        for mic in [o["id"] for o in spec.RIG_QUESTIONS[0]["options"]]:
            for outputs in ("one", "two", "separate", "phones"):
                for aux in ("nothing", "band", "tracks", "monitor"):
                    answers = {"mic": mic, "wireless": "no", "outputs": outputs, "aux": aux,
                               "key": "follow", "switch3": "effects", "mp75button": "hit", "mp76buttons": "default"}
                    for row in spec.rig_plan(answers, [0] * 75):
                        self.assertTrue(spec.setup_value_ok(row["index"], row["value"]), (answers, row))

    def test_rig_asking_reads_the_pedal_but_writes_nothing(self):
        answers = {"mic": "condenser", "wireless": "no", "outputs": "one", "aux": "band",
                   "key": "follow", "switch3": "none"}
        status, body = self.post("/api/setup/rig", {"answers": answers})
        self.assertEqual(status, 200, body)
        self.assertTrue(body["plan"])
        self.assertFalse([m for m in self.pedal.log if m[6:7] == [0x13]])

    def test_rig_applies_every_change_in_one_pass(self):
        answers = {"mic": "condenser", "wireless": "no", "outputs": "separate", "aux": "tracks",
                   "key": "myself", "switch3": "effects"}
        status, body = self.post("/api/setup/rig", {"answers": answers, "apply": True})
        self.assertEqual(status, 200, body)
        self.assertTrue(body["ok"])
        self.assertEqual(body["plan"], [])  # nothing left to do
        self.assertEqual(self.pedal.setup[9], 1)  # condenser
        self.assertEqual(self.pedal.setup[10], 1)  # remembered as the last mic, like the pedal's own menu
        self.assertEqual(self.pedal.setup[6], 1)  # Mono, as the engineer asked
        self.assertEqual((self.pedal.setup[31], self.pedal.setup[32]), (1, 1))  # Tracks, sent to the PA
        self.assertEqual(self.pedal.setup[40:43], [6, 7, 12])  # Harmony, Delay, Reverb
        self.assertEqual(len([m for m in self.pedal.log if m[6:7] == [0x13]]), 3)  # one pass of three packets

    def test_rig_applies_only_the_changes_that_were_offered(self):
        answers = {"mic": "dynamic", "wireless": "yes", "outputs": "one", "aux": "nothing",
                   "key": "myself", "switch3": "none"}
        status, body = self.post("/api/setup/rig", {"answers": answers, "apply": True, "changes": {"6": 2}})
        self.assertEqual(status, 400, body)
        self.assertFalse([m for m in self.pedal.log if m[6:7] == [0x13]])

    def test_rig_writes_only_the_ticked_rows(self):
        answers = {"mic": "dynamic", "wireless": "yes", "outputs": "one", "aux": "nothing",
                   "key": "myself", "switch3": "none"}
        _, body = self.post("/api/setup/rig", {"answers": answers})
        offered = [row["index"] for row in body["plan"]]
        self.assertIn(22, offered)
        keep = [row for row in body["plan"] if row["index"] == 22][0]
        status, body = self.post("/api/setup/rig",
                                 {"answers": answers, "apply": True, "changes": {"22": keep["value"]}})
        self.assertEqual(status, 200, body)
        self.assertEqual(self.pedal.setup[22], 1)
        self.assertEqual(self.pedal.setup[17], 0)  # not ticked, so untouched
        self.assertEqual([row["index"] for row in body["plan"]],
                         [i for i in offered if i != 22])  # the rest are still offered

    def test_spec_lists_every_page_with_known_indices(self):
        pages = spec.as_json()["setup"]
        self.assertEqual([p["title"] for p in pages],
                         ["Input", "Output", "Global", "Loop", "System", "Switch-3", "Mic Control"])
        indices = [f["index"] for p in pages for f in p["fields"]]
        self.assertEqual(len(indices), len(set(indices)))


if __name__ == "__main__":
    unittest.main()
