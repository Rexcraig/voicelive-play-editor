// Browser-only build: hand the UI a transport that talks to the pedal directly, and get permission for
// SysEx, which Chrome only grants from something the singer clicked.
import * as api from "./api.js";
import * as midi from "./midi.js";

const base = new URL(".", import.meta.url);
let connected = false;

async function connect() {
  try {
    await midi.connect();
    connected = true;
    setStatus("");
    if (globalThis.refreshSetup) globalThis.refreshSetup();
    return true;
  } catch (e) {
    setStatus(e.message);
    return false;
  }
}

function setStatus(message) {
  const el = document.querySelector("#connect");
  if (!el) return;
  el.hidden = connected;
  el.querySelector("p").textContent = message || "This editor talks to the pedal through your browser. Chrome will ask once for permission to use MIDI devices.";
}

// The UI's first job is to read the spec; everything after that goes through the same transport.
globalThis.vlpReady = api.load(base).then(() => {
  globalThis.vlpTransport = api.transport;
});

addEventListener("DOMContentLoaded", () => {
  const button = document.querySelector("#connect button");
  if (button) button.onclick = async () => { if (await connect()) poke(); };
  setStatus("");
  // Already allowed from an earlier visit: Chrome answers without a prompt, so no click is needed.
  if (navigator.permissions?.query) {
    navigator.permissions.query({ name: "midi", sysex: true }).then((p) => { if (p.state === "granted") connect().then(poke); }).catch(() => {});
  }
});

// Nudge the UI to look again once the pedal is reachable.
function poke() {
  if (globalThis.poll) globalThis.poll();
  if (globalThis.refreshSetup) globalThis.refreshSetup();
}
