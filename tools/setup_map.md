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

## Page 2/8 OUTPUT
- 6  Output: Stereo 0, Mono 1, Dual Mono 2
- 1  USB Out level (dB, 0 = 0 dB; negative values)
- 35 Vocal Cancel: Off 0, On 1
- 34 Headphone Limiter (dB, 0 = 0 dB; negative values)
- 19 Lead Mute: Off 0, On 1
- 32 Aux to Main Out: Off 0, On 1

## Page 3/8 GLOBAL
- 17 Global Key: Off 0, On 1
- 15 Global Tempo: Off 0, On 1
- 36 Mic Boost: Off 0, Low 1, High 2

## Page 4/8 LOOP
- 7  Loop Input: Lead Mix 0, Aux 1, Lead Mix and Aux 2
- 24 Undo: Off 0, On 1
- 23 Loop Feedback: 0..100 %

## Page 5/8 SYSTEM
- 21 LCD Contrast (number as shown)
- 14 Tune Reference: value = Hz x 2 (880 = 440.0 Hz, 884 = 442.0 Hz)
- 22 Up/Dn Function: Looping 0, Set Key 1
- 13 Pitch Pipe Level (dB, 0 = 0 dB)
- 18 Lead Delay: None 0, Voice Sync 1, Auto 2
- 43 RoomSense LoCut: index 0..112, Hz = round(20 * 2^(index/24)) (1/24-octave steps; 0 = 20 Hz, 2 = 21 Hz, 112 = 508 Hz;
     formula fits all three readings, mid-range not spot-checked)

## Page 6/8 SWITCH-3 (footswitch accessory)
- 37 Control: Loop Mode 0, Custom 1 (Loop Mode shows fixed loop functions; switch values below apply in Custom)
- 38 Harm Moment: Off 0, On 1
- 39 Delay Moment: Off 0, On 1
- 40 / 41 / 42 Switch 1 / 2 / 3 function: Loop Rec/Play 0, Loop Stop/Clear 1, Loop Undo 2, Loop Start/Stop 3, 1 BTN Looper 4,
  Tap Tempo 5, Harmony 6, Delay 7, uMod 8, Transducer 9, HardTune 10, Doubling 11, Reverb 12

## Page 7/8 MIC CONTROL
- 48 MP76 Control: Default 0, Custom 1 (Default overrides the four button assignments; values below apply in Custom)
- 20 MP75 Control: HIT 0, HIT + Talk 1, Preset Up 2, Loop 3 (confirmed on unit)
- 47 MP76 Top / 45 MP76 Bottom / 46 MP76 Left / 44 MP76 Right:
  Preset Down 0, Preset Up 1, HIT 2, HIT + Talk 3, HIT + Tap 4, Loop 5, Loop Stop/Clear 6, Loop Undo 7, Tap Tempo 8, uMod 9,
  Delay 10, Delay Moment 11, Reverb 12, Harmony 13, Harm Moment 14, Doubling 15, Transducer 16, HardTune 17
  (Top proven by stepping to 17; Bottom/Left/Right from the photo: Doubling 15, Loop 5, HIT 2)

## Page 8/8 PRODUCT INFO: read-only (firmware 1.4.00 B70)

## Seen on screen, not yet tested
- Page 5 SYSTEM: LCD Contrast 2, Tune Reference 440.0 Hz (= value 14, half-Hz), Up/Dn Function SET KEY, Pitch Pipe Level 0 dB,
  Lead Delay NONE, RoomSense LoCut 20 Hz

## Not yet identified (probably MIX levels, current key/preset etc., not on Setup pages)
- {0: -10, 2: -36, 3: -28, 4: -36, 5: -33, 11: -5, 12: -36, 16: 3, 25: 246, 26: 0, 29: 0, 33: 0, 49: 0, 50: 0, 51: 0, 52: 0, 53: 0, 54: 0, 55: 0, 56: 0, 57: 0, 58: 0, 59: 0, 60: 0, 61: 0, 62: 0, 63: 0, 64: 0, 65: 0, 66: 0, 67: 0, 68: 0, 69: 0, 70: 0, 71: 0, 72: 0, 73: 0, 74: 0}

## Other observations
- 14 = 880 in base: likely Tune Reference in 0.5 Hz steps (440.0 Hz). 25 = 246: likely current preset.
- USB MIDI stalled once after changing Input (fixed by replugging).
