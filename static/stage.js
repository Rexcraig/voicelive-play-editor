// Stage view: the backbone of Cue mode. A set runs as a list of cues: every preset of every song, in order.
// (A song's presets already are its cues; each may carry an optional `label`, e.g. "Chorus", and later an `at`
// time in seconds for playback.) Going to a cue plays that preset in the pedal's edit buffer, the same proven path
// as every live edit, so nothing is ever written to the pedal here.
//
// Moving: tap a cue, the big Next/Back buttons, or keys. Page-turner pedals send PageDown/PageUp or the arrow keys,
// so those work too: Right/Space/PageDown = next cue, Left/PageUp = previous, Down/Up = next/previous song.

const stage = { set: null, cues: [], at: -1, sending: false, pending: null, wake: null };

function stageCues(set) {
  const cues = [];
  set.songs.forEach((song, s) => song.presets.forEach((preset, c) => cues.push({
    song, songIndex: s, cueIndex: c, preset,
    label: preset.label || (song.presets.length > 1 ? `Part ${c + 1}` : ""),
  })));
  return cues;
}

async function openStage(set) {
  stage.set = set;
  stage.cues = stageCues(set);
  stage.at = -1;
  $("#stage").hidden = false;
  document.body.classList.add("on-stage");
  renderStage();
  try { await document.documentElement.requestFullscreen?.(); } catch { /* not allowed here; the view still works */ }
  try { stage.wake = await navigator.wakeLock?.request("screen"); } catch { /* keeps the screen on where supported */ }
}

function closeStage() {
  $("#stage").hidden = true;
  document.body.classList.remove("on-stage");
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  stage.wake?.release?.().catch(() => {});
  stage.wake = null;
}

// Go to cue `i`. Sends are never stacked: while one is on its way, only the newest request is kept, so tapping
// quickly through the set always lands on the last tap.
function goCue(i) {
  if (i < 0 || i >= stage.cues.length) return;
  stage.at = i;
  renderStage();
  stage.pending = stage.cues[i];
  if (!stage.sending) sendCue();
}

async function sendCue() {
  stage.sending = true;
  while (stage.pending) {
    const cue = stage.pending;
    stage.pending = null;
    const p = cue.preset;
    const data = await api("/api/send", { name: p.name, tags: p.tags, values: Object.fromEntries(p.params.map((v, i) => [i, v])) });
    blinkTx(data.ok);
    $("#stage-status").textContent = data.ok ? "" : data.message;
  }
  stage.sending = false;
}

function stepSong(dir) {
  const here = stage.cues[stage.at];
  const song = here ? here.songIndex + dir : 0;
  const i = stage.cues.findIndex((c) => c.songIndex === song);
  if (i >= 0) goCue(i);
}

const effectsOf = (params) => BLOCK_STATES.filter(([slot]) => params[slot])
  .map(([slot, label, block]) => ({ label, block, hit: params[slot] === 2 }));

function renderStage() {
  const set = stage.set;
  const cur = stage.cues[stage.at];
  const next = stage.cues[stage.at + 1];
  $("#stage-set").textContent = set.name || "Untitled set";
  $("#stage-song").textContent = cur ? cur.song.title || "Untitled song" : "Ready";
  $("#stage-cue").textContent = cur ? [cur.label, cur.preset.name].filter(Boolean).join(" · ") : "Tap Next, or a song below, to start.";
  const fx = $("#stage-fx");
  fx.innerHTML = "";
  for (const e of cur ? effectsOf(cur.preset.params) : []) {
    const chip = document.createElement("span");
    chip.className = "chip big" + (e.hit ? " hit" : "");
    chip.dataset.block = e.block;
    chip.textContent = e.hit ? `${e.label} · on HIT` : e.label;
    fx.append(chip);
  }
  if (cur && !fx.children.length) fx.append(Object.assign(document.createElement("span"), { className: "stage-dry", textContent: "Dry voice: no effects" }));
  $("#stage-next").textContent = next
    ? `Next: ${next.songIndex !== cur?.songIndex ? `${next.song.title || "Untitled song"} · ` : ""}${[next.label, next.preset.name].filter(Boolean).join(" · ")}`
    : cur ? "End of the set" : "";
  $("#stage-prev-btn").disabled = stage.at <= 0;
  $("#stage-next-btn").disabled = stage.at >= stage.cues.length - 1;
  $("#stage-offline").hidden = state.connected;

  const list = $("#stage-list");
  list.innerHTML = "";
  set.songs.forEach((song, s) => {
    const li = document.createElement("li");
    if (cur && cur.songIndex === s) li.classList.add("now");
    const title = document.createElement("span");
    title.className = "stage-song-title";
    title.textContent = song.title || "Untitled song";
    li.append(title);
    const parts = document.createElement("span");
    parts.className = "stage-parts";
    stage.cues.forEach((c, i) => {
      if (c.songIndex !== s) return;
      const b = document.createElement("button");
      b.type = "button";
      b.className = "ghost" + (i === stage.at ? " on" : "");
      b.textContent = c.label || c.preset.name;
      b.onclick = () => goCue(i);
      parts.append(b);
    });
    li.append(parts);
    list.append(li);
  });
  list.querySelector("li.now")?.scrollIntoView({ block: "nearest" });
}

document.addEventListener("keydown", (e) => {
  if ($("#stage").hidden || (e.target instanceof Element && e.target.closest("input, textarea, select"))) return;
  const keys = {
    ArrowRight: () => goCue(stage.at + 1), " ": () => goCue(stage.at + 1), PageDown: () => goCue(stage.at + 1), Enter: () => goCue(stage.at + 1),
    ArrowLeft: () => goCue(stage.at - 1), PageUp: () => goCue(stage.at - 1),
    ArrowDown: () => stepSong(1), ArrowUp: () => stepSong(-1),
    Escape: closeStage,
  };
  if (keys[e.key]) { e.preventDefault(); keys[e.key](); }
});

$("#stage-next-btn").onclick = () => goCue(stage.at + 1);
$("#stage-prev-btn").onclick = () => goCue(stage.at - 1);
$("#stage-close").onclick = closeStage;
document.addEventListener("visibilitychange", async () => {
  // The screen lock is dropped when the tab is hidden; take it again on return.
  if (!$("#stage").hidden && document.visibilityState === "visible") {
    try { stage.wake = await navigator.wakeLock?.request("screen"); } catch { /* not supported */ }
  }
});
