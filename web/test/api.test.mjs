// Drives web/src/api.js's transport() against fake-pedal.mjs, the way the real browser build would: no
// server, no npm packages, just Node's own test runner (`node --test web/test/api.test.mjs`).
//
// Everything api.js/midi.js/storage.js expect from the browser is stubbed below, BEFORE those modules are
// imported (via dynamic import, since static imports are hoisted ahead of any top-level code and would
// otherwise run against the real, missing globals). storage.js's IndexedDB folder handle is deliberately
// left unstubbed (indexedDB stays undefined) so every backup takes its documented "download" fallback,
// which we intercept to inspect what would have been saved.
import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");

// --- in-memory localStorage -------------------------------------------------
function makeLocalStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    clear: () => map.clear(),
  };
}
globalThis.localStorage = makeLocalStorage();

// --- capture what storage.js's download() fallback would have saved --------
const downloads = []; // [{name, href}], newest last
const blobs = new Map(); // href -> Blob, so a test can read the bytes back
globalThis.document = {
  createElement(tag) {
    if (tag !== "a") throw new Error(`fake document.createElement: unstubbed <${tag}>`);
    const el = { download: "", _href: "" };
    Object.defineProperty(el, "href", { get: () => el._href, set: (v) => (el._href = v) });
    el.click = () => downloads.push({ name: el.download, href: el._href });
    return el;
  },
};
let blobSeq = 0;
globalThis.URL.createObjectURL = (blob) => {
  const href = `blob:fake-${blobSeq++}`;
  blobs.set(href, blob);
  return href;
};
globalThis.URL.revokeObjectURL = (href) => blobs.delete(href);

// storage.download() schedules a 10s revoke; unref only long timers so `node --test` exits promptly
// without them, while midi.js's real (much shorter) ack/read deadlines still get to fire.
const realSetTimeout = globalThis.setTimeout;
globalThis.setTimeout = (fn, ms, ...args) => {
  const t = realSetTimeout(fn, ms, ...args);
  if (ms >= 5000) t?.unref?.();
  return t;
};

// --- spec.json over "fetch", exactly as boot.js serves it from the same folder ---
const SPEC = JSON.parse(readFileSync(path.join(ROOT, "web", "src", "spec.json"), "utf8"));
globalThis.fetch = async () => ({ json: async () => SPEC });

// --- fake Web MIDI, wired to a pedal we swap out per test -------------------
const { FakePedal, createFakeMIDIAccess } = await import("./fake-pedal.mjs");
const fakeAccess = createFakeMIDIAccess();
globalThis.navigator.requestMIDIAccess = async () => fakeAccess.access;

// Now that every global api.js/midi.js/storage.js touch is stubbed, load them for real.
const midi = await import("../src/midi.js");
const api = await import("../src/api.js");
const { buildSyx, parseSyx } = await import("../src/tch.js");

await api.load(new URL("http://localhost/vlp/index.html"));
await midi.connect(); // one Chrome permission prompt, simulated once for the whole run

// --- fixtures: the singer's real presets, same three the Python tests use ------
const fixtureBytes = readFileSync(path.join(ROOT, "tests", "fixtures", "All 3 - Treat Me Right.syx"));
const [chorus, fx, right] = parseSyx(new Uint8Array(fixtureBytes));
const asSlot = (p) => ({ name: p.name, tags: p.tags, params: Array.from(p.params) });
const valuesOf = (params) => Object.fromEntries(params.map((v, i) => [String(i), v]));
const setPresets = () => [chorus, fx, right].map((p) => ({ name: p.name, tags: p.tags, params: Array.from(p.params) }));

function freshPedal() {
  return new FakePedal({ 1: asSlot(right), 2: asSlot(chorus), 3: asSlot(fx) });
}

let pedal;
beforeEach(() => {
  localStorage.clear();
  downloads.length = 0;
  blobs.clear();
  pedal = freshPedal();
  fakeAccess.setPedal(pedal);
});

async function lastDownloadBytes() {
  assert.equal(downloads.length >= 1, true, "expected a download to have happened");
  const blob = blobs.get(downloads[downloads.length - 1].href);
  return Buffer.from(await blob.arrayBuffer());
}

// --- /api/spec, /api/status --------------------------------------------------

test("/api/spec returns the generated spec", async () => {
  const result = await api.transport("/api/spec");
  assert.deepEqual(result, SPEC);
});

test("/api/status reports connected", async () => {
  assert.deepEqual(await api.transport("/api/status"), { connected: true });
  pedal.connected = false;
  fakeAccess.setPedal(pedal); // simulate the statechange a real unplug would fire
  assert.deepEqual(await api.transport("/api/status"), { connected: false });
});

// --- /api/pedal/slot/N --------------------------------------------------------

test("/api/pedal/slot/N returns a preset for a filled slot and logs the read", async () => {
  const result = await api.transport("/api/pedal/slot/1");
  assert.equal(result.ok, true);
  assert.equal(result.preset.name, "TREAT ME RIGHT");
  assert.deepEqual(result.preset.params, right.params);
  const log = JSON.parse(localStorage.getItem("vlp.saves"));
  assert.equal(log["1"].kind, "read");
  assert.equal(log["1"].preset.name, "TREAT ME RIGHT");
});

test("/api/pedal/slot/N returns null for an empty slot", async () => {
  const result = await api.transport("/api/pedal/slot/300");
  assert.equal(result.ok, true);
  assert.equal(result.preset, null);
  const log = JSON.parse(localStorage.getItem("vlp.saves"));
  assert.equal(log["300"].kind, "read");
  assert.equal(log["300"].preset, null);
});

// --- /api/save ----------------------------------------------------------------

test("/api/save into an occupied slot backs up the old preset before writing", async () => {
  const newParams = right.params.slice();
  newParams[9] = -1;
  const result = await api.transport("/api/save", {
    slot: 1, name: "REPLACEMENT", tags: right.tags, values: valuesOf(newParams),
  });
  assert.equal(result.ok, true);
  assert.match(result.message, /^Saved to preset 1\./);
  assert.match(result.message, /backed up/);

  // the backup must hold the OLD preset (proves it was taken before the write landed)
  const backedUp = parseSyx(await lastDownloadBytes())[0];
  assert.equal(backedUp.name, "TREAT ME RIGHT");
  assert.deepEqual(backedUp.params, right.params);
  assert.equal(downloads.length, 1);

  // and the new preset is what actually landed on the pedal
  assert.equal(pedal.slots.get(1).name, "REPLACEMENT");
  assert.deepEqual(pedal.slots.get(1).params, newParams);
});

test("/api/save when the pedal doesn't ack: ok:false, tells the singer to check the pedal, backup still happened", async () => {
  pedal.dropAckFor.add(1);
  const result = await api.transport("/api/save", { slot: 1, name: "X", values: valuesOf(right.params) });
  assert.equal(result.ok, false);
  assert.match(result.message, /pedal/i);
  assert.equal(downloads.length, 1, "the old preset must still have been backed up");
  const backedUp = parseSyx(await lastDownloadBytes())[0];
  assert.equal(backedUp.name, "TREAT ME RIGHT");
});

test("/api/save into an empty slot makes no backup", async () => {
  const result = await api.transport("/api/save", { slot: 20, name: "NEW SONG", values: {} });
  assert.equal(result.ok, true);
  assert.equal(downloads.length, 0);
  assert.equal(pedal.slots.get(20).name, "NEW SONG");
});

test("/api/save reports a clear error and makes no changes when the pedal is unplugged", async () => {
  pedal.connected = false;
  fakeAccess.setPedal(pedal);
  const result = await api.transport("/api/save", { slot: 1, name: "X", values: {} });
  assert.equal(result.ok, false);
  assert.match(result.message, /not found/i);
  assert.match(result.message, /Nothing was saved/);
  assert.equal(downloads.length, 0);
});

// --- /api/setup -----------------------------------------------------------------

test("/api/setup reads 75 values", async () => {
  const result = await api.transport("/api/setup");
  assert.equal(result.ok, true);
  assert.equal(result.values.length, 75);
  assert.equal(result.values[14], 880); // 440.0 Hz
});

test("/api/setup POSTing a valid change writes and reports ok", async () => {
  const result = await api.transport("/api/setup", { index: 21, value: 4 });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(pedal.setup[21], 4);
  assert.equal(result.values[21], 4);
});

test("/api/setup refuses an invalid index without touching the pedal", async () => {
  const result = await api.transport("/api/setup", { index: 999, value: 3 });
  assert.equal(result.ok, false);
  assert.equal(pedal.log.filter((m) => m[6] === 0x13).length, 0);
});

test("/api/setup refuses an invalid value for a real setting without touching the pedal", async () => {
  // index 9 is a mic choice; 7 is reserved for "set via RoomSense: Voice", not a direct choice (rig.js).
  const result = await api.transport("/api/setup", { index: 9, value: 7 });
  assert.equal(result.ok, false);
  assert.equal(pedal.log.filter((m) => m[6] === 0x13).length, 0);
});

// --- /api/sets ------------------------------------------------------------------

test("/api/sets round-trips through localStorage, including the stale-revision conflict", async () => {
  assert.deepEqual(await api.transport("/api/sets"), { sets: [], revision: 0 });

  const setsA = [{ id: "a", name: "Gig", songs: [] }];
  assert.deepEqual(await api.transport("/api/sets", { sets: setsA, revision: 0 }), { ok: true, revision: 1 });
  assert.deepEqual(await api.transport("/api/sets"), { sets: setsA, revision: 1 });

  const stale = await api.transport("/api/sets", { sets: [{ id: "b", name: "Stale" }], revision: 0 });
  assert.equal(stale.ok, false);
  assert.deepEqual(stale.sets, setsA);
  assert.equal(stale.revision, 1);
  assert.match(stale.message, /another editor window/);
  assert.deepEqual(await api.transport("/api/sets"), { sets: setsA, revision: 1 }); // the stale write didn't land
});

// --- /api/sets/load ---------------------------------------------------------------

test("/api/sets/load writes consecutive slots into empty presets", async () => {
  const result = await api.transport("/api/sets/load", { set_name: "Gig", start: 100, presets: setPresets() });
  assert.equal(result.ok, true);
  assert.deepEqual(result.written, [100, 101, 102]);
  assert.deepEqual(result.unchanged, []);
  assert.equal(result.backups, null);
  assert.deepEqual([100, 101, 102].map((s) => pedal.slots.get(s).name), ["TREAT ME CHORUS", "TREAT ME FX", "TREAT ME RIGHT"]);
});

test("/api/sets/load skips identical presets and backs up the ones it replaces", async () => {
  // pedal: 1 RIGHT, 2 CHORUS, 3 FX. Loading CHORUS,FX,RIGHT at slot 2: 2,3 already match, 4 is new.
  let result = await api.transport("/api/sets/load", { set_name: "Gig", start: 2, presets: setPresets() });
  assert.deepEqual(result.written, [4]);
  assert.deepEqual(result.unchanged, [2, 3]);
  assert.equal(downloads.length, 0, "nothing replaced yet, so nothing backed up");

  // Loading the same three at slot 1: all three differ from what's there now, so all three are replaced.
  result = await api.transport("/api/sets/load", { set_name: "Gig 2", start: 1, presets: setPresets() });
  assert.deepEqual(result.written, [1, 2, 3]);
  assert.equal(downloads.length, 3, "one backup per replaced slot");
});

test("/api/sets/load stops at the first failure and says how far it got", async () => {
  pedal.slots.set(52, { name: "KEEP ME", tags: 0, params: new Array(50).fill(0) });
  pedal.corruptSlots.add(51);
  const result = await api.transport("/api/sets/load", { set_name: "Gig", start: 50, presets: setPresets() });
  assert.equal(result.ok, false);
  assert.deepEqual(result.written, [50]);
  assert.equal(result.failed, 51);
  assert.match(result.message, /Preset 50 is loaded\./);
  assert.equal(pedal.slots.get(52).name, "KEEP ME", "slots after the failure must be left alone");
});

// --- /api/export ------------------------------------------------------------------

test("/api/export returns bytes identical to tch.buildSyx for the same preset", async () => {
  const bytes = await api.transport("/api/export", {
    slot: right.number, name: right.name, tags: right.tags, values: valuesOf(right.params),
  });
  const want = buildSyx(right.number, right.name, right.tags, right.params);
  assert.deepEqual(Buffer.from(bytes), Buffer.from(want));
});
