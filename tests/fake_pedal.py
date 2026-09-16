"""A simulated VoiceLive Play that speaks the same SysEx as the real pedal, for tests.

Install with `install(server_module, pedal)`: it swaps the server's rtmidi for fake ports wired to `pedal`.
Behaviour copied from the real unit (tools/capture.txt and tests on 2026-09-16):
  45 hi lo      -> 0x20 header + two 0x21 packets, or 34 02 00 00 when the slot is empty
  20 + 21 + 21  -> stores the preset, acks 34 01 hi lo
  57 00 00/01   -> session begin/end, no reply
  F0 7E 7F 06 01 F7 -> identity reply
"""
import sys
import types

sys.path.insert(0, str(__import__("pathlib").Path(__file__).resolve().parent.parent))
from tch import build_syx, parse_syx  # noqa: E402

HEAD = [0xF0, 0x00, 0x01, 0x38, 0x00, 0x69]
IDENTITY_REPLY = [0xF0, 0x7E, 0x00, 0x06, 0x02, 0x00, 0x01, 0x38, 0x69, 0x00, 0x00, 0x00, 0x00, 0xF7]
DEVICE = "VoiceLive Play"


class FakePedal:
    def __init__(self, presets=None, capacity=500):
        self.slots = dict(presets or {})  # slot -> {"name", "tags", "params"}
        self.capacity = capacity
        self.connected = True
        self.inputs = []  # open FakeMidiIn ports receive every reply
        self.log = []  # every message the pedal received
        self.pending = None
        self.drop_ack_for = set()  # simulate a lost ack
        self.corrupt_slots = set()  # simulate a bad write: stores different params
        self.name_filter = lambda name: name.replace("(", " ").replace(")", " ")  # seen on the real unit

    def reply(self, msg):
        for port in self.inputs:
            port.queue.append(list(msg))

    def receive(self, msg):
        self.log.append(list(msg))
        if msg == [0xF0, 0x7E, 0x7F, 0x06, 0x01, 0xF7]:
            return self.reply(IDENTITY_REPLY)
        if msg[:6] != HEAD:
            return
        cmd = msg[6]
        if cmd == 0x45:
            slot = (msg[7] << 7) | msg[8]
            p = self.slots.get(slot)
            if not p:
                return self.reply(HEAD + [0x34, 0x02, 0x00, 0x00, 0xF7])
            data = build_syx(slot, p["name"], p["tags"], p["params"])
            start = 0
            for i, b in enumerate(data):
                if b == 0xF7:
                    self.reply(list(data[start:i + 1]))
                    start = i + 1
        elif cmd == 0x20:
            self.pending = bytes(msg)
        elif cmd == 0x21 and self.pending is not None:
            self.pending += bytes(msg)
            if msg[7] == 1:
                p = parse_syx(self.pending)[0]
                self.pending = None
                slot = p["number"]
                if slot == 0:
                    self.live = p
                    return
                params = list(p["params"])
                if slot in self.corrupt_slots:
                    params[9] = params[9] - 1
                self.slots[slot] = {"name": self.name_filter(p["name"]), "tags": p["tags"], "params": params}
                if slot not in self.drop_ack_for:
                    self.reply(HEAD + [0x34, 0x01, (slot >> 7) & 0x7F, slot & 0x7F, 0xF7])


def fake_rtmidi(pedal):
    class FakeMidiOut:
        def get_ports(self):
            return ["IAC Driver Bus 1"] + ([DEVICE] if pedal.connected else [])

        def open_port(self, index):
            self.open = True

        def send_message(self, msg):
            if pedal.connected:
                pedal.receive(list(msg))

        def close_port(self):
            self.open = False

    class FakeMidiIn:
        def __init__(self):
            self.queue = []

        def get_ports(self):
            return ["IAC Driver Bus 1"] + ([DEVICE] if pedal.connected else [])

        def ignore_types(self, **kwargs):
            pass

        def open_port(self, index):
            pedal.inputs.append(self)

        def get_message(self):
            return (self.queue.pop(0), 0.0) if self.queue else None

        def close_port(self):
            if self in pedal.inputs:
                pedal.inputs.remove(self)

    return types.SimpleNamespace(MidiOut=FakeMidiOut, MidiIn=FakeMidiIn)


def install(server, pedal):
    server.rtmidi = fake_rtmidi(pedal)
