// Community: presets other singers shared, stored by the Worker (web/worker/index.js). The tab and the Share
// button only appear once the Worker says Community is switched on, so the desktop build never shows them.
//
// Presets arrive from other people, so everything they wrote (name, description, singer) goes on the page with
// textContent, never as HTML. Trying one plays it in the pedal's edit buffer; nothing is saved unless the singer
// uses Save a copy, which goes through the normal save dialog and its backup.

const community = { presets: [], me: { admin: false, name: "" }, genre: null, loaded: false };

async function initCommunity() {
  const status = await api("/api/community/status");
  if (!status || !status.enabled) return;
  $("#community-tab").hidden = false;
  $("#share-open").hidden = false;
}

async function openCommunityTab(force = false) {
  if (community.loaded && !force) return renderCommunity();
  $("#community-count").textContent = "Loading…";
  const data = await api("/api/community/list");
  if (!data.ok) {
    $("#community-count").textContent = data.message;
    return;
  }
  community.presets = data.presets;
  community.me = data.me;
  community.loaded = true;
  renderCommunity();
}

function renderCommunity() {
  const q = $("#community-search").value.trim().toLowerCase();
  const all = community.presets;
  const visible = all.filter((p) => !p.hidden || p.mine || community.me.admin);

  const counts = new Map();
  for (const p of visible) for (const g of genresOf(p.tags)) if (g !== "Favorite") counts.set(g, (counts.get(g) || 0) + 1);
  const mine = visible.filter((p) => p.mine).length;
  if (community.genre && community.genre !== "Mine" && !counts.has(community.genre)) community.genre = null;
  const box = $("#community-genres");
  box.innerHTML = "";
  const filters = [null, ...(mine ? ["Mine"] : []), ...state.spec.genres.filter((g) => counts.has(g))];
  for (const g of filters) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "genre" + (community.genre === g ? " on" : "");
    b.setAttribute("aria-pressed", community.genre === g);
    b.textContent = g === null ? `All ${visible.length}` : g === "Mine" ? `Shared by me ${mine}` : `${g} ${counts.get(g)}`;
    b.onclick = () => { community.genre = g; renderCommunity(); };
    box.append(b);
  }

  const shown = visible.filter((p) => {
    if (community.genre === "Mine" && !p.mine) return false;
    if (community.genre && community.genre !== "Mine" && !genresOf(p.tags).includes(community.genre)) return false;
    return !q || p.name.toLowerCase().includes(q) || p.description.toLowerCase().includes(q) || p.author.toLowerCase().includes(q);
  });
  $("#community-count").textContent = visible.length
    ? `${visible.length} shared preset${visible.length === 1 ? "" : "s"}.`
    : "Nothing shared yet. Be the first: open a preset you like in the editor, then Files › Share to Community.";
  const note = $("#community-note");
  note.hidden = shown.length === visible.length;
  note.textContent = `Showing ${shown.length} of ${visible.length}.`;

  const list = $("#community-list");
  list.innerHTML = "";
  for (const p of shown) list.append(communityRow(p));
}

function communityRow(p) {
  const li = document.createElement("li");
  if (p.hidden) li.classList.add("is-hidden");
  const main = document.createElement("div");
  main.className = "cmain";
  const title = document.createElement("div");
  title.className = "ctitle";
  const name = document.createElement("span");
  name.className = "pn";
  name.textContent = p.name;
  const chips = document.createElement("span");
  chips.className = "chips";
  chips.innerHTML = BLOCK_STATES.filter(([slot]) => p.params[slot])
    .map(([slot, label, block]) => `<span class="chip${p.params[slot] === 2 ? " hit" : ""}" data-block="${block}">${label}${p.params[slot] === 2 ? " · HIT" : ""}</span>`).join("");
  title.append(name, chips);
  main.append(title);
  if (p.description) {
    const d = document.createElement("p");
    d.className = "cdesc";
    d.textContent = p.description;
    main.append(d);
  }
  const meta = document.createElement("p");
  meta.className = "cmeta";
  const genres = genresOf(p.tags).filter((g) => g !== "Favorite");
  meta.textContent = [`by ${p.author}${p.mine ? " (you)" : ""}`, new Date(p.created).toLocaleDateString([], { dateStyle: "medium" }), genres.join(" · ")]
    .filter(Boolean).join(" · ");
  if (p.hidden) meta.textContent += " · hidden from others";
  if (community.me.admin && p.reports) meta.textContent += ` · reported ${p.reports}×`;
  main.append(meta);

  const actions = document.createElement("div");
  actions.className = "pedal-actions";
  const button = (label, onclick, cls = "ghost") => {
    const b = document.createElement("button");
    b.className = cls;
    b.textContent = label;
    b.onclick = onclick;
    actions.append(b);
    return b;
  };
  button("Try it", () => loadPreset(p, null));
  button("Save a copy", () => { loadPreset(p, null); openSave({ prefillEmpty: true }); });
  if (p.mine || community.me.admin) {
    button("Delete", async () => {
      if (!confirm(`Delete ${p.name} from Community? This can't be undone.`)) return;
      await communityAction("/api/community/delete", { id: p.id });
    }, "ghost danger");
  }
  if (community.me.admin) {
    button(p.hidden ? "Unhide" : "Hide", () => communityAction("/api/community/hide", { id: p.id, hidden: !p.hidden }));
    if (!p.mine) {
      button("Stop sharer", async () => {
        if (!confirm(`Stop ${p.author} from sharing, and hide everything they've shared?`)) return;
        await communityAction("/api/community/ban", { id: p.id });
      }, "link");
    }
  } else if (!p.mine) {
    button("Report", async () => {
      const reason = prompt(`What's wrong with ${p.name}? (For example: offensive, not theirs to share, broken.)`);
      if (reason === null) return;
      await communityAction("/api/community/report", { id: p.id, reason });
    }, "link");
  }
  li.append(main, actions);
  return li;
}

async function communityAction(path, body) {
  const res = await api(path, body);
  $("#community-count").textContent = res.message;
  if (res.ok) {
    const message = res.message;
    await openCommunityTab(true);
    $("#community-count").textContent = message;
  }
}

// --- sharing ---------------------------------------------------------------------------------------------------

function openShare() {
  $("#files-menu").open = false;
  const name = pedalName($("#preset-name").value, "");
  if (!name) return hint("Give the preset a name before sharing it.");
  $("#share-name").textContent = name;
  let saved = "";
  try { saved = localStorage.getItem("vlp.communityName") || ""; } catch { /* private window */ }
  $("#share-author").value = community.me.name || saved;
  $("#share-description").value = "";
  $("#share-rights").checked = false;
  $("#share-error").hidden = true;
  const box = $("#share-genres");
  box.innerHTML = "";
  state.spec.genres.forEach((g, bit) => {
    if (g === "Favorite") return;
    const label = document.createElement("label");
    label.className = "genre-check";
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.value = bit;
    cb.checked = !!((state.tags || 0) >> bit & 1);
    label.append(cb, document.createTextNode(g));
    box.append(label);
  });
  $("#share-dialog").showModal();
}

$("#share-open").onclick = openShare;
$("#community-share").onclick = () => { showTab("editor"); openShare(); };
$("#community-search").oninput = renderCommunity;

$("#share-confirm").onclick = async (e) => {
  e.preventDefault();
  const btn = $("#share-confirm");
  if (btn.disabled) return;
  const author = $("#share-author").value.trim();
  let tags = 0;
  for (const cb of $("#share-genres").querySelectorAll("input:checked")) tags |= 1 << +cb.value;
  const body = {
    name: $("#preset-name").value,
    tags,
    params: Array.from({ length: 50 }, (_, i) => state.values[i] ?? state.spec.defaults[i] ?? 0),
    description: $("#share-description").value,
    author,
    rights: $("#share-rights").checked,
  };
  btn.disabled = true;
  btn.textContent = "Sharing…";
  const res = await api("/api/community/share", body);
  btn.disabled = false;
  btn.textContent = "Share";
  if (!res.ok) {
    $("#share-error").textContent = res.message;
    $("#share-error").hidden = false;
    return;
  }
  try { localStorage.setItem("vlp.communityName", author); } catch { /* private window */ }
  $("#share-dialog").close();
  hint(res.message);
  community.loaded = false;
};

// The browser build routes api() through vlpTransport, which is ready only after its loader finishes.
(globalThis.vlpReady || Promise.resolve()).then(initCommunity);
