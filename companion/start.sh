#!/usr/bin/env sh
set -eu
cd "$(dirname "$0")"
printf 'Foundry origin (e.g. http://localhost:30000): '
read -r tely_foundry_origin
exec python3 bridge.py --allow-origin "${tely_foundry_origin:-http://localhost:30000}"
