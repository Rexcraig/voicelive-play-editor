"""Shared setup: import the server with its data folders and pedal swapped for temporary/fake ones."""
import json
import pathlib
import shutil
import sys
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer

ROOT = pathlib.Path(__file__).resolve().parent.parent
FIXTURES = pathlib.Path(__file__).resolve().parent / "fixtures"
sys.path.insert(0, str(ROOT))

import server  # noqa: E402
import fake_pedal  # noqa: E402
from tch import parse_syx  # noqa: E402

REAL_RTMIDI = server.rtmidi


def fixture_presets():
    """The three Treat Me presets from the singer's real .syx export."""
    return parse_syx((FIXTURES / "All 3 - Treat Me Right.syx").read_bytes())


def as_slot(p):
    return {"name": p["name"], "tags": p["tags"], "params": list(p["params"])}


class ServerTest(unittest.TestCase):
    """Runs the real HTTP handler against a fake pedal, with every data path in a temp folder."""

    def setUp(self):
        self.tmp = pathlib.Path(tempfile.mkdtemp(prefix="vlp-test-"))
        self.saved = {k: getattr(server, k) for k in ("BACKUPS", "SAVES", "SETS", "PEDAL_CACHE", "DATA_BACKUP", "VS_DATA")}
        server.BACKUPS = self.tmp / "backups"
        server.SAVES = self.tmp / "saves.json"
        server.SETS = self.tmp / "sets.json"
        server.PEDAL_CACHE = self.tmp / "pedal_cache.json"
        server.DATA_BACKUP = self.tmp / "no-drive" / "data"  # drive "unplugged" unless a test says otherwise
        server.VS_DATA = self.tmp / "no-voicesupport"
        chorus, fx, right = fixture_presets()
        self.pedal = fake_pedal.FakePedal({1: as_slot(right), 2: as_slot(chorus), 3: as_slot(fx)})
        fake_pedal.install(server, self.pedal)
        self.httpd = ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()
        self.base = f"http://127.0.0.1:{self.httpd.server_address[1]}"

    def tearDown(self):
        self.httpd.shutdown()
        self.httpd.server_close()
        if server.backup_timer:
            server.backup_timer.cancel()
        server.rtmidi = REAL_RTMIDI
        for k, v in self.saved.items():
            setattr(server, k, v)
        shutil.rmtree(self.tmp, ignore_errors=True)

    def get(self, path):
        return self._open(urllib.request.Request(self.base + path))

    def post(self, path, body=None, raw=None):
        data = raw if raw is not None else json.dumps(body or {}).encode()
        return self._open(urllib.request.Request(self.base + path, data, method="POST"))

    def _open(self, req):
        try:
            with urllib.request.urlopen(req) as r:
                payload = r.read()
                status = r.status
        except urllib.error.HTTPError as e:
            payload, status = e.read(), e.code
        try:
            return status, json.loads(payload)
        except ValueError:
            return status, payload

    def values(self, preset):
        return {str(i): v for i, v in enumerate(preset["params"])}
