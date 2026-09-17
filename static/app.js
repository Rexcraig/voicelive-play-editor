const state = { values: {}, spec: null, timer: null };
const $ = (sel) => document.querySelector(sel);

const fmt = {
  db: (v) => (v <= -51 ? "off" : `${v} dB`),
  range: (v) => `${v}`,
};

async function boot() {
  state.spec = await (await fetch("/api/spec")).json();
  state.spec.params.forEach((p) => (state.values[p.slot] = state.spec.defaults[p.slot]));
  // Start with everything off so the pedal reflects exactly what's on screen.
  state.spec.params.filter((p) => p.kind === "state").forEach((p) => (state.values[p.slot] = 0));
  const nameInput = $("#preset-name");
  nameInput.maxLength = state.spec.name_length;
  nameInput.addEventListener("input", () => {
    const allowed = new Set(state.spec.name_chars);
    const pos = nameInput.selectionStart;
    nameInput.value = [...nameInput.value.toUpperCase()].map((c) => (allowed.has(c) ? c : " ")).join("").slice(0, state.spec.name_length);
    nameInput.setSelectionRange(pos, pos);
  });
  nameInput.addEventListener("change", () => { nameInput.value = nameInput.value.trimEnd(); });
  render();
  poll();
  setInterval(poll, 4000);
}

function render() {
  const main = $("#blocks");
  main.innerHTML = "";
  for (const block of state.spec.blocks) {
    const params = state.spec.params.filter((p) => p.block === block.id);
    const stateParam = params.find((p) => p.kind === "state");
    const card = document.createElement("section");
    card.className = "card";
    card.dataset.block = block.id;

    const head = document.createElement("div");
    head.className = "card-head";
    head.innerHTML = `<div class="card-title"><h2>${block.title}</h2></div><p>${block.help}</p>`;
    if (stateParam) head.querySelector(".card-title").append(segmented(stateParam, card));
    card.append(head);

    const body = document.createElement("div");
    body.className = "card-body";
    for (const p of params.filter((x) => x.kind !== "state")) body.append(control(p));
    card.append(body);
    main.append(card);
    paint(card, stateParam ? state.values[stateParam.slot] : 1);
  }

  const globals = state.spec.params.filter((p) => p.block === "global");
  if (globals.length) {
    const card = document.createElement("section");
    card.className = "card on";
    card.innerHTML = `<div class="card-head"><div class="card-title"><h2>Song</h2></div>
      <p>Tempo is used by delay styles that follow the beat.</p></div>`;
    const body = document.createElement("div");
    body.className = "card-body";
    globals.forEach((p) => body.append(control(p)));
    card.append(body);
    $("#blocks").append(card);
  }
}

function segmented(param, card) {
  const seg = document.createElement("div");
  seg.className = "seg";
  [["Off", 0], ["On", 1], ["HIT", 2]].forEach(([label, value]) => {
    const b = document.createElement("button");
    b.textContent = label;
    b.dataset.value = value;
    b.setAttribute("aria-pressed", String(state.values[param.slot] === value));
    b.onclick = () => {
      state.values[param.slot] = value;
      seg.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", String(+x.dataset.value === value)));
      paint(card, value);
      push();
    };
    seg.append(b);
  });
  return seg;
}

function paint(card, value) {
  card.classList.toggle("off", value === 0);
  card.classList.toggle("on", value === 1);
  card.classList.toggle("hit", value === 2);
}

function control(p) {
  const row = document.createElement("div");
  row.className = "row";
  const label = document.createElement("label");
  label.textContent = p.label;
  row.append(label);

  if (p.kind === "choice") {
    const sel = document.createElement("select");
    p.options.forEach((name, i) => {
      const o = document.createElement("option");
      o.value = i;
      o.textContent = name;
      sel.append(o);
    });
    sel.value = state.values[p.slot];
    sel.onchange = () => { state.values[p.slot] = +sel.value; push(); };
    row.append(sel);
  } else {
    const wrap = document.createElement("div");
    wrap.className = "slider";
    const input = document.createElement("input");
    input.type = "range";
    input.min = p.min; input.max = p.max;
    input.value = state.values[p.slot];
    const out = document.createElement("span");
    out.className = "value";
    out.textContent = fmt[p.kind === "db" ? "db" : "range"](+input.value);
    input.oninput = () => {
      state.values[p.slot] = +input.value;
      out.textContent = fmt[p.kind === "db" ? "db" : "range"](+input.value);
      push();
    };
    wrap.append(input, out);
    row.append(wrap);
  }
  if (!p.confirmed) label.insertAdjacentHTML("beforeend", '<span class="guess" title="Name inferred, not yet verified on the pedal">?</span>');
  return row;
}

function push() {
  clearTimeout(state.timer);
  state.timer = setTimeout(send, 120);
}

// Every call to the editor's server goes through here, so a dropped connection or a bad reply
// becomes a message on screen instead of a button stuck on "Saving…".
async function api(path, body) {
  try {
    const res = await fetch(path, body === undefined ? {} : { method: "POST", body: JSON.stringify(body) });
    return await res.json();
  } catch {
    return { ok: false, message: "The editor lost contact with its server. Check that the Terminal window is still open, then try again." };
  }
}

// The name exactly as the pedal will store it (same rule as tch.pedal_name, measured on the unit).
function pedalName(name, fallback = "UNTITLED") {
  const allowed = new Set(state.spec.name_chars);
  const cleaned = [...(name || "").toUpperCase().slice(0, state.spec.name_length)].map((c) => (allowed.has(c) ? c : " ")).join("").trimEnd();
  return cleaned || fallback;
}

async function send() {
  const data = await api("/api/send", { name: $("#preset-name").value, values: state.values, tags: state.tags });
  if (!data.ok) hint(data.message, "live");
  else if (state.hintSource === "live") hint("");  // clear only our own old error, never a save result
}

function hint(text, source = "action") {
  $("#hint").textContent = text;
  state.hintSource = source;
}

async function poll() {
  try {
    const { connected } = await (await fetch("/api/status")).json();
    state.connected = connected;
    const el = $("#status");
    el.className = "status " + (connected ? "ok" : "bad");
    $("#status-text").textContent = connected ? "Pedal connected" : "Pedal not found";
  } catch { /* server restarting */ }
}

const BLOCK_STATES = [[33, "Harmony"], [34, "Double"], [32, "Reverb"], [31, "Delay"], [30, "µMod"], [36, "HardTune"], [35, "Transducer"]];

function showTab(name) {
  document.querySelectorAll(".tabs button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === name)));
  $("#blocks").hidden = name !== "editor";
  $("footer").hidden = name !== "editor";
  $("#pedal").hidden = name !== "pedal";
  $("#sets").hidden = name !== "sets";
  if (name === "sets") openSetsTab();
  if (name === "pedal" && !state.pedalOpened) {
    state.pedalOpened = true;
    loadPedal().then(() => { if (state.connected) readPedal(); });
  }
}

async function readPedal() {
  const btn = $("#sync-refresh");
  if (btn.disabled) return;
  btn.disabled = true;
  btn.textContent = "Reading… about 10 s";
  try {
    const data = await api("/api/pedal/read", {});
    if (data.ok) await loadPedal();
    else $("#sync-detail").textContent = data.message;
  } finally {
    btn.disabled = false;
    btn.textContent = "Read pedal";
  }
}

async function loadPedal() {
  const data = await api("/api/pedal");
  if (data.ok === false) return hint(data.message);
  state.pedal = data;
  const p = state.pedal;
  $("#pedal-source").innerHTML = p.synced
    ? `${p.presets.length} presets and <span class="empty-count">${p.capacity - p.presets.length} empty slots</span>.` : "";
  const when = p.synced && `${new Date(p.synced).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })} (${ago(p.synced)})`;
  $("#sync-title").textContent = !p.synced ? "Nothing read from the pedal yet"
    : p.source === "pedal" ? `Read from the pedal: ${when}` : `From VoiceSupport's last sync: ${when}`;
  $("#sync-detail").textContent = p.synced
    ? "Presets stored with the pedal's own Store button after this won't show until you read the pedal again. Saves from this editor show straight away."
    : "Connect the pedal and press Read pedal.";
  $("#sync-notice").hidden = false;
  $("#sync-notice").classList.toggle("old", !p.synced || Date.now() - p.synced > 24 * 3600e3);
  renderPedal();
}

function ago(ms) {
  const min = Math.round((Date.now() - ms) / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} hour${h === 1 ? "" : "s"} ago`;
  const d = Math.round(h / 24);
  return `${d} day${d === 1 ? "" : "s"} ago`;
}

function renderPedal() {
  const q = $("#pedal-search").value.trim().toUpperCase();
  const list = $("#pedal-list");
  list.innerHTML = "";
  for (const p of state.pedal.presets) {
    if (q && !p.name.includes(q) && String(p.slot) !== q) continue;
    const li = document.createElement("li");
    const chips = BLOCK_STATES.filter(([slot]) => p.params[slot])
      .map(([slot, label]) => `<span class="chip${p.params[slot] === 2 ? " hit" : ""}">${label}${p.params[slot] === 2 ? " · HIT" : ""}</span>`).join("");
    const edited = p.saved ? `<span class="chip edited" title="Saved from this editor after the list was last read">saved here</span>` : "";
    li.innerHTML = `<span class="slot">${p.slot}</span><span class="pname"></span><span class="chips">${chips}${edited}</span>`;
    li.querySelector(".pname").textContent = p.name;
    const open = document.createElement("button");
    open.className = "ghost";
    open.textContent = "Open in editor";
    open.onclick = () => {
      loadPreset(p, p.slot);
    };
    li.append(open);
    list.append(li);
  }
}

function loadPreset(p, slot) {
  p.params.forEach((v, i) => (state.values[i] = v));
  state.tags = p.tags;
  state.slot = slot || null;
  $("#preset-name").value = p.name;
  render();
  showTab("editor");
  push();
}

async function openSyx(file) {
  if (!file) return;
  const res = await fetch("/api/syx", { method: "POST", body: await file.arrayBuffer() });
  const data = await res.json();
  if (!data.ok) return hint(`${file.name}: ${data.message}`);
  if (data.presets.length === 1) {
    loadPreset(data.presets[0]);
    return hint(`Imported ${data.presets[0].name} from ${file.name}.`);
  }
  $("#pick-title").textContent = `${file.name} has ${data.presets.length} presets`;
  const list = $("#pick-list");
  list.innerHTML = "";
  data.presets.forEach((p) => {
    const li = document.createElement("li");
    const b = document.createElement("button");
    b.value = "cancel";
    b.textContent = p.name;
    b.onclick = () => { loadPreset(p); hint(`Imported ${p.name} from ${file.name}.`); };
    li.append(b);
    list.append(li);
  });
  $("#pick-dialog").showModal();
}

$("#open").onclick = () => { $("#files-menu").open = false; $("#open-file").click(); };
document.addEventListener("click", (e) => { if (!$("#files-menu").contains(e.target)) $("#files-menu").open = false; });
$("#open-file").onchange = (e) => { openSyx(e.target.files[0]); e.target.value = ""; };
let dragDepth = 0;
window.addEventListener("dragenter", (e) => { if (e.dataTransfer.types.includes("Files")) { dragDepth++; $("#drop-hint").hidden = false; } });
window.addEventListener("dragleave", () => { if (--dragDepth <= 0) { dragDepth = 0; $("#drop-hint").hidden = true; } });
window.addEventListener("dragover", (e) => e.preventDefault());
window.addEventListener("drop", (e) => {
  e.preventDefault();
  dragDepth = 0;
  $("#drop-hint").hidden = true;
  openSyx(e.dataTransfer.files[0]);
});

async function openSave() {
  if (!state.pedal) await loadPedal();
  const input = $("#save-slot");
  input.max = state.pedal.capacity;
  const empty = firstEmpty();
  $("#save-empty").hidden = !empty;
  $("#save-empty").textContent = `Use the first empty slot (${empty})`;
  input.value = state.slot || "";
  checkSlot();
  $("#save-dialog").showModal();
  input.select();
}

function firstEmpty() {
  const used = new Set(state.pedal.presets.map((p) => p.slot));
  for (let slot = 1; slot <= state.pedal.capacity; slot++) if (!used.has(slot)) return slot;
  return null;
}

let slotCheck = 0;
async function checkSlot() {
  describeSlot();
  const slot = +$("#save-slot").value;
  const check = ++slotCheck;
  if (!state.connected || !Number.isInteger(slot) || slot < 1 || slot > state.pedal.capacity) return;
  $("#save-confirm").disabled = true;
  await new Promise((r) => setTimeout(r, 250));
  if (check !== slotCheck) return;
  const data = await api(`/api/pedal/slot/${slot}`);
  if (check !== slotCheck) return;
  if (data.ok) {
    state.pedal.presets = state.pedal.presets.filter((p) => p.slot !== slot);
    if (data.preset) state.pedal.presets.push(data.preset);
    state.pedal.presets.sort((a, b) => a.slot - b.slot);
    describeSlot({ live: true });
  } else describeSlot();
}

function describeSlot({ live = false } = {}) {
  const slot = +$("#save-slot").value;
  const current = state.pedal.presets.find((p) => p.slot === slot);
  const asOf = live ? " on the pedal" : current?.saved ? ` (as of your save from this editor ${ago(current.saved)})`
    : state.pedal.synced ? ` (as of the list from ${ago(state.pedal.synced)})` : "";
  const newName = $("#preset-name").value.toUpperCase() || "EDITOR";
  const valid = Number.isInteger(slot) && slot >= 1 && slot <= state.pedal.capacity;
  $("#save-current").textContent = !$("#save-slot").value ? ""
    : !valid ? `The pedal's presets are numbered 1 to ${state.pedal.capacity}.`
    : current ? `Preset ${slot}${asOf} is currently ${current.name}. It will become ${newName}.`
    : `Preset ${slot}${asOf} is empty. ${newName} will be saved there.`;
  $("#save-warn").hidden = !current;
  $("#save-confirm").textContent = current ? "Replace preset" : "Save preset";
  $("#save-confirm").disabled = !valid;
}

$("#save").onclick = openSave;
$("#save-slot").oninput = checkSlot;
$("#save-slot").addEventListener("keydown", (e) => {
  if (e.key !== "Enter") return;
  e.preventDefault();  // the form's first button is Cancel, so Enter would otherwise cancel
  if (!$("#save-confirm").disabled) $("#save-confirm").click();
});
$("#save-empty").onclick = () => { $("#save-slot").value = firstEmpty(); checkSlot(); };
$("#save-confirm").onclick = async (e) => {
  e.preventDefault();
  if ($("#save-confirm").disabled) return;
  const slot = +$("#save-slot").value;
  $("#save-dialog").close();
  hint(`Saving to preset ${slot}…`);
  const data = await api("/api/save", { name: $("#preset-name").value, values: state.values, tags: state.tags, slot });
  hint(data.message);
  if (data.ok) state.slot = slot;
  await loadPedal();
};

document.querySelectorAll(".tabs button").forEach((b) => (b.onclick = () => showTab(b.dataset.tab)));
$("#pedal-search").oninput = renderPedal;
$("#sync-refresh").onclick = readPedal;
$("#export").onclick = () => {
  $("#files-menu").open = false;
  const form = document.createElement("form");
  form.method = "POST";
  form.action = "/api/export";
  document.body.append(form);
  fetch("/api/export", {
    method: "POST",
    body: JSON.stringify({ name: $("#preset-name").value, values: state.values, tags: state.tags, slot: state.slot || 0 }),
  }).then((r) => r.blob()).then((blob) => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = ($("#preset-name").value || "preset").replace(/\s+/g, " ").trim() + ".syx";
    a.click();
  });
  form.remove();
};

boot();
