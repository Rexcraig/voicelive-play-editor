"""Copying the singer's data to the backup drive."""
import json
import os
import time
import unittest

from helpers import ServerTest
import server


class DataBackupTests(ServerTest):
    def setUp(self):
        super().setUp()
        server.DATA_BACKUP = self.tmp / "drive" / "data"
        (self.tmp / "drive").mkdir()

    def test_skips_quietly_without_drive(self):
        server.DATA_BACKUP = self.tmp / "missing" / "data"
        server.SETS.write_text("{}")
        server.backup_data()
        self.assertFalse((self.tmp / "missing").exists())

    def test_each_distinct_set_list_version_is_kept_once(self):
        server.SETS.write_text(json.dumps({"sets": [1]}))
        server.backup_data()
        server.backup_data()
        server.SETS.write_text(json.dumps({"sets": [1, 2]}))
        time.sleep(1.1)  # versions are named by the second
        server.backup_data()
        self.assertEqual(len(list((server.DATA_BACKUP / "sets-history").glob("*.json"))), 2)
        self.assertEqual(json.loads((server.DATA_BACKUP / "sets.json").read_text()), {"sets": [1, 2]})

    def test_preset_backups_are_never_deleted_from_drive(self):
        (server.BACKUPS / "folder").mkdir(parents=True)
        (server.BACKUPS / "folder" / "preset 001 A.syx").write_bytes(b"a")
        server.backup_data()
        (server.BACKUPS / "folder" / "preset 001 A.syx").unlink()
        server.backup_data()
        self.assertTrue((server.DATA_BACKUP / "preset-backups" / "folder" / "preset 001 A.syx").exists())

    def test_history_is_capped(self):
        history = server.DATA_BACKUP / "sets-history"
        history.mkdir(parents=True)
        for i in range(server.KEEP_SET_VERSIONS + 5):
            (history / f"2026-01-01_{i:06d}_x{i}.json").write_text("{}")
        server.SETS.write_text('{"sets": ["new"]}')
        server.backup_data()
        self.assertEqual(len(list(history.glob("*.json"))), server.KEEP_SET_VERSIONS)

    def test_save_triggers_a_backup_shortly_after(self):
        server.SETS.write_text("{}")
        self.post("/api/sets", {"sets": [{"id": "x"}]})
        self.assertIsNotNone(server.backup_timer)
        server.backup_timer.cancel()
        server.backup_data()
        self.assertTrue((server.DATA_BACKUP / "sets.json").exists())


if __name__ == "__main__":
    unittest.main()
