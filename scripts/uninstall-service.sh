#!/usr/bin/env bash
set -e

# Remote Care Monitor — Service Uninstaller

if [ "$EUID" -ne 0 ]; then
  echo "Error: Please run with sudo:"
  echo "  sudo bash scripts/uninstall-service.sh"
  exit 1
fi

echo "Stopping and disabling remote-care-pi service..."
systemctl stop remote-care-pi.service 2>/dev/null || true
systemctl disable remote-care-pi.service 2>/dev/null || true

if [ -f "/etc/systemd/system/remote-care-pi.service" ]; then
  rm -f "/etc/systemd/system/remote-care-pi.service"
  systemctl daemon-reload
  echo "Removed /etc/systemd/system/remote-care-pi.service."
fi

echo "Remote Care Monitor service uninstalled."
