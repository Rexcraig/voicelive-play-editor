# VoiceLive Play: the USB MIDI protocol

TC-Helicon doesn't publish how its VoiceSupport app talks to the VoiceLive Play. Everything below was worked out by
capturing that traffic and then testing each command against a real pedal. Anything marked *unknown* has not been
pinned down yet.

## How it was captured

`tools/midilog.c` is a small CoreMIDI logger. Loaded into VoiceSupport with `DYLD_INSERT_LIBRARIES`, it records every
message the app sends and receives, without touching the pedal or needing admin rights. A full raw capture of one
VoiceSupport sync is in `tools/capture.txt`. Every command was then replayed from the editor and checked on the unit.

## Framing

- Every message is SysEx: `F0 00 01 38 00 69 <cmd> ... F7` (TC-Helicon's manufacturer ID, product `0x69`).
- Numbers are packed 7 bits per byte. Preset values are signed 28-bit integers in 4 bytes.
- The pedal acknowledges with `34 01 <hi7> <lo7>`. `34 02 00 00` means an empty slot; `34 09 00 00` means "refused".
- The `7E` family is discovery; the standard identity request is answered.

## Presets

- A preset is one `0x20` header plus two `0x21` packets.
  - Header: preset number (2 × 7 bits), format version 170 (2 × 7 bits), a 15-byte name, a 28-bit tag field.
  - Each `0x21` packet: index 0 or 1, 100 data bytes (25 values × 4 bytes), checksum = `sum(data) & 0x7F`.
- **Send with number 0:** loads into the active preset immediately. Nothing is stored ("modified via sysex").
- **Send with number N (1 to 500):** permanently writes slot N. Verified to survive a preset change and a power cycle.
- **Read:** `57 00 00` opens a session, `45 <hi7> <lo7>` requests one slot (reply: header + two packets, or
  `34 02 00 00` if empty), `57 00 01` closes it. A full 500-slot read takes about 9 seconds.
- Reading the slot the pedal is sitting on returns the *saved* preset, not unsaved edits, so backups taken before a
  save are always the real stored version.
- The pedal sends nothing over USB when you change presets or store on the unit itself, so the editor shows how old
  its copy of the pedal's contents is and offers a refresh.
- A `.syx` export from VoiceSupport is exactly header + two packets per preset (checked byte for byte).

## Preset values (50 slots)

Confirmed on the unit:

| Slot | Meaning |
| --- | --- |
| 1 | Harmony voicing (28 styles) |
| 2 | Key (0 = auto, 1 = C … 12 = B) |
| 4 | Doubling style (10) |
| 5 | Harmony level (-35 = off … 0) |
| 6 | Doubling level (-36 … 0) |
| 7, 8, 9 | Voice modulation / delay / reverb level (-51 … 0) |
| 13, 14, 20 | Voice modulation style (24) / delay style (18) / reverb style (28) |
| 18 | Delay feedback (0 … 100; TC's own presets stop at 80) |
| 21 | Reverb decay (1 … 300) |
| 22, 24, 26 | Megaphone & distortion style (8) / drive (0 … 100) / filter (0 … 100) |
| 27, 28, 29 | HardTune style (7) / shift (-36 … 24) / gender (-50 … 50) |
| 30 – 36 | Block state, 0 off / 1 on / 2 HIT: modulation, delay, reverb, harmony, doubling, megaphone, HardTune |

Not shown on the pedal's screen (checked by ear): 3 scale, 15 tempo, 16 / 17 delay time L / R in ms, 19 delay filter.

*Unknown:* 0, 10 – 12, 23, 25, 37, 38 – 49.

The printed manual's option lists are out of date for current firmware; `spec.py` holds the lists read off the unit.

## Setup menu

- **Read:** `15 00` returns three `0x13` packets, 75 values in all.
- **Write:** send the three packets back *outside* a `57` session. Inside one the pedal refuses (`34 09 00 00`);
  outside it acknowledges (`34 01 00 00`).
- The full value-to-setting map, with every option list read off the pedal, is in `tools/setup_map.md`.
  The snapshots in `tools/setup_snapshots/` are the before/after reads used to map each setting.
- Every write is read back, and the editor reports what the pedal actually kept.
