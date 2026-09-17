# SETUP block map (read with tools/setup_probe.py; request 15 00, reply 0x13 x3 packets = 75 values)
Mapped with Will on the unit, 2026-09-17. Index = position in the decoded 75-value list. Enum values follow on-screen order.

## Page 1/8 INPUT
- 9  Input (source): Dynamic Mic 0, Condenser Mic 1, MP-75 Mic 2, E835FX Mic 3 (read as "EB35FX"; likely Sennheiser e835fx), MP-76 Mic 4, USB Left 5, USB Right 6; RoomSense 7 (set automatically by RoomSense = Voice, not in the list)
- 10 Last mic type (restored when RoomSense leaves Voice); mirrors 9 for mic choices
- 28 RoomSense: Ambient 0, Ambient/Auto 1, Voice 2 (Voice sets 9 = 7 and 27 = 1)
- 27 RoomSense-is-input flag (0/1), follows RoomSense = Voice
- 31 Aux In Type: Live 0, Tracks 1, Monitor 2
- 30 Tone Style: Off 0, Normal 1, Less Bright 2, Norm+Warmth 3, More Comp 4, Norm No Gate 5, Less Bright NG 6, Warmth NG 7, More Comp NG 8
- 8  Pitch Correction Amount: Off 0, 1..100 %

## Other observations
- 14 = 880 in base: likely Tune Reference in 0.5 Hz steps (440.0 Hz). 25 = 246: likely current preset.
- USB MIDI stalled once after changing Input (fixed by replugging).
