import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { pedalName, buildSyx, parseSyx, NAME_LENGTH } from "../src/tch.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.join(HERE, "..", "..", "tests", "fixtures");
const expected = JSON.parse(readFileSync(path.join(HERE, "fixtures.json"), "utf8"));

function toBase64(bytes) {
  return Buffer.from(bytes).toString("base64");
}

// --- pedalName unit cases --------------------------------------------------

test("pedalName: lowercase becomes uppercase", () => {
  assert.equal(pedalName("treat me right"), "TREAT ME RIGHT");
});

test("pedalName: parens become spaces", () => {
  assert.equal(pedalName("solo (loud)"), "SOLO  LOUD");
});

test("pedalName: trailing spaces are dropped", () => {
  assert.equal(pedalName("hi   "), "HI");
});

test("pedalName: empty name falls back to UNTITLED", () => {
  assert.equal(pedalName(""), "UNTITLED");
  assert.equal(pedalName(null), "UNTITLED");
  assert.equal(pedalName("   "), "UNTITLED");
});

test("pedalName: over-length name truncates to 15", () => {
  const result = pedalName("this name is way too long for the pedal");
  assert.equal(result.length <= NAME_LENGTH, true);
  assert.equal(result, "THIS NAME IS WA".slice(0, NAME_LENGTH));
});

// --- parity against the Python reference -----------------------------------

for (const file of readdirSync(FIXTURES_DIR)) {
  if (!file.endsWith(".syx")) continue;
  const want = expected[file];
  assert.ok(want, `fixtures.json missing entry for ${file} — run web/test/make_fixtures.py`);

  test(`parseSyx matches Python tch.parse_syx: ${file}`, () => {
    const raw = new Uint8Array(readFileSync(path.join(FIXTURES_DIR, file)));
    const got = parseSyx(raw);
    assert.equal(got.length, want.length);
    got.forEach((preset, i) => {
      const w = want[i];
      assert.equal(preset.number, w.number, `${file} preset ${i} number`);
      assert.equal(preset.name, w.name, `${file} preset ${i} name`);
      assert.equal(preset.tags, w.tags, `${file} preset ${i} tags`);
      assert.deepEqual(preset.params, w.params, `${file} preset ${i} params`);
      assert.equal(toBase64(preset.syx), w.syx_b64, `${file} preset ${i} syx bytes`);
    });
  });

  test(`buildSyx round-trips byte-for-byte vs Python tch.build_syx: ${file}`, () => {
    for (const w of want) {
      const rebuilt = buildSyx(w.number, w.name, w.tags, w.params);
      assert.equal(toBase64(rebuilt), w.build_syx_b64, `${file} preset ${w.number} buildSyx bytes`);
    }
  });
}
