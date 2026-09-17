"""What each VoiceLive Play preset slot means.

Decoded from 877 official TC-Helicon presets and confirmed on the unit where marked.
`confirmed` = seen on the box's own screen; otherwise it's inferred from TC's presets + manual.
"""

OFF, ON, HIT = 0, 1, 2

REVERB_STYLES = [
    "Smooth Plate", "Reflection Plate", "Thin Plate", "Bright Plate", "Real Plate", "Real Plate Long",
    "Jazz Plate", "Quick Plate", "Soft Hall", "Amsterdam Hall", "Broadway Hall", "Snappy Room",
    "Library", "Dark Room", "Music Club", "Studio Room", "Warehouse", "Bouncy Room", "Bright Chamber",
    "Wooden Chamber", "St. Joseph Church", "Dome Chapel", "Hockey Arena", "Museum", "Indoor Arena",
    "Cozy Corner", "Thin Spring", "Full Spring",
]
# Read off the unit's own Style list, in order.
DELAY_STYLES = [
    "Quarter", "Eighth", "Triplet", "Dotted 1/8", "Dotted 1/4", "1/4 Triplet", "Sixteenth",
    "Ping Pong 1", "Ping Pong 2", "Ping Pong 3", "Multitap 1", "Multitap 2", "Multitap 3",
    "Multitap 4", "Multitap 5", "Multitap 6", "Classic Slap", "Set Time",
]
DELAY_FILTERS = [
    "Digital", "Tape", "Analog", "Radio", "Megaphone", "Cell Phone", "Lo-Fi",
    "Hi Cut 1", "Hi Cut 2", "Hi Cut 3", "Low Cut 1", "Low Cut 2", "Low Cut 3",
]
# Read off the unit's own Style list, in order (differs from the manual: Panner moved, Auto Wah added).
UMOD_STYLES = [
    "MicroMod Clone", "MicroMod Wider", "Thicken", "Light Chorus", "Medium Chorus", "Wide Chorus",
    "Mono Chorus", "Fast Rotor", "Panner", "Flanger", "Flange Feedback", "Flange Negative",
    "Mono Flange", "Soft Flange", "Tube", "Up Tube", "Down Tube", "Down & Up Tube", "Rise and Fall",
    "Auto Wah", "Underwater", "Cylon Mono", "Cylon Stereo", "Alien Voiceover",
]
HARDTUNE_STYLES = ["Pop", "Country Gliss", "Robot", "Correct Natural", "Correct Chromatic", "Drone", "Gender Bender"]
# Unit lists Radio..Combo after the first entry; Megaphone as #0 matches TC's "MEGAPHONE" presets.
MEGAPHONE_STYLES = ["Megaphone", "Radio", "On the Phone", "Overdrive", "Buzz Cut", "Stack", "Tweed", "Combo"]
# Read off the unit's own Style list, in order; matches TC's presets ("DOUBLE UP" = 7, "OCTAVE GANG" = 9).
DOUBLE_STYLES = [
    "1 Voice Tight", "1 Voice Loose", "2 Voices Tight", "2 Voices Loose", "Shout",
    "1 Voice Octave Up", "1 Voice Octave Down", "2 Voices Octave Up", "2 Voices Octave Down", "Octave Up & Down",
]
# Read off the unit's own Style list, in order, and cross-checked against TC's presets
# (their "FIFTH UP" preset = 21 = +7 semitones; "4TH SHIFT+OCTDN" = 27 = -12 and -5).
HARMONY_STYLES = [
    "High", "Higher", "Low", "Lower", "Octave Up", "Octave Down",
    "High & Low", "High & Higher", "High & Lower", "Higher & Lower", "Higher & Low", "Lower & Low",
    "Octave Down & Up", "Octave Down & Higher", "Octave Down & High", "Octave Down & Low", "Octave Down & Lower",
    "Octave Up & Higher", "Octave Up & High", "Octave Up & Low", "Octave Up & Lower",
    "+7 semitones", "-5 semitones", "+7 & -5 semitones", "+12 & +7 semitones", "+12 & -5 semitones",
    "-12 & +7 semitones", "-12 & -5 semitones",
]
KEYS = ["Auto (follows input)"] + ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
SCALES = ["Major 1", "Major 2", "Major 3", "Minor 1", "Minor 2", "Minor 3"]

# slot: (block, label, kind, options-or-range, confirmed)
PARAMS = [
    (33, "harmony", "Harmony", "state", None, True),
    (1, "harmony", "Voicing", "choice", HARMONY_STYLES, True),
    (2, "harmony", "Key", "choice", KEYS, True),  # 3 = D confirmed on the unit
    (3, "harmony", "Scale", "choice", SCALES, False),
    (5, "harmony", "Level", "db", (-35, 0), True),  # box: -35 = Off, midpoint -18, top 0 dB (Will, 2026-09-17)

    (34, "double", "Doubling", "state", None, True),
    (4, "double", "Style", "choice", DOUBLE_STYLES, True),
    (6, "double", "Level", "db", (-36, 0), True),

    (32, "reverb", "Reverb", "state", None, True),
    (20, "reverb", "Style", "choice", REVERB_STYLES, True),
    (21, "reverb", "Decay", "range", (1, 300), True),
    (9, "reverb", "Level", "db", (-51, 0), True),

    (31, "delay", "Delay", "state", None, True),
    (14, "delay", "Style", "choice", DELAY_STYLES, True),
    (16, "delay", "Time L (ms)", "range", (6, 2400), False),
    (17, "delay", "Time R (ms)", "range", (6, 2400), False),
    (18, "delay", "Feedback", "range", (0, 100), True),
    (19, "delay", "Filter", "choice", DELAY_FILTERS, False),
    (8, "delay", "Level", "db", (-51, 0), True),

    (30, "umod", "Voice Modulation", "state", None, False),
    (13, "umod", "Style", "choice", UMOD_STYLES, True),
    (7, "umod", "Level", "db", (-51, 0), True),

    (36, "hardtune", "HardTune", "state", None, True),
    (27, "hardtune", "Style", "choice", HARDTUNE_STYLES, True),
    (28, "hardtune", "Shift (semitones)", "range", (-36, 24), True),
    (29, "hardtune", "Gender", "range", (-50, 50), True),

    (35, "megaphone", "Transducer", "state", None, True),
    (22, "megaphone", "Style", "choice", MEGAPHONE_STYLES, True),
    (24, "megaphone", "Drive", "range", (0, 100), True),
    (26, "megaphone", "Filter", "range", (0, 100), True),

    (15, "global", "Tempo (BPM)", "range", (25, 300), False),
]

BLOCKS = [
    ("harmony", "Harmony", "Adds sung harmony lines above or below the lead."),
    ("double", "Doubling", "Stacks copies of the voice for a thicker, produced sound."),
    ("reverb", "Reverb", "Sense of room, from a small studio to an arena."),
    ("delay", "Delay", "Repeats, or echoes, of the voice."),
    ("umod", "Voice Modulation", "Chorus, flange and stranger movement effects."),
    ("hardtune", "HardTune", "Pitch correction, from gentle to the hard Auto-Tune sound."),
    ("megaphone", "Megaphone & Distortion", "Megaphone, radio, phone and amp-style distortion. Called Transducer on the pedal."),
]


# SETUP menu (whole-pedal settings, not per preset). Index = position in the 75-value setup block; mapped on the
# unit with Will 2026-09-17 (tools/setup_map.md). kind: choice | onoff | percent | step (range not measured: +/-1 buttons,
# the pedal keeps what it accepts) | hz2 (value = Hz x 2) | locut (index 0..112, Hz = 20 * 2^(index/24)).
ON_OFF = ["Off", "On"]
SWITCH3_FUNCTIONS = ["Loop Rec/Play", "Loop Stop/Clear", "Loop Undo", "Loop Start/Stop", "1 Button Looper", "Tap Tempo",
                     "Harmony", "Delay", "uMod", "Transducer", "HardTune", "Doubling", "Reverb"]
MP76_FUNCTIONS = ["Preset Down", "Preset Up", "HIT", "HIT + Talk", "HIT + Tap", "Loop", "Loop Stop/Clear", "Loop Undo",
                  "Tap Tempo", "uMod", "Delay", "Delay Moment", "Reverb", "Harmony", "Harm Moment", "Doubling",
                  "Transducer", "HardTune"]
SETUP_PAGES = [
    ("input", "Input", "Which mic is plugged in, and how the pedal treats the voice before any effects.", [
        (9, "Input", "choice", ["Dynamic Mic", "Condenser Mic", "MP-75 Mic", "E835FX Mic", "MP-76 Mic", "USB Left", "USB Right", "RoomSense"]),
        (28, "RoomSense", "choice", ["Ambient", "Ambient/Auto", "Voice"]),
        (31, "Aux In Type", "choice", ["Live", "Tracks", "Monitor"]),
        (30, "Tone Style", "choice", ["Off", "Normal", "Less Bright", "Norm+Warmth", "More Comp", "Norm No Gate",
                                      "Less Bright NG", "Warmth NG", "More Comp NG"]),
        (8, "Pitch Correction", "percent", (0, 100)),
    ]),
    ("output", "Output", "How sound leaves the pedal: to the PA, headphones and USB.", [
        (6, "Output", "choice", ["Stereo", "Mono", "Dual Mono"]),
        (1, "USB Out", "step", "dB"),
        (35, "Vocal Cancel", "onoff", ON_OFF),
        (34, "Headphone Limit", "step", "dB"),
        (19, "Lead Mute", "onoff", ON_OFF),
        (32, "Aux to Main Out", "onoff", ON_OFF),
    ]),
    ("global", "Global", "Settings that stay put when you change presets.", [
        (17, "Global Key", "onoff", ON_OFF),
        (15, "Global Tempo", "onoff", ON_OFF),
        (36, "Mic Boost", "choice", ["Off", "Low", "High"]),
    ]),
    ("loop", "Loop", "How the looper records.", [
        (7, "Loop Input", "choice", ["Lead Mix", "Aux", "Lead Mix and Aux"]),
        (24, "Undo", "onoff", ON_OFF),
        (23, "Loop Feedback", "percent", (0, 100)),
    ]),
    ("system", "System", "The screen, tuning and how the pedal itself behaves.", [
        (21, "LCD Contrast", "step", ""),
        (14, "Tune Reference", "hz2", "Hz"),
        (22, "Up + Down Switches", "choice", ["Looping", "Set Key"]),
        (13, "Pitch Pipe Level", "step", "dB"),
        (18, "Lead Delay", "choice", ["None", "Voice Sync", "Auto"]),
        (43, "RoomSense Low Cut", "locut", (0, 112)),
    ]),
    ("switch3", "Switch-3", "What the optional three-button footswitch does. Switches 1-3 apply when Control is Custom.", [
        (37, "Control", "choice", ["Loop Mode", "Custom"]),
        (38, "Harm Moment", "onoff", ON_OFF),
        (39, "Delay Moment", "onoff", ON_OFF),
        (40, "Switch 1", "choice", SWITCH3_FUNCTIONS),
        (41, "Switch 2", "choice", SWITCH3_FUNCTIONS),
        (42, "Switch 3", "choice", SWITCH3_FUNCTIONS),
    ]),
    ("mic", "Mic Control", "What the buttons on a TC-Helicon MP-75 or MP-76 mic do. The four MP-76 buttons apply when MP-76 Control is Custom.", [
        (20, "MP-75 Control", "choice", ["HIT", "HIT + Talk", "Preset Up", "Loop"]),
        (48, "MP-76 Control", "choice", ["Default", "Custom"]),
        (47, "MP-76 Top", "choice", MP76_FUNCTIONS),
        (45, "MP-76 Bottom", "choice", MP76_FUNCTIONS),
        (46, "MP-76 Left", "choice", MP76_FUNCTIONS),
        (44, "MP-76 Right", "choice", MP76_FUNCTIONS),
    ]),
]
SETUP_FIELDS = {i: (label, kind, extra) for _, _, _, fields in SETUP_PAGES for i, label, kind, extra in fields}


def setup_value_ok(index, value):
    if index not in SETUP_FIELDS:
        return False
    _, kind, extra = SETUP_FIELDS[index]
    if kind in ("choice", "onoff"):
        return 0 <= value < len(extra) and not (index == 9 and value == 7)  # RoomSense input is set via RoomSense: Voice
    if kind in ("percent", "locut"):
        return extra[0] <= value <= extra[1]
    return -200 <= value <= 2000  # step / hz2: range not measured; the pedal's read-back is the judge


def as_json():
    return {
        "setup": [{"id": i, "title": t, "help": h,
                   "fields": [{"index": x, "label": l, "kind": k,
                               "options": e if k in ("choice", "onoff") else None,
                               "unit": e if k in ("step", "hz2") else None,
                               "min": e[0] if k in ("percent", "locut") else None,
                               "max": e[1] if k in ("percent", "locut") else None}
                              for x, l, k, e in fields]}
                  for i, t, h, fields in SETUP_PAGES],
        "blocks": [{"id": b, "title": t, "help": h} for b, t, h in BLOCKS],
        "params": [
            {"slot": s, "block": b, "label": l, "kind": k,
             "options": o if k == "choice" else None,
             "min": o[0] if k in ("range", "db") else None,
             "max": o[1] if k in ("range", "db") else None,
             "confirmed": c}
            for s, b, l, k, o, c in PARAMS
        ],
    }
