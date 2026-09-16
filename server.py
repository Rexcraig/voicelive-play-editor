"""Local server for the VoiceLive Play editor: serves the UI and talks to the box over USB MIDI."""
import hashlib
import json
import shutil
import pathlib
import struct
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import rtmidi

import spec
from tch import build_syx, parse_syx, read_presets  # noqa: E402

HERE = pathlib.Path(__file__).resolve().parent
VS_DATA = pathlib.Path.home() / "Library/TC-Helicon/VoiceSupport 2/VoiceLive Play/data"
DEVICE = "VoiceLive Play"
PEDAL_CACHE = HERE / "pedal_cache.json"  # last full read straight from the pedal
CAPACITY = 500  # VoiceSupport asks for slots 1..500; empty ones answer 34 02 00 00
BACKUPS = HERE / "backups"  # a .syx copy of every preset before the editor replaces it
SETS = HERE / "sets.json"  # the singer's saved set lists
SAVES = HERE / "saves.json"  # slots this editor has written since VoiceSupport's last sync
# Off-machine copy of the singer's data (sets, save log, preset backups). Skipped when the drive isn't mounted.
DATA_BACKUP = pathlib.Path("/Volumes/Dock1/VoiceLivePlay/data")
KEEP_SET_VERSIONS = 100
lock = threading.Lock()
backup_timer = None


_defaults = json.loads((HERE / "defaults.json").read_text())
DEFAULTS, TAGS = _defaults["params"], _defaults["tags"]


def backup_data():
    """Mirror user data to DATA_BACKUP. Preset backups are only ever added, never deleted; each distinct
    version of sets.json is kept (newest KEEP_SET_VERSIONS), so a bad edit or deleted set can be recovered."""
    if not DATA_BACKUP.parent.is_dir():
        return
    try:
        history = DATA_BACKUP / "sets-history"
        history.mkdir(parents=True, exist_ok=True)
        if SETS.exists():
            data = SETS.read_bytes()
            digest = hashlib.sha256(data).hexdigest()[:12]
            if not any(history.glob(f"*_{digest}.json")):
                (history / f"{time.strftime('%Y-%m-%d_%H%M%S')}_{digest}.json").write_bytes(data)
            for old in sorted(history.glob("*.json"))[:-KEEP_SET_VERSIONS]:
                old.unlink()
            shutil.copy2(SETS, DATA_BACKUP / "sets.json")
        if SAVES.exists():
            shutil.copy2(SAVES, DATA_BACKUP / "saves.json")
        if BACKUPS.is_dir():
            for src in BACKUPS.rglob("*.syx"):
                dst = DATA_BACKUP / "preset-backups" / src.relative_to(BACKUPS)
                if not dst.exists():
                    dst.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copy2(src, dst)
    except OSError as e:
        print(f"Data backup to {DATA_BACKUP} failed: {e}", flush=True)


def schedule_backup():
    """Back up a few seconds after the last change, so a burst of edits makes one copy."""
    global backup_timer
    if backup_timer:
        backup_timer.cancel()
    backup_timer = threading.Timer(5, backup_data)
    backup_timer.daemon = False
    backup_timer.start()


def voicesupport_sync():
    """The pedal's presets as of VoiceSupport's most recent sync, or None."""
    syncs = sorted(VS_DATA.glob("*/sync.tch"), key=lambda f: f.stat().st_mtime)
    if not syncs:
        return None
    raw, presets = read_presets(syncs[-1])
    out = []
    for p in presets:
        i = raw.rfind(struct.pack("<II", 170, 15), 0, p["offsets"][0])
        name = raw[i + 8:i + 23].rstrip(b"\x00").decode("ascii", "replace")  # fixed 15-byte field
        out.append({"slot": struct.unpack("<I", raw[i - 4:i])[0], "name": name, "params": p["params"],
                    "tags": struct.unpack("<I", raw[i + 23:i + 27])[0]})
    return {"time": syncs[-1].stat().st_mtime, "source": "voicesupport", "presets": out}


def pedal_contents():
    """Newest known picture of the pedal (direct read or VoiceSupport sync), plus editor saves made since."""
    sources = [s for s in (voicesupport_sync(), json.loads(PEDAL_CACHE.read_text()) if PEDAL_CACHE.exists() else None) if s]
    if not sources:
        return {"synced": None, "source": None, "presets": [], "capacity": CAPACITY}
    base = max(sources, key=lambda s: s["time"])
    by_slot = {p["slot"]: dict(p) for p in base["presets"]}
    saves = json.loads(SAVES.read_text()) if SAVES.exists() else {}
    for slot, saved in saves.items():
        if saved["time"] > base["time"] and 1 <= int(slot) <= CAPACITY:
            by_slot.setdefault(int(slot), {"slot": int(slot)}).update(
                name=saved["name"], params=saved["params"], saved=saved["time"] * 1000, tags=saved.get("tags", TAGS))
    return {"synced": base["time"] * 1000, "source": base["source"],
            "presets": sorted(by_slot.values(), key=lambda x: x["slot"]), "capacity": CAPACITY}


class PedalLink:
    """Request/response session with the pedal, using the commands VoiceSupport uses (captured 2026-09-16)."""
    HEAD = [0xF0, 0x00, 0x01, 0x38, 0x00, 0x69]

    def __enter__(self):
        self.out, self.inp = rtmidi.MidiOut(), rtmidi.MidiIn()
        if DEVICE not in self.out.get_ports():
            raise ConnectionError("VoiceLive Play not found. Check the USB cable, and close VoiceSupport if it's open.")
        self.out.open_port(self.out.get_ports().index(DEVICE))
        self.inp.ignore_types(sysex=False)
        self.inp.open_port(self.inp.get_ports().index(DEVICE))
        self.out.send_message(self.HEAD + [0x57, 0x00, 0x00, 0xF7])  # begin session
        return self

    def __exit__(self, *exc):
        self.out.send_message(self.HEAD + [0x57, 0x00, 0x01, 0xF7])  # end session
        self.inp.close_port()
        self.out.close_port()

    def read(self, slot):
        """Preset dict for `slot`, or None if the slot is empty."""
        self.out.send_message(self.HEAD + [0x45, (slot >> 7) & 0x7F, slot & 0x7F, 0xF7])
        msgs, deadline = [], time.time() + 1.5
        while time.time() < deadline:
            m = self.inp.get_message()
            if not m:
                time.sleep(0.002)
                continue
            m = m[0]
            if m[:6] != self.HEAD:
                continue
            if m[6] == 0x34 and not msgs:
                return None  # empty slot: 34 02 00 00
            if m[6] in (0x20, 0x21):
                msgs.append(bytes(m))
            if m[6] == 0x21 and m[7] == 1:
                p = parse_syx(b"".join(msgs))[0]
                return {"slot": slot, "name": p["name"], "params": p["params"], "tags": p["tags"]}
        raise TimeoutError(f"The pedal didn't answer when asked for preset {slot}.")


    def write(self, slot, name, tags, params):
        """Store a preset in `slot`, then read it back. Returns True only if the pedal holds exactly that preset."""
        data = build_syx(slot, name, tags, params)
        msg = []
        for byte in data:
            msg.append(byte)
            if byte == 0xF7:
                self.out.send_message(msg)
                msg = []
        ack = self.HEAD + [0x34, 0x01, (slot >> 7) & 0x7F, slot & 0x7F, 0xF7]
        deadline = time.time() + 2
        while time.time() < deadline:
            m = self.inp.get_message()
            if not m:
                time.sleep(0.002)
            elif m[0] == ack:
                back = self.read(slot)
                return bool(back) and back["name"] == name and back["params"] == list(params) and back["tags"] == tags
        return False


def pedal_answers():
    """True only if the pedal replies to a MIDI identity request. macOS's port list can go stale after unplugging."""
    if not lock.acquire(blocking=False):
        return True  # busy talking to the pedal right now
    try:
        out, inp = rtmidi.MidiOut(), rtmidi.MidiIn()
        if DEVICE not in out.get_ports() or DEVICE not in inp.get_ports():
            return False
        inp.ignore_types(sysex=False)
        inp.open_port(inp.get_ports().index(DEVICE))
        out.open_port(out.get_ports().index(DEVICE))
        out.send_message([0xF0, 0x7E, 0x7F, 0x06, 0x01, 0xF7])
        deadline = time.time() + 0.4
        answered = False
        while time.time() < deadline and not answered:
            m = inp.get_message()
            if m:
                answered = m[0][:5] == [0xF0, 0x7E, 0x00, 0x06, 0x02] and m[0][5:8] == [0x00, 0x01, 0x38]
            else:
                time.sleep(0.005)
        inp.close_port()
        out.close_port()
        return answered
    except Exception:
        return False
    finally:
        lock.release()


def read_whole_pedal():
    with PedalLink() as link:
        presets = [p for p in (link.read(slot) for slot in range(1, CAPACITY + 1)) if p]
    PEDAL_CACHE.write_text(json.dumps({"time": time.time(), "source": "pedal", "presets": presets}))


def refresh_cached_slot(slot, preset):
    """Keep the cached read in step after a single-slot read or save."""
    if not PEDAL_CACHE.exists():
        return
    cache = json.loads(PEDAL_CACHE.read_text())
    cache["presets"] = [p for p in cache["presets"] if p["slot"] != slot] + ([preset] if preset else [])
    PEDAL_CACHE.write_text(json.dumps(cache))


def safe_filename(text):
    return "".join(c if c.isalnum() or c in " -" else "_" for c in text).strip() or "untitled"


def load_set(set_name, start, presets):
    """Write `presets` into slots start, start+1, ... Backs up every preset it replaces; stops at the first failure."""
    folder = BACKUPS / f"{time.strftime('%Y-%m-%d %H%M%S')} before set {safe_filename(set_name)}"
    written, unchanged = [], []
    with lock, PedalLink() as link:
        for offset, p in enumerate(presets):
            slot = start + offset
            name, tags, params = p["name"].upper()[:15], int(p["tags"]), [int(v) for v in p["params"]]
            old = link.read(slot)
            if old and old["name"] == name and old["tags"] == tags and old["params"] == params:
                unchanged.append(slot)
                continue
            if old:
                folder.mkdir(parents=True, exist_ok=True)
                (folder / f"preset {slot:03d} {safe_filename(old['name'])}.syx").write_bytes(
                    build_syx(slot, old["name"], old["tags"], old["params"]))
            if not link.write(slot, name, tags, params):
                return {"ok": False, "written": written, "unchanged": unchanged, "failed": slot,
                        "backups": folder.name if folder.exists() else None,
                        "message": f"Preset {slot} didn't save correctly, so loading stopped there. "
                                   f"Presets {start}–{slot - 1} are done; check preset {slot} on the pedal."}
            written.append(slot)
            record_save(slot, name, params, tags)
            refresh_cached_slot(slot, {"slot": slot, "name": name, "params": params, "tags": tags})
    return {"ok": True, "written": written, "unchanged": unchanged, "backups": folder.name if folder.exists() else None}


def record_save(slot, name, params, tags):
    saves = json.loads(SAVES.read_text()) if SAVES.exists() else {}
    saves[str(slot)] = {"name": name, "params": params, "tags": tags, "time": time.time()}
    SAVES.write_text(json.dumps(saves))
    schedule_backup()


def midi_out():
    out = rtmidi.MidiOut()
    ports = out.get_ports()
    if DEVICE not in ports:
        return None
    out.open_port(ports.index(DEVICE))
    return out


def send_to_box(name, params, slot=0, tags=None):
    """Slot 0 loads into the active preset without saving; slot N permanently replaces preset N."""
    out = midi_out()
    if out is None:
        return False, "VoiceLive Play not found. Check the USB cable, and close VoiceSupport if it's open."
    inp = None
    if slot:
        inp = rtmidi.MidiIn()
        inp.ignore_types(sysex=False)
        inp.open_port(inp.get_ports().index(DEVICE))
    data = build_syx(slot, name or "EDITOR", TAGS if tags is None else tags, params)
    msg = []
    for byte in data:
        msg.append(byte)
        if byte == 0xF7:
            out.send_message(msg)
            msg = []
            if slot:
                time.sleep(0.05)
    out.close_port()
    if not slot:
        return True, "sent"
    # The pedal acks with 0x34 01 <slot as two 7-bit bytes>.
    ack = [0xF0, 0x00, 0x01, 0x38, 0x00, 0x69, 0x34, 0x01, (slot >> 7) & 0x7F, slot & 0x7F, 0xF7]
    deadline = time.time() + 2
    while time.time() < deadline:
        m = inp.get_message()
        if m and m[0] == ack:
            inp.close_port()
            return True, f"Saved to preset {slot}."
        if not m:
            time.sleep(0.02)
    inp.close_port()
    return False, f"The pedal didn't confirm storing preset {slot}. Check preset {slot} on the pedal."


def merge(values):
    params = list(DEFAULTS)
    for k, v in values.items():
        params[int(k)] = int(v)
    return params


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def _send(self, code, body, ctype="application/json"):
        payload = body if isinstance(body, bytes) else json.dumps(body).encode()
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def do_GET(self):
        if self.path in ("/", "/index.html"):
            return self._send(200, (HERE / "static/index.html").read_bytes(), "text/html; charset=utf-8")
        for name, ctype in (("app.js", "text/javascript"), ("sets.js", "text/javascript"), ("style.css", "text/css")):
            if self.path == "/" + name:
                return self._send(200, (HERE / "static" / name).read_bytes(), ctype)
        if self.path == "/api/spec":
            return self._send(200, {**spec.as_json(), "defaults": DEFAULTS})
        if self.path == "/api/pedal":
            return self._send(200, pedal_contents())
        if self.path == "/api/sets":
            return self._send(200, json.loads(SETS.read_text()) if SETS.exists() else {"sets": []})
        if self.path.startswith("/api/pedal/slot/"):
            slot = int(self.path.rsplit("/", 1)[1])
            if not 1 <= slot <= CAPACITY:
                return self._send(400, {"ok": False, "message": f"The pedal's presets are numbered 1 to {CAPACITY}."})
            try:
                with lock, PedalLink() as link:
                    preset = link.read(slot)
            except (ConnectionError, TimeoutError) as e:
                return self._send(503, {"ok": False, "message": str(e)})
            refresh_cached_slot(slot, preset)
            return self._send(200, {"ok": True, "preset": preset})
        if self.path == "/api/status":
            return self._send(200, {"connected": pedal_answers()})
        self._send(404, {"error": "not found"})

    def do_POST(self):
        raw = self.rfile.read(int(self.headers.get("Content-Length", 0)))
        if self.path == "/api/syx":
            try:
                presets = parse_syx(raw)
            except ValueError as e:
                return self._send(400, {"ok": False, "message": str(e)})
            return self._send(200, {"ok": True, "presets": [{k: v for k, v in p.items() if k != "syx"} for p in presets]})
        body = json.loads(raw or "{}")
        params = merge(body.get("values", {}))
        name = (body.get("name") or "EDITOR").upper()[:15]
        tags = int(body["tags"]) if body.get("tags") is not None else TAGS
        if self.path == "/api/send":
            with lock:
                ok, message = send_to_box(name, params, int(body.get("slot", 0)), tags)
            return self._send(200 if ok else 503, {"ok": ok, "message": message})
        if self.path == "/api/sets":
            SETS.write_text(json.dumps({"sets": body.get("sets", [])}, indent=1))
            schedule_backup()
            return self._send(200, {"ok": True})
        if self.path == "/api/pedal/range":
            start, count = int(body.get("start", 1)), int(body.get("count", 0))
            if start < 1 or count < 0 or start + count - 1 > CAPACITY:
                return self._send(400, {"ok": False, "message": f"The pedal's presets are numbered 1 to {CAPACITY}."})
            try:
                with lock, PedalLink() as link:
                    presets = [link.read(slot) for slot in range(start, start + count)]
            except (ConnectionError, TimeoutError) as e:
                return self._send(503, {"ok": False, "message": str(e)})
            for offset, preset in enumerate(presets):
                refresh_cached_slot(start + offset, preset)
            return self._send(200, {"ok": True, "presets": presets})
        if self.path == "/api/sets/load":
            start, presets = int(body.get("start", 0)), body.get("presets", [])
            if not presets or start < 1 or start + len(presets) - 1 > CAPACITY:
                return self._send(400, {"ok": False, "message": f"The set has to fit in presets 1 to {CAPACITY}."})
            try:
                return self._send(200, load_set(body.get("set_name", "set"), start, presets))
            except (ConnectionError, TimeoutError) as e:
                return self._send(503, {"ok": False, "message": str(e)})
        if self.path == "/api/pedal/read":
            try:
                with lock:
                    read_whole_pedal()
            except (ConnectionError, TimeoutError) as e:
                return self._send(503, {"ok": False, "message": str(e)})
            return self._send(200, {"ok": True, **pedal_contents()})
        if self.path == "/api/save":
            slot = int(body.get("slot", 0))
            if not 1 <= slot <= CAPACITY:
                return self._send(400, {"ok": False, "message": f"The pedal's presets are numbered 1 to {CAPACITY}."})
            with lock:
                # Back up whatever is in the slot right now, straight from the pedal. No backup, no overwrite.
                try:
                    with PedalLink() as link:
                        old = link.read(slot)
                except (ConnectionError, TimeoutError) as e:
                    return self._send(503, {"ok": False, "message": f"{e} Nothing was saved."})
                backup = None
                if old:
                    BACKUPS.mkdir(exist_ok=True)
                    safe = "".join(c if c.isalnum() or c in " -" else "_" for c in old["name"]).strip()
                    backup = BACKUPS / f"{time.strftime('%Y-%m-%d %H%M%S')} preset {slot} {safe}.syx"
                    backup.write_bytes(build_syx(slot, old["name"], old["tags"], old["params"]))
                ok, message = send_to_box(name, params, slot, tags)
            if ok and backup:
                message += f" The old {old['name']} is backed up in backups/{backup.name}."
            if ok:
                record_save(slot, name, params, tags)
                refresh_cached_slot(slot, {"slot": slot, "name": name, "params": params, "tags": tags})
            return self._send(200 if ok else 503, {"ok": ok, "message": message})
        if self.path == "/api/export":
            data = build_syx(int(body.get("slot", 263)), name, tags, params)
            self.send_response(200)
            self.send_header("Content-Type", "application/octet-stream")
            self.send_header("Content-Disposition", f'attachment; filename="{name.title()}.syx"')
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            return self.wfile.write(data)
        self._send(404, {"error": "not found"})


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8730
    print(f"VoiceLive Play editor on http://localhost:{port}")
    backup_data()  # catch up on anything changed while the drive was unplugged
    ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()
