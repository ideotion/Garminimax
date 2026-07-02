# SPDX-License-Identifier: GPL-3.0-or-later
"""Tests for the running-fitness (VDOT) trend and its API endpoint.

Runs are plain summaries (distance + duration), so every estimate is
hand-checkable against the Daniels–Gilbert model via ``vdot_for_effort``.
"""

from __future__ import annotations

import datetime as _dt

from fastapi.testclient import TestClient
import pytest

from core import compute_fitness_trend
from core.config import write_config
from core.models import Activity
from core.race import vdot_for_effort
from server.app import create_app

_START = _dt.date(2024, 3, 1)


def _run(day: int, *, km: float, minutes: float, sport: str = "running",
         act_id: int | None = None) -> Activity:
    return Activity(
        id=act_id,
        sport=sport,
        start_time=_dt.datetime(_START.year, _START.month, _START.day, 8)
        + _dt.timedelta(days=day),
        total_distance=km * 1000.0,
        total_timer_time=minutes * 60.0,
    )


def test_points_score_the_whole_run_with_the_shared_model():
    ft = compute_fitness_trend([_run(0, km=5, minutes=25)])
    assert ft["available"] is True
    p = ft["points"][0]
    assert p["vdot"] == round(vdot_for_effort(5000.0, 1500.0), 1)  # single formula source
    assert ft["current"]["vdot"] == p["vdot"]


def test_envelope_is_the_rolling_window_maximum():
    # A fast 5K, then slower runs: the envelope holds the fast mark while it is
    # inside the window, then drops to the best remaining run once it ages out.
    acts = [
        _run(0, km=5, minutes=22),    # fast -> high VDOT
        _run(30, km=5, minutes=28),   # slower
        _run(120, km=5, minutes=27),  # 120 days later: the fast run left the 90d window
    ]
    ft = compute_fitness_trend(acts)
    fast = round(vdot_for_effort(5000, 22 * 60.0), 1)
    slow27 = round(vdot_for_effort(5000, 27 * 60.0), 1)
    env = {e["date"]: e["vdot"] for e in ft["envelope"]}
    assert env[acts[0].start_time.date().isoformat()] == fast
    assert env[acts[1].start_time.date().isoformat()] == fast     # still holds the fast mark
    assert env[acts[2].start_time.date().isoformat()] == slow27   # fast run aged out
    assert ft["all_time_best"]["vdot"] == fast                    # all-time best remembers it


def test_delta_30d_reflects_recent_change():
    # Envelope rises from the day-0 slow mark to the day-40 fast mark.
    acts = [_run(0, km=5, minutes=30), _run(40, km=5, minutes=24)]
    ft = compute_fitness_trend(acts)
    expected = round(
        round(vdot_for_effort(5000, 24 * 60.0), 1) - round(vdot_for_effort(5000, 30 * 60.0), 1), 1
    )
    assert ft["delta_30d"] == pytest.approx(expected, abs=0.11)


def test_short_efforts_and_other_sports_are_excluded():
    acts = [
        _run(0, km=0.4, minutes=2),                  # too short a distance
        _run(1, km=5, minutes=1.5),                  # too short a duration
        _run(2, km=5, minutes=25, sport="cycling"),  # wrong sport for the model
    ]
    ft = compute_fitness_trend(acts)
    assert ft["available"] is False and ft["points"] == []


def test_trail_running_counts():
    ft = compute_fitness_trend([_run(0, km=8, minutes=45, sport="trail_running")])
    assert ft["available"] is True and len(ft["points"]) == 1


def test_notes_carry_the_honesty_framing():
    ft = compute_fitness_trend([_run(0, km=5, minutes=25)])
    text = " ".join(ft["notes"]).lower()
    assert "lower-bound" in text and "not garmin" in text


# --------------------------------------------------------------------------- #
# API
# --------------------------------------------------------------------------- #
@pytest.fixture
def client(tmp_config, tmp_path) -> TestClient:
    cfg_path = tmp_path / "config.yaml"
    write_config(tmp_config, cfg_path)
    return TestClient(create_app(str(cfg_path)))


def test_fitness_endpoint_shape(client: TestClient, tmp_config):
    from core.store import Store

    empty = client.get("/api/insights/fitness").json()
    assert empty["available"] is False and empty["points"] == []

    with Store(tmp_config.storage.db_file) as store:
        store.add_activity(_run(0, km=10, minutes=55))
    ft = client.get("/api/insights/fitness").json()
    assert ft["available"] is True
    assert set(ft) == {"available", "window_days", "points", "envelope", "current",
                       "all_time_best", "delta_30d", "notes"}
    assert ft["window_days"] == 90
    assert ft["current"]["vdot"] == ft["points"][0]["vdot"]