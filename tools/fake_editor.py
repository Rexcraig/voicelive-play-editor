"""Run the editor against the simulated pedal, so the UI can be tried without touching the real one.

    ~/vocal-analyzer/.venv/bin/python tools/fake_editor.py   ->  http://127.0.0.1:8797

The pedal starts as Will's was found on 09-17 (Mono out, condenser mic, Lead Mute on), so "Set up my rig"
has something to propose. Nothing is saved: presets, sets and backups go to a temporary folder.
"""
import pathlib, sys, tempfile
ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT)); sys.path.insert(0, str(ROOT / "tests"))
import server, fake_pedal
from tch import parse_syx
tmp = pathlib.Path(tempfile.mkdtemp(prefix="vlp-ui-"))
server.BACKUPS, server.SAVES = tmp / "backups", tmp / "saves.json"
server.SETS, server.PEDAL_CACHE = tmp / "sets.json", tmp / "pedal_cache.json"
server.DATA_BACKUP, server.VS_DATA = tmp / "no-drive", tmp / "no-vs"
presets = parse_syx((ROOT / "tests/fixtures/All 3 - Treat Me Right.syx").read_bytes())
pedal = fake_pedal.FakePedal({i + 1: {"name": p["name"], "tags": p["tags"], "params": list(p["params"])}
                              for i, p in enumerate(presets)})
pedal.setup[6] = 1        # Mono, like the pedal was found on 09-17
pedal.setup[9] = pedal.setup[10] = 1   # Condenser
pedal.setup[19] = 1       # Lead Mute on, so the wizard has something to fix
fake_pedal.install(server, pedal)
from http.server import ThreadingHTTPServer
httpd = ThreadingHTTPServer(("127.0.0.1", 8797), server.Handler)
print("fake editor on http://127.0.0.1:8797", flush=True)
httpd.serve_forever()
