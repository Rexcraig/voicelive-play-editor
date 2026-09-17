// Setup tab: the pedal's whole-pedal settings (its own Setup button, pages 1-7).
// Values are read from the pedal; every change is written straight away and the pedal's read-back is shown.

const setup = { values: null, queue: Promise.resolve(), pending: 0 };

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
    page.fields.forEach((f) => body.append(setupRow(f)));
    card.append(body);
    root.append(card);
  });
}

function setupRow(f) {
  const v = setup.values[f.index];
  const row = document.createElement("div");
  row.className = "row";
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
    input.onchange = () => setupChange(f.index, +input.value);  // on release: one write per drag
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
  el.innerHTML = "<strong></strong><p></p>";
  el.querySelector("strong").textContent = title;
  el.querySelector("p").textContent = text;
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

function infoButton(title, text) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "info";
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
