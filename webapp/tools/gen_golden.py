#!/usr/bin/env python3
"""Generate golden analytics fixtures from the canonical Python core.

Dumps (portable input -> core output) pairs for the JS engine port to match, so
the browser analytics can never silently drift from core/. Run from the
Garminimax checkout:  python tools/gen_golden.py > test/golden.json

Each case carries `activities` (plain dicts), `athlete`, optional `as_of` /
`wellness`, and the core's `training_load` + `coach_state` outputs.
"""
from __future__ import annotations

import datetime as dt
import json
import sys
from pathlib import Path

# Import the canonical engine from the Garminimax checkout (repo root is two
# levels up from webapp/tools/).
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from core import compute_coach_state, compute_training_load  # noqa: E402
from core.config import AthleteConfig  # noqa: E402
from core.models import Activity  # noqa: E402
from core.wellness import DayWellness  # noqa: E402

BASE = dt.date(2024, 1, 1)


def act(day_offset, *, minutes=60.0, sport="running", power=None, hr=None):
    """A portable activity dict + its Activity for the core."""
    start = dt.datetime(BASE.year, BASE.month, BASE.day, 8) + dt.timedelta(days=day_offset)
    return {
        "date": start.date().isoformat(), "start_time": start.isoformat(),
        "sport": sport, "duration_s": minutes * 60.0,
        "avg_power": power, "avg_heart_rate": hr,
    }


def to_activity(a):
    return Activity(
        sport=a["sport"], start_time=dt.datetime.fromisoformat(a["start_time"]),
        total_timer_time=a["duration_s"], avg_power=a["avg_power"],
        avg_heart_rate=a["avg_heart_rate"],
    )


def wellness(day_offset, rhr, stress=25):
    d = (BASE + dt.timedelta(days=day_offset)).isoformat()
    return {"date": d, "resting_hr": rhr, "avg_stress": stress}


def to_wellness(w):
    return DayWellness(date=w["date"], steps=None, resting_hr=w["resting_hr"],
                       avg_hr=None, max_hr=None, avg_stress=w["avg_stress"], stress_samples=4)


def case(name, activities, athlete, *, as_of=None, wellness_days=None):
    acts = [to_activity(a) for a in activities]
    ath = AthleteConfig(**athlete)
    well = [to_wellness(w) for w in (wellness_days or [])]
    # Always pin as_of so the fixture is deterministic (never "today"): default to
    # the last activity date. The JS test reads this back, so it never diverges.
    if as_of is None and activities:
        as_of = max(a["date"] for a in activities)
    as_of_d = dt.date.fromisoformat(as_of) if as_of else None
    tl = compute_training_load(acts, ath, as_of=as_of_d)
    cs = compute_coach_state(acts, ath, as_of=as_of_d, wellness=well)
    return {
        "name": name,
        "input": {"activities": activities, "athlete": athlete,
                  "as_of": as_of, "wellness": wellness_days or []},
        "training_load": tl,
        "coach_state": cs.as_dict(),
    }


def main():
    hr_ath = {"max_heart_rate": 190, "resting_heart_rate": 50}
    pw_ath = {"ftp_w": 250}
    cases = [
        case("duration_basis_no_thresholds",
             [act(0, minutes=60), act(1, minutes=45), act(3, minutes=90)], {}),
        case("hr_trimp_basis",
             [act(0, minutes=60, hr=169), act(2, minutes=40, hr=150)], hr_ath),
        case("power_tss_basis",
             [act(0, minutes=60, power=250), act(1, minutes=90, power=200)], pw_ath),
        case("mixed_bases",
             [act(0, minutes=60, power=250), act(1, minutes=60, hr=169)],
             {"ftp_w": 250, "max_heart_rate": 190, "resting_heart_rate": 50}),
        case("as_of_decays_to_today",
             [act(0, minutes=90, hr=175)], hr_ath, as_of="2024-01-10"),
        # A 5-week HR build -> exercises ramp / ACWR / monotony / days-since-hard.
        case("five_week_build_coach_state",
             [act(i, minutes=(80 if i % 3 == 0 else 45), hr=(168 if i % 3 == 0 else 148))
              for i in range(35)],
             hr_ath, as_of="2024-02-05",
             wellness_days=[wellness(28 + i, 50) for i in range(6)] + [wellness(34, 58)]),
        case("empty_history", [], hr_ath, as_of="2024-02-05"),
    ]
    json.dump({"generated_from": "garminimax core", "cases": cases}, sys.stdout, indent=1)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
