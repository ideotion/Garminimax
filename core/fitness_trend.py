# SPDX-License-Identifier: GPL-3.0-or-later
"""Aerobic fitness trend -- whole-run VO₂max/VDOT estimates over time (pure, stdlib).

Completes the VO₂max story. :mod:`core.race` estimates VO₂max from one activity's
best *sustained* effort (which needs the trackpoint series); this module tracks
the trend across the whole history from **summaries alone** (one query, no
per-activity series load -- same efficiency rule as :mod:`core.hr_trends`) by
scoring each run's overall distance/time with the same Daniels–Gilbert model
(:func:`core.race.vdot_for_effort`).

Honesty, load-bearing:

* A whole-run average is a **lower-bound** estimate -- an easy run reads low; the
  best-effort figure on the activity page is the sharper single-day number.
* The trend therefore follows a rolling ``window_days`` **maximum** -- the
  envelope of fitness you have actually demonstrated -- which jumps up with a
  strong effort and decays only as that effort ages out of the window. It never
  pretends day-to-day precision.
* Running-only (the model is running-specific), and explicitly **not** Garmin's
  proprietary FirstBeat VO₂max.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Iterable

from .models import Activity
from .race import vdot_for_effort

_FOOT_SPORTS = {"running", "trail_running"}

# Trust the same effort floor as race predictions: at least this far and this
# long, so a GPS blip or a sprint can't anchor the estimate.
_MIN_DIST_M = 1000.0
_MIN_TIME_S = 120.0

# The fitness envelope: your best demonstrated VDOT in this trailing window.
WINDOW_DAYS = 90
# The recent-change comparison span reported as ``delta_30d``.
_DELTA_DAYS = 30


@dataclass
class FitnessPoint:
    """One run's whole-run VDOT estimate."""

    date: str            # YYYY-MM-DD (UTC)
    activity_id: int | None
    vdot: float
    distance_m: float
    time_s: float

    def as_dict(self) -> dict:
        return {
            "date": self.date,
            "activity_id": self.activity_id,
            "vdot": round(self.vdot, 1),
            "distance_m": round(self.distance_m, 1),
            "time_s": round(self.time_s, 1),
        }


def _utc_date(dt: datetime) -> str:
    if dt.tzinfo is not None:
        dt = dt.astimezone(timezone.utc)
    return dt.date().isoformat()


def compute_fitness_trend(
    activities: Iterable[Activity], *, window_days: int = WINDOW_DAYS
) -> dict:
    """The running-fitness (VDOT) trend over the whole local history.

    Scores every qualifying run (running/trail, ≥ 1 km and ≥ 2 min) from its
    summary distance/time, then derives the rolling ``window_days``-maximum
    envelope, the current value, the all-time best, and the ~30-day change.
    Summaries only -- never loads a trackpoint series. Returns
    ``available=False`` with empty fields when nothing qualifies.
    """
    points: list[FitnessPoint] = []
    for a in activities:
        if (a.sport or "").lower() not in _FOOT_SPORTS or a.start_time is None:
            continue
        dist = a.total_distance or 0.0
        dur = a.total_timer_time or 0.0
        if dist < _MIN_DIST_M or dur < _MIN_TIME_S:
            continue
        vdot = vdot_for_effort(dist, dur)
        if vdot is None or vdot <= 0:
            continue
        points.append(FitnessPoint(_utc_date(a.start_time), a.id, vdot, dist, dur))
    points.sort(key=lambda p: (p.date, p.activity_id or 0))

    if not points:
        return {
            "available": False, "window_days": window_days, "points": [],
            "envelope": [], "current": None, "all_time_best": None,
            "delta_30d": None, "notes": [],
        }

    # Rolling-window maximum per active date: the demonstrated-fitness envelope.
    dates = sorted({p.date for p in points})
    envelope: list[dict] = []
    for d in dates:
        floor = (datetime.fromisoformat(d) - timedelta(days=window_days)).date().isoformat()
        best = max(p.vdot for p in points if floor < p.date <= d)
        envelope.append({"date": d, "vdot": round(best, 1)})

    current = envelope[-1]
    best_point = max(points, key=lambda p: p.vdot)

    # Change vs the envelope ~30 days before the latest active day.
    delta_30d = None
    cutoff = (datetime.fromisoformat(current["date"]) - timedelta(days=_DELTA_DAYS)).date().isoformat()
    earlier = [e for e in envelope if e["date"] <= cutoff]
    if earlier:
        delta_30d = round(current["vdot"] - earlier[-1]["vdot"], 1)

    return {
        "available": True,
        "window_days": window_days,
        "points": [p.as_dict() for p in points],
        "envelope": envelope,
        "current": current,
        "all_time_best": best_point.as_dict(),
        "delta_30d": delta_30d,
        "notes": [
            "Each point scores the whole run's average pace, so it is a lower-bound "
            "estimate -- easy runs read low. The activity page's best-effort figure "
            "is the sharper single-day number.",
            f"The trend line is your best estimate in the trailing {window_days} days "
            "(the fitness you have actually demonstrated), not a day-to-day reading.",
            "An open Daniels–Gilbert (VDOT) model computed locally -- not Garmin's "
            "proprietary FirstBeat VO₂max.",
        ],
    }
