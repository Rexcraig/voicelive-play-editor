const state = { values: {}, spec: null, timer: null };
const $ = (sel) => document.querySelector(sel);

const fmt = {
  // The bottom of a level's range is Off on the box. Doubling's bottom (-36) hasn't been checked on the unit yet.
  db: (v, p) => (v <= p.min && p.slot !== 6 ? "off" : `${v} dB`),
  range: (v) => `${v}`,
};

// Click a slider's readout window to type the value instead of dragging. `parse` turns what was typed into the
// slider's own number (null = not understood); the slider's oninput/onchange then run as if it had been dragged
// there, so typing plays on the pedal (and, for Setup, writes) exactly like a drag does.
function typeable(out, slider, parse) {
  out.tabIndex = 0;
  out.classList.add("typeable");
  out.title = "Click to type a value";
  out.setAttribute("role", "button");
  const edit = () => {
    if (slider.disabled || out.querySelector("input")) return;
    const box = document.createElement("input");
    box.className = "value-edit";
    box.value = out.textContent;
    box.setAttribute("aria-label", "Type a value, then press Enter");
    let done = false;
    const finish = (commit) => {
      if (done) return;
      done = true;
      const v = commit ? parse(box.value.trim().toLowerCase()) : null;
      box.remove();
      if (v == null || Number.isNaN(v)) return;
      const clamped = Math.min(+slider.max, Math.max(+slider.min, Math.round(v)));
      if (clamped === +slider.value) return;
      slider.value = clamped;
      slider.oninput?.();
      slider.onchange?.();
    };
    box.onkeydown = (e) => {
      if (e.key === "Enter") { e.preventDefault(); finish(true); out.focus(); }
      if (e.key === "Escape") { e.preventDefault(); finish(false); out.focus(); }
    };
    box.onblur = () => finish(true);
    out.append(box);
    box.focus();
    box.select();
  };
  out.onclick = edit;
  out.onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); edit(); } };
}

// The number in what was typed: "-12 dB" -> -12, "1.5" -> 1.5; "off" -> the given value.
const typedNumber = (text, off = null) => (/^of/.test(text) ? off : parseFloat(text.replace(/[^0-9.+-]/g, "")));

async function boot() {
  // Draw only once every script on the page has run: render() uses infoButton() from setup.js, and with the files
  // already cached the loader below can finish before the later scripts have executed (seen 09-30: no effect cards).
  if (document.readyState === "loading") await new Promise((r) => document.addEventListener("DOMContentLoaded", r, { once: true }));
  // The browser-only build has no server: it sets vlpTransport, and every call below goes there instead.
  if (globalThis.vlpReady) await globalThis.vlpReady;
  state.spec = await api("/api/spec");
  $("#version").textContent = `v${state.spec.version}`;
  document.title = `VoiceLive Play Editor v${state.spec.version}`;
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
  showWhere();
  poll();
  setInterval(poll, 4000);
}

// Effect pages in the order the pedal's own screen numbers them, so card 3 is page 3 on the box.
const PEDAL_PAGES = ["umod", "delay", "reverb", "harmony", "double", "hardtune", "megaphone"];

function render() {
  const main = $("#blocks");
  main.innerHTML = "";
  const page = (b) => PEDAL_PAGES.indexOf(b.id) + 1 || 99;
  const blocks = [...state.spec.blocks].sort((a, b) => page(a) - page(b));
  $("#leds").innerHTML = blocks.map((b) => `<i data-block="${b.id}"></i>`).join("");
  for (const block of blocks) {
    const params = state.spec.params.filter((p) => p.block === block.id);
    const stateParam = params.find((p) => p.kind === "state");
    const card = document.createElement("section");
    card.className = "card";
    card.dataset.block = block.id;

    const head = document.createElement("div");
    head.className = "card-head";
    head.innerHTML = `<div class="card-title"><span class="led"></span><h2>${block.title}</h2>`
      + (page(block) < 99 ? `<span class="page" title="Page ${page(block)} on the pedal">P${page(block)}</span>` : "")
      + `</div><p>${block.help}</p>`;
    if (stateParam) head.querySelector(".card-title").append(segmented(stateParam, card));
    card.append(head);

    const body = document.createElement("div");
    body.className = "card-body";
    for (const p of params.filter((x) => x.kind !== "state")) body.append(control(p));
    card.append(body);
    // Pitch Correction on the Setup menu works like HardTune on every preset, so it is shown with it,
    // outside the card body so it stays readable when HardTune is Off.
    if (block.id === "hardtune") card.append(Object.assign(document.createElement("div"), { className: "global-note" }));
    main.append(card);
    paint(card, stateParam ? state.values[stateParam.slot] : 1);
  }
  renderGlobals();

  // Song-wide settings (tempo) live in the top bar, next to the preset name.
  const song = $("#song");
  song.innerHTML = "";
  state.spec.params.filter((p) => p.block === "global").forEach((p) => {
    const row = control(p);
    row.title = "Used by delay styles that follow the beat.";
    song.append(row);
  });
}

function segmented(param, card) {
  const seg = document.createElement("div");
  seg.className = "seg";
  seg.style.setProperty("--i", state.values[param.slot]);
  [["Off", 0], ["On", 1], ["HIT", 2]].forEach(([label, value]) => {
    const b = document.createElement("button");
    b.textContent = label;
    b.dataset.value = value;
    b.setAttribute("aria-pressed", String(state.values[param.slot] === value));
    b.onclick = () => {
      state.values[param.slot] = value;
      seg.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", String(+x.dataset.value === value)));
      seg.style.setProperty("--i", value);
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
  const led = $(`#leds [data-block="${card.dataset.block}"]`);
  if (led) {
    led.classList.toggle("on", value === 1);
    led.classList.toggle("hit", value === 2);
  }
}

// Paint the track between zero (or the left end) and the thumb.
function fill(input) {
  const min = +input.min, max = +input.max, v = +input.value;
  const pct = (x) => `${((x - min) / (max - min)) * 100}%`;
  const zero = min < 0 && max > 0 ? 0 : min;
  input.style.setProperty("--from", pct(Math.min(zero, v)));
  input.style.setProperty("--to", pct(Math.max(zero, v)));
}

function control(p) {
  const row = document.createElement("div");
  row.className = "row";
  const label = document.createElement("label");
  label.textContent = p.label;
  if (p.help) {
    const note = "This setting's name is our best reading. The pedal's own screen doesn't show it, so it isn't confirmed.";
    label.append(infoButton(p.label, p.confirmed ? p.help : `${p.help}\n\n${note}`, !p.confirmed));
  }
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
    sel.id = `p${p.slot}`;
    label.htmlFor = sel.id;
    sel.onchange = () => { state.values[p.slot] = +sel.value; push(); };
    const step = (dir, glyph) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "step";
      b.textContent = glyph;
      b.setAttribute("aria-label", `${dir < 0 ? "Previous" : "Next"} ${p.label.toLowerCase()}`);
      b.onclick = () => {
        const n = p.options.length;
        sel.value = (+sel.value + dir + n) % n;
        sel.onchange();
      };
      return b;
    };
    const stepper = document.createElement("div");
    stepper.className = "stepper";
    stepper.append(step(-1, "‹"), sel, step(1, "›"));
    row.append(stepper);
  } else {
    const wrap = document.createElement("div");
    wrap.className = "slider";
    const input = document.createElement("input");
    input.type = "range";
    input.min = p.min; input.max = p.max;
    input.value = state.values[p.slot];
    const out = document.createElement("span");
    out.className = "value";
    out.textContent = fmt[p.kind === "db" ? "db" : "range"](+input.value, p);
    fill(input);
    input.oninput = () => {
      state.values[p.slot] = +input.value;
      fill(input);
      out.textContent = fmt[p.kind === "db" ? "db" : "range"](+input.value, p);
      push();
    };
    typeable(out, input, (t) => typedNumber(t, p.kind === "db" ? p.min : null));
    wrap.append(input, out);
    row.append(wrap);
  }
  return row;
}

// The pedal has one playing spot, owned by the preset number it's on. Anything the editor plays that isn't
// that stored preset shows on the pedal's screen with its own name under the pedal's current number, which
// looks broken if nobody says so (the singer, 09-25). This line always says where the sound lives.
function showWhere() {
  const el = $("#where");
  const n = state.slot;
  let text, title;
  if (n && state.onPedal && !state.dirty) {
    text = `Preset ${n} on the pedal`;
    title = "The pedal is on this preset, and nothing has been changed.";
  } else if (n && state.onPedal) {
    text = `Preset ${n} · changed, not saved`;
    title = "You hear the changes now. Save to pedal keeps them; switching presets on the pedal throws them away.";
  } else if (n && !state.playing) {
    text = `Preset ${n} · not playing on the pedal`;
    title = "Connect the pedal to hear it. Nothing on the pedal has changed.";
  } else if (n) {
    text = `Preset ${n} · playing over the pedal's current preset`;
    title = `The pedal's screen shows this name under whatever number it's on; that's normal. To see ${n} there, step to it with the footswitch. Nothing is saved or lost.`;
  } else if (!state.playing) {
    text = "Not on the pedal yet";
    title = "Change anything and you'll hear it on the pedal straight away. Save to pedal gives it its own number.";
  } else {
    text = "Not on the pedal yet · playing over its current preset";
    title = "The pedal's screen shows this name under whatever number it's on; that's normal, and nothing on the pedal has changed. Save to pedal gives it its own number.";
  }
  el.textContent = text;
  el.title = title;
  el.classList.toggle("unsaved", !(n && state.onPedal && !state.dirty));
}

// Changes made in the editor live only in this tab (and the pedal's edit buffer, which the editor can't read back),
// so leaving or refreshing the page with unsaved changes asks first. The browser shows its own wording.
window.addEventListener("beforeunload", (e) => {
  if (!state.dirty) return;
  e.preventDefault();
  e.returnValue = "";
});

function push() {
  state.dirty = true;
  showWhere();
  clearTimeout(state.timer);
  state.timer = setTimeout(send, 120);
}

// Every call to the editor's server goes through here, so a dropped connection or a bad reply
// becomes a message on screen instead of a button stuck on "Saving…".
async function api(path, body) {
  try {
    if (globalThis.vlpTransport) return await globalThis.vlpTransport(path, body);
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

// A name for a copy: "TREAT ME RIGHT" -> "TREAT ME RIGHT 2", counting up past any copy already on the
// pedal, and trimming the front part when the number won't fit in the pedal's 15 characters.
function copyName(base) {
  const limit = state.spec.name_length;
  const stem = pedalName(base).replace(/ \d+$/, "").trimEnd() || "PRESET";
  const taken = new Set((state.pedal?.presets || []).map((p) => pedalName(p.name)));
  for (let n = 2; n < 100; n++) {
    const tail = ` ${n}`;
    const name = pedalName(stem.slice(0, limit - tail.length).trimEnd() + tail);
    if (!taken.has(name)) return name;
  }
  return pedalName(stem);
}

async function send() {
  const data = await api("/api/send", { name: $("#preset-name").value, values: state.values, tags: state.tags });
  blinkTx(data.ok);
  state.playing = data.ok;  // only true once the pedal actually has it
  showWhere();
  if (!data.ok) hint(data.message, "live");
  else if (state.hintSource === "live") hint("");  // clear only our own old error, never a save result
}

// The top bar's "Sent" light: blinks when a change reached the pedal, stays red when one didn't.
function blinkTx(ok) {
  const tx = $("#tx");
  tx.classList.remove("blink");
  tx.classList.toggle("err", !ok);
  if (ok) {
    void tx.offsetWidth;  // restart the blink
    tx.classList.add("blink");
  }
}

function hint(text, source = "action") {
  $("#hint").textContent = text;
  state.hintSource = source;
}

async function poll() {
  try {
    const { connected } = await api("/api/status");
    const wasConnected = state.connected;
    state.connected = connected;
    if (connected && !wasConnected) refreshSetup();
    if (connected !== wasConnected) renderGlobals();
    const el = $("#status");
    el.className = "status " + (connected ? "ok" : "bad");
    $("#status-text").textContent = connected ? "Pedal connected" : "Pedal not found";
  } catch { /* server restarting */ }
}

const BLOCK_STATES = [[33, "Harmony", "harmony"], [34, "Double", "double"], [32, "Reverb", "reverb"], [31, "Delay", "delay"],
  [30, "µMod", "umod"], [36, "HardTune", "hardtune"], [35, "Transducer", "megaphone"]];

function showTab(name) {
  document.querySelectorAll(".tabs button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === name)));
  $("#blocks").hidden = name !== "editor";
  $("footer").hidden = name !== "editor";
  $("#pedal").hidden = name !== "pedal";
  $("#sets").hidden = name !== "sets";
  $("#community").hidden = name !== "community";
  if (name === "community") openCommunityTab();
  $("#setup").hidden = name !== "setup";
  if (name === "sets") openSetsTab();
  if (name === "setup") openSetupTab();
  if (name === "editor") refreshSetup();
  if (name === "pedal" && !state.pedalOpened) {
    state.pedalOpened = true;
    loadPedal().then(() => { if (state.connected) readPedal(); });
  }
}

// One read at a time: a second caller (the automatic read, Read pedal, Save snapshot) waits for the one running.
function readPedal() {
  state.reading ||= readPedalOnce().finally(() => { state.reading = null; });
  return state.reading;
}

async function readPedalOnce() {
  const btn = $("#sync-refresh");
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

const genresOf = (tags) => (state.spec.genres || []).filter((_, bit) => (tags >> bit) & 1);

function renderGenreFilter() {
  const box = $("#genre-filter");
  const counts = new Map();
  for (const p of state.pedal.presets) for (const g of genresOf(p.tags || 0)) counts.set(g, (counts.get(g) || 0) + 1);
  if (state.genre && !counts.has(state.genre)) state.genre = null;
  box.hidden = !counts.size;
  box.innerHTML = "";
  for (const g of [null, ...state.spec.genres.filter((x) => counts.has(x))]) {
    const b = document.createElement("button");
    b.className = "genre" + (state.genre === g ? " on" : "");
    b.setAttribute("aria-pressed", state.genre === g);
    b.textContent = g ? `${g} ${counts.get(g)}` : `All ${state.pedal.presets.length}`;
    b.onclick = () => { state.genre = g; renderPedal(); };
    box.append(b);
  }
}

function renderPedal() {
  renderGenreFilter();
  const q = $("#pedal-search").value.trim().toUpperCase();
  const list = $("#pedal-list");
  list.innerHTML = "";
  const shown = state.pedal.presets.filter((p) => (!q || p.name.includes(q) || String(p.slot) === q)
    && (!state.genre || genresOf(p.tags || 0).includes(state.genre)));
  const note = $("#pedal-filtered");
  const what = [state.genre, q && `"${$("#pedal-search").value.trim()}"`].filter(Boolean).join(" and ");
  note.hidden = !what;
  if (what) {
    note.textContent = `Showing ${shown.length} of ${state.pedal.presets.length}, matching ${what}. `;
    const clear = document.createElement("button");
    clear.className = "link";
    clear.textContent = "Show all";
    clear.onclick = () => { $("#pedal-search").value = ""; state.genre = null; renderPedal(); };
    note.append(clear);
  }
  for (const p of shown) {
    const li = document.createElement("li");
    const chips = BLOCK_STATES.filter(([slot]) => p.params[slot])
      .map(([slot, label, block]) => `<span class="chip${p.params[slot] === 2 ? " hit" : ""}" data-block="${block}">${label}${p.params[slot] === 2 ? " · HIT" : ""}</span>`).join("");
    const edited = p.saved ? `<span class="chip edited" title="Saved from this editor after the list was last read">saved here</span>` : "";
    li.innerHTML = `<span class="slot">${p.slot}</span><span class="pname"><span class="pn"></span><span class="genres"></span></span><span class="chips">${chips}${edited}</span>`;
    const genres = genresOf(p.tags || 0);
    li.querySelector(".pn").textContent = p.name;
    li.querySelector(".genres").textContent = genres.filter((g) => g !== "Favorite").join(" · ");
    if (genres.includes("Favorite")) li.querySelector(".pn").insertAdjacentHTML("beforeend", ` <span class="fav" title="Favorite (FAV on the pedal)">FAV</span>`);
    const open = document.createElement("button");
    open.className = "ghost";
    open.textContent = "Open in editor";
    open.onclick = async () => {
      // Switch the pedal itself to this preset, so its screen shows the same number and name. If it doesn't
      // follow, fall back to playing it in the edit buffer, which keeps the pedal's current number.
      const res = state.connected ? await api("/api/pedal/select", { slot: p.slot }) : { switched: false };
      loadPreset(p, p.slot, { play: !res.switched });
    };
    const copy = document.createElement("button");
    copy.className = "ghost";
    copy.textContent = "Duplicate";
    copy.title = "Open a copy of this preset, to change and save somewhere else";
    copy.onclick = () => {
      loadPreset({ ...p, name: copyName(p.name) }, null);  // no slot: the copy isn't on the pedal yet
      openSave({ prefillEmpty: true });
    };
    const actions = document.createElement("div");
    actions.className = "pedal-actions";
    actions.append(open, copy);
    li.append(actions);
    list.append(li);
  }
}

function loadPreset(p, slot, { play = true } = {}) {
  p.params.forEach((v, i) => (state.values[i] = v));
  state.tags = p.tags;
  state.slot = slot || null;
  state.onPedal = !play;  // true only when the pedal itself switched to this stored preset
  state.suggestSlot = null;
  $("#preset-name").value = p.name;
  render();
  showTab("editor");
  if (play) push();  // not needed when the pedal has just switched to this very preset
  state.dirty = false;
  showWhere();
}

async function openSyx(file) {
  if (!file) return;
  const bytes = new Uint8Array(await file.arrayBuffer());
  const data = globalThis.vlpTransport
    ? await globalThis.vlpTransport("/api/syx", bytes)
    : await (await fetch("/api/syx", { method: "POST", body: bytes })).json();
  if (!data.ok) return hint(`${file.name}: ${data.message}`);
  if (data.presets.length === 1) {
    importPreset(data.presets[0], file.name);
    return;
  }
  $("#pick-title").textContent = `${file.name} has ${data.presets.length} presets`;
  pick.presets = data.presets;
  pick.file = file.name;
  pick.genre = null;
  $("#pick-search").value = "";
  renderPick();
  $("#pick-dialog").showModal();
}

const pick = { presets: [], file: "", genre: null };

// A .syx preset remembers the slot it was saved from (a snapshot holds every preset under its own number), so that
// number is offered in the Save dialog. A pack's numbers are only positions in the pack and are never offered.
const slotOf = (p) => (!p.pack && p.number >= 1 && p.number <= 500 ? p.number : null);

function importPreset(p, file) {
  loadPreset(p, null);
  state.suggestSlot = slotOf(p);
  hint(`Imported ${p.name} from ${file}.${state.suggestSlot ? ` It was preset ${state.suggestSlot}; Save to pedal offers that number.` : ""}`);
}

function renderPick() {
  const q = $("#pick-search").value.trim().toUpperCase();
  const counts = new Map();
  for (const p of pick.presets) for (const g of genresOf(p.tags || 0)) counts.set(g, (counts.get(g) || 0) + 1);
  const box = $("#pick-genres");
  box.hidden = !counts.size;
  box.innerHTML = "";
  for (const g of [null, ...state.spec.genres.filter((x) => counts.has(x))]) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "genre" + (pick.genre === g ? " on" : "");
    b.setAttribute("aria-pressed", pick.genre === g);
    b.textContent = g ? `${g} ${counts.get(g)}` : `All ${pick.presets.length}`;
    b.onclick = () => { pick.genre = g; renderPick(); };
    box.append(b);
  }
  const list = $("#pick-list");
  list.innerHTML = "";
  for (const p of pick.presets) {
    const genres = genresOf(p.tags || 0);
    if (q && !p.name.toUpperCase().includes(q)) continue;
    if (pick.genre && !genres.includes(pick.genre)) continue;
    const li = document.createElement("li");
    const b = document.createElement("button");
    b.value = "cancel";
    b.innerHTML = `<span class="slotno"></span><span class="pn"></span><span class="genres"></span>`;
    b.querySelector(".slotno").textContent = slotOf(p) ? String(slotOf(p)) : "";
    b.querySelector(".pn").textContent = p.name;
    b.querySelector(".genres").textContent = genres.filter((g) => g !== "Favorite").join(" · ");
    b.onclick = () => importPreset(p, pick.file);
    li.append(b);
    list.append(li);
  }
  if (!list.children.length) list.innerHTML = `<li class="none">No presets match.</li>`;
}
$("#pick-search").oninput = renderPick;

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

async function openSave({ prefillEmpty = false } = {}) {
  if (!state.pedal) await loadPedal();
  const input = $("#save-slot");
  input.max = state.pedal.capacity;
  // With no picture of the pedal (the browser build starts with none), "first empty" would be slot 1,
  // which on this pedal holds a real preset. Offer it only when the list is known.
  const empty = state.pedal.synced ? firstEmpty() : null;
  $("#save-empty").hidden = !empty;
  $("#save-empty").textContent = `Use the first empty slot (${empty})`;
  input.value = state.slot || state.suggestSlot || (prefillEmpty ? empty || "" : "");
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

$("#save").onclick = () => openSave();
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
  if (data.ok) {
    state.slot = slot;
    state.dirty = false;
    // Move the pedal onto the preset just saved, so its screen agrees. If the pedal won't switch, the
    // where-line says it's saved but still playing over the pedal's current number.
    state.onPedal = !!(await api("/api/pedal/select", { slot })).switched;
    showWhere();
  }
  await loadPedal();
};

document.querySelectorAll(".tabs button").forEach((b) => (b.onclick = () => showTab(b.dataset.tab)));
$("#pedal-search").oninput = renderPedal;
$("#sync-refresh").onclick = readPedal;
const exportBytes = (payload) => globalThis.vlpTransport
  ? globalThis.vlpTransport("/api/export", payload).then((bytes) => new Blob([bytes]))
  : fetch("/api/export", { method: "POST", body: JSON.stringify(payload) }).then((r) => r.blob());

function download(blob, filename) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

$("#export").onclick = async () => {
  $("#files-menu").open = false;
  const payload = { name: $("#preset-name").value, values: state.values, tags: state.tags, slot: state.slot || 0 };
  download(await exportBytes(payload), ($("#preset-name").value || "preset").replace(/\s+/g, " ").trim() + ".syx");
};

// Every preset on the pedal in one .syx, each under its own slot number, read fresh first. Opening the file with
// Files > Import presets lists them all; Save to pedal puts any one back.
$("#snapshot").onclick = async () => {
  const say = (text) => { $("#sync-detail").textContent = text; };
  const btn = $("#snapshot");
  if (!state.connected) return say("Connect the pedal first: a snapshot is read fresh from the pedal.");
  btn.disabled = true;
  btn.textContent = "Reading the pedal…";
  const started = Date.now();
  try {
    await readPedal();
    if (!state.pedal.synced || state.pedal.synced < started - 30e3) return say("The pedal couldn't be read, so no snapshot was saved.");
    btn.textContent = "Saving…";
    const parts = [];
    for (const p of state.pedal.presets) {
      parts.push(await exportBytes({ name: p.name, values: Object.fromEntries(p.params.map((v, i) => [i, v])), tags: p.tags, slot: p.slot }));
    }
    const d = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    download(new Blob(parts), `VoiceLive Play snapshot ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}${pad(d.getMinutes())}.syx`);
    say(`Downloaded a snapshot of all ${parts.length} presets on the pedal. To bring one back: Files › Import presets, pick it, then Save to pedal.`);
  } finally {
    btn.disabled = false;
    btn.textContent = "Save snapshot";
  }
};

boot();
