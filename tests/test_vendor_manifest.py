# SPDX-License-Identifier: GPL-3.0-or-later
"""The vendored-asset license & size gate (3-D realism mission PR11).

The clean tree must pass, and the checker must reject each planted violation:
a disallowed license, an oversized file, a hash mismatch, a missing file, and
an unmanifested file smuggled into a scan root. Negative fixtures run against
a temp tree so the real manifest stays untouched.
"""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path

_SPEC = importlib.util.spec_from_file_location(
    "check_vendor_manifest",
    Path(__file__).resolve().parent.parent / "scripts" / "check_vendor_manifest.py",
)
gate = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(gate)


def test_clean_tree_passes_the_gate():
    manifest = gate.load_manifest(gate.MANIFEST_PATH)
    problems = gate.check_manifest(manifest, root=gate.ROOT)
    assert problems == [], "\n".join(problems)


def test_every_known_vendored_asset_is_pinned():
    manifest = gate.load_manifest(gate.MANIFEST_PATH)
    paths = {a["path"] for a in manifest["assets"]}
    assert "web/vendor/chart.umd.js" in paths
    for a in manifest["assets"]:
        assert len(a["sha256"]) == 64, f"{a['path']}: sha256 must be pinned"
        assert a["license"] in gate.ALLOWED_LICENSES


def _tree(tmp_path: Path, content: bytes = b"asset-bytes") -> tuple[Path, dict]:
    (tmp_path / "web" / "vendor").mkdir(parents=True)
    f = tmp_path / "web" / "vendor" / "thing.js"
    f.write_bytes(content)
    manifest = {
        "_meta": {"scan_roots": ["web/vendor"]},
        "assets": [{
            "path": "web/vendor/thing.js", "name": "Thing", "version": "1.0",
            "license": "MIT", "source": "https://example.org/thing",
            "sha256": gate.sha256_of(f), "max_bytes": 1000,
        }],
    }
    return tmp_path, manifest


def test_disallowed_license_is_rejected(tmp_path):
    root, manifest = _tree(tmp_path)
    manifest["assets"][0]["license"] = "CC-BY-NC-4.0"   # non-commercial: hard reject
    problems = gate.check_manifest(manifest, root=root)
    assert any("not in the allowlist" in p for p in problems)


def test_oversized_asset_is_rejected(tmp_path):
    root, manifest = _tree(tmp_path, content=b"x" * 2000)
    manifest["assets"][0]["sha256"] = gate.sha256_of(root / "web" / "vendor" / "thing.js")
    problems = gate.check_manifest(manifest, root=root)   # max_bytes stays 1000
    assert any("exceeds budget" in p for p in problems)


def test_hash_mismatch_is_rejected(tmp_path):
    root, manifest = _tree(tmp_path)
    manifest["assets"][0]["sha256"] = "0" * 64
    problems = gate.check_manifest(manifest, root=root)
    assert any("sha256 mismatch" in p for p in problems)


def test_missing_file_is_rejected(tmp_path):
    root, manifest = _tree(tmp_path)
    (root / "web" / "vendor" / "thing.js").unlink()
    problems = gate.check_manifest(manifest, root=root)
    assert any("does not exist" in p for p in problems)


def test_unmanifested_file_in_scan_root_is_rejected(tmp_path):
    root, manifest = _tree(tmp_path)
    (root / "web" / "vendor" / "smuggled.bin").write_bytes(b"\x00\x01")
    problems = gate.check_manifest(manifest, root=root)
    assert any("smuggled.bin" in p and "not in the manifest" in p for p in problems)


def test_first_party_metadata_is_exempt(tmp_path):
    root, manifest = _tree(tmp_path)
    (root / "web" / "vendor" / "README.md").write_text("docs")
    (root / "web" / "vendor" / "manifest.json").write_text(json.dumps(manifest))
    problems = gate.check_manifest(manifest, root=root)
    assert problems == []


def test_missing_required_field_is_rejected(tmp_path):
    root, manifest = _tree(tmp_path)
    del manifest["assets"][0]["source"]
    problems = gate.check_manifest(manifest, root=root)
    assert any("missing required field 'source'" in p for p in problems)
