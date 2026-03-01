#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LAUNCH_AGENTS_DIR="$HOME/Library/LaunchAgents"
PLIST_PATH="$LAUNCH_AGENTS_DIR/com.gejubot.backend.plist"
LABEL="com.gejubot.backend"
USER_DOMAIN="gui/$(id -u)"

mkdir -p "$LAUNCH_AGENTS_DIR" "$ROOT_DIR/.runtime"

cat >"$PLIST_PATH" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key>
    <string>${LABEL}</string>
    <key>ProgramArguments</key>
    <array>
      <string>${ROOT_DIR}/scripts/gejubotd.sh</string>
      <string>run</string>
    </array>
    <key>WorkingDirectory</key>
    <string>${ROOT_DIR}</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>${ROOT_DIR}/.runtime/launchd.out.log</string>
    <key>StandardErrorPath</key>
    <string>${ROOT_DIR}/.runtime/launchd.err.log</string>
  </dict>
</plist>
EOF

launchctl bootout "$USER_DOMAIN" "$PLIST_PATH" >/dev/null 2>&1 || true
launchctl bootstrap "$USER_DOMAIN" "$PLIST_PATH"
launchctl enable "$USER_DOMAIN/$LABEL"
launchctl kickstart -k "$USER_DOMAIN/$LABEL"

echo "Installed and started launchd service: $LABEL"
echo "plist: $PLIST_PATH"
