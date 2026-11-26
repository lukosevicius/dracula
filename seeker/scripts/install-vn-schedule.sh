#!/bin/bash
# Installs (or with --uninstall removes) the launchd agent that runs scripts/vn-import.sh on this Mac
# at 05:30 and 12:30 local time. Run it again after moving the project or changing the Node.js version.
set -euo pipefail

label="lt.dracula.vn-import"
plist="$HOME/Library/LaunchAgents/$label.plist"
domain="gui/$(id -u)"

launchctl bootout "$domain/$label" >/dev/null 2>&1 || true
if [ "${1:-}" = "--uninstall" ]; then
  rm -f "$plist"
  echo "Removed the Vilnius Events schedule."
  exit 0
fi

script="$(cd "$(dirname "$0")" && pwd)/vn-import.sh"
node="$(command -v node)"
log="$HOME/Library/Logs/dracula-vn-import.log"
[ -f "$(dirname "$script")/../.env.central" ] || { echo "seeker/.env.central is missing."; exit 1; }
chmod +x "$script"
mkdir -p "$HOME/Library/LaunchAgents"

xml() { printf '%s' "$1" | sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g'; }
cat > "$plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$label</string>
  <key>ProgramArguments</key>
  <array><string>/bin/bash</string><string>$(xml "$script")</string></array>
  <key>EnvironmentVariables</key>
  <dict><key>NODE_BIN</key><string>$(xml "$node")</string></dict>
  <key>StartCalendarInterval</key>
  <array>
    <dict><key>Hour</key><integer>5</integer><key>Minute</key><integer>30</integer></dict>
    <dict><key>Hour</key><integer>12</integer><key>Minute</key><integer>30</integer></dict>
  </array>
  <key>StandardOutPath</key><string>$(xml "$log")</string>
  <key>StandardErrorPath</key><string>$(xml "$log")</string>
</dict>
</plist>
EOF
plutil -lint "$plist" >/dev/null
launchctl bootstrap "$domain" "$plist"
echo "Installed: Vilnius Events imports run at 05:30 and 12:30 with $node."
echo "Log: $log"
echo "Run now: launchctl kickstart $domain/$label"
