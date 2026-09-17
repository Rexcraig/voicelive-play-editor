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

# Plain-language help for each effect setting, shown behind the info button in the editor.
PARAM_HELP = {
    1: "Which harmony lines the pedal sings with you: above, below, or both, and how many voices.",
    2: "The song's key, so the harmonies stay in tune. Auto follows what the pedal hears you sing.",
    3: "Which scale the harmony notes are picked from inside the key. The variations shift a few notes each, so try them if a harmony sounds sour.",
    5: "How loud the harmony voices are against your own.",
    4: "How many copies of your voice are added and how closely they follow it. Wider styles spread them left and right.",
    6: "How loud the copies are against your own voice.",
    20: "The kind of space: plates and rooms are tight, halls and arenas are big.",
    21: "How long the reverb tail lasts after you stop singing.",
    9: "How loud the reverb is against your voice.",
    14: "The echo pattern: single repeats, rhythmic ones that follow the tempo, or ping-pong between left and right.",
    16: "How long before the echo repeats on the left, in milliseconds. Only styles that don't follow the tempo use it.",
    17: "How long before the echo repeats on the right, in milliseconds. Only styles that don't follow the tempo use it.",
    18: "How many times each echo repeats before fading away.",
    19: "The tone of the repeats. Tape and analog styles get duller with each one, like older echo machines.",
    8: "How loud the echoes are against your voice.",
    13: "The kind of movement added: chorus, flanging, rotating speaker and stranger effects.",
    7: "How loud the modulation effect is against your voice.",
    27: "How hard your pitch is pushed to the nearest note, from gentle correction to the hard Auto-Tune sound.",
    28: "Moves your voice up or down in semitones.",
    29: "Changes the character of the voice: lower sounds bigger and deeper, higher sounds thinner and brighter.",
    22: "The voice it imitates: megaphone, radio, telephone or a guitar amp.",
    24: "How hard the sound is pushed, from slight grit to full distortion.",
    26: "The tone of the distortion, from thin and boxy to full and open.",
    15: "The song's tempo. Delay styles that follow the beat use it, so their echoes stay in time.",
}

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


# Plain-language help for each setup field, from the manual plus what we measured on the unit.
SETUP_HELP = {
    9: "Which input the pedal listens to. Match it to the microphone you plug in, so the pedal can tune its preamp for that type. USB Left/Right takes sound from a computer instead.",
    28: "The two small microphones built into the pedal. Ambient picks up the room for your headphone mix. Ambient/Auto also listens to the music to work out its key, so harmonies can follow the band. Voice uses them instead of a microphone, and is heard in headphones only.",
    31: "What is plugged into the Aux socket. Live suits a band or instrument feed, Tracks suits pre-recorded music you sing along to, and Monitor lets you hear it without using it to work out the key.",
    30: "Automatic EQ, compression and gating on the lead voice. Normal suits most singers. The NG versions leave the gate off, so a very quiet voice is never cut off.",
    8: "Gentle automatic tuning applied to everything you sing. Off leaves the voice untouched; higher amounts pull harder towards the nearest note, up to a hard Auto-Tune effect.",
    6: "How the two XLR outputs are used. Stereo sends the whole sound to both. Mono sends your dry voice out Left and all effects out Right, for a sound engineer who wants them separate. Dual Mono sends voice and effects out Left, and anything from Aux out Right. With only one cable in Left, Mono means no effects are heard.",
    1: "Level of the sound the pedal sends to a computer over USB.",
    35: "Tries to remove the lead vocal from music coming in on Aux, so you can sing along karaoke style. How well it works varies from song to song.",
    34: "Where the headphone limiter starts holding the volume back, to protect your ears.",
    19: "Removes your own voice from the output, leaving only the processed sounds such as harmonies.",
    32: "Whether music coming in on Aux is also sent to the PA, or stays in your headphones only.",
    17: "Keeps the key you set for harmonies when you change presets, instead of each preset bringing its own.",
    15: "Keeps the tempo you tapped when you change presets, so delays stay in time from song to song.",
    36: "Extra gain for quiet sources. Off suits a line-level source such as a wireless receiver; Low or High suit a microphone plugged straight in. Watch the pedal's input light while singing loudly: it should never sit red.",
    7: "What the looper records: your voice with its effects, the Aux input, or both together.",
    24: "Keeps the last loop layer undoable. On gives 15 seconds of loop time; Off doubles it to 30 seconds.",
    23: "How loud the existing layers stay when you record another one. Around 90% stops a loop getting louder with every pass.",
    21: "How dark the pedal's own screen looks. Adjust it for the light you play in.",
    14: "The tuning everything is measured against. 440.0 Hz is standard; change it to match instruments tuned elsewhere.",
    22: "What pressing both footswitches together does: start looping, or set the key for harmonies.",
    13: "Volume of the reference note in the pedal's Practice screen.",
    18: "Delays your dry voice very slightly so harmonies line up exactly with it. None is the most immediate. Voice Sync always aligns by the same amount. Auto aligns by how many effects are running.",
    43: "Cuts low rumble picked up by the pedal's built-in room microphones, such as stage noise or air conditioning.",
    37: "Whether an optional three-button footswitch runs the looper with fixed functions, or the three assignments you choose below.",
    38: "Harmony sounds only while a footswitch is held down, instead of switching on and off with each press.",
    39: "Delay sounds only while a footswitch is held down.",
    40: "What the first button on an optional three-button footswitch does. It applies when Control is set to Custom.",
    41: "What the second button on an optional three-button footswitch does. It applies when Control is set to Custom.",
    42: "What the third button on an optional three-button footswitch does. It applies when Control is set to Custom.",
    20: "What the button on a TC-Helicon MP-75 microphone does.",
    48: "Whether a TC-Helicon MP-76 microphone uses its standard button layout, or the four assignments you choose below.",
    47: "What the top button on an MP-76 microphone does. It applies when MP-76 Control is set to Custom.",
    45: "What the bottom button on an MP-76 microphone does. It applies when MP-76 Control is set to Custom.",
    46: "What the left button on an MP-76 microphone does. It applies when MP-76 Control is set to Custom.",
    44: "What the right button on an MP-76 microphone does. It applies when MP-76 Control is set to Custom.",
}


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
                   "fields": [{"index": x, "label": l, "kind": k, "help": SETUP_HELP.get(x, ""),
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
             "confirmed": c, "help": PARAM_HELP.get(s, "")}
            for s, b, l, k, o, c in PARAMS
        ],
    }
