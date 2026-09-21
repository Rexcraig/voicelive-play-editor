// A JS port of tests/fake_pedal.py: a simulated VoiceLive Play that speaks the same SysEx as the real
// pedal, exposed as a fake Web MIDI implementation (an object shaped like MIDIAccess) so web/src/midi.js
// can be pointed at it with no changes. See tests/fake_pedal.py's own docstring for the wire behaviour
// this mirrors; keep the two in sync if the protocol ever changes.
import { buildSyx, checksum, decode28, encode28, parseSyx, pedalName } from "../src/tch.js";

export const DEVICE = "VoiceLive Play";
const HEAD = [0xf0, 0x00, 0x01, 0x38, 0x00, 0x69];
const IDENTITY_REPLY = [0xf0, 0x7e, 0x00, 0x06, 0x02, 0x00, 0x01, 0x38, 0x69, 0x00, 0x00, 0x00, 0x00, 0xf7];
const IDENTITY_REQUEST = [0xf0, 0x7e, 0x7f, 0x06, 0x01, 0xf7];

const eq = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
const headMatch = (msg) => HEAD.every((b, i) => msg[i] === b);

export class FakePedal {
  constructor(presets = {}) {
    this.slots = new Map(Object.entries(presets).map(([slot, p]) => [Number(slot), p]));
    this.connected = true;
    this.log = []; // every message received, for assertions
    this.pending = null; // in-progress 0x20+0x21+0x21 preset write
    this.live = null; // last preset sent to slot 0 (the edit buffer)

    // Knobs matching tests/fake_pedal.py, for the failure-case tests.
    this.dropAckFor = new Set(); // slot numbers whose write ack is swallowed (preset still lands)
    this.corruptSlots = new Set(); // slot numbers whose write lands with a mangled param (write "fails")
    this.garbleNextReads = 0; // damage the next N preset-read replies (checksum mismatch)
    this.silentAfterWrites = null; // stop answering entirely once this many writes have happened
    this.strayPacketBeforeReply = false; // send a lone 0x21 packet before answering a read

    this.writes = 0;
    this.setup = new Array(75).fill(0);
    this.setup[14] = 880; // 440.0 Hz
    this.setup[21] = 2; // LCD contrast
    this.setup[28] = 1; // RoomSense Ambient/Auto
    this.inSession = false;
    this.setupPending = {};
    this.setupClamp = {}; // index -> max value the pedal accepts (simulate a range limit)

    this._listeners = new Set(); // "open" MIDI input ports that should receive replies
  }

  // A MIDI input port subscribes here (see createFakeMIDIAccess); returns an unsubscribe function.
  onData(fn) {
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  }

  reply(bytes) {
    const msg = Array.from(bytes);
    for (const fn of this._listeners) fn(msg);
  }

  // What the fake device does with an incoming SysEx message, byte for byte identical to fake_pedal.py.
  receive(bytes) {
    const msg = Array.from(bytes);
    this.log.push(msg);
    if (this.silentAfterWrites !== null && this.writes >= this.silentAfterWrites) return;
    if (eq(msg, IDENTITY_REQUEST)) return this.reply(IDENTITY_REPLY);
    if (!headMatch(msg)) return;
    const cmd = msg[6];

    if (cmd === 0x57) {
      this.inSession = msg[8] === 0;
    } else if (cmd === 0x15) {
      for (let i = 0; i < 3; i++) {
        const data = this.setup.slice(i * 25, (i + 1) * 25).flatMap((v) => Array.from(encode28(v)));
        this.reply([...HEAD, 0x13, 0x01, 0x34, i, ...data, checksum(data), 0xf7]);
      }
    } else if (cmd === 0x13) {
      if (this.inSession) return this.reply([...HEAD, 0x34, 0x09, 0x00, 0x00, 0xf7]);
      const data = msg.slice(10, -2);
      const values = [];
      for (let j = 0; j < 100; j += 4) values.push(decode28(data.slice(j, j + 4)));
      this.setupPending[msg[9]] = values;
      if (Object.keys(this.setupPending).length === 3) {
        const next = [0, 1, 2].flatMap((i) => this.setupPending[i]);
        for (const [i, top] of Object.entries(this.setupClamp)) next[i] = Math.min(next[i], top);
        this.setup = next;
        this.setupPending = {};
        this.reply([...HEAD, 0x34, 0x01, 0x00, 0x00, 0xf7]);
      }
    } else if (cmd === 0x45) {
      const slot = (msg[7] << 7) | msg[8];
      const p = this.slots.get(slot);
      if (!p) return this.reply([...HEAD, 0x34, 0x02, 0x00, 0x00, 0xf7]);
      const data = Array.from(buildSyx(slot, p.name, p.tags, p.params));
      if (this.strayPacketBeforeReply) this.reply(data.slice(32, 32 + 110));
      if (this.garbleNextReads) {
        this.garbleNextReads -= 1;
        data[32 + 20] ^= 0x01;
      }
      let start = 0;
      for (let i = 0; i < data.length; i++) {
        if (data[i] === 0xf7) {
          this.reply(data.slice(start, i + 1));
          start = i + 1;
        }
      }
    } else if (cmd === 0x20) {
      this.pending = msg.slice();
    } else if (cmd === 0x21 && this.pending !== null) {
      this.pending = this.pending.concat(msg);
      if (msg[7] === 1) {
        const [p] = parseSyx(Uint8Array.from(this.pending));
        this.pending = null;
        const slot = p.number;
        if (slot === 0) {
          this.live = p;
          return;
        }
        const params = Array.from(p.params);
        if (this.corruptSlots.has(slot)) params[9] = params[9] - 1;
        this.slots.set(slot, { name: pedalName(p.name), tags: p.tags, params });
        this.writes += 1;
        if (!this.dropAckFor.has(slot)) {
          this.reply([...HEAD, 0x34, 0x01, (slot >> 7) & 0x7f, slot & 0x7f, 0xf7]);
        }
      }
    }
  }
}

// A MIDIAccess-shaped object wired to a swappable FakePedal (swap with setPedal between tests; the port
// objects themselves stay the same identity, since web/src/midi.js caches them after the first lookup).
export function createFakeMIDIAccess() {
  const state = { pedal: null, unsub: null };
  const input = { id: "vlp-in", name: DEVICE, type: "input", state: "connected", onmidimessage: null };
  const output = {
    id: "vlp-out",
    name: DEVICE,
    type: "output",
    state: "connected",
    send(bytes) {
      if (state.pedal && state.pedal.connected) state.pedal.receive(bytes);
    },
  };
  // An unrelated port, same as fake_pedal.py's "IAC Driver Bus 1", so `find()`'s name filter is exercised.
  const decoyIn = { id: "iac-in", name: "IAC Driver Bus 1", type: "input", state: "connected", onmidimessage: null };
  const decoyOut = { id: "iac-out", name: "IAC Driver Bus 1", type: "output", state: "connected", send() {} };

  function deliver(msg) {
    if (input.onmidimessage) input.onmidimessage({ data: Uint8Array.from(msg) });
  }

  const access = {
    get inputs() {
      const map = new Map([[decoyIn.id, decoyIn]]);
      if (state.pedal && state.pedal.connected) map.set(input.id, input);
      return map;
    },
    get outputs() {
      const map = new Map([[decoyOut.id, decoyOut]]);
      if (state.pedal && state.pedal.connected) map.set(output.id, output);
      return map;
    },
    onstatechange: null,
    sysexEnabled: true,
  };

  // Point the fake MIDI ports at a (possibly new) pedal, and tell midi.js its port list may have changed
  // — exactly what a real "device plugged/unplugged" statechange event does — so `find()` looks again
  // instead of reusing a stale connected/disconnected pair from a previous test's pedal.
  function setPedal(pedal) {
    if (state.unsub) {
      state.unsub();
      state.unsub = null;
    }
    state.pedal = pedal;
    if (pedal) state.unsub = pedal.onData(deliver);
    if (access.onstatechange) access.onstatechange({ port: input });
  }

  return { access, setPedal };
}
