# SPDX-License-Identifier: GPL-3.0-or-later
"""Manual activity entries -- logging work no watch recorded (pure, stdlib-only).

Completed guided sessions (Sports at Home, Tai Chi flows) and any other unwatched
training can be logged straight into the archive as first-class activities, so
training load, monotony, insights and the yearly recap see the *whole* picture --
not just what the watch filed. Without this, cross-training the coach itself
prescribes is invisible to the analytics.

Manual entries are ordinary :class:`~core.models.Activity` rows with three
distinguishing marks:

* ``file_hash`` is a synthetic ``manual-<hex>`` key (the store's content-addressed
  primary key requires one; the prefix guarantees it can never collide with a real
  SHA-256, which is 64 hex chars with no dash).
* ``extra["source"] == "manual"`` (plus an optional human ``label``).
* no ``raw_path`` -- raw export correctly reports the original file unavailable.

They are the only activities the API allows deleting (a typo in a manual log
should be correctable; imported watch data stays immutable-by-default).
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from .models import Activity

MANUAL_PREFIX = "manual-"

# Practical bounds for a hand-entered session (a typo guard, not a judgement).
MAX_DURATION_MIN = 24 * 60.0
HR_RANGE = (30, 250)
LABEL_MAX = 120


def is_manual(activity: Activity) -> bool:
    """True if this activity was hand-logged rather than imported from a file."""
    return (activity.file_hash or "").startswith(MANUAL_PREFIX)


def create_manual_activity(
    *,
    sport: str,
    duration_min: float,
    start_time: datetime | None = None,
    avg_heart_rate: int | None = None,
    total_calories: int | None = None,
    label: str | None = None,
) -> Activity:
    """Build (not persist) a validated manual :class:`Activity`.

    ``sport`` is normalised to a lowercase slug (spaces/dashes -> underscores) so
    manual entries filter alongside FIT-derived sports. ``start_time`` defaults to
    now (UTC); naive datetimes are taken as UTC, matching the importers. Raises
    ``ValueError`` on out-of-range input -- the API maps that to a 422.
    """
    slug = (sport or "").strip().lower().replace(" ", "_").replace("-", "_")
    if not slug or not slug.replace("_", "").isalnum():
        raise ValueError("sport must be a simple name, e.g. strength_training")
    if not (0 < duration_min <= MAX_DURATION_MIN):
        raise ValueError(f"duration_min must be in (0, {MAX_DURATION_MIN:.0f}]")
    if avg_heart_rate is not None and not (HR_RANGE[0] <= avg_heart_rate <= HR_RANGE[1]):
        raise ValueError(f"avg_heart_rate must be within {HR_RANGE[0]}..{HR_RANGE[1]} bpm")
    if total_calories is not None and total_calories < 0:
        raise ValueError("total_calories must be >= 0")
    if label is not None and len(label) > LABEL_MAX:
        raise ValueError(f"label is limited to {LABEL_MAX} characters")

    start = start_time or datetime.now(timezone.utc)
    if start.tzinfo is not None:
        start = start.astimezone(timezone.utc).replace(tzinfo=None)

    extra: dict = {"source": "manual"}
    if label:
        extra["label"] = label.strip()

    return Activity(
        file_hash=MANUAL_PREFIX + uuid.uuid4().hex,
        sport=slug,
        start_time=start,
        total_timer_time=float(duration_min) * 60.0,
        total_elapsed_time=float(duration_min) * 60.0,
        avg_heart_rate=avg_heart_rate,
        total_calories=total_calories,
        extra=extra,
    )
