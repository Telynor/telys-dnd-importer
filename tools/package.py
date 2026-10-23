#!/usr/bin/env python3
"""Create installable and source ZIPs; no network or build dependencies."""
import json
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

ROOT = Path(__file__).resolve().parents[1]
VERSION = json.loads((ROOT / "module.json").read_text())["version"]
OUT = ROOT.parent / "deliverables"
OUT.mkdir(exist_ok=True)

with ZipFile(OUT / f"telys-dnd-importer-{VERSION}.zip", "w", ZIP_DEFLATED) as archive:
    for path in sorted(ROOT.rglob("*")):
        if path.is_file() and not any(part in {"__pycache__", ".git", "node_modules", "dist"} for part in path.relative_to(ROOT).parts):
            archive.write(path, Path(ROOT.name) / path.relative_to(ROOT))
print(OUT / f"telys-dnd-importer-{VERSION}.zip")
