#!/bin/bash
# Runs the Vilnius Events part of the scheduled import from this Mac. Vilnius Events refuses requests from GitHub's
# servers, so the GitHub workflow imports only Avilys. Installed as a launchd agent by install-vn-schedule.sh.
#
# Without an argument the first run of the day is "daily" (the two newest list pages), later runs "quick"
# (the newest page). Runs are at 12:00 and 18:00; one missed while the Mac was closed runs when it next wakes.
# Uses the checked-out code and seeker/.env.central. Output goes to ~/Library/Logs/dracula-vn-import.log.
set -uo pipefail

seeker="$(cd "$(dirname "$0")/.." && pwd)"
state="$HOME/Library/Application Support/Dracula"
stamp="$state/vn-import-last-daily"
mkdir -p "$state"

mode="${1:-}"
if [ -z "$mode" ]; then
  if [ -f "$stamp" ] && [ -z "$(find "$stamp" -mmin +1200)" ]; then mode=quick; else mode=daily; fi
fi

node="${NODE_BIN:-$(command -v node || true)}"
notify() { /usr/bin/osascript -e "display notification \"$1\" with title \"Dracula import\"" >/dev/null 2>&1 || true; }
if [ -z "$node" ] || [ ! -x "$node" ]; then
  echo "$(date '+%F %T') Node.js not found. Run scripts/install-vn-schedule.sh again."
  notify "Vilnius Events import could not start: Node.js not found."
  exit 1
fi

echo "=== $(date '+%F %T') Vilnius Events import ($mode)"
cd "$seeker" || exit 1
if ! "$node" node_modules/typescript/bin/tsc -p tsconfig.json; then
  notify "Vilnius Events import could not build Seeker."
  exit 1
fi
if "$node" dist/scheduled-import.js "$mode" --sources=vilnius-events; then
  [ "$mode" = daily ] && touch "$stamp"
  echo "=== $(date '+%F %T') done"
else
  notify "Vilnius Events import failed. See ~/Library/Logs/dracula-vn-import.log"
  echo "=== $(date '+%F %T') failed"
  exit 1
fi
