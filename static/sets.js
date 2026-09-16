// Sets: named, ordered song lists. Each song holds one or more presets (full copies, so a set survives pedal changes).
// "Load onto pedal" writes the set's presets, in order, into consecutive slots.

const sets = { list: [], current: null, loaded: false, saveTimer: null, picker: null, plan: null, drag: null };
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
    sets.list = (await (await fetch("/api/sets")).json()).sets;
    sets.current = sets.list[0]?.id || null;
    sets.loaded = true;
  }
  renderSets();
}

function currentSet() { return sets.list.find((s) => s.id === sets.current); }

function saveSets() {
  const set = currentSet();
  if (set) set.updated = Date.now();
  clearTimeout(sets.saveTimer);
  sets.saveTimer = setTimeout(() => fetch("/api/sets", { method: "POST", body: JSON.stringify({ sets: sets.list }) }), 300);
}

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
    saveSets();
    fetch("/api/sets", { method: "POST", body: JSON.stringify({ sets: sets.list }) });
    renderSets();
  };
  const load = el("button", "primary", "Load onto pedal");
  load.disabled = !n;
  load.onclick = openLoadDialog;
  actions.append(del, load);
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
  chip.append(pos, name, x);

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
    BLOCK_STATES.filter(([slot]) => p.params[slot]).forEach(([slot, label]) =>
      chips.append(el("span", `chip${p.params[slot] === 2 ? " hit" : ""}`, label)));
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
function openLoadDialog() {
  const set = currentSet();
  const n = allPresets(set).length;
  $("#load-title").textContent = `Load "${set.name || "Untitled set"}" onto the pedal`;
  $("#load-start").max = state.pedal?.capacity || 500;
  $("#load-start").value = set.start || 1;
  $("#load-result").textContent = "";
  $("#load-cancel").textContent = "Cancel";
  $("#load-dialog").showModal();
  planLoad();
}

let planCheck = 0;
async function planLoad() {
  const set = currentSet();
  const presets = allPresets(set);
  const start = +$("#load-start").value;
  const check = ++planCheck;
  const go = $("#load-go");
  go.disabled = true;
  $("#load-plan").innerHTML = "";
  const capacity = state.pedal?.capacity || 500;
  if (!Number.isInteger(start) || start < 1 || start + presets.length - 1 > capacity) {
    $("#load-summary").textContent = `This set needs ${presets.length} slots, so it has to start between 1 and ${capacity - presets.length + 1}.`;
    return;
  }
  $("#load-summary").textContent = `Checking presets ${start}–${start + presets.length - 1} on the pedal…`;
  await new Promise((r) => setTimeout(r, 250));
  if (check !== planCheck) return;
  const data = await (await fetch("/api/pedal/range", { method: "POST", body: JSON.stringify({ start, count: presets.length }) })).json();
  if (check !== planCheck) return;
  if (!data.ok) return ($("#load-summary").textContent = data.message);

  const same = (a, b) => a && a.name === b.name && a.tags === b.tags && a.params.every((v, i) => v === b.params[i]);
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
    tr.append(el("td", null, same(r.now, r.next) ? `${r.next.name} (already there)` : r.next.name));
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
$("#load-go").onclick = async () => {
  const set = currentSet();
  const { start, presets } = sets.plan;
  const go = $("#load-go");
  go.disabled = true;
  $("#load-start").disabled = true;
  go.textContent = "Loading…";
  $("#load-result").textContent = `Writing and checking each preset. About ${Math.max(1, Math.round(presets.length * 0.2))} s.`;
  let data;
  try {
    data = await (await fetch("/api/sets/load", { method: "POST", body: JSON.stringify({ set_name: set.name, start, presets }) })).json();
  } finally {
    $("#load-start").disabled = false;
  }
  if (data.ok) {
    set.start = start;
    saveSets();
    const backup = data.backups ? ` Replaced presets are backed up in backups/${data.backups}.` : "";
    $("#load-result").textContent = `Done: presets ${start}–${start + presets.length - 1} now hold this set.${backup}`;
    $("#load-cancel").textContent = "Close";
  } else {
    $("#load-result").textContent = data.message;
  }
  state.pedal = null;
  await loadPedal();
  renderSets();
  await planLoad();
};

$("#set-new").onclick = newSet;
