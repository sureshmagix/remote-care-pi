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

# Detect actual invoking user (when run with sudo)
TARGET_USER="${SUDO_USER:-$USER}"
if [ "$TARGET_USER" = "root" ]; then
  # If executed directly as root, try to detect 'pi' or default user
  if id "pi" &>/dev/null; then
    TARGET_USER="pi"
  fi
fi

# Resolve script & project root directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

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
    echo "Please install Node.js 18+ on your Raspberry Pi first:"
    echo "  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -"
    echo "  sudo apt install -y nodejs"
    exit 1
  fi
fi

echo "Configuration:"
echo "  User:         $TARGET_USER"
echo "  Directory:    $PROJECT_DIR"
echo "  Node binary:  $NODE_BIN"
echo "  Node version: $($NODE_BIN -v)"

# Ensure data directory exists with correct ownership
mkdir -p "$PROJECT_DIR/data"
chown -R "$TARGET_USER:$TARGET_USER" "$PROJECT_DIR/data"

SERVICE_FILE="/etc/systemd/system/remote-care-pi.service"

sed -e "s|{{USER}}|$TARGET_USER|g" \
    -e "s|{{DIR}}|$PROJECT_DIR|g" \
    -e "s|{{NODE_BIN}}|$NODE_BIN|g" \
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
