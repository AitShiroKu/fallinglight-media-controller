#!/usr/bin/env bash
# Remove FallingLight Media Controller. Media and settings in /var/lib are kept
# unless --purge is given.
set -euo pipefail
APP=fallinglight-media-controller
[[ $EUID -eq 0 ]] || { echo "Run as root (sudo)." >&2; exit 1; }

if command -v systemctl >/dev/null && [[ -d /run/systemd/system ]]; then
  systemctl disable --now "$APP.service" 2>/dev/null || true
fi
rm -f "/etc/systemd/system/$APP.service"
command -v systemctl >/dev/null && systemctl daemon-reload 2>/dev/null || true
rm -rf "/opt/$APP"

if [[ "${1:-}" == "--purge" ]]; then
  rm -rf "/var/lib/$APP" "/etc/$APP.env"
  userdel fallinglight 2>/dev/null || true
  echo "Removed app, data and config."
else
  echo "Removed app. Data kept in /var/lib/$APP and config in /etc/$APP.env (use --purge to delete)."
fi
