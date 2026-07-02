#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
"""Vendored-asset license & size gate (3-D realism mission PR11).

Every third-party file vendored into the app (today ``web/vendor/``; later
``web/models/`` for avatars, sound packs, …) must be listed in
``web/vendor/manifest.json`` with its source, an allowlisted license, a pinned
SHA-256, and a size budget. This checker fails when:

* a scanned file is missing from the manifest (nothing sneaks in),
* a listed file is missing, its hash differs, or it exceeds its size budget,
* a license is outside the allowlist (GPL-3.0-compatible, redistributable),
* the manifest itself is malformed.

Run standalone (``python scripts/check_vendor_manifest.py``, exit 1 on
problems) or through the pytest gate (``tests/test_vendor_manifest.py``).
First-party metadata files (README/NOTICE/LICENSE/the manifest itself) are
exempt from the must-be-listed rule; they are documentation, not assets.
"""

from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MANIFEST_PATH = ROOT / "web" / "vendor" / "manifest.json"
# Directories whose every (non-exempt) file must be manifested. Extend this
# list when a new asset root appears (models, sounds, fonts, …).
SCAN_ROOTS = ("web/vendor", "web/models")
EXEMPT_NAMES = {"README.md", "NOTICE", "NOTICE.md", "LICENSE", "LICENSE.md",
                "manifest.json", ".gitkeep"}

ALLOWED_LICENSES = {
    "MIT", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause",
    "CC0-1.0", "Unlicense", "CC-BY-4.0",
}
REQUIRED_FIELDS = ("path", "name", "version", "license", "source", "sha256", "max_bytes")


def sha256_of(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 16), b""):
            h.update(chunk)
    return h.hexdigest()


def load_manifest(manifest_path: Path) -> dict:
    return json.loads(manifest_path.read_text(encoding="utf-8"))


def check_manifest(manifest: dict, *, root: Path, allowed: set[str] | None = None) -> list[str]:
    """Validate a manifest against the tree under ``root``; return problems."""
    allowed = allowed if allowed is not None else ALLOWED_LICENSES
    problems: list[str] = []
    assets = manifest.get("assets")
    if not isinstance(assets, list):
        return ["manifest has no 'assets' list"]

    listed: set[str] = set()
    for entry in assets:
        ident = entry.get("path", "<missing path>")
        for field in REQUIRED_FIELDS:
            if not entry.get(field):
                problems.append(f"{ident}: missing required field '{field}'")
        if not all(entry.get(f) for f in REQUIRED_FIELDS):
            continue
        listed.add(entry["path"])
        if entry["license"] not in allowed:
            problems.append(f"{ident}: license '{entry['license']}' is not in the allowlist")
        path = root / entry["path"]
        if not path.is_file():
            problems.append(f"{ident}: file does not exist")
            continue
        size = path.stat().st_size
        if size > int(entry["max_bytes"]):
            problems.append(f"{ident}: {size} bytes exceeds budget {entry['max_bytes']}")
        digest = sha256_of(path)
        if digest != entry["sha256"]:
            problems.append(f"{ident}: sha256 mismatch (file {digest[:16]}…, manifest {str(entry['sha256'])[:16]}…)")

    for scan in manifest.get("_meta", {}).get("scan_roots", SCAN_ROOTS):
        base = root / scan
        if not base.is_dir():
            continue
        for path in sorted(base.rglob("*")):
            if not path.is_file() or path.name in EXEMPT_NAMES:
                continue
            rel = path.relative_to(root).as_posix()
            if rel not in listed:
                problems.append(f"{rel}: vendored file is not in the manifest")

    return problems


def main() -> int:
    try:
        manifest = load_manifest(MANIFEST_PATH)
    except (OSError, ValueError) as exc:
        print(f"cannot read {MANIFEST_PATH}: {exc}")
        return 1
    problems = check_manifest(manifest, root=ROOT)
    if problems:
        print("vendored-asset gate FAILED:")
        for p in problems:
            print(f"  - {p}")
        return 1
    n = len(manifest.get("assets", []))
    print(f"vendored-asset gate OK ({n} asset{'s' if n != 1 else ''} verified)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
