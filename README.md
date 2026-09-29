# Remote Care Monitor — Raspberry Pi Edition

> **Headless, local-first network, internet, and service monitor tailor-made for Raspberry Pi with a browser-accessible dashboard over your local network.**

---

## 🌟 Overview

Most Raspberry Pi devices run in **headless mode** (without a display, monitor, keyboard, or desktop GUI). The standard desktop Electron app cannot run in headless environments and consumes excessive RAM.

**Remote Care Monitor (Raspberry Pi Edition)** is tailor-made to solve this:
- **Headless Web Architecture**: Built as a native, lightweight Node.js service that runs without any desktop or display server.
- **Accessible Over Local Network (LAN / Wi-Fi)**: Any phone, tablet, laptop, or desktop on the same network can access the dashboard by navigating to `http://<raspberry-pi-ip>:3000` or `http://raspberrypi.local:3000`.
- **Ultra-Lightweight Footprint**: Uses ~30–45 MB RAM (compared to 400+ MB for Electron), making it run smoothly even on Raspberry Pi Zero 2 W, Pi 3, Pi 4, and Pi 5.
- **Real-Time Push Updates**: Powered by Server-Sent Events (SSE). Monitor state changes, outages, and recoveries reflect instantly across all connected browser tabs without manual refreshing.
- **Hardware Health Diagnostics**: Automatically monitors Raspberry Pi SoC CPU temperature, under-voltage/throttling state via `vcgencmd`, memory usage, system load, and network interfaces.
- **Turnkey Systemd Service**: Runs automatically on boot as a hardened Linux background daemon with auto-restart on failure.
- **In-Browser CSV Export**: Download monthly audit and history reports directly in your browser without needing desktop file dialogs.
- **All Core Checks Included**: ICMP Ping, TCP ports, HTTP/HTTPS web endpoints, default gateway, network adapters (`eth0`/`wlan0`), systemd services (`systemctl is-active`), and processes (`pgrep`).

---

## 🚀 Quick Start on Raspberry Pi

### 1. Install Node.js (v20+; v22 LTS recommended)
If you haven't installed Node.js on your Raspberry Pi:
```bash
# Install Node.js 22.x on Raspberry Pi OS / Debian
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt update && sudo apt install -y nodejs
```

Verify your installation:
```bash
node -v
npm -v
```

> This release requires Node.js 20 or later because its SQLite dependency no
> longer supports Node 18. Node 22 LTS is the preferred production runtime.

### Raspberry Pi OS compatibility

- Supported: current Raspberry Pi OS Lite or Desktop releases with `systemd`,
  on 64-bit ARM (`arm64`) or 32-bit ARMv7 (`armv7l`) hardware. This includes
  Pi Zero 2 W, Pi 3, Pi 4, and Pi 5.
- Not supported: original Pi Zero / Pi 1 (ARMv6), or Raspberry Pi OS releases
  that cannot run Node.js 20+.
- `better-sqlite3` uses a native module. A matching binary is normally used;
  install build tools once so `npm ci` can compile it when one is unavailable:

```bash
sudo apt update && sudo apt install -y build-essential python3
```

### 2. Install Project Dependencies
Navigate to the project folder and install dependencies:
```bash
cd remote-care-pi
npm ci --omit=dev
```

### 3. Start the Server Manually (Testing Mode)
```bash
npm start
```

> **Automatic Port Availability & Conflict Resolution**:
> If port `3000` is already in use by another application (e.g., Grafana, Docker, Pi-hole, Node.js), Remote Care Monitor automatically checks port availability, selects the next free port (`3001`, `3002`, etc.), and notifies you in the terminal banner. You can also explicitly specify a custom port with `PORT=<port> npm start`.

When started, the terminal will display a banner with the exact URLs to open:
```text
  ==============================================================
    Remote Care Monitor — Raspberry Pi Edition
  ==============================================================
    Local Dashboard:    http://localhost:3000
    Network (eth0):     http://192.168.1.150:3000
    Network (wlan0):    http://192.168.1.151:3000
    mDNS (Bonjour):     http://raspberrypi.local:3000
    Database:           /home/pi/remote-care-pi/data/remote-care.sqlite
  ==============================================================
```

Open any browser on your laptop or phone connected to the same Wi-Fi/router and go to:
```text
http://<your-pi-ip>:3000
```
*(e.g., `http://192.168.1.150:3000` or `http://raspberrypi.local:3000`)*

---

## ⚙️ Running as a Permanent Background Service (Systemd)

To make Remote Care Monitor automatically start whenever the Raspberry Pi boots and run 24/7 in the background:

### One-Command Service Installation:
```bash
sudo bash scripts/install-service.sh
```
This script automatically:
1. Detects your current user, project path, and Node.js binary.
2. Creates the systemd service `/etc/systemd/system/remote-care-pi.service`.
3. Enables the service to start on system boot.
4. Starts the service immediately.
5. Prints the detected IP addresses and web URLs.

---

## 📋 Terminal Commands Reference

### 🔍 1. Finding Your Raspberry Pi's IP Address
| Command | Description |
| :--- | :--- |
| `hostname -I` | Prints all IP addresses assigned to your Raspberry Pi (quickest way) |
| `ip addr show` | Displays detailed network adapter information |
| `ip route get 1.1.1.1 \| awk '{print $7}'` | Shows the specific IP used for outbound network traffic |
| `hostname` | Displays your Pi hostname (default is `raspberrypi`, accessible via `http://raspberrypi.local:3000`) |

---

### 💻 2. Running & Development Commands
Run these commands from inside the `remote-care-pi` directory:

| Command | Description |
| :--- | :--- |
| `npm start` | Starts the headless web server (auto-detects port availability starting from 3000) |
| `PORT=8080 npm start` | Runs the server on a custom port (e.g. 8080) |
| `npm run explore` | Interactive CLI exploring all built-in tools (port, adapters, gateway, ping, tcp, http, hardware) |
| `npm run dev` | Runs with Node file-watcher (auto-restarts on code edits) |
| `npm test` | Runs the full automated suite (auth, checks, database, Pi diagnostics, port auto-selection, authenticated HTTP API) |
| `npm run lint` | Runs syntax checks across all server, main, and renderer files |

---

### 🛡️ 3. Managing the Background Systemd Service
Once installed via `sudo bash scripts/install-service.sh`:

| Command | Description |
| :--- | :--- |
| `sudo systemctl status remote-care-pi` | Check if the monitor service is currently active & running |
| `sudo systemctl start remote-care-pi` | Start the service |
| `sudo systemctl stop remote-care-pi` | Stop the service |
| `sudo systemctl restart remote-care-pi` | Restart the service |
| `sudo systemctl enable remote-care-pi` | Configure service to launch automatically on Pi boot |
| `sudo systemctl disable remote-care-pi` | Prevent service from launching on Pi boot |

---

### 📜 4. Viewing Logs
| Command | Description |
| :--- | :--- |
| `sudo journalctl -u remote-care-pi -f` | Stream live real-time logs in your terminal |
| `sudo journalctl -u remote-care-pi -n 100 --no-pager` | View the last 100 log lines |
| `sudo journalctl -u remote-care-pi --since "1 hour ago"` | View logs from the past hour |

---

### 🧱 5. Firewall Configuration (If UFW is installed)
If you run `ufw` (Uncomplicated Firewall) on your Raspberry Pi:
```bash
# Allow port 3000 from local network
sudo ufw allow 3000/tcp

# Check firewall status
sudo ufw status
```

---

### 🌡️ 6. Useful Raspberry Pi Hardware Diagnostics Commands
| Command | Description |
| :--- | :--- |
| `vcgencmd measure_temp` | Check CPU SoC temperature |
| `vcgencmd get_throttled` | Check for low voltage (`0x0` means healthy, `0x50000` or `0x50005` indicates past/present undervoltage) |
| `free -h` | View RAM memory usage |
| `df -h` | View SD card / SSD storage space |
| `uptime` | View system uptime and load average |

---

### 🧹 7. Uninstalling the Background Service
To remove the background systemd service:
```bash
sudo bash scripts/uninstall-service.sh
```

---

## 📁 Directory Structure

```text
remote-care-pi/
├── assets/                  # Icons and branding
├── data/                    # SQLite database storage (remote-care.sqlite)
├── scripts/
│   ├── install-service.sh   # Automated systemd installer
│   ├── uninstall-service.sh # Service uninstaller
│   ├── remote-care-pi.service # Systemd unit template
│   └── run-tests.js         # Test runner
├── src/
│   ├── server.js            # Node.js HTTP + SSE headless web server
│   ├── main/
│   │   ├── auth.js          # Authentication & session token management
│   │   ├── checks.js        # ICMP, TCP, HTTP, systemd, process, adapter checks
│   │   ├── database.js      # SQLite persistence & audit logging
│   │   ├── monitor-engine.js# Polling scheduler and state transition engine
│   │   └── pi-system.js     # Raspberry Pi hardware diagnostics & temperature
│   └── renderer/
│       ├── api-client.js    # Web bridge replacing Electron IPC with REST & SSE
│       ├── app.js           # Single-page application logic
│       ├── index.html       # Web dashboard HTML
│       └── styles.css       # Responsive dashboard styling
├── tests/                   # Automated test suite
├── package.json             # Tailor-made for Raspberry Pi
└── README.md                # Documentation & cheat sheet
```

---

## 🔒 Security & Privacy Notice
- **100% Local-First**: Remote Care Monitor operates entirely on your local network. No metrics, targets, or logs are uploaded to any external cloud server.
- **Role-Based Access Control**:
  - **Super Admin**: Initial setup sets the master password required to add/edit/delete monitors, configure settings, view logs, and manage accounts.
  - **Viewer**: Read-only access to view live status and dashboards.
- **Systemd Hardening**: The included service runs with `NoNewPrivileges=true` and `ProtectSystem=full` for defense-in-depth on Linux.

---

## 📄 License
Wiitronics Solutions Pvt Ltd — All rights reserved.
