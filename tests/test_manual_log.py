# SPDX-License-Identifier: GPL-3.0-or-later
"""Tests for manual activity logging (core.manual + its API endpoints).

The loop this closes: guided sessions (Sports at Home / Tai Chi) and any other
unwatched training can land in the archive as first-class activities, so
training load and insights see the whole picture. Manual entries are also the
only deletable activities -- imported watch data stays immutable.
"""

from __future__ import annotations

import datetime as _dt
import time

import pytest
from fastapi.testclient import TestClient

from core.config import write_config
from core.manual import MANUAL_PREFIX, create_manual_activity, is_manual
from server.app import create_app


# --------------------------------------------------------------------------- #
# core
# --------------------------------------------------------------------------- #
def test_create_manual_activity_shape():
    a = create_manual_activity(
        sport="Strength Training", duration_min=25,
        start_time=_dt.datetime(2026, 7, 1, 18, 30), avg_heart_rate=112, label="Home session",
    )
    assert a.file_hash.startswith(MANUAL_PREFIX) and len(a.file_hash) > len(MANUAL_PREFIX)
    assert a.sport == "strength_training"  # normalised to a filterable slug
    assert a.total_timer_time == 25 * 60.0
    assert a.extra == {"source": "manual", "label": "Home session"}
    assert is_manual(a)


def test_manual_hash_never_collides_with_real_sha256():
    # Real hashes are 64 bare hex chars; the manual prefix contains a dash.
    a = create_manual_activity(sport="yoga", duration_min=10)
    assert "-" in a.file_hash and len(a.file_hash) != 64


def test_manual_start_time_defaults_to_now_utc():
    before = _dt.datetime.now(_dt.timezone.utc).replace(tzinfo=None)
    a = create_manual_activity(sport="walking", duration_min=15)
    after = _dt.datetime.now(_dt.timezone.utc).replace(tzinfo=None)
    assert before <= a.start_time <= after


@pytest.mark.parametrize("kwargs, msg", [
    (dict(sport="", duration_min=10), "sport"),
    (dict(sport="run!", duration_min=10), "sport"),
    (dict(sport="run", duration_min=0), "duration"),
    (dict(sport="run", duration_min=10_000), "duration"),
    (dict(sport="run", duration_min=10, avg_heart_rate=20), "heart_rate"),
    (dict(sport="run", duration_min=10, label="x" * 200), "label"),
])
def test_create_manual_activity_validation(kwargs, msg):
    with pytest.raises(ValueError, match=msg):
        create_manual_activity(**kwargs)


# --------------------------------------------------------------------------- #
# API
# --------------------------------------------------------------------------- #
@pytest.fixture
def client(tmp_config, tmp_path) -> TestClient:
    cfg_path = tmp_path / "config.yaml"
    write_config(tmp_config, cfg_path)
    return TestClient(create_app(str(cfg_path)))


def _sync(client: TestClient) -> None:
    job_id = client.post("/api/sync").json()["job_id"]
    deadline = time.time() + 15
    while time.time() < deadline:
        if client.get(f"/api/sync/{job_id}").json()["status"] != "running":
            return
        time.sleep(0.1)


def test_manual_log_feeds_list_and_training_load(client: TestClient):
    r = client.post("/api/activities/manual", json={
        "sport": "taichi", "duration_min": 20, "start_time": "2026-07-01T09:00:00",
        "label": "Morning flow",
    })
    assert r.status_code == 200
    body = r.json()
    assert body["file_hash"].startswith(MANUAL_PREFIX)
    assert body["extra"]["source"] == "manual"

    lst = client.get("/api/activities").json()
    assert lst["total"] == 1 and "taichi" in lst["sports"]

    # The loop-closer: the hand-logged session counts toward training load.
    tl = client.get("/api/insights/training-load").json()
    assert tl["coverage"]["activities"] == 1
    assert tl["coverage"]["basis"]["duration"] == 1
    assert tl["series"][0]["load"] == 20.0  # 20 min on the duration basis


def test_manual_entry_is_deletable(client: TestClient):
    rid = client.post("/api/activities/manual",
                      json={"sport": "yoga", "duration_min": 15}).json()["id"]
    assert client.delete(f"/api/activities/{rid}").status_code == 204
    assert client.get(f"/api/activities/{rid}").status_code == 404
    assert client.get("/api/activities").json()["total"] == 0


def test_imported_activity_is_immutable(client: TestClient):
    _sync(client)  # imports the fixture .FIT
    imported = client.get("/api/activities").json()["items"][0]
    r = client.delete(f"/api/activities/{imported['id']}")
    assert r.status_code == 409
    assert "immutable" in r.json()["detail"]
    assert client.get("/api/activities").json()["total"] == 1  # still there


def test_delete_missing_is_404(client: TestClient):
    assert client.delete("/api/activities/12345").status_code == 404


def test_manual_validation_maps_to_422(client: TestClient):
    assert client.post("/api/activities/manual",
                       json={"sport": "x!", "duration_min": 10}).status_code == 422
    assert client.post("/api/activities/manual",
                       json={"sport": "run", "duration_min": 0}).status_code == 422
    assert client.post("/api/activities/manual",
                       json={"sport": "run", "duration_min": 10,
                             "start_time": "not-a-date"}).status_code == 422


def test_manual_raw_export_unavailable(client: TestClient):
    rid = client.post("/api/activities/manual",
                      json={"sport": "walking", "duration_min": 30}).json()["id"]
    r = client.get(f"/api/activities/{rid}/export", params={"format": "raw"})
    assert r.status_code == 422
    assert "not available" in r.json()["detail"]
