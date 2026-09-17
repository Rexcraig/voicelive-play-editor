"""Talking to the pedal: reads, verified writes, sets, saves and backups, against a simulated pedal."""
import json
import time
import unittest

from helpers import ServerTest, fixture_presets
import server
from tch import parse_syx


class PedalLinkTests(ServerTest):
    def test_read_preset_and_empty_slot(self):
        with server.PedalLink() as link:
            self.assertEqual(link.read(1)["name"], "TREAT ME RIGHT")
            self.assertIsNone(link.read(300))

    def test_session_begin_and_end_are_sent(self):
        with server.PedalLink() as link:
            link.read(1)
        self.assertEqual(self.pedal.log[0][6:9], [0x57, 0x00, 0x00])
        self.assertEqual(self.pedal.log[-1][6:9], [0x57, 0x00, 0x01])

    def test_write_is_verified_by_reading_back(self):
        right = fixture_presets()[2]
        with server.PedalLink() as link:
            ok, back = link.write(10, right["name"], right["tags"], right["params"])
            self.assertTrue(ok)
            self.assertEqual(back["params"], right["params"])
        self.assertEqual(self.pedal.slots[10]["params"], right["params"])

    def test_write_that_lands_wrong_is_reported(self):
        right = fixture_presets()[2]
        self.pedal.corrupt_slots.add(10)
        with server.PedalLink() as link:
            self.assertFalse(link.write(10, right["name"], right["tags"], right["params"])[0])

    def test_write_without_ack_is_reported(self):
        right = fixture_presets()[2]
        self.pedal.drop_ack_for.add(10)
        with server.PedalLink() as link:
            self.assertFalse(link.write(10, right["name"], right["tags"], right["params"])[0])

    def test_unplugged_pedal_raises_clear_error(self):
        self.pedal.connected = False
        with self.assertRaisesRegex(server.PedalError, "not found"):
            with server.PedalLink():
                pass

    def test_silent_pedal_times_out(self):
        self.pedal.receive = lambda msg: None
        with server.PedalLink() as link:
            with self.assertRaises(server.PedalError):
                link.read(1)

    def test_garbled_reply_is_retried(self):
        self.pedal.garble_next_reads = 1
        with server.PedalLink() as link:
            self.assertEqual(link.read(1)["name"], "TREAT ME RIGHT")

    def test_stray_packet_before_reply_is_ignored(self):
        self.pedal.stray_packet_before_reply = True
        with server.PedalLink() as link:
            self.assertEqual(link.read(2)["name"], "TREAT ME CHORUS")
            self.assertIsNone(link.read(300))

    def test_status_reflects_real_connection(self):
        self.assertEqual(self.get("/api/status"), (200, {"connected": True}))
        self.pedal.connected = False
        self.assertEqual(self.get("/api/status"), (200, {"connected": False}))


class SaveTests(ServerTest):
    def test_save_to_empty_slot_makes_no_backup(self):
        right = fixture_presets()[2]
        status, r = self.post("/api/save", {"slot": 20, "name": "NEW SONG", "tags": right["tags"], "values": self.values(right)})
        self.assertEqual((status, r["ok"]), (200, True))
        self.assertEqual(self.pedal.slots[20]["name"], "NEW SONG")
        self.assertFalse(server.BACKUPS.exists())

    def test_save_over_preset_backs_up_the_old_one_first(self):
        chorus = fixture_presets()[0]
        before = dict(self.pedal.slots[1])
        status, r = self.post("/api/save", {"slot": 1, "name": "REPLACEMENT", "tags": chorus["tags"], "values": self.values(chorus)})
        self.assertEqual(status, 200)
        (backup,) = server.BACKUPS.glob("*.syx")
        (old,) = parse_syx(backup.read_bytes())
        self.assertEqual((old["number"], old["name"], old["params"]), (1, before["name"], before["params"]))
        self.assertIn("backed up", r["message"])

    def test_two_quick_saves_to_one_slot_keep_both_backups(self):
        """Saving twice within a second must not overwrite the first backup (the original preset)."""
        # Typical: tweak a slider, save under the same name, tweak again, save again.
        original = dict(self.pedal.slots[1])
        tweak1, tweak2 = list(original["params"]), list(original["params"])
        tweak1[9], tweak2[9] = -10, -20
        for params in (tweak1, tweak2):
            self.post("/api/save", {"slot": 1, "name": original["name"], "tags": original["tags"],
                                    "values": {str(i): v for i, v in enumerate(params)}})
        kept = sorted(parse_syx(b.read_bytes())[0]["params"][9] for b in server.BACKUPS.glob("*.syx"))
        self.assertEqual(kept, sorted([original["params"][9], -10]), "the untouched original must still be backed up")

    def test_no_save_when_old_preset_cannot_be_backed_up(self):
        self.pedal.connected = False
        status, r = self.post("/api/save", {"slot": 1, "name": "X", "values": {}})
        self.assertEqual(status, 503)
        self.assertIn("Nothing was saved", r["message"])
        self.assertEqual(self.pedal.slots[1]["name"], "TREAT ME RIGHT")

    def test_slot_numbers_outside_1_to_500_are_refused(self):
        for slot in (0, -1, 501):
            status, r = self.post("/api/save", {"slot": slot, "name": "X", "values": {}})
            self.assertEqual(status, 400, slot)
        self.assertEqual(len([m for m in self.pedal.log if m[6:7] == [0x20]]), 0)

    def test_lost_ack_is_reported_as_failure(self):
        self.pedal.drop_ack_for.add(20)
        status, r = self.post("/api/save", {"slot": 20, "name": "X", "values": {}})
        self.assertEqual((status, r["ok"]), (503, False))
        self.assertEqual(server.slot_log()["20"]["kind"], "read", "an unconfirmed save must not be listed as saved")

    def test_saved_preset_shows_in_pedal_list(self):
        self.post("/api/pedal/read")
        self.post("/api/save", {"slot": 30, "name": "LATER SONG", "values": {}})
        _, contents = self.get("/api/pedal")
        self.assertEqual({p["slot"]: p["name"] for p in contents["presets"]}[30], "LATER SONG")

    def test_name_with_characters_the_pedal_changes(self):
        """The pedal turns ( ) into spaces. Saving such a name should still be reported accurately."""
        self.post("/api/pedal/read")
        status, r = self.post("/api/save", {"slot": 40, "name": "SONG (2)", "values": {}})
        self.assertEqual(status, 200)
        _, contents = self.get("/api/pedal")
        listed = {p["slot"]: p["name"] for p in contents["presets"]}.get(40)
        self.assertEqual(listed, self.pedal.slots[40]["name"], "editor's list should match what the pedal holds")


class ReviewFixTests(ServerTest):
    """Issues from the Fable review, 2026-09-16."""

    def test_live_send_never_saves_even_if_asked_for_a_slot(self):
        before = json.dumps(self.pedal.slots, sort_keys=True)
        status, r = self.post("/api/send", {"name": "SNEAKY", "slot": 1, "values": {"32": 0}})
        self.assertEqual(status, 200)
        self.assertEqual(json.dumps(self.pedal.slots, sort_keys=True), before)
        self.assertEqual(self.pedal.live["name"], "SNEAKY")

    def test_save_that_lands_wrong_reports_failure_and_lists_what_pedal_holds(self):
        self.post("/api/pedal/read")
        self.pedal.corrupt_slots.add(20)
        status, r = self.post("/api/save", {"slot": 20, "name": "SONG", "values": {"9": -10}})
        self.assertEqual((status, r["ok"]), (503, False))
        self.assertIn("didn't save correctly", r["message"])
        listed = {p["slot"]: p for p in self.get("/api/pedal")[1]["presets"]}[20]
        self.assertEqual(listed["params"], self.pedal.slots[20]["params"])
        self.assertNotIn("saved", listed)

    def test_newer_read_beats_older_save_in_pedal_list(self):
        self.post("/api/pedal/read")
        self.post("/api/save", {"slot": 5, "name": "FROM EDITOR", "values": {}})
        time.sleep(0.01)
        self.pedal.slots[5] = {"name": "STORED ON PEDAL", "tags": 0, "params": [0] * 50}  # Store button on the unit
        self.get("/api/pedal/slot/5")
        listed = {p["slot"]: p for p in self.get("/api/pedal")[1]["presets"]}[5]
        self.assertEqual(listed["name"], "STORED ON PEDAL")
        self.assertNotIn("saved", listed)

    def test_read_showing_slot_empty_removes_it_from_list(self):
        self.post("/api/pedal/read")
        del self.pedal.slots[3]
        self.post("/api/pedal/range", {"start": 3, "count": 1})
        self.assertNotIn(3, [p["slot"] for p in self.get("/api/pedal")[1]["presets"]])

    def test_garbled_pedal_gives_a_clear_error_not_a_dead_request(self):
        self.pedal.garble_next_reads = 10
        status, r = self.get("/api/pedal/slot/1")
        self.assertEqual(status, 503)
        self.assertIn("garbled", r["message"])
        status, r = self.post("/api/save", {"slot": 1, "name": "X", "values": {}})
        self.assertEqual((status, r["ok"]), (503, False))
        self.assertIn("Nothing was saved", r["message"])
        self.assertEqual(self.pedal.slots[1]["name"], "TREAT ME RIGHT")

    def test_set_load_that_loses_the_pedal_midway_says_how_far_it_got(self):
        chorus, fx, right = fixture_presets()
        presets = [dict(name=f"SONG {i}", tags=0, params=[i] + [0] * 49) for i in range(5)]
        self.pedal.silent_after_writes = 3  # 20 and 21 verified; 22 written, then the pedal stops answering
        status, r = self.post("/api/sets/load", {"set_name": "Gig", "start": 20, "presets": presets})
        self.assertFalse(r["ok"])
        self.assertEqual(r["written"], [20, 21])
        self.assertEqual(r["failed"], 22)
        self.assertIn("Presets 20–21 are loaded", r["message"])

    def test_set_load_with_no_pedal_changes_nothing(self):
        self.pedal.connected = False
        status, r = self.post("/api/sets/load", {"set_name": "Gig", "start": 20, "presets": [dict(name="A", tags=0, params=[0] * 50)]})
        self.assertFalse(r["ok"])
        self.assertIn("No presets were changed", r["message"])


class LiveSendTests(ServerTest):
    def test_live_send_goes_to_edit_buffer_not_a_slot(self):
        slots_before = json.dumps(self.pedal.slots, sort_keys=True)
        status, r = self.post("/api/send", {"name": "TRY", "values": {"32": 1}})
        self.assertEqual((status, r["ok"]), (200, True))
        self.assertEqual(self.pedal.live["name"], "TRY")
        self.assertEqual(json.dumps(self.pedal.slots, sort_keys=True), slots_before)


class SetLoadTests(ServerTest):
    def set_presets(self):
        chorus, fx, right = fixture_presets()
        return [dict(name=p["name"], tags=p["tags"], params=p["params"]) for p in (chorus, fx, right)]

    def test_load_into_empty_slots(self):
        status, r = self.post("/api/sets/load", {"set_name": "Gig", "start": 100, "presets": self.set_presets()})
        self.assertEqual((status, r["ok"], r["written"], r["unchanged"], r["backups"]), (200, True, [100, 101, 102], [], None))
        self.assertEqual([self.pedal.slots[s]["name"] for s in (100, 101, 102)], ["TREAT ME CHORUS", "TREAT ME FX", "TREAT ME RIGHT"])

    def test_identical_presets_are_skipped_and_replaced_ones_backed_up(self):
        # pedal: 1 RIGHT, 2 CHORUS, 3 FX. Load CHORUS, FX, RIGHT at 2 -> 2,3 unchanged, 4 new.
        # Load at 1 -> all three replaced, each backed up.
        status, r = self.post("/api/sets/load", {"set_name": "Gig", "start": 2, "presets": self.set_presets()})
        self.assertEqual((r["written"], r["unchanged"]), ([4], [2, 3]))
        status, r = self.post("/api/sets/load", {"set_name": "Gig 2", "start": 1, "presets": self.set_presets()})
        self.assertEqual(r["written"], [1, 2, 3])
        backups = sorted(p.name for p in (server.BACKUPS / r["backups"]).glob("*.syx"))
        self.assertEqual(backups, ["preset 001 TREAT ME RIGHT.syx", "preset 002 TREAT ME CHORUS.syx", "preset 003 TREAT ME FX.syx"])

    def test_stops_at_first_failure_and_leaves_later_slots_alone(self):
        self.pedal.slots[52] = {"name": "KEEP ME", "tags": 0, "params": [0] * 50}
        self.pedal.corrupt_slots.add(51)
        status, r = self.post("/api/sets/load", {"set_name": "Gig", "start": 50, "presets": self.set_presets()})
        self.assertEqual((r["ok"], r["written"], r["failed"]), (False, [50], 51))
        self.assertEqual(self.pedal.slots[52]["name"], "KEEP ME")

    def test_set_must_fit_on_pedal(self):
        status, r = self.post("/api/sets/load", {"set_name": "Gig", "start": 499, "presets": self.set_presets()})
        self.assertEqual(status, 400)
        status, r = self.post("/api/sets/load", {"set_name": "Gig", "start": 1, "presets": []})
        self.assertEqual(status, 400)

    def test_failure_on_first_slot_has_sensible_message(self):
        self.pedal.corrupt_slots.add(60)
        status, r = self.post("/api/sets/load", {"set_name": "Gig", "start": 60, "presets": self.set_presets()})
        self.assertNotIn("60–59", r["message"])

    def test_preset_name_with_parentheses_loads(self):
        presets = self.set_presets()
        presets[0]["name"] = "INTRO (SLOW)"
        status, r = self.post("/api/sets/load", {"set_name": "Gig", "start": 200, "presets": presets})
        self.assertTrue(r["ok"], r.get("message"))


class RangeAndSetsStorageTests(ServerTest):
    def test_range_read(self):
        status, r = self.post("/api/pedal/range", {"start": 1, "count": 4})
        self.assertEqual([p and p["name"] for p in r["presets"]], ["TREAT ME RIGHT", "TREAT ME CHORUS", "TREAT ME FX", None])

    def test_range_outside_pedal_refused(self):
        self.assertEqual(self.post("/api/pedal/range", {"start": 499, "count": 3})[0], 400)

    def test_sets_round_trip(self):
        sets = [{"id": "a", "name": "Gig", "songs": [{"id": "s", "title": "Song", "presets": []}]}]
        self.assertEqual(self.get("/api/sets"), (200, {"sets": [], "revision": 0}))
        self.assertEqual(self.post("/api/sets", {"sets": sets, "revision": 0}), (200, {"ok": True, "revision": 1}))
        self.assertEqual(self.get("/api/sets"), (200, {"sets": sets, "revision": 1}))

    def test_second_window_cannot_overwrite_newer_sets(self):
        self.post("/api/sets", {"sets": [{"id": "a", "name": "From window A"}], "revision": 0})
        status, r = self.post("/api/sets", {"sets": [{"id": "b", "name": "Stale window B"}], "revision": 0})
        self.assertEqual(status, 409)
        self.assertEqual(r["sets"], [{"id": "a", "name": "From window A"}])
        self.assertIn("another editor window", r["message"])
        self.assertEqual(self.get("/api/sets")[1]["sets"], [{"id": "a", "name": "From window A"}])

    def test_sets_file_from_before_revisions_still_loads(self):
        server.SETS.write_text('{"sets": [{"id": "old"}]}')
        self.assertEqual(self.get("/api/sets"), (200, {"sets": [{"id": "old"}], "revision": 0}))
        self.assertEqual(self.post("/api/sets", {"sets": [], "revision": 0})[0], 200)

    def test_full_read_lists_every_preset(self):
        status, r = self.post("/api/pedal/read")
        self.assertEqual((r["source"], [p["slot"] for p in r["presets"]]), ("pedal", [1, 2, 3]))


class FileTests(ServerTest):
    def test_import_endpoint(self):
        from helpers import FIXTURES
        status, r = self.post("/api/syx", raw=(FIXTURES / "All 3 - Treat Me Right.syx").read_bytes())
        self.assertEqual([p["name"] for p in r["presets"]], ["TREAT ME CHORUS", "TREAT ME FX", "TREAT ME RIGHT"])
        self.assertEqual(self.post("/api/syx", raw=b"junk")[0], 400)

    def test_export_of_new_preset_targets_edit_buffer_not_a_slot(self):
        status, data = self.post("/api/export", {"name": "NEW", "values": {}})
        (p,) = parse_syx(data)
        self.assertEqual(p["number"], 0)

    def test_export_of_unchanged_preset_matches_original_file(self):
        from helpers import FIXTURES
        original = (FIXTURES / "Treat Me Right.syx").read_bytes()
        (p,) = parse_syx(original)
        status, data = self.post("/api/export", {"slot": p["number"], "name": p["name"], "tags": p["tags"], "values": self.values(p)})
        self.assertEqual(data, original)


if __name__ == "__main__":
    unittest.main()
