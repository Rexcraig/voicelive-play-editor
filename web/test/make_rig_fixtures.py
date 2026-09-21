#!/usr/bin/env python3
"""Regenerate web/test/rig-fixtures.json from the Python spec.py/server.py reference implementation,
so web/test/rig.test.mjs can prove web/src/rig.js matches it exactly.

Run with the project's venv:
  python3 web/test/make_rig_fixtures.py
"""
import copy
import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
import spec  # noqa: E402
import server  # noqa: E402

OUT = pathlib.Path(__file__).resolve().parent / "rig-fixtures.json"


def all_answer_combinations():
    """Every answers dict the wizard's UI could produce: walk RIG_QUESTIONS in order, branching over
    each visible question's options. Visibility (`when`) only ever depends on an earlier answer (mic),
    so a single left-to-right pass is enough; a question left invisible is simply absent from the dict,
    same as the UI never asking it."""
    def helper(i, answers):
        if i == len(spec.RIG_QUESTIONS):
            yield dict(answers)
            return
        q = spec.RIG_QUESTIONS[i]
        if spec.rig_visible(q, answers):
            for opt in q["options"]:
                answers[q["id"]] = opt["id"]
                yield from helper(i + 1, answers)
            del answers[q["id"]]
        else:
            yield from helper(i + 1, answers)

    yield from helper(0, {})


def value_sets():
    zeros = [0] * 75
    # tests/fake_pedal.py's FakePedal.__init__ default setup block.
    fake_default = [0] * 75
    fake_default[14], fake_default[21], fake_default[28] = 880, 2, 1
    # A pedal with RoomSense: Voice already selected — the linked fields (9=RoomSense input, 27) as
    # setup_changes would have left them, so this array is internally consistent like a real pedal's.
    roomsense_voice = [0] * 75
    roomsense_voice[28], roomsense_voice[9], roomsense_voice[27] = 2, 7, 1
    return {"zeros": zeros, "fakeDefault": fake_default, "roomsenseVoice": roomsense_voice}


def rig_plan_cases(sets):
    cases = []
    for answers in all_answer_combinations():
        for name, values in sets.items():
            cases.append({
                "answers": answers,
                "valueSet": name,
                "expected": spec.rig_plan(answers, values),
            })
    return cases


def setup_value_ok_cases():
    cases = []
    for index, (label, kind, extra) in spec.SETUP_FIELDS.items():
        if kind in ("choice", "onoff"):
            n = len(extra)
            candidates = {-1, 0, n - 1, n, n + 5}
            if index == 9:
                candidates.add(7)  # in range but reserved: RoomSense input is set via RoomSense: Voice
        elif kind in ("percent", "locut"):
            lo, hi = extra
            candidates = {lo - 1, lo, hi, hi + 1, (lo + hi) // 2}
        else:  # step / hz2
            candidates = {-201, -200, 2000, 2001, 0, 999}
        for value in sorted(candidates):
            cases.append({"index": index, "value": value, "expected": spec.setup_value_ok(index, value)})
    # An index the pedal's Setup menu doesn't have at all.
    cases.append({"index": 9999, "value": 0, "expected": spec.setup_value_ok(9999, 0)})
    return cases


def setup_changes_cases():
    zeros = [0] * 75

    def with_values(overrides):
        v = copy.copy(zeros)
        for i, val in overrides.items():
            v[i] = val
        return v

    scenarios = [
        # index 28 (RoomSense): switching onto Voice picks up the RoomSense input and its flag.
        (with_values({28: 0}), 28, 2),
        # switching off Voice restores whatever mic was last used (values[10]).
        (with_values({28: 2, 10: 3}), 28, 0),
        # neither edge: RoomSense moved between two non-Voice positions, no linked fields.
        (with_values({28: 0}), 28, 1),
        # already on Voice, set to Voice again: no-op on the linked fields.
        (with_values({28: 2}), 28, 2),
        # index 9 (Input): choosing a mic also records it as the last mic (index 10).
        (zeros, 9, 5),
        (zeros, 9, 0),
        # unrelated indexes: plain passthrough, no linked fields.
        (zeros, 6, 1),
        (zeros, 17, 0),
    ]
    cases = []
    for values, index, value in scenarios:
        cases.append({"values": values, "index": index, "value": value,
                      "expected": server.setup_changes(values, index, value)})
    return cases


def main():
    sets = value_sets()
    fixtures = {
        "setupValueOk": setup_value_ok_cases(),
        "setupChanges": setup_changes_cases(),
        "rigPlan": {"valueSets": sets, "cases": rig_plan_cases(sets)},
    }
    OUT.write_text(json.dumps(fixtures, indent=1) + "\n")
    print(f"wrote {OUT}: {len(fixtures['setupValueOk'])} setupValueOk cases, "
          f"{len(fixtures['setupChanges'])} setupChanges cases, "
          f"{len(fixtures['rigPlan']['cases'])} rigPlan cases")


if __name__ == "__main__":
    main()
