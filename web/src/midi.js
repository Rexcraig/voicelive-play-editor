// Talking to the pedal from the browser over Web MIDI, using the same commands as the Python server's
// PedalLink (captured from VoiceSupport 2026-09-16; see HANDOFF.md "Protocol").
//
// Differences from the server, all forced by the browser:
// - Web MIDI hands messages to a callback, so replies go into a queue and `expect` waits on it.
// - SysEx needs requestMIDIAccess({sysex: true}), which Chrome asks the singer to allow, once per site.
// - Only one conversation at a time, same as the server's lock: `run` serialises everything.
import { buildSyx, checksum, decode28, encode28, parseSyx, pedalName } from "./tch.js";

export const DEVICE = "VoiceLive Play";
export const CAPACITY = 500;  // the pedal's slots, 1..500
const HEAD = [0xF0, 0x00, 0x01, 0x38, 0x00, 0x69];
const SETUP_PACKETS = 3;  // 15 00 -> three 0x13 packets of 25 values

export class PedalError extends Error {}

const NO_ACCESS = "This browser can't reach MIDI devices. Use Chrome, Edge or Firefox on a computer; Safari can't do it (tested 2026-09-24).";
const NOT_FOUND = "VoiceLive Play not found. Check the USB cable, and close VoiceSupport if it's open.";

let access = null;
let queue = Promise.resolve();
let busy = 0;  // conversations queued or running: the status check answers from this instead of waiting
const inbox = [];
let waiter = null;

// Asks for MIDI access, including SysEx. The first call shows Chrome's permission prompt, so it must
// happen inside something the singer clicked.
export async function connect() {
  if (access) return access;
  if (!navigator.requestMIDIAccess) throw new PedalError(NO_ACCESS);
  try {
    access = await navigator.requestMIDIAccess({ sysex: true });
  } catch {
    throw new PedalError("This site isn't allowed to use MIDI. Allow it in the address bar, then try again.");
  }
  access.onstatechange = () => { ports.cache = null; };
  return access;
}

const ports = { cache: null };

function find() {
  if (!access) throw new PedalError(NOT_FOUND);
  if (ports.cache) return ports.cache;
  const pick = (map) => [...map.values()].find((p) => (p.name || "").includes(DEVICE));
  const input = pick(access.inputs), output = pick(access.outputs);
  if (!input || !output) throw new PedalError(NOT_FOUND);
  input.onmidimessage = (e) => {
    inbox.push(Array.from(e.data));
    if (waiter) { const w = waiter; waiter = null; w(); }
  };
  ports.cache = { input, output };
  return ports.cache;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The next message to arrive, or null once `deadline` passes.
async function next(deadline) {
  while (!inbox.length) {
    const left = deadline - performance.now();
    if (left <= 0) return null;
    await Promise.race([new Promise((r) => { waiter = r; }), sleep(Math.min(left, 20))]);
  }
  return inbox.shift();
}

function drain() { inbox.length = 0; }

function send(bytes) { find().output.send(bytes); }

// One conversation with the pedal at a time. `session` wraps the work in the 0x57 session VoiceSupport
// opens for reads; setup writes must run OUTSIDE one (inside, the pedal refuses them with 34 09 00 00).
export function run(work, { session = true } = {}) {
  busy++;
  const job = queue.then(async () => {
    find();
    drain();
    if (session) send([...HEAD, 0x57, 0x00, 0x00, 0xF7]);
    try {
      return await work({ send, next, drain });
    } finally {
      if (session) try { send([...HEAD, 0x57, 0x00, 0x01, 0xF7]); } catch { /* unplugged mid-session */ }
    }
  });
  queue = job.catch(() => {}).finally(() => { busy--; });  // a failed job must not block the next one
  return job;
}

// Each SysEx message of a multi-packet preset goes out on its own, as the pedal expects.
function sendSyx(data) {
  let msg = [];
  for (const byte of data) {
    msg.push(byte);
    if (byte === 0xF7) { send(msg); msg = []; }
  }
}

async function readOnce(slot) {
  send([...HEAD, 0x45, (slot >> 7) & 0x7F, slot & 0x7F, 0xF7]);
  const deadline = performance.now() + 1500;
  let msgs = [];
  for (let m = await next(deadline); m; m = await next(deadline)) {
    if (m.length < 8 || HEAD.some((b, i) => m[i] !== b)) continue;
    if (m[6] === 0x34 && m[7] === 0x02 && !msgs.length) return null;  // empty slot (34 01 .. is a save ack)
    if (m[6] === 0x20) msgs = [m];                                    // a header starts a preset; stray bytes before it don't
    else if (m[6] === 0x21 && msgs.length) {
      msgs.push(m);
      if (m[7] === 1) {
        const p = parseSyx(Uint8Array.from(msgs.flat()))[0];  // throws if damaged
        return { slot, name: p.name, params: p.params, tags: p.tags };
      }
    }
  }
  throw new PedalError(`The pedal didn't answer when asked for preset ${slot}.`);
}

export async function readSlot(link, slot) {
  for (const attempt of [1, 2]) {
    try {
      return await readOnce(slot);
    } catch (e) {
      if (e instanceof PedalError) throw e;
      link.drain();  // garbled: clear the line and ask once more
    }
  }
  throw new PedalError(`The pedal's answer for preset ${slot} was garbled twice. Try again, or reconnect the USB cable.`);
}

// Saves a preset and reads it back. ok is true only if the pedal acknowledged and holds exactly that preset.
export async function writeSlot(link, slot, name, tags, params) {
  name = pedalName(name);
  params = params.map((v) => Math.trunc(v));
  link.drain();
  sendSyx(buildSyx(slot, name, tags, params));
  const ack = [...HEAD, 0x34, 0x01, (slot >> 7) & 0x7F, slot & 0x7F, 0xF7];
  const deadline = performance.now() + 2000;
  let acked = false;
  while (!acked) {
    const m = await next(deadline);
    if (!m) break;
    acked = m.length === ack.length && ack.every((b, i) => m[i] === b);
  }
  const back = await readSlot(link, slot);
  const same = back && back.name === name && back.tags === tags
    && back.params.length === params.length && back.params.every((v, i) => v === params[i]);
  return { ok: acked && !!same, back };
}

// Play a preset in the edit buffer (number 0). Never saves.
export async function sendLive(name, tags, params) {
  return run(async () => { sendSyx(buildSyx(0, pedalName(name, "EDITOR"), tags, params)); return true; });
}

// Setup value that holds the preset the pedal is on (Setup map: [25] read 246 while the pedal sat on 246).
export const CURRENT_PRESET = 25;

// Ask the pedal to switch to a stored preset with standard MIDI Bank Select + Program Change on channel 1, then
// confirm from the Setup block that it moved. Only selects; never writes. Two bank-select schemes are tried,
// because which one the Play uses isn't documented. Returns true only when the pedal is seen on `slot`. If it
// ends up anywhere else (for example it obeyed Program Change but not the bank), it is sent back where it was.
export async function selectPreset(slot) {
  return run(async (link) => {
    const current = async () => setupValues(await setupPackets(link))[CURRENT_PRESET];
    const go = async (n, bank) => {
      send([0xB0, bank, (n - 1) >> 7]);
      send([0xC0, (n - 1) & 0x7F]);
      await sleep(250);
      return current();
    };
    const start = await current();
    for (const bank of [0x00, 0x20]) {
      if (await go(slot, bank) === slot) return true;
    }
    if (start >= 1 && start <= CAPACITY && await current() !== start) {
      for (const bank of [0x00, 0x20]) if (await go(start, bank) === start) break;
    }
    return false;
  }, { session: false });
}

async function setupPackets(link) {
  link.drain();
  send([...HEAD, 0x15, 0x00, 0xF7]);
  const deadline = performance.now() + 1500;
  const packets = {};
  while (Object.keys(packets).length < SETUP_PACKETS) {
    const m = await next(deadline);
    if (!m) break;
    const head = HEAD.every((b, i) => m[i] === b) && m[6] === 0x13;
    if (head && m.length > 12 && checksum(m.slice(10, -2)) === m[m.length - 2]) packets[m[9]] = m;
  }
  if (Object.keys(packets).length < SETUP_PACKETS) {
    throw new PedalError("The pedal didn't send its setup settings. Try again, or reconnect the USB cable.");
  }
  return packets;
}

function setupValues(packets) {
  const values = [];
  for (const i of Object.keys(packets).map(Number).sort((a, b) => a - b)) {
    const data = packets[i].slice(10, -2);
    for (let j = 0; j + 4 <= data.length; j += 4) values.push(decode28(data.slice(j, j + 4)));
  }
  return values;
}

export async function readSetup() {
  return run(async (link) => setupValues(await setupPackets(link)));
}

// Writes setup values the proven way: read the three packets, change the bytes, send them back outside a
// session, then read again and report what the pedal actually kept.
export async function writeSetupMany(pairs, linked) {
  const packets = await run(async (link) => setupPackets(link));
  const values = setupValues(packets);
  const working = [...values], changes = {};
  for (const [index, value] of Object.entries(pairs)) {  // each setting sees what the ones before it did
    for (const [i, v] of Object.entries(linked(working, +index, value))) {
      changes[i] = v;
      working[i] = v;
    }
  }
  const per = (packets[0].length - 12) / 4;
  for (const [i, v] of Object.entries(changes)) {
    const p = Math.floor(i / per), k = i % per;
    const packet = packets[p];
    const data = packet.slice(10, -2);
    data.splice(k * 4, 4, ...encode28(v));
    packets[p] = [...packet.slice(0, 10), ...data, checksum(data), 0xF7];
  }
  const acked = await run(async (link) => {
    link.drain();
    for (const i of Object.keys(packets).map(Number).sort((a, b) => a - b)) {
      send(packets[i]);
      await sleep(20);
    }
    const want = [...HEAD, 0x34, 0x01, 0x00, 0x00, 0xF7];
    const deadline = performance.now() + 2000;
    while (true) {
      const m = await next(deadline);
      if (!m) return false;
      if (m.length === want.length && want.every((b, i) => m[i] === b)) return true;
    }
  }, { session: false });
  const now = await readSetup();
  return { acked, changes, values: now };
}

// True only if the pedal answers a MIDI identity request: the port list can go stale after unplugging.
export async function answers() {
  if (!access) return false;
  if (busy) return true;  // mid-conversation with the pedal, so it is plainly there
  try {
    return await run(async (link) => {
      link.drain();
      send([0xF0, 0x7E, 0x7F, 0x06, 0x01, 0xF7]);
      const deadline = performance.now() + 400;
      while (true) {
        const m = await next(deadline);
        if (!m) return false;
        const id = [0xF0, 0x7E, 0x00, 0x06, 0x02, 0x00, 0x01, 0x38];
        if (id.every((b, i) => m[i] === b)) return true;
      }
    }, { session: false });
  } catch {
    return false;
  }
}
