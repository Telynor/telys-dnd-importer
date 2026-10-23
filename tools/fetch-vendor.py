#!/usr/bin/env python3
"""Restore pinned OCR distributions for a source checkout; verify every byte."""
import argparse
import hashlib
import json
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.parse import urlsplit
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1] / "vendor" / "ocr"


def matches(path, asset):
    return (path.is_file() and path.stat().st_size == asset["bytes"]
            and hashlib.sha256(path.read_bytes()).hexdigest() == asset["sha256"])


def restore(asset, verify_only=False):
    target = (ROOT / asset["path"]).resolve()
    if not target.is_relative_to(ROOT.resolve()):
        raise ValueError("Unsafe vendor asset path")
    if matches(target, asset):
        return "verified " + asset["path"]
    if verify_only:
        raise ValueError("Missing or modified vendor asset: " + asset["path"])
    url = urlsplit(asset["source"])
    if url.scheme != "https" or url.hostname != "cdn.jsdelivr.net":
        raise ValueError("Unexpected vendor source: " + asset["path"])
    request = Request(asset["source"], headers={"User-Agent": "Telys-DND-Importer-Release/0.1"})
    with urlopen(request, timeout=60) as response:
        data = response.read(asset["bytes"] + 1)
    if len(data) != asset["bytes"] or hashlib.sha256(data).hexdigest() != asset["sha256"]:
        raise ValueError("Vendor integrity check failed: " + asset["path"])
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.with_name(target.name + ".download")
    try:
        temporary.write_bytes(data)
        temporary.replace(target)
    finally:
        temporary.unlink(missing_ok=True)
    return "restored " + asset["path"]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--verify-only", action="store_true")
    args = parser.parse_args()
    assets = json.loads((ROOT / "assets.json").read_text(encoding="utf-8"))
    with ThreadPoolExecutor(max_workers=4) as pool:
        for result in pool.map(lambda asset: restore(asset, args.verify_only), assets):
            print(result)
    print(f"All {len(assets)} OCR assets verified.")


if __name__ == "__main__":
    main()
