// Sets: named, ordered song lists. Each song holds one or more presets (full copies, so a set survives pedal changes).
// "Load onto pedal" writes the set's presets, in order, into consecutive slots.

const sets = { list: [], revision: 0, current: null, loaded: false, saveTimer: null, saving: Promise.resolve(), picker: null, plan: null, drag: null, batch: null };
const uid = () => Math.random().toString(36).slice(2, 10);
const allPresets = (set) => set.songs.flatMap((song) => song.presets);
const el = (tag, cls, text) => {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
};

async function openSetsTab() {
  if (!sets.loaded) {
    const data = await api("/api/sets");
    if (data.ok === false) return setsNotice(data.message);
    sets.list = data.sets;
    sets.revision = data.revision;
    sets.current = sets.list[0]?.id || null;
    sets.loaded = true;
  }
  renderSets();
}

function setsNotice(text) {
  $("#sets-notice").textContent = text || "";
  $("#sets-notice").hidden = !text;
}

function currentSet() { return sets.list.find((s) => s.id === sets.current); }

function saveSets() {
  const set = currentSet();
  if (set) set.updated = Date.now();
  clearTimeout(sets.saveTimer);
  sets.saveTimer = setTimeout(flushSets, 300);
}

// Saves go out one at a time, each carrying the revision it was based on. If another window saved in
// between, the server refuses and this window switches to the latest sets.
function flushSets() {
  clearTimeout(sets.saveTimer);
  sets.saveTimer = null;
  sets.saving = sets.saving.then(async () => {
    const data = await api("/api/sets", { sets: sets.list, revision: sets.revision });
    if (data.ok) {
      sets.revision = data.revision;
      if ($("#sets-notice").dataset.kind === "error") setsNotice("");
    } else if (data.sets) {
      sets.list = data.sets;
      sets.revision = data.revision;
      if (!currentSet()) sets.current = sets.list[0]?.id || null;
      setsNotice(data.message);
      $("#sets-notice").dataset.kind = "conflict";
      renderSets();
    } else {
      setsNotice(`Couldn't save your sets: ${data.message}`);
      $("#sets-notice").dataset.kind = "error";
    }
  });
  return sets.saving;
}

// Closing or hiding the tab right after an edit: send the pending change immediately.
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "hidden" || !sets.saveTimer) return;
  clearTimeout(sets.saveTimer);
  sets.saveTimer = null;
  navigator.sendBeacon("/api/sets", new Blob([JSON.stringify({ sets: sets.list, revision: sets.revision })], { type: "text/plain" }));
  sets.revision += 1;
});

// Coming back to this window: pick up changes made in another one (if nothing is waiting to be saved here).
document.addEventListener("visibilitychange", async () => {
  if (document.visibilityState !== "visible" || !sets.loaded || sets.saveTimer) return;
  await sets.saving;
  const data = await api("/api/sets");
  if (data.ok === false || data.revision === sets.revision) return;
  sets.list = data.sets;
  sets.revision = data.revision;
  if (!currentSet()) sets.current = sets.list[0]?.id || null;
  if (!$("#sets").hidden) renderSets();
});

function renderSets() {
  const list = $("#set-list");
  list.innerHTML = "";
  for (const set of sets.list) {
    const li = el("li");
    const b = el("button", set.id === sets.current ? "active" : "");
    b.append(el("span", "set-name", set.name || "Untitled set"));
    const n = allPresets(set).length;
    b.append(el("span", "set-meta", `${set.songs.length} song${set.songs.length === 1 ? "" : "s"} · ${n} preset${n === 1 ? "" : "s"}`));
    b.onclick = () => { sets.current = set.id; renderSets(); };
    li.append(b);
    list.append(li);
  }
  if (!sets.list.length) list.append(el("li", "side-empty", "No sets yet."));
  renderSetEditor();
}

function renderSetEditor() {
  const box = $("#set-editor");
  box.innerHTML = "";
  const set = currentSet();
  if (!set) {
    const empty = el("div", "set-empty");
    empty.append(el("h2", null, "Build a set"));
    empty.append(el("p", null, "A set is your songs in running order. Each song can use one or more presets. When it's ready, load it onto the pedal and step through it with the footswitch."));
    const b = el("button", "primary", "New set");
    b.onclick = newSet;
    empty.append(b);
    return box.append(empty);
  }

  const head = el("div", "set-head");
  const name = el("input", "set-title");
  name.value = set.name;
  name.placeholder = "Set name";
  name.spellcheck = false;
  name.oninput = () => { set.name = name.value; saveSets(); renderSetListOnly(); };
  const n = allPresets(set).length;
  const meta = el("p", "set-summary", n
    ? `${set.songs.length} song${set.songs.length === 1 ? "" : "s"} · ${n} preset${n === 1 ? "" : "s"} · last loaded at preset ${set.start || "—"}`
    : "Add songs to get started.");
  const titleCol = el("div", "set-title-col");
  titleCol.append(name, meta);
  const actions = el("div", "set-actions");
  const del = el("button", "link danger", "Delete set");
  del.type = "button";
  del.onclick = () => {
    if (!confirm(`Delete the set "${set.name || "Untitled set"}"? Presets already on the pedal stay there.`)) return;
    sets.list = sets.list.filter((s) => s !== set);
    sets.current = sets.list[0]?.id || null;
    flushSets();
    renderSets();
  };
  const load = el("button", "primary", "Load onto pedal");
  load.disabled = !n;
  load.onclick = openLoadDialog;
  const print = el("button", "ghost", "Print set list");
  print.type = "button";
  print.disabled = !n;
  print.title = "A one-page set list with the pedal's preset numbers, for the mic stand";
  print.onclick = () => printSetList(set);
  const perform = el("button", "ghost", "Stage view");
  perform.type = "button";
  perform.disabled = !n;
  perform.title = "Run this set full-screen: each part plays on the pedal as you go";
  perform.onclick = () => openStage(set);
  actions.append(del, print, perform, load);
  head.append(titleCol, actions);
  box.append(head);

  const songs = el("ol", "songs");
  set.songs.forEach((song, index) => songs.append(renderSong(set, song, index)));
  box.append(songs);

  const add = el("button", "add-song", "+ Add song");
  add.onclick = () => openPicker({ set, song: null });
  box.append(add);
  box.append(el("p", "set-status", ""));
}

function renderSetListOnly() {
  const set = currentSet();
  const active = $("#set-list .active .set-name");
  if (active && set) active.textContent = set.name || "Untitled set";
}

function slotLabel(set, song) {
  let first = 1;
  for (const s of set.songs) {
    if (s === song) break;
    first += s.presets.length;
  }
  return first;
}

function renderSong(set, song, index) {
  const li = el("li", "song");
  li.dataset.id = song.id;

  const handle = el("span", "handle", "⋮⋮");
  handle.title = "Drag to reorder";
  handle.onmousedown = () => (li.draggable = true);
  li.ondragstart = (e) => {
    sets.drag = { kind: "song", id: song.id };
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", song.id);
    li.classList.add("dragging");
  };
  li.ondragend = () => { li.draggable = false; li.classList.remove("dragging"); clearDropMarks(); sets.drag = null; };
  li.ondragover = (e) => {
    if (sets.drag?.kind !== "song") return;
    e.preventDefault();
    const after = e.clientY > li.getBoundingClientRect().top + li.offsetHeight / 2;
    clearDropMarks();
    li.classList.add(after ? "drop-after" : "drop-before");
  };
  li.ondrop = (e) => {
    if (sets.drag?.kind !== "song") return;
    e.preventDefault();
    e.stopPropagation();
    const after = e.clientY > li.getBoundingClientRect().top + li.offsetHeight / 2;
    const moving = set.songs.find((s) => s.id === sets.drag.id);
    if (!moving || moving === song) return;
    set.songs.splice(set.songs.indexOf(moving), 1);
    set.songs.splice(set.songs.indexOf(song) + (after ? 1 : 0), 0, moving);
    saveSets();
    renderSets();
  };

  const num = el("span", "song-num", String(index + 1));
  const main = el("div", "song-main");
  const title = el("input", "song-title");
  title.value = song.title;
  title.placeholder = "Song title";
  title.spellcheck = false;
  title.oninput = () => { song.title = title.value; saveSets(); };

  const chips = el("div", "song-presets");
  const firstSlot = slotLabel(set, song);
  song.presets.forEach((preset, i) => chips.append(renderPresetChip(set, song, preset, i, firstSlot + i)));
  const addPreset = el("button", "chip-add", "+ Preset");
  addPreset.type = "button";
  addPreset.onclick = () => openPicker({ set, song });
  chips.append(addPreset);
  main.append(title, chips);

  const remove = el("button", "icon", "×");
  remove.type = "button";
  remove.title = "Remove song from set";
  remove.onclick = () => {
    set.songs = set.songs.filter((s) => s !== song);
    saveSets();
    renderSets();
  };
  li.append(handle, num, main, remove);
  return li;
}

function renderPresetChip(set, song, preset, index, position) {
  const chip = el("span", "preset-chip");
  chip.draggable = true;
  chip.title = `Position ${position} in the set. Drag to reorder within the song; click to open in the editor.`;
  const pos = el("span", "chip-pos", String(position));
  const name = el("button", "chip-name", preset.name);
  name.type = "button";
  name.onclick = () => { loadPreset(preset); hint(`Opened ${preset.name} from the set "${set.name}". Changes in the editor don't change the set.`); };
  const blocks = BLOCK_STATES.filter(([slot]) => preset.params[slot]).map(([, label]) => label).join(", ");
  if (blocks) name.title = blocks;
  const x = el("button", "chip-x", "×");
  x.type = "button";
  x.title = "Remove preset from song";
  x.onclick = () => { song.presets.splice(index, 1); saveSets(); renderSets(); };
  // The part's name in Stage view ("Verse", "Chorus"): a song's presets are its cues, in order.
  const label = el("input", "chip-label");
  label.value = preset.label || "";
  label.placeholder = "Part";
  label.maxLength = 20;
  label.spellcheck = false;
  label.title = "Name this part, e.g. Verse or Chorus. Stage view shows it.";
  label.draggable = false;
  label.oninput = () => { if (label.value.trim()) preset.label = label.value.trim(); else delete preset.label; saveSets(); };
  chip.append(pos, label, name, x);

  chip.ondragstart = (e) => {
    e.stopPropagation();
    sets.drag = { kind: "preset", song: song.id, index };
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", preset.name);
  };
  chip.ondragend = () => { clearDropMarks(); sets.drag = null; };
  chip.ondragover = (e) => {
    if (sets.drag?.kind !== "preset" || sets.drag.song !== song.id) return;
    e.preventDefault();
    e.stopPropagation();
    const after = e.clientX > chip.getBoundingClientRect().left + chip.offsetWidth / 2;
    clearDropMarks();
    chip.classList.add(after ? "drop-right" : "drop-left");
  };
  chip.ondrop = (e) => {
    if (sets.drag?.kind !== "preset" || sets.drag.song !== song.id) return;
    e.preventDefault();
    e.stopPropagation();
    const after = e.clientX > chip.getBoundingClientRect().left + chip.offsetWidth / 2;
    const [moving] = song.presets.splice(sets.drag.index, 1);
    let target = index + (after ? 1 : 0);
    if (sets.drag.index < target) target -= 1;
    song.presets.splice(target, 0, moving);
    saveSets();
    renderSets();
  };
  return chip;
}

function clearDropMarks() {
  document.querySelectorAll(".drop-before, .drop-after, .drop-left, .drop-right")
    .forEach((n) => n.classList.remove("drop-before", "drop-after", "drop-left", "drop-right"));
}

function newSet() {
  const set = { id: uid(), name: "New set", start: null, songs: [], updated: Date.now() };
  sets.list.unshift(set);
  sets.current = set.id;
  saveSets();
  renderSets();
  const title = $(".set-title");
  title.focus();
  title.select();
}

// ---------- preset picker ----------
async function openPicker(target) {
  sets.picker = { ...target, source: "pedal", presets: [] };
  $("#picker-title").textContent = target.song ? `Add presets to "${target.song.title || "song"}"` : "Add a song";
  $("#picker-search").value = "";
  if (!state.pedal) await loadPedal();
  sets.picker.presets = state.pedal.presets;
  $("#picker-source").textContent = state.pedal.synced
    ? `Presets on the pedal (${state.pedal.source === "pedal" ? "read" : "synced"} ${ago(state.pedal.synced)}).`
    : "No pedal list yet. Read the pedal on the On the pedal tab, or import from a file.";
  renderPicker();
  $("#picker").showModal();
  $("#picker-search").focus();
}

function renderPicker() {
  const q = $("#picker-search").value.trim().toUpperCase();
  const list = $("#picker-list");
  list.innerHTML = "";
  for (const p of sets.picker.presets) {
    if (q && !p.name.includes(q) && String(p.slot) !== q) continue;
    const li = el("li");
    li.append(el("span", "slot", p.slot ? String(p.slot) : "file"));
    li.append(el("span", "pname", p.name));
    const chips = el("span", "chips");
    BLOCK_STATES.filter(([slot]) => p.params[slot]).forEach(([slot, label, block]) => {
      const chip = el("span", `chip${p.params[slot] === 2 ? " hit" : ""}`, label);
      chip.dataset.block = block;
      chips.append(chip);
    });
    li.append(chips);
    const add = el("button", "ghost", "Add");
    add.type = "button";
    add.onclick = () => {
      addToSet(p);
      add.textContent = "Added";
      add.disabled = true;
    };
    li.append(add);
    list.append(li);
  }
}

function addToSet(p) {
  const { set } = sets.picker;
  const copy = { name: p.name, tags: p.tags, params: [...p.params], from: p.slot ? `pedal ${p.slot}` : sets.picker.file };
  if (!sets.picker.song) {
    const title = p.name.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
    sets.picker.song = { id: uid(), title, presets: [] };
    set.songs.push(sets.picker.song);
    $("#picker-title").textContent = `Add presets to "${title}"`;
  }
  sets.picker.song.presets.push(copy);
  saveSets();
  renderSets();
}

$("#picker-search").oninput = renderPicker;
$("#picker-import").onclick = () => $("#picker-file").click();
$("#picker-file").onchange = async (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  const data = await (await fetch("/api/syx", { method: "POST", body: await file.arrayBuffer() })).json();
  if (!data.ok) return ($("#picker-source").textContent = `${file.name}: ${data.message}`);
  sets.picker.presets = data.presets.map(({ number, ...p }) => p);
  sets.picker.file = file.name;
  $("#picker-source").textContent = `Presets in ${file.name}.`;
  renderPicker();
};

// ---------- load onto pedal ----------
// batch = { name, presets } loads presets from a file (Files > Import presets > Save all) instead of the current set.
function openLoadDialog(batch = null) {
  sets.batch = batch;
  const set = batch ? null : currentSet();
  const n = loadPresets().length;
  $("#load-title").textContent = batch ? `Save all ${n} presets from "${batch.name}" to the pedal`
    : `Load "${set.name || "Untitled set"}" onto the pedal`;
  $("#load-start").max = state.pedal?.capacity || 500;
  // A file's presets have no home yet: leave the number blank and ask for it.
  $("#load-start").value = batch ? "" : set.start || 1;
  $("#load-result").textContent = "";
  $("#load-cancel").textContent = "Cancel";
  $("#load-dialog").showModal();
  if (batch) $("#load-start").focus();
  planLoad();
}
const loadPresets = () => (sets.batch ? sets.batch.presets : allPresets(currentSet()));

let planCheck = 0;
async function planLoad() {
  const presets = loadPresets();
  if (sets.batch && !$("#load-start").value) {
    $("#load-plan").innerHTML = "";
    $("#load-go").disabled = true;
    $("#load-summary").textContent = `Which preset number should the first one go to? They fill ${presets.length} presets in a row from there.`;
    return;
  }
  const start = +$("#load-start").value;
  const check = ++planCheck;
  const go = $("#load-go");
  go.disabled = true;
  $("#load-plan").innerHTML = "";
  const capacity = state.pedal?.capacity || 500;
  if (!Number.isInteger(start) || start < 1 || start + presets.length - 1 > capacity) {
    $("#load-summary").textContent = `${sets.batch ? "These presets need" : "This set needs"} ${presets.length} slots, so it has to start between 1 and ${capacity - presets.length + 1}.`;
    return;
  }
  $("#load-summary").textContent = `Checking presets ${start}–${start + presets.length - 1} on the pedal…`;
  await new Promise((r) => setTimeout(r, 250));
  if (check !== planCheck) return;
  const data = await api("/api/pedal/range", { start, count: presets.length });
  if (check !== planCheck) return;
  if (!data.ok) return ($("#load-summary").textContent = data.message);

  // Compare names the way the pedal stores them, as the server does when it decides what to write.
  const same = (a, b) => a && a.name === pedalName(b.name) && a.tags === b.tags && a.params.every((v, i) => v === b.params[i]);
  const rows = presets.map((p, i) => ({ slot: start + i, now: data.presets[i], next: p }));
  const replaced = rows.filter((r) => r.now && !same(r.now, r.next)).length;
  const matching = rows.filter((r) => same(r.now, r.next)).length;
  const empty = rows.filter((r) => !r.now).length;
  sets.plan = { start, presets, rows };

  const table = $("#load-plan");
  const headRow = el("tr");
  ["Preset", "On the pedal now", "Becomes"].forEach((h) => headRow.append(el("th", null, h)));
  table.append(headRow);
  for (const r of rows) {
    const tr = el("tr", !r.now ? "is-empty" : same(r.now, r.next) ? "is-same" : "is-replace");
    tr.append(el("td", "slot", String(r.slot)));
    tr.append(el("td", null, r.now ? r.now.name : "empty"));
    tr.append(el("td", null, same(r.now, r.next) ? `${pedalName(r.next.name)} (already there)` : pedalName(r.next.name)));
    table.append(tr);
  }
  const parts = [];
  if (replaced) parts.push(`${replaced} preset${replaced === 1 ? "" : "s"} will be replaced and backed up first`);
  if (empty) parts.push(`${empty} empty slot${empty === 1 ? "" : "s"} will be used`);
  if (matching) parts.push(`${matching} already match`);
  $("#load-summary").textContent = parts.join(" · ") + ".";
  go.disabled = replaced + empty === 0;
  go.textContent = replaced + empty === 0 ? "Already on the pedal" : `Load ${replaced + empty} preset${replaced + empty === 1 ? "" : "s"} onto pedal`;
}

$("#load-start").oninput = planLoad;
$("#load-start").addEventListener("keydown", (e) => { if (e.key === "Enter") e.preventDefault(); });
// Escape would hide the dialog while presets are still being written; keep it open until the load finishes.
$("#load-dialog").addEventListener("cancel", (e) => { if (sets.loading) e.preventDefault(); });
$("#load-go").onclick = async () => {
  const batch = sets.batch;
  const set = batch ? null : currentSet();
  const { start, presets } = sets.plan;
  const go = $("#load-go");
  go.disabled = true;
  sets.loading = true;
  $("#load-start").disabled = true;
  $("#load-cancel").disabled = true;
  go.textContent = "Loading…";
  $("#load-result").textContent = `Writing and checking each preset. About ${Math.max(1, Math.round(presets.length * 0.2))} s. Keep the pedal connected.`;
  const data = await api("/api/sets/load", { set_name: batch ? batch.name : set.name, start, presets });
  sets.loading = false;
  $("#load-start").disabled = false;
  $("#load-cancel").disabled = false;
  $("#load-cancel").textContent = "Close";
  if (data.ok) {
    if (set) {
      set.start = start;
      saveSets();
    }
    const backup = data.backups ? ` Replaced presets are backed up in backups/${data.backups.replace(/^backups\//, "")}.` : "";
    $("#load-result").textContent = `Done: presets ${start}–${start + presets.length - 1} now hold ${batch ? "these presets" : "this set"}.${backup}`;
  } else {
    const backup = data.backups ? ` Presets it replaced are backed up in backups/${data.backups.replace(/^backups\//, "")}.` : "";
    $("#load-result").textContent = data.message + backup;
  }
  state.pedal = null;
  await loadPedal();
  if (!batch) renderSets();
  await planLoad();
};
$("#load-dialog").addEventListener("close", () => { sets.batch = null; });

$("#set-new").onclick = newSet;


// --- printable set list -----------------------------------------------------------------------------------------
// One page for the mic stand: every song in order, each part with the preset number the pedal shows once the set
// is loaded. The numbers come from where the set was last loaded; if the pedal (as last read) no longer holds the
// set there, the sheet says so instead of printing numbers that would be wrong on stage.

async function printSetList(set) {
  await loadPedal();  // the pedal list as last read; no pedal needed
  const start = set.start || null;
  const onPedal = new Map((state.pedal?.presets || []).map((p) => [p.slot, p.name]));
  const sheet = $("#print-sheet");
  sheet.innerHTML = "";
  const head = el("header", "ps-head");
  head.append(el("h1", null, set.name || "Untitled set"));
  const total = allPresets(set).length;
  let note;
  if (!start) {
    note = "Not loaded onto the pedal yet: the numbers below are the running order, not preset numbers.";
  } else {
    const wrong = allPresets(set).map((p, i) => ({ p, slot: start + i }))
      .filter(({ p, slot }) => onPedal.size && onPedal.get(slot) !== pedalName(p.name));
    note = wrong.length
      ? `Check before the gig: the pedal no longer holds this set at preset ${wrong[0].slot}. Load the set again, then reprint.`
      : `Presets ${start}–${start + total - 1} on the pedal. Up footswitch = next part.`;
  }
  head.append(el("p", "ps-note", note));
  sheet.append(head);

  const list = el("ol", "ps-songs");
  let pos = 0;
  set.songs.forEach((song) => {
    const li = el("li", "ps-song");
    const first = (start || 1) + pos;
    const last = first + song.presets.length - 1;
    li.append(el("span", "ps-range", song.presets.length > 1 ? `${first}–${last}` : String(first)));
    const body = el("div", "ps-body");
    body.append(el("span", "ps-title", song.title || "Untitled song"));
    const parts = el("ul", "ps-parts");
    song.presets.forEach((preset, i) => {
      const fx = BLOCK_STATES.filter(([slot]) => preset.params[slot])
        .map(([slot, label]) => (preset.params[slot] === 2 ? `${label} on HIT` : label));
      const row = el("li");
      row.append(el("b", null, String(first + i)));
      row.append(el("span", "ps-part", [preset.label, preset.name].filter(Boolean).join(" · ")));
      row.append(el("span", "ps-fx", fx.length ? fx.join(", ") : "dry"));
      parts.append(row);
    });
    body.append(parts);
    li.append(body);
    list.append(li);
    pos += song.presets.length;
  });
  sheet.append(list);
  sheet.append(el("p", "ps-foot", `Printed ${new Date().toLocaleDateString([], { dateStyle: "medium" })}`));
  window.print();
}
