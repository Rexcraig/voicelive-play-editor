"""Read/write TC-Helicon VoiceLive Play .tch preset archives."""
import pathlib
import struct
import re

SYX_HEADER = b"\xf0\x00\x01\x38\x00\x69"  # TC-Helicon manufacturer ID + VoiceLive Play product ID
PACKET = re.compile(re.escape(SYX_HEADER) + rb"\x21(.)(.{100})(.)\xf7", re.S)


# Characters the pedal keeps in a preset name (measured on the unit, fw 1.4.00, 2026-09-16).
# Lowercase is stored as uppercase; anything else becomes a space; trailing spaces are dropped.
NAME_CHARS = frozenset(" !$%&'+-./0123456789=?ABCDEFGHIJKLMNOPQRSTUVWXYZ")
NAME_LENGTH = 15


def pedal_name(name, fallback="UNTITLED"):
    """The name exactly as the pedal will store it."""
    cleaned = "".join(c if c in NAME_CHARS else " " for c in (name or "").upper()[:NAME_LENGTH]).rstrip()
    return cleaned or fallback


def decode28(b):
    v = (b[0] << 21) | (b[1] << 14) | (b[2] << 7) | b[3]
    return v - (1 << 28) if v & (1 << 27) else v


def encode28(v):
    v &= (1 << 28) - 1
    return bytes([(v >> 21) & 0x7F, (v >> 14) & 0x7F, (v >> 7) & 0x7F, v & 0x7F])


def checksum(data):
    return sum(data) & 0x7F


def read_presets(path):
    raw = pathlib.Path(path).read_bytes()
    packets = list(PACKET.finditer(raw))
    presets = []
    i = 0
    while i < len(packets) - 1:
        p0, p1 = packets[i], packets[i + 1]
        if p0.group(1) != b"\x00" or p1.group(1) != b"\x01":
            i += 1
            continue
        head = raw[max(0, p0.start() - 48):p0.start()]
        names = re.findall(rb"[ -~]{2,15}", head)
        data = p0.group(2) + p1.group(2)
        presets.append({
            "file": pathlib.Path(path).name,
            "name": names[-1].decode() if names else "?",
            "params": [decode28(data[k:k + 4]) for k in range(0, 200, 4)],
            "checks": (p0.group(3)[0], p1.group(3)[0]),
            "offsets": (p0.start(), p1.start()),
        })
        i += 2
    return raw, presets


FILE_HEADER_LEN = 0x57  # version strings + product/format descriptor, identical across official packs
NUM_SLOTS = 501


def build_packet(index, data100):
    return SYX_HEADER + bytes([0x21, index]) + data100 + bytes([checksum(data100)]) + b"\xf7"


def build_record(number, name, tags, params):
    data = b"".join(encode28(v) for v in params)
    name_b = name.upper().encode()[:15].ljust(15, b"\x00")
    rec = struct.pack("<II", 2, 2) + b"\x00" + b"\xff\xff\xff\xff" + b"\x01"
    rec += struct.pack("<III", number, 170, 15) + name_b + struct.pack("<IIII", tags, 1, 2, 110)
    rec += build_packet(0, data[:100]) + struct.pack("<I", 110) + build_packet(1, data[100:])
    return rec


def build_file(header, presets):
    """presets: list of (name, tags, params). header: first FILE_HEADER_LEN bytes of an official pack."""
    out = header[:FILE_HEADER_LEN]
    for i, (name, tags, params) in enumerate(presets, start=1):
        out += build_record(i, name, tags, params)
    return out + b"\xff\xff\xff\xff" * (NUM_SLOTS - len(presets))


def build_syx_header(number, name, tags, steps=1):
    """Preset header message VoiceSupport writes before a preset's data packets in exported .syx files."""
    body = bytes([(number >> 7) & 0x7F, number & 0x7F, (170 >> 7) & 0x7F, 170 & 0x7F])
    body += name.upper().encode()[:15].ljust(15, b"\x00") + encode28(tags) + bytes([steps])
    return SYX_HEADER + b"\x20" + body + b"\xf7"


def build_syx(number, name, tags, params):
    data = b"".join(encode28(v) for v in params)
    return build_syx_header(number, name, tags) + build_packet(0, data[:100]) + build_packet(1, data[100:])


def parse_syx(data):
    """Split a .syx file into presets: [{number, name, tags, params, syx}]. Raises ValueError on a malformed file."""
    msgs, start = [], None
    for i, b in enumerate(data):
        if b == 0xF0:
            start = i
        elif b == 0xF7 and start is not None:
            msgs.append(data[start:i + 1])
            start = None
    presets, cur = [], None
    for m in msgs:
        if not m.startswith(SYX_HEADER) or len(m) < 8:
            continue
        cmd = m[6]
        if cmd == 0x20 and len(m) == 32:
            cur = {"number": (m[7] << 7) | m[8], "name": m[11:26].rstrip(b"\x00").decode("ascii", "replace"),
                   "tags": decode28(m[26:30]), "packets": {}, "syx": bytes(m)}
        elif cmd == 0x21 and len(m) == 110 and cur is not None:
            idx, body, check = m[7], m[8:108], m[108]
            if checksum(body) != check:
                raise ValueError(f"Preset '{cur['name']}' is damaged (checksum mismatch).")
            cur["packets"][idx] = body
            cur["syx"] += bytes(m)
            if 0 in cur["packets"] and 1 in cur["packets"]:
                d = cur["packets"][0] + cur["packets"][1]
                presets.append({"number": cur["number"], "name": cur["name"], "tags": cur["tags"],
                                "params": [decode28(d[k:k + 4]) for k in range(0, 200, 4)], "syx": cur["syx"]})
                cur = None
    if not presets:
        presets = parse_tch(data)
    if not presets:
        raise ValueError("No VoiceLive Play presets found in this file.")
    return presets


def parse_tch(data):
    """Presets in a VoiceSupport .tch pack (the format build_record writes): [{number, name, tags, params}].
    Only records whose fixed fields check out are taken; checked 2026-09-25 against all 35 TC .tch packs."""
    data = bytes(data)
    presets = []
    for m in PACKET.finditer(data):
        s = m.start()
        if m.group(1) != b"\x00" or s < 43:
            continue
        number, version, name_len = struct.unpack("<III", data[s - 43:s - 31])
        tags, _, _, length = struct.unpack("<IIII", data[s - 16:s])
        after = data[m.end():m.end() + 4 + 110]
        second = PACKET.match(after, 4)
        if version != 170 or name_len != 15 or length != 110 or not second or second.group(1) != b"\x01":
            continue
        if checksum(m.group(2)) != m.group(3)[0] or checksum(second.group(2)) != second.group(3)[0]:
            raise ValueError(f"Preset {number} in this pack is damaged (checksum mismatch).")
        d = m.group(2) + second.group(2)
        presets.append({"number": number, "name": data[s - 31:s - 16].rstrip(b"\x00").decode("ascii", "replace"),
                        "tags": tags, "params": [decode28(d[k:k + 4]) for k in range(0, 200, 4)],
                        "pack": True})  # number = position in the pack, not a slot on anyone's pedal
    return presets
