#!/usr/bin/env bash
set -e

# Remote Care Monitor — Raspberry Pi Systemd Service Installer
# Wiitronics Solutions Pvt Ltd

echo "=============================================================="
echo "  Remote Care Monitor (Raspberry Pi Edition) — Service Setup  "
echo "=============================================================="

if [ "$EUID" -ne 0 ]; then
  echo "Error: Please run this installer with sudo:"
  echo "  sudo bash scripts/install-service.sh"
  exit 1
fi

# Resolve script & project root directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
DATA_DIR="$PROJECT_DIR/data"

# Detect the account that should own the service. `sudo bash ...` supplies
# SUDO_USER; direct root execution falls back to the project owner instead of
# silently running the web service as root.
TARGET_USER="${SUDO_USER:-}"
if [ -z "$TARGET_USER" ] || [ "$TARGET_USER" = "root" ]; then
  PROJECT_OWNER="$(stat -c '%U' "$PROJECT_DIR")"
  if [ "$PROJECT_OWNER" != "root" ] && id "$PROJECT_OWNER" &>/dev/null; then
    TARGET_USER="$PROJECT_OWNER"
  elif id "pi" &>/dev/null; then
    TARGET_USER="pi"
  else
    echo "Error: Could not determine a non-root service account."
    echo "Run this command with sudo from the account that owns the project."
    exit 1
  fi
fi

# Detect node binary
NODE_BIN="$(command -v node || true)"
if [ -z "$NODE_BIN" ]; then
  # Fallbacks for common nvm / fnm / system paths
  if [ -x "/usr/bin/node" ]; then
    NODE_BIN="/usr/bin/node"
  elif [ -x "/usr/local/bin/node" ]; then
    NODE_BIN="/usr/local/bin/node"
  else
    echo "Error: Node.js was not found in PATH."
    echo "Please install Node.js 20+ on your Raspberry Pi first:"
    echo "  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -"
    echo "  sudo apt install -y nodejs"
    exit 1
  fi
fi

NODE_MAJOR="$("$NODE_BIN" -p "process.versions.node.split('.')[0]" 2>/dev/null || true)"
case "$NODE_MAJOR" in
  ''|*[!0-9]*)
    echo "Error: Unable to determine the installed Node.js version."
    exit 1
    ;;
esac
if [ "$NODE_MAJOR" -lt 20 ]; then
  echo "Error: Remote Care Monitor requires Node.js 20 or later (found $($NODE_BIN -v))."
  echo "Install Node.js 22 LTS, then rerun this installer."
  exit 1
fi

echo "Configuration:"
echo "  User:         $TARGET_USER"
echo "  Directory:    $PROJECT_DIR"
echo "  Node binary:  $NODE_BIN"
echo "  Node version: $($NODE_BIN -v)"

# Ensure data directory exists with correct ownership
mkdir -p "$DATA_DIR"
chown -R "$TARGET_USER:$TARGET_USER" "$DATA_DIR"
chmod 750 "$DATA_DIR"

SERVICE_FILE="/etc/systemd/system/remote-care-pi.service"

escape_sed_replacement() {
  printf '%s' "$1" | sed -e 's/[\\&|]/\\\\&/g'
}

SED_USER="$(escape_sed_replacement "$TARGET_USER")"
SED_DIR="$(escape_sed_replacement "$PROJECT_DIR")"
SED_DATA_DIR="$(escape_sed_replacement "$DATA_DIR")"
SED_NODE_BIN="$(escape_sed_replacement "$NODE_BIN")"

sed -e "s|{{USER}}|$SED_USER|g" \
    -e "s|{{DIR}}|$SED_DIR|g" \
    -e "s|{{DATA_DIR}}|$SED_DATA_DIR|g" \
    -e "s|{{NODE_BIN}}|$SED_NODE_BIN|g" \
    "$SCRIPT_DIR/remote-care-pi.service" > "$SERVICE_FILE"

chmod 644 "$SERVICE_FILE"

echo "Reloading systemd daemon..."
systemctl daemon-reload

echo "Enabling remote-care-pi service on boot..."
systemctl enable remote-care-pi.service

echo "Starting remote-care-pi service..."
systemctl restart remote-care-pi.service

sleep 2

# Check status
if systemctl is-active --quiet remote-care-pi.service; then
  echo ""
  echo "=============================================================="
  echo "  SUCCESS! Remote Care Monitor service is active & running!   "
  echo "=============================================================="
  
  # Detect IP addresses
  IP_LIST=$(hostname -I 2>/dev/null || ip addr show | grep -o 'inet [0-9.]*' | cut -d' ' -f2 | grep -v '127.0.0.1' || true)
  HOSTNAME=$(hostname 2>/dev/null || echo "raspberrypi")
  
  echo "You can access your monitoring dashboard from any PC, phone, or"
  echo "tablet connected to the same Wi-Fi/LAN at:"
  echo ""
  for ip in $IP_LIST; do
    echo "  ->  http://$ip:3000"
  done
  echo "  ->  http://$HOSTNAME.local:3000"
  echo ""
  echo "Management commands:"
  echo "  Check status:    sudo systemctl status remote-care-pi"
  echo "  View live logs:  sudo journalctl -u remote-care-pi -f"
  echo "  Restart service: sudo systemctl restart remote-care-pi"
  echo "  Stop service:    sudo systemctl stop remote-care-pi"
  echo "=============================================================="
else
  echo "Warning: Service started but check status returned non-active."
  echo "Inspect logs using: sudo journalctl -u remote-care-pi -n 50"
fi
