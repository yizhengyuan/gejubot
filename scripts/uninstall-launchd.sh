#!/usr/bin/env bash
set -euo pipefail

PLIST_PATH="$HOME/Library/LaunchAgents/com.gejubot.backend.plist"
USER_DOMAIN="gui/$(id -u)"

if [[ -f "$PLIST_PATH" ]]; then
  launchctl bootout "$USER_DOMAIN" "$PLIST_PATH" >/dev/null 2>&1 || true
  rm -f "$PLIST_PATH"
  echo "Uninstalled launchd service: com.gejubot.backend"
else
  echo "Service plist not found: $PLIST_PATH"
fi
