"""The browser build has no server, so /api/spec's payload is baked into web/src/spec.json at build
time. These guard both halves: the generated file is current, and what it was generated from is still
exactly what the server serves."""
import json
import sys
import unittest

from helpers import ROOT, ServerTest

sys.path.insert(0, str(ROOT / "tools"))
import gen_spec  # noqa: E402


class WebSpecTests(ServerTest):
    def test_web_spec_json_is_current(self):
        actual = json.loads((ROOT / "web/src/spec.json").read_text())
        self.assertEqual(actual, gen_spec.payload(), "web/src/spec.json is stale — run: python tools/gen_spec.py")

    def test_generated_payload_matches_what_the_server_serves(self):
        status, body = self.get("/api/spec")
        self.assertEqual(status, 200)
        self.assertEqual(body, gen_spec.payload(), "tools/gen_spec.py has drifted from server.py's /api/spec")


if __name__ == "__main__":
    unittest.main()
