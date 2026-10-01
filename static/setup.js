// Setup tab: the pedal's whole-pedal settings (its own Setup button, pages 1-7).
// Values are read from the pedal; every change is written straight away and the pedal's read-back is shown.

const setup = { values: null, queue: Promise.resolve(), pending: 0, tried: false };

async function openSetupTab(force = false) {
  if (setup.values && !force) return;
  setupMsg("Reading the pedal's setup…");
  const data = await api("/api/setup");
  if (!data.ok) return setupMsg(data.message);
  setup.values = data.values;
  setupMsg("");
  renderSetup();
}

function setupMsg(text) {
  const el = $("#setup-msg");
  el.textContent = text;
  el.hidden = !text;
}

// A dependent setting does nothing unless its switch is set to Custom.
function setupInactive(index) {
  const v = setup.values;
  if ([40, 41, 42].includes(index)) return v[37] === 0;
  if ([44, 45, 46, 47].includes(index)) return v[48] === 0;
  if (index === 9) return v[28] === 2;
  return false;
}

function renderSetup() {
  const root = $("#setup-pages");
  root.innerHTML = "";
  state.spec.setup.forEach((page, n) => {
    const card = document.createElement("section");
    card.className = "card setup-card";
    card.dataset.block = "global";
    card.innerHTML = `<div class="card-head"><div class="card-title"><span class="led"></span><h2></h2>`
      + `<span class="page" title="Page ${n + 1} of the pedal's Setup menu">${n + 1}/8</span></div><p></p></div>`;
    card.querySelector("h2").textContent = page.title;
    card.querySelector("p").textContent = page.help;
    const body = document.createElement("div");
    body.className = "card-body";
    page.fields.forEach((f) => {
      body.append(setupRow(f));
      if (f.note) body.append(el("p", "row-note", f.note));
    });
    card.append(body);
    root.append(card);
  });
  renderGlobals();
}

function setupRow(f) {
  const v = setup.values[f.index];
  const row = document.createElement("div");
  row.className = "row";
  row.dataset.index = f.index;
  row.classList.toggle("inactive", setupInactive(f.index));
  const label = document.createElement("label");
  label.textContent = f.label;
  if (f.help) label.append(infoButton(f.label, f.help));
  row.append(label);

  if (f.kind === "choice") {
    const sel = document.createElement("select");
    sel.id = `setup-${f.index}`;
    label.htmlFor = sel.id;
    f.options.forEach((name, i) => {
      const o = document.createElement("option");
      o.value = i;
      o.textContent = name;
      if (f.index === 9 && i === 7) o.disabled = true;  // set by RoomSense: Voice, not chosen directly
      sel.append(o);
    });
    sel.value = v;
    sel.disabled = f.index === 9 && v === 7;
    if (sel.disabled) sel.title = "RoomSense is set to Voice. Change RoomSense to pick a mic.";
    sel.onchange = () => setupChange(f.index, +sel.value);
    const pickable = f.options.map((_, i) => i).filter((i) => !(f.index === 9 && i === 7));
    const step = (dir, glyph) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "step";
      b.textContent = glyph;
      b.disabled = sel.disabled;
      b.setAttribute("aria-label", `${dir < 0 ? "Previous" : "Next"} ${f.label.toLowerCase()}`);
      b.onclick = () => {
        const at = Math.max(0, pickable.indexOf(+sel.value));
        setupChange(f.index, pickable[(at + dir + pickable.length) % pickable.length]);
      };
      return b;
    };
    const stepper = document.createElement("div");
    stepper.className = "stepper";
    stepper.append(step(-1, "‹"), sel, step(1, "›"));
    row.append(stepper);
  } else if (f.kind === "onoff") {
    const seg = document.createElement("div");
    seg.className = "seg two";
    seg.style.setProperty("--i", v ? 1 : 0);
    f.options.forEach((name, i) => {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = name;
      b.setAttribute("aria-pressed", String(v === i));
      b.onclick = () => { if (setup.values[f.index] !== i) setupChange(f.index, i); };
      seg.append(b);
    });
    row.append(seg);
  } else if (f.kind === "percent" || f.kind === "locut") {
    const wrap = document.createElement("div");
    wrap.className = "slider";
    const input = document.createElement("input");
    input.type = "range";
    input.id = `setup-${f.index}`;
    label.htmlFor = input.id;
    input.min = f.min;
    input.max = f.max;
    input.value = v;
    const out = document.createElement("span");
    out.className = "value";
    const show = () => {
      const x = +input.value;
      out.textContent = f.kind === "locut" ? `${Math.round(20 * 2 ** (x / 24))} Hz` : f.index === 8 && x === 0 ? "off" : `${x} %`;
      fill(input);
    };
    show();
    input.oninput = show;
    if (f.index === 8) {
      input.dataset.mirror = 8;
      input.oninput = () => mirrorPitch(+input.value);
    }
    input.onchange = () => setupChange(f.index, +input.value);  // on release: one write per drag
    typeable(out, input, (t) => {
      if (f.kind !== "locut") return typedNumber(t, f.index === 8 ? 0 : null);
      const hz = typedNumber(t);  // typed in Hz; the pedal stores 1/24-octave steps from 20 Hz
      return hz > 0 ? 24 * Math.log2(hz / 20) : null;
    });
    wrap.append(input, out);
    row.append(wrap);
  } else {  // step / hz2: range not measured on the unit, so +/-1 and let the pedal's read-back decide
    const out = document.createElement("output");
    out.className = "readout";
    out.textContent = f.kind === "hz2" ? `${(v / 2).toFixed(1)} Hz` : `${v}${f.unit ? ` ${f.unit}` : ""}`;
    const step = (dir, glyph) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "step";
      b.textContent = glyph;
      b.setAttribute("aria-label", `${dir < 0 ? "Lower" : "Raise"} ${f.label.toLowerCase()}`);
      b.onclick = () => setupChange(f.index, setup.values[f.index] + dir);
      return b;
    };
    const stepper = document.createElement("div");
    stepper.className = "stepper";
    stepper.append(step(-1, "‹"), out, step(1, "›"));
    row.append(stepper);
  }
  return row;
}

// Writes go one at a time; the screen shows the value at once, then whatever the pedal actually kept.
function setupChange(index, value) {
  setup.values[index] = value;
  renderSetup();
  setup.pending++;
  setup.queue = setup.queue.then(async () => {
    const data = await api("/api/setup", { index, value });
    setup.pending--;
    blinkTx(data.ok);
    if (data.values) setup.values = data.values;
    setupMsg(data.ok ? "" : data.message);
    if (!setup.pending) renderSetup();
  });
}

// A small "i" by each setting: hover, focus or tap for a short explanation. The first one waits a moment;
// while the panel is open the next one is instant, so reading down a page stays quick.
const tip = { el: null, timer: null, open: null, lastClosed: 0 };

function tipEl() {
  if (!tip.el) {
    tip.el = document.createElement("div");
    tip.el.className = "tip";
    tip.el.id = "setting-tip";
    tip.el.hidden = true;
    document.body.append(tip.el);
  }
  return tip.el;
}

function showTip(button, title, text) {
  const el = tipEl();
  el.innerHTML = "<strong></strong>";
  el.querySelector("strong").textContent = title;
  text.split("\n\n").forEach((part) => {
    const p = document.createElement("p");
    p.textContent = part;
    el.append(p);
  });
  el.hidden = false;
  const r = button.getBoundingClientRect();
  const width = Math.min(320, innerWidth - 24);
  el.style.width = `${width}px`;
  const left = Math.min(Math.max(12, r.left - width / 2 + r.width / 2), innerWidth - width - 12);
  const below = r.bottom + 8 + el.offsetHeight < innerHeight;
  el.style.left = `${left}px`;
  el.style.top = `${below ? r.bottom + 8 : Math.max(12, r.top - 8 - el.offsetHeight)}px`;
  button.setAttribute("aria-expanded", "true");
  tip.open = button;
}

function hideTip() {
  clearTimeout(tip.timer);
  if (tip.open) tip.open.setAttribute("aria-expanded", "false");
  if (tip.el) tip.el.hidden = true;
  if (tip.open) tip.lastClosed = Date.now();
  tip.open = null;
}

function infoButton(title, text, unconfirmed = false) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = unconfirmed ? "info unconfirmed" : "info";
  b.textContent = "i";
  b.setAttribute("aria-label", `What ${title} does`);
  b.setAttribute("aria-expanded", "false");
  b.setAttribute("aria-controls", "setting-tip");
  const open = () => showTip(b, title, text);
  b.onmouseenter = () => {
    clearTimeout(tip.timer);
    const instant = tip.open || Date.now() - tip.lastClosed < 800;
    tip.timer = setTimeout(open, instant ? 0 : 350);
  };
  b.onmouseleave = () => { clearTimeout(tip.timer); if (tip.open === b) hideTip(); };
  b.onfocus = open;
  b.onblur = () => { if (tip.open === b) hideTip(); };
  b.onclick = (e) => { e.preventDefault(); tip.open === b ? hideTip() : open(); };
  return b;
}

addEventListener("keydown", (e) => { if (e.key === "Escape") hideTip(); });
addEventListener("scroll", hideTip, true);
addEventListener("pointerdown", (e) => { if (tip.open && !e.target.closest(".info")) hideTip(); });

$("#setup-refresh").onclick = () => openSetupTab(true);

// Setup settings that change the sound of every preset, shown on the Editor so a sound the effect cards
// don't explain has a visible cause (09-18: Pitch Correction at 65 % was heard as doubling with every effect off).
function globalSound(v) {
  const on = [];
  if (v[8] > 0) on.push([8, `Pitch Correction ${v[8]} %`]);
  if (v[30] > 0) on.push([30, `Tone Style ${setupField(30).options[v[30]]}`]);
  if (v[28] === 2) on.push([28, "RoomSense Voice"]);
  if (v[19] === 1) on.push([19, "Lead Mute On"]);
  return on;
}

const setupField = (index) => state.spec.setup.flatMap((p) => p.fields).find((f) => f.index === index);

// Opens the Setup tab at one setting and lights its row for a moment.
function goToSetting(index) {
  showTab("setup");
  openSetupTab().then(() => {
    const row = document.querySelector(`#setup-pages .row[data-index="${index}"]`);
    if (!row) return;
    row.scrollIntoView({ block: "center", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    row.classList.remove("flash");
    void row.offsetWidth;  // restart the animation
    row.classList.add("flash");
  });
}

function settingLink(index, text) {
  const b = el("button", "link", text);
  b.type = "button";
  b.title = "Open this setting on the Setup tab";
  b.onclick = () => goToSetting(index);
  return b;
}

// The line under the HardTune card and the line under all the cards. Both say "unknown" rather than guess
// when the Setup block hasn't been read.
function renderGlobals() {
  const v = setup.values;
  const note = document.querySelector('.card[data-block="hardtune"] .global-note');
  if (note) renderPitchPanel(note, v);
  const line = $("#globals");
  line.innerHTML = "";
  if (!v) {
    line.hidden = !state.connected || !setup.tried;
    line.append("Settings that change every preset: unknown, the pedal's Setup hasn't been read. ", readLink());
    return;
  }
  const on = globalSound(v);
  line.hidden = !on.length;
  line.append(el("span", "led"), "Also on for every preset, from Setup: ");
  // Each item keeps its separator, so a wrapped line never starts with a dot.
  on.forEach(([index, text], i) => {
    const item = el("span", "item");
    item.append(settingLink(index, text), ...(i < on.length - 1 ? [" ·"] : []));
    line.append(item);
  });
}

// Setup's Pitch Correction, repeated under HardTune. Drawn in the Setup colour with its own legend because,
// unlike everything else on the card, it is kept on the pedal the moment it's let go and applies to every preset.
function renderPitchPanel(note, v) {
  const existing = note.querySelector("#global-8");
  if (v && existing) {  // update in place, so the slider keeps focus after a change
    existing.disabled = !state.connected;
    return mirrorPitch(v[8]);
  }
  note.innerHTML = "";
  note.classList.toggle("lit", !!(v && v[8] > 0));
  const head = el("div", "global-head");
  head.append(el("span", "led"), el("span", "global-legend", "Global"), settingLink(8, "Setup › Input"));
  note.append(head);
  if (!v) {
    note.append(el("p", "global-caption", setup.tried ? "Pitch Correction: unknown, the pedal's Setup hasn't been read. " : "Reading the pedal…"));
    if (setup.tried) note.lastChild.append(readLink());
    return;
  }
  const f = setupField(8);
  const row = el("div", "row");
  const label = el("label", null, f.label);
  label.htmlFor = "global-8";
  label.append(infoButton(f.label, f.help));
  const wrap = el("div", "slider");
  const input = el("input");
  Object.assign(input, { type: "range", id: "global-8", min: f.min, max: f.max, value: v[8] });
  input.dataset.mirror = 8;
  input.disabled = !state.connected;
  const out = el("span", "value");
  wrap.append(input, out);
  row.append(label, wrap);
  note.append(row, el("p", "global-caption", "Kept on the pedal as soon as you let go, for every preset. Save to pedal doesn't store it."));
  input.oninput = () => mirrorPitch(+input.value);
  input.onchange = () => setupChange(8, +input.value);
  typeable(out, input, (t) => typedNumber(t, 0));
  mirrorPitch(v[8]);
}

// Both Pitch Correction sliders (Setup tab and HardTune card) follow each other while one is dragged.
function mirrorPitch(x) {
  document.querySelectorAll('input[data-mirror="8"]').forEach((input) => {
    input.value = x;
    fill(input);
    input.nextElementSibling.textContent = x === 0 ? "off" : `${x} %`;
  });
  document.querySelector(".global-note")?.classList.toggle("lit", x > 0);
}

function readLink() {
  const b = el("button", "link", "Read pedal");
  b.type = "button";
  b.onclick = () => refreshSetup();
  return b;
}

// Reads the Setup block again. Called when the pedal connects, the window comes back into focus and the
// Editor tab opens, because the pedal sends nothing when its own Setup menu is used.
function refreshSetup() {
  if (!state.connected || setup.pending) return;
  setup.queue = setup.queue.then(async () => {
    if (setup.pending) return;
    const data = await api("/api/setup");
    setup.tried = true;
    if (!data.ok || setup.pending) return renderGlobals();
    const changed = JSON.stringify(data.values) !== JSON.stringify(setup.values);
    setup.values = data.values;
    if (changed) renderSetup();
  });
}

addEventListener("focus", refreshSetup);

// "Set up my rig": a few questions about how the pedal is plugged in, then the settings that follow from
// the answers, each with its reason. Asking only reads the pedal; nothing is written until "Apply".
const rig = { answers: {}, plan: [], busy: false };

const rigQuestions = () => state.spec.rig.filter((q) => Object.entries(q.when || {}).every(([k, v]) => v.includes(rig.answers[k])));

function openRig() {
  rig.answers = {};
  rig.plan = [];
  $("#rig-result").textContent = "";
  $("#rig-cancel").textContent = "Cancel";
  $("#rig-plan-wrap").hidden = true;
  renderRig();
  $("#rig-dialog").showModal();
}

function renderRig() {
  const root = $("#rig-questions");
  root.innerHTML = "";
  rigQuestions().forEach((q) => {
    const block = el("fieldset", "rig-q");
    const legend = el("legend", null, q.question);
    if (q.note) legend.append(el("span", "rig-note", q.note));
    block.append(legend);
    const opts = el("div", "rig-opts");
    q.options.forEach((o) => {
      const label = el("label", "rig-opt");
      const input = el("input");
      input.type = "radio";
      input.name = `rig-${q.id}`;
      input.setAttribute("aria-label", o.label);
      input.checked = rig.answers[q.id] === o.id;
      input.onchange = () => answerRig(q.id, o.id);
      const text = el("span", "rig-opt-text");
      text.append(el("strong", null, o.label));
      if (o.note) text.append(el("span", "rig-note", o.note));
      label.append(input, text);
      opts.append(label);
    });
    block.append(opts);
    root.append(block);
  });
}

async function answerRig(id, value) {
  rig.answers[id] = value;
  // A different mic can add or remove later questions, so redraw before asking the pedal what would change.
  renderRig();
  $("#rig-result").textContent = "";
  const asked = rigQuestions();
  if (asked.some((q) => !rig.answers[q.id])) {
    $("#rig-plan-wrap").hidden = true;
    $("#rig-go").disabled = true;
    $("#rig-summary").textContent = "";
    return;
  }
  $("#rig-summary").textContent = "Reading the pedal…";
  $("#rig-plan-wrap").hidden = false;
  const answers = Object.fromEntries(asked.map((q) => [q.id, rig.answers[q.id]]));
  const data = await api("/api/setup/rig", { answers });
  if (!data.ok) {
    $("#rig-summary").textContent = data.message;
    return;
  }
  if (data.values) setup.values = data.values;
  rig.plan = data.plan;
  renderRigPlan();
}

function renderRigPlan() {
  const table = $("#rig-plan");
  table.innerHTML = "";
  const head = el("tr");
  ["", "Setting", "Now", "Becomes", "Why"].forEach((h) => head.append(el("th", null, h)));
  table.append(head);
  rig.plan.forEach((row, i) => {
    const tr = el("tr");
    const tick = el("td", "tick");
    const box = el("input");
    box.type = "checkbox";
    box.checked = row.keep !== false;
    box.id = `rig-row-${i}`;
    box.setAttribute("aria-label", `Change ${row.label}`);
    box.onchange = () => { row.keep = box.checked; updateRigButton(); };
    tick.append(box);
    tr.append(tick);
    const name = el("td", "name");
    const label = el("label", null, row.label);
    label.htmlFor = box.id;
    name.append(label);
    tr.append(name, el("td", "was", row.from), el("td", "now", row.to), el("td", "why", row.reason));
    table.append(tr);
  });
  const n = rig.plan.length;
  $("#rig-summary").textContent = n
    ? `${n} setting${n === 1 ? "" : "s"} would change. Everything else on the pedal is already right for this rig.`
    : "Nothing to change: the pedal is already set up that way.";
  $("#rig-plan-wrap").hidden = false;
  $("#rig-untick").hidden = !n;
  updateRigButton();
}

function updateRigButton() {
  const picked = rig.plan.filter((r) => r.keep !== false).length;
  const go = $("#rig-go");
  go.disabled = !picked || rig.busy;
  go.textContent = picked ? `Apply ${picked} change${picked === 1 ? "" : "s"}` : "Nothing to apply";
}

$("#rig-open").onclick = () => { if (setup.values) openRig(); else openSetupTab().then(() => setup.values && openRig()); };
$("#rig-dialog").addEventListener("cancel", (e) => { if (rig.busy) e.preventDefault(); });
$("#rig-go").onclick = async () => {
  const chosen = rig.plan.filter((r) => r.keep !== false);
  if (!chosen.length) return;
  rig.busy = true;
  updateRigButton();
  $("#rig-cancel").disabled = true;
  $("#rig-result").textContent = "Sending to the pedal…";
  const asked = rigQuestions();
  const data = await api("/api/setup/rig", {
    answers: Object.fromEntries(asked.map((q) => [q.id, rig.answers[q.id]])),
    apply: true,
    changes: Object.fromEntries(chosen.map((r) => [r.index, r.value])),
  });
  rig.busy = false;
  $("#rig-cancel").disabled = false;
  $("#rig-cancel").textContent = "Close";
  blinkTx(data.ok);
  if (data.values) {
    setup.values = data.values;
    renderSetup();
  }
  const sent = chosen.length;
  rig.plan = data.plan || [];
  renderRigPlan();
  const left = rig.plan.length;  // whatever is still different: the rows left unticked
  $("#rig-result").textContent = data.ok
    ? `Done: ${sent} setting${sent === 1 ? "" : "s"} changed on the pedal.`
      + (left ? " What's still listed is what you left unticked; tick and apply it whenever you like." : "")
    : data.message;
};
