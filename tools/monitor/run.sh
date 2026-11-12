#!/bin/bash
# Offline browser checks of the working copy. Usage: tools/monitor/run.sh   (exit 0 = all passed)
cd "$(dirname "$0")/../.." || exit 2
PORT=${PORT:-8811}
python3 -m http.server "$PORT" --bind 127.0.0.1 >/dev/null 2>&1 & SRV=$!
trap 'kill $SRV 2>/dev/null' EXIT
sleep 1
node tools/monitor/store.js "$PORT" | grep -v '^PASS'; A=${PIPESTATUS[0]}
node tools/monitor/admin.js "$PORT" | grep -v '^PASS'; B=${PIPESTATUS[0]}
[ "$A" = 0 ] && [ "$B" = 0 ]
