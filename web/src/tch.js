// SysEx codec for TC-Helicon VoiceLive Play presets. Ported from tch.py — see that file for the
// Python reference implementation (used to build the parity fixtures in web/test/).

export const SYX_HEADER = new Uint8Array([0xf0, 0x00, 0x01, 0x38, 0x00, 0x69]); // TC-Helicon manufacturer ID + VoiceLive Play product ID

// Characters the pedal keeps in a preset name (measured on the unit, fw 1.4.00, 2026-09-16).
// Lowercase is stored as uppercase; anything else becomes a space; trailing spaces are dropped.
export const NAME_CHARS = new Set(" !$%&'+-./0123456789=?ABCDEFGHIJKLMNOPQRSTUVWXYZ");
export const NAME_LENGTH = 15;

const encoder = new TextEncoder();

function concatBytes(...arrays) {
  const len = arrays.reduce((n, a) => n + a.length, 0);
  const out = new Uint8Array(len);
  let offset = 0;
  for (const a of arrays) {
    out.set(a, offset);
    offset += a.length;
  }
  return out;
}

function u32le(n) {
  return new Uint8Array([n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >> 24) & 0xff]);
}

// name.upper().encode()[:15].ljust(15, b"\x00") — truncate/pad at the BYTE level, not char level.
function nameBytes(name) {
  const out = new Uint8Array(NAME_LENGTH);
  out.set(encoder.encode(name.toUpperCase()).slice(0, NAME_LENGTH));
  return out;
}

function startsWith(bytes, prefix) {
  if (bytes.length < prefix.length) return false;
  for (let i = 0; i < prefix.length; i++) if (bytes[i] !== prefix[i]) return false;
  return true;
}

function rstripZero(bytes) {
  let end = bytes.length;
  while (end > 0 && bytes[end - 1] === 0) end--;
  return bytes.slice(0, end);
}

// str.decode("ascii", "replace"): bytes >= 0x80 become U+FFFD instead of raising.
function decodeAsciiReplace(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += bytes[i] < 128 ? String.fromCharCode(bytes[i]) : "�";
  return s;
}

/** The name exactly as the pedal will store it. */
export function pedalName(name, fallback = "UNTITLED") {
  const upper = (name || "").toUpperCase().slice(0, NAME_LENGTH);
  let cleaned = "";
  for (const c of upper) cleaned += NAME_CHARS.has(c) ? c : " ";
  cleaned = cleaned.trimEnd();
  return cleaned || fallback;
}

export function decode28(b) {
  const v = (b[0] << 21) | (b[1] << 14) | (b[2] << 7) | b[3];
  return v & (1 << 27) ? v - (1 << 28) : v;
}

export function encode28(v) {
  v &= (1 << 28) - 1;
  return new Uint8Array([(v >> 21) & 0x7f, (v >> 14) & 0x7f, (v >> 7) & 0x7f, v & 0x7f]);
}

export function checksum(data) {
  let sum = 0;
  for (let i = 0; i < data.length; i++) sum += data[i];
  return sum & 0x7f;
}

export function buildPacket(index, data100) {
  return concatBytes(SYX_HEADER, new Uint8Array([0x21, index]), data100, new Uint8Array([checksum(data100)]), new Uint8Array([0xf7]));
}

export function buildRecord(number, name, tags, params) {
  const data = concatBytes(...params.map(encode28));
  const nameB = nameBytes(name);
  const part1 = concatBytes(u32le(2), u32le(2), new Uint8Array([0x00]), new Uint8Array([0xff, 0xff, 0xff, 0xff]), new Uint8Array([0x01]));
  const part2 = concatBytes(u32le(number), u32le(170), u32le(15), nameB, u32le(tags), u32le(1), u32le(2), u32le(110));
  const part3 = concatBytes(buildPacket(0, data.slice(0, 100)), u32le(110), buildPacket(1, data.slice(100)));
  return concatBytes(part1, part2, part3);
}

/** Preset header message VoiceSupport writes before a preset's data packets in exported .syx files. */
export function buildSyxHeader(number, name, tags, steps = 1) {
  const body = concatBytes(
    new Uint8Array([(number >> 7) & 0x7f, number & 0x7f, (170 >> 7) & 0x7f, 170 & 0x7f]),
    nameBytes(name),
    encode28(tags),
    new Uint8Array([steps])
  );
  return concatBytes(SYX_HEADER, new Uint8Array([0x20]), body, new Uint8Array([0xf7]));
}

export function buildSyx(number, name, tags, params) {
  const data = concatBytes(...params.map(encode28));
  return concatBytes(buildSyxHeader(number, name, tags), buildPacket(0, data.slice(0, 100)), buildPacket(1, data.slice(100)));
}

/** Split a .syx file into presets: [{number, name, tags, params, syx}]. Throws on a malformed file. */
export function parseSyx(data) {
  const msgs = [];
  let start = null;
  for (let i = 0; i < data.length; i++) {
    const b = data[i];
    if (b === 0xf0) start = i;
    else if (b === 0xf7 && start !== null) {
      msgs.push(data.slice(start, i + 1));
      start = null;
    }
  }

  const presets = [];
  let cur = null;
  for (const m of msgs) {
    if (!startsWith(m, SYX_HEADER) || m.length < 8) continue;
    const cmd = m[6];
    if (cmd === 0x20 && m.length === 32) {
      cur = {
        number: (m[7] << 7) | m[8],
        name: decodeAsciiReplace(rstripZero(m.slice(11, 26))),
        tags: decode28(m.slice(26, 30)),
        packets: {},
        syx: m.slice(),
      };
    } else if (cmd === 0x21 && m.length === 110 && cur !== null) {
      const idx = m[7];
      const body = m.slice(8, 108);
      const check = m[108];
      if (checksum(body) !== check) {
        throw new Error(`Preset '${cur.name}' is damaged (checksum mismatch).`);
      }
      cur.packets[idx] = body;
      cur.syx = concatBytes(cur.syx, m);
      if (0 in cur.packets && 1 in cur.packets) {
        const d = concatBytes(cur.packets[0], cur.packets[1]);
        const params = [];
        for (let k = 0; k < 200; k += 4) params.push(decode28(d.slice(k, k + 4)));
        presets.push({ number: cur.number, name: cur.name, tags: cur.tags, params, syx: cur.syx });
        cur = null;
      }
    }
  }
  if (presets.length === 0) presets.push(...parseTch(data));
  if (presets.length === 0) throw new Error("No VoiceLive Play presets found in this file.");
  return presets;
}

// A preset packet starting at i: SYX_HEADER, 0x21, index, 100 data bytes, checksum, F7.
function packetAt(data, i, index) {
  if (i + 110 > data.length || data[i + 6] !== 0x21 || data[i + 7] !== index || data[i + 109] !== 0xf7) return null;
  for (let k = 0; k < 6; k++) if (data[i + k] !== SYX_HEADER[k]) return null;
  return { body: data.slice(i + 8, i + 108), check: data[i + 108] };
}

/** Presets in a VoiceSupport .tch pack: [{number, name, tags, params}]. Mirrors tch.parse_tch. */
export function parseTch(data) {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const u32 = (i) => view.getUint32(i, true);
  const presets = [];
  for (let s = 43; s + 110 <= data.length; s++) {
    const p0 = packetAt(data, s, 0);
    if (!p0 || u32(s - 39) !== 170 || u32(s - 35) !== 15 || u32(s - 4) !== 110) continue;
    const p1 = packetAt(data, s + 114, 1);
    if (!p1) continue;
    const number = u32(s - 43);
    if (checksum(p0.body) !== p0.check || checksum(p1.body) !== p1.check) {
      throw new Error(`Preset ${number} in this pack is damaged (checksum mismatch).`);
    }
    const d = concatBytes(p0.body, p1.body);
    const params = [];
    for (let k = 0; k < 200; k += 4) params.push(decode28(d.slice(k, k + 4)));
    presets.push({ number, name: decodeAsciiReplace(rstripZero(data.slice(s - 31, s - 16))), tags: u32(s - 16), params, pack: true });
    s += 223;
  }
  return presets;
}
