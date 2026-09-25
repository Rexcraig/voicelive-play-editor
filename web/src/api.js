// The Python server's routes, done in the browser. Every path and reply here matches server.py, so the UI
// files in static/ are shared by both versions and neither drifts from the other.
import * as midi from "./midi.js";
import * as store from "./storage.js";
import { buildSyx, parseSyx, pedalName } from "./tch.js";
import { rigPlan, setupChanges, setupValueOk } from "./rig.js";

// spec.json is generated from spec.py by tools/gen_spec.py, so the two versions can't drift.
// Fetched rather than imported as a JSON module, which not every browser supports yet.
let spec = null;
export async function load(base) {
  if (!spec) spec = await (await fetch(new URL("spec.json", base))).json();
  return spec;
}

const CAPACITY = midi.CAPACITY;
const { PedalError } = midi;

const fail = (message) => ({ ok: false, message });

const merge = (values) => {
  const params = [...spec.defaults];
  for (const [k, v] of Object.entries(values || {})) params[+k] = Math.trunc(v);
  return params;
};

const presetOf = (body) => ({
  name: pedalName(body.name, "EDITOR"),
  params: merge(body.values),
  tags: body.tags === undefined || body.tags === null ? spec.tags : Math.trunc(body.tags),
});

const stamp = () => {
  const d = new Date(), p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
};

const safeName = (text) => ([...(text || "")].map((c) => (/[a-z0-9 -]/i.test(c) ? c : "_")).join("").trim() || "untitled");

// The newest picture of the pedal: the last full read, updated by every later save or single-slot read.
// The desktop version can also fall back to VoiceSupport's sync file; a browser can't read that folder.
function pedalContents() {
  const cache = store.pedalCache();
  const bySlot = new Map((cache?.presets || []).map((p) => [p.slot, { ...p }]));
  const log = Object.entries(store.slotLog()).sort((a, b) => a[1].time - b[1].time);
  for (const [slot, entry] of log) {
    const n = +slot;
    if (entry.time <= (cache?.time || 0) || n < 1 || n > CAPACITY) continue;
    if (!entry.preset) bySlot.delete(n);
    else bySlot.set(n, { ...entry.preset, slot: n, ...(entry.kind === "saved" ? { saved: entry.time * 1000 } : {}) });
  }
  return {
    synced: cache ? cache.time * 1000 : null,
    source: cache ? "pedal" : null,
    presets: [...bySlot.values()].sort((a, b) => a.slot - b.slot),
    capacity: CAPACITY,
  };
}

let selectFailed = false;

async function backupSlot(path, slot, preset) {
  return store.backupPreset(path, buildSyx(slot, preset.name, preset.tags, preset.params));
}

// Save one preset: back up what's there (read straight from the pedal), write, verify. Never writes
// without the backup, exactly as the desktop version does.
async function savePreset(slot, { name, tags, params }) {
  let old, kept = "", result;
  try {
    result = await midi.run(async (link) => {
      old = await midi.readSlot(link, slot);
      if (old) kept = await backupSlot(`backups/${stamp()} preset ${slot} ${safeName(old.name)}.syx`, slot, old);
      return midi.writeSlot(link, slot, name, tags, params);
    });
  } catch (e) {
    if (!(e instanceof PedalError)) throw e;
    return fail(old ? `${e.message} Preset ${slot} may have changed: check it on the pedal.` : `${e.message} Nothing was saved.`);
  }
  if (result.back) store.noteSlot(slot, result.back, result.ok ? "saved" : "read");
  const where = kept ? ` The old ${old.name} is backed up in ${kept}.` : "";
  return result.ok
    ? { ok: true, message: `Saved to preset ${slot}.${where}` }
    : fail(`Preset ${slot} didn't save correctly. Check it on the pedal.${where}`);
}

// Write a whole set into consecutive slots, backing up each preset it replaces and stopping at the first
// problem, saying exactly how far it got.
async function loadSet(setName, start, presets) {
  const folder = `backups/${stamp()} before set ${safeName(setName)}`;
  const written = [], unchanged = [];
  let slot = null, backedUp = false;  // no folder is named unless something was really backed up
  const stopped = (problem) => {
    const last = slot ? slot - 1 : start - 1;
    const done = last > start ? `Presets ${start}–${last} are loaded.`
      : last === start ? `Preset ${start} is loaded.` : "No presets were changed.";
    return { ok: false, written, unchanged, backups: backedUp ? folder : null, failed: slot,
             message: `Loading stopped at preset ${slot || start}: ${problem} ${done}` };
  };
  try {
    const bad = await midi.run(async (link) => {
      for (const [offset, p] of presets.entries()) {
        slot = start + offset;
        const name = pedalName(p.name), tags = Math.trunc(p.tags), params = p.params.map((v) => Math.trunc(v));
        const old = await midi.readSlot(link, slot);
        const same = old && old.name === name && old.tags === tags && old.params.every((v, i) => v === params[i]);
        if (same) { unchanged.push(slot); continue; }
        if (old) {
          await backupSlot(`${folder}/preset ${String(slot).padStart(3, "0")} ${safeName(old.name)}.syx`, slot, old);
          backedUp = true;
        }
        const { ok, back } = await midi.writeSlot(link, slot, name, tags, params);
        if (back) store.noteSlot(slot, back, ok ? "saved" : "read");
        if (!ok) return `it didn't save correctly. Check preset ${slot} on the pedal.`;
        written.push(slot);
      }
      return null;
    });
    if (bad) return stopped(bad);
  } catch (e) {
    if (!(e instanceof PedalError)) throw e;
    return stopped(e.message);
  }
  return { ok: true, written, unchanged, backups: backedUp ? folder : null };
}

async function writeSetup(pairs) {
  const { acked, changes, values } = await midi.writeSetupMany(pairs, setupChanges);
  if (Object.entries(changes).every(([i, v]) => values[i] === v)) return { ok: true, values, message: "sent" };
  const field = (i) => spec.setup.flatMap((p) => p.fields).find((f) => f.index === +i);
  const missed = Object.keys(pairs).filter((i) => field(i) && values[i] !== (changes[i] ?? values[i])).map((i) => field(i).label);
  const names = missed.join(", ") || field(Object.keys(pairs).map(Number).sort((a, b) => a - b)[0]).label;
  const why = acked ? "kept a different value" : "didn't confirm the change";
  return { ok: false, values, message: `The pedal ${why} for ${names}. The screen shows what it holds now.` };
}

const ROUTES = {
  "/api/spec": async () => spec,
  "/api/status": async () => ({ connected: await midi.answers() }),
  "/api/pedal": async () => pedalContents(),
  "/api/sets": async (body) => {
    if (body === undefined) return store.readSets();
    const current = store.readSets();
    if (body.revision !== current.revision) {
      return { ok: false, ...current,
               message: "These sets were changed in another editor window. Showing the latest version; your last change wasn't kept." };
    }
    const revision = current.revision + 1;
    if (!store.writeSets(body.sets || [], revision)) return fail("This browser wouldn't store the sets. Check that it allows site data.");
    return { ok: true, revision };
  },
  "/api/send": async (body) => {
    const { name, tags, params } = presetOf(body);
    await midi.sendLive(name, tags, params);
    return { ok: true, message: "sent" };
  },
  "/api/pedal/select": async (body) => {
    const slot = Math.trunc(body?.slot ?? 0);
    if (slot < 1 || slot > CAPACITY) return fail(`The pedal's presets are numbered 1 to ${CAPACITY}.`);
    if (selectFailed) return { ok: true, switched: false };  // tried once this visit; don't keep poking the pedal
    const switched = await midi.selectPreset(slot);
    selectFailed = !switched;
    return { ok: true, switched };
  },
  "/api/setup": async (body) => {
    if (body === undefined) return { ok: true, values: await midi.readSetup() };
    const index = Math.trunc(body.index ?? -1), value = Math.trunc(body.value ?? 0);
    if (!setupValueOk(index, value, spec)) return fail("That isn't a setting the pedal's Setup menu offers.");
    return writeSetup({ [index]: value });
  },
  "/api/setup/rig": async (body) => {
    const answers = body.answers || {};
    const values = await midi.readSetup();
    const plan = rigPlan(answers, values, spec);
    if (!body.apply) return { ok: true, plan, values };
    const offered = Object.fromEntries(plan.map((p) => [p.index, p.value]));
    const changes = body.changes
      ? Object.fromEntries(Object.entries(body.changes).map(([i, v]) => [Math.trunc(+i), Math.trunc(v)]))
      : offered;
    if (Object.entries(changes).some(([i, v]) => offered[i] !== v)) {  // only ever what was shown
      return fail("Those aren't the settings that were offered. Answer the questions again.");
    }
    if (!Object.keys(changes).length) return { ok: true, plan: [], values, message: "The pedal is already set up that way." };
    const done = await writeSetup(changes);
    return { ...done, plan: rigPlan(answers, done.values, spec) };
  },
  "/api/pedal/read": async () => {
    const presets = await midi.run(async (link) => {
      const found = [];
      for (let slot = 1; slot <= CAPACITY; slot++) {
        const p = await midi.readSlot(link, slot);
        if (p) found.push(p);
      }
      return found;
    });
    store.writePedalCache(presets);
    return { ok: true, ...pedalContents() };
  },
  "/api/pedal/range": async (body) => {
    const start = Math.trunc(body.start ?? 1), count = Math.trunc(body.count ?? 0);
    if (start < 1 || count < 0 || start + count - 1 > CAPACITY) return fail(`The pedal's presets are numbered 1 to ${CAPACITY}.`);
    const presets = await midi.run(async (link) => {
      const out = [];
      for (let slot = start; slot < start + count; slot++) out.push(await midi.readSlot(link, slot));
      return out;
    });
    presets.forEach((preset, offset) => store.noteSlot(start + offset, preset, "read"));
    return { ok: true, presets };
  },
  "/api/sets/load": async (body) => {
    const start = Math.trunc(body.start ?? 0), presets = body.presets || [];
    if (!presets.length || start < 1 || start + presets.length - 1 > CAPACITY) return fail(`The set has to fit in presets 1 to ${CAPACITY}.`);
    return loadSet(body.set_name || "set", start, presets);
  },
  "/api/save": async (body) => {
    const slot = Math.trunc(body.slot ?? 0);
    if (slot < 1 || slot > CAPACITY) return fail(`The pedal's presets are numbered 1 to ${CAPACITY}.`);
    return savePreset(slot, presetOf(body));
  },
  "/api/syx": async (bytes) => {
    try {
      return { ok: true, presets: parseSyx(bytes).map(({ syx, ...rest }) => rest) };
    } catch (e) {
      return fail(e.message);
    }
  },
  "/api/export": async (body) => {
    const { name, tags, params } = presetOf(body);
    const slot = Math.trunc(body.slot ?? 0);
    return buildSyx(slot >= 0 && slot <= CAPACITY ? slot : 0, name, tags, params);
  },
};

// Single-slot read: /api/pedal/slot/N
async function readOneSlot(slot) {
  if (slot < 1 || slot > CAPACITY) return fail(`The pedal's presets are numbered 1 to ${CAPACITY}.`);
  const preset = await midi.run((link) => midi.readSlot(link, slot));
  store.noteSlot(slot, preset, "read");
  return { ok: true, preset };
}

// What the UI's api() calls instead of fetch. Anything the pedal refuses comes back as {ok:false,message},
// so the singer sees the same words as in the desktop version.
export async function transport(path, body) {
  try {
    if (path.startsWith("/api/pedal/slot/")) return await readOneSlot(Math.trunc(+path.split("/").pop()));
    const route = ROUTES[path];
    if (!route) return fail(`The editor asked for ${path}, which doesn't exist.`);
    return await route(body);
  } catch (e) {
    if (e instanceof PedalError) return fail(e.message);
    console.error(e);
    return fail("Something went wrong inside the editor. Reload the page and try again.");
  }
}
