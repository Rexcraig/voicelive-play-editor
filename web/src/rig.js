// "Set up my rig" wizard + Setup-menu validation. Ported from spec.py (setup_value_ok, setup_text,
// _rig_settings/rig_visible, rig_plan) and server.py (setup_changes), so the browser-only build offers
// the same wizard and validation as the Python server without a round trip. `spec` is the /api/spec
// payload (or the equivalent JSON the browser build embeds) — see spec.py's as_json() for its shape.

// Setup fields live in spec.setup[*].fields, not a flat map, so every lookup walks the pages. Fine at
// this size (fewer than 60 fields); avoids keeping a second, staler copy of the same data.
function findField(spec, index) {
  for (const page of spec.setup) {
    for (const field of page.fields) {
      if (field.index === index) return field;
    }
  }
  return null;
}

export function setupValueOk(index, value, spec) {
  const field = findField(spec, index);
  if (!field) return false;
  const { kind, options, min, max } = field;
  if (kind === "choice" || kind === "onoff") {
    // RoomSense input (9 = 7) is set via RoomSense: Voice instead, same as spec.py.
    return value >= 0 && value < options.length && !(index === 9 && value === 7);
  }
  if (kind === "percent" || kind === "locut") {
    return value >= min && value <= max;
  }
  return value >= -200 && value <= 2000; // step / hz2: range not measured; the pedal's read-back is the judge
}

// How a setup value reads on screen.
export function setupText(index, value, spec) {
  const field = findField(spec, index);
  const { kind, options, unit } = field;
  if (kind === "choice" || kind === "onoff") {
    return value >= 0 && value < options.length ? options[value] : String(value);
  }
  if (kind === "percent") {
    return index === 8 && value === 0 ? "off" : `${value} %`;
  }
  if (kind === "locut") {
    return `${Math.round(20 * 2 ** (value / 24))} Hz`;
  }
  if (kind === "hz2") {
    return `${(value / 2).toFixed(1)} Hz`;
  }
  return `${value}${unit ? ` ${unit}` : ""}`;
}

// A question is asked only when earlier answers call for it.
function rigVisible(question, answers) {
  const when = question.when || {};
  return Object.entries(when).every(([k, v]) => v.includes(answers[k]));
}

// Answers -> {setup index: [value, reason]}. Only settings the answers actually decide.
function rigSettings(answers, spec) {
  const out = {};
  const ask = {};
  for (const q of spec.rig) {
    if (rigVisible(q, answers)) ask[q.id] = answers[q.id];
  }
  const mic = ask.mic;
  const aux = ask.aux;

  const inputs = { dynamic: 0, condenser: 1, mp75: 2, e835: 3, mp76: 4 };
  if (Object.prototype.hasOwnProperty.call(inputs, mic)) {
    out[9] = [inputs[mic], "So the pedal treats the microphone you plugged in the right way."];
    out[28] = [1, "The pedal's own mics listen to the room, and to the music to find the key."];
  } else if (mic === "roomsense") {
    out[28] = [2, "The pedal's built-in microphones become the input. You will hear it in headphones only."];
  }

  if (ask.wireless === "yes") {
    out[36] = [0, "A wireless receiver already sends a strong signal, so no extra boost is needed."];
  } else if (ask.wireless === "no") {
    out[36] = [1, "A microphone straight into the pedal is quieter, so it gets a little boost. " +
      "If the input light sits red while you sing loudly, set this back to Off."];
  }

  const outputs = ask.outputs;
  if (outputs === "separate") {
    out[6] = [1, "Your dry voice goes out the Left socket and the effects out the Right one, " +
      "which is what the sound engineer asked for. Both cables must be plugged in."];
  } else if (outputs === "one" || outputs === "two" || outputs === "phones") {
    out[6] = [0, "Everything you hear goes to both outputs. On Mono a single cable carries the dry " +
      "voice only, which is why the effects seemed to do nothing."];
  }

  if (aux === "band") {
    out[31] = [0, "A live feed from the band, which the pedal can also use to find the key."];
    out[32] = [0, "The band is already in the PA, so the pedal doesn't send it out again."];
  } else if (aux === "tracks") {
    out[31] = [1, "Pre-recorded music, which the pedal follows for the key."];
    out[32] = [1, "So the audience hears the tracks. Turn it off if the tracks reach the PA another way."];
  } else if (aux === "monitor") {
    out[31] = [2, "You hear what's plugged in, but the pedal doesn't use it to work out the key."];
    out[32] = [0, "It stays in your headphones instead of going to the PA."];
  }

  if (ask.key === "myself") {
    out[17] = [1, "The key you set stays put when you change presets."];
    out[22] = [1, "Pressing both footswitches together sets the key."];
  } else if (ask.key === "follow") {
    out[17] = [0, "Each song's key is worked out from the music instead of being held."];
    if (aux === "band" || aux === "tracks") {
      // the Aux feed above already gives the pedal the music
    } else if (mic !== "roomsense") {
      out[28] = [1, "The pedal's own microphones listen to the band to work out the key."];
    }
  }

  const switch3 = ask.switch3;
  if (switch3 === "loop") {
    out[37] = [0, "The three buttons run the looper."];
  } else if (switch3 === "effects") {
    out[37] = [1, "The three buttons do what you choose below."];
    out[40] = [6, "First button: harmony on and off."];
    out[41] = [7, "Second button: delay on and off."];
    out[42] = [12, "Third button: reverb on and off."];
  }

  const mp75Map = { hit: 0, talk: 1, preset: 2, loop: 3 };
  const mp75 = Object.prototype.hasOwnProperty.call(mp75Map, ask.mp75button) ? mp75Map[ask.mp75button] : null;
  if (mp75 !== null) {
    out[20] = [mp75, "What the button on the microphone does."];
  }
  if (ask.mp76buttons === "default") {
    out[48] = [0, "The four buttons go back to the layout the microphone came with."];
  }

  // True whatever the answers: these two silently spoil the sound when they're left on.
  out[19] = [0, "Your own voice is heard, not only the harmonies and effects."];
  if (aux !== "tracks") {
    out[35] = [0, "Vocal Cancel only makes sense for karaoke tracks, and it thins out everything else."];
  }
  return out;
}

// What would change on the pedal, in the order the Setup pages show it. Settings already right are left out.
export function rigPlan(answers, values, spec) {
  const wanted = rigSettings(answers, spec);
  const order = [];
  for (const page of spec.setup) {
    for (const field of page.fields) order.push(field.index);
  }
  const plan = [];
  for (const index of order) {
    if (!(index in wanted)) continue;
    const [value, reason] = wanted[index];
    if (!setupValueOk(index, value, spec) || values[index] === value) continue;
    const field = findField(spec, index);
    plan.push({
      index, label: field.label, value, reason,
      from: setupText(index, values[index], spec),
      to: setupText(index, value, spec),
    });
  }
  return plan;
}

// The values the pedal's own menu changes together (observed on the unit 2026-09-17).
export function setupChanges(values, index, value) {
  const changes = { [index]: value };
  if (index === 28) { // RoomSense: Voice makes RoomSense the input; leaving Voice restores the last mic
    if (value === 2 && values[28] !== 2) {
      changes[9] = 7;
      changes[27] = 1;
    } else if (value !== 2 && values[28] === 2) {
      changes[9] = values[10];
      changes[27] = 0;
    }
  }
  if (index === 9) { // choosing a mic also records it as the last mic
    changes[10] = value;
  }
  return changes;
}
