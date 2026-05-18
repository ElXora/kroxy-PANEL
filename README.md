# KRYOXI Panel

> A modern black & white game server panel with Docker-based Minecraft hosting.

![Node.js](https://img.shields.io/badge/Node.js-20.x-green) ![Express](https://img.shields.io/badge/Express-4.18-lightgrey) ![Docker](https://img.shields.io/badge/Docker-required-blue) ![License](https://img.shields.io/badge/license-MIT-white)

---

## Features

- Login & Register system with session auth
- Create, start, stop, restart & delete Minecraft servers
- Live WebSocket console per server
- Real-time CPU & RAM stats (polls every 3s)
- Daily reward system (50 coins every 24h)
- Coin economy (users start with 100 coins)
- Admin panel — user management, ban/unban, settings
- Full activity log per user
- Docker container lifecycle management
- nginx reverse proxy + optional SSL

---

## Stack & Node Packages

| Package | Version | Purpose |
|---|---|---|
| `express` | 4.18.2 | Web framework |
| `ejs` | 3.1.9 | Templating engine |
| `express-session` | 1.17.3 | Session management |
| `bcryptjs` | 2.4.3 | Password hashing |
| `nedb-promises` | 6.2.1 | File-based database (no setup needed) |
| `dockerode` | 4.0.2 | Docker API wrapper |
| `ws` | 8.16.0 | WebSocket for live console |
| `connect-flash` | 0.1.1 | Flash messages |
| `cookie-parser` | 1.4.6 | Cookie parsing |
| `express-rate-limit` | 7.1.5 | Rate limiting |
| `nodemon` *(dev)* | 3.0.3 | Auto-restart in development |

---

## Ports

| Service | Port | Notes |
|---|---|---|
| Panel (Node.js) | `3000` | Internal only, proxied by nginx |
| nginx (HTTP) | `80` | Public access |
| nginx (HTTPS) | `443` | After SSL setup |
| Minecraft default | `25565` | First server |
| Minecraft range | `25565–25600` | Multiple servers |

> The panel runs on port **3000** internally. nginx proxies it to **80/443** so you access it via domain or IP with no port in the URL.

---

## Requirements

- Ubuntu 20.04 / 22.04 or Debian 11+ VPS
- Root access
- A domain name (optional, IP works too)
- Minimum 1GB RAM (2GB+ recommended for running MC servers)

---

## Install on VPS

```bash
# 1. SSH into your VPS
ssh root@YOUR_VPS_IP

# 2. Clone the repo
git clone https://github.com/YOUR_USERNAME/kryoxi-panel.git kryoxi-panel

# 3. Enter the folder
cd kryoxi-panel

# 4. Make installer executable
chmod +x install.sh

# 5. Run the installer
bash install.sh
```

The installer automatically handles:
- Node.js 20 installation
- Docker install & Minecraft image pull
- nginx setup & reverse proxy config
- systemd service (auto-starts on reboot)
- Firewall rules (80, 443, 25565–25600)
- Optional SSL via Certbot

---

## Manual / Local Setup

```bash
# Clone the repo
git clone https://github.com/YOUR_USERNAME/kryoxi-panel.git
cd kryoxi-panel

# Install dependencies
npm install

# Start the panel
node src/app.js

# Open in browser
# http://localhost:3000
```

For development with auto-restart:
```bash
npm run dev
```

---

## Default Login

| Field | Value |
|---|---|
| Username | `admin` |
| Password | `admin123` |

> ⚠️ Change the admin password immediately after first login.

---

## Panel Management Commands

```bash
# Check if panel is running
systemctl status kryoxi-panel

# Start the panel
systemctl start kryoxi-panel

# Stop the panel
systemctl stop kryoxi-panel

# Restart the panel
systemctl restart kryoxi-panel

# View live logs
journalctl -u kryoxi-panel -f

# View error logs
cat /opt/kryoxi-panel/logs/error.log
```

---

## Update Panel

```bash
cd kryoxi-panel
git pull
bash update.sh
```

---

## Troubleshooting

```bash
# Panel not starting — check logs
journalctl -u kryoxi-panel -f

# Reinstall node dependencies
cd /opt/kryoxi-panel && npm install
systemctl restart kryoxi-panel

# nginx not working
nginx -t
systemctl restart nginx

# Docker permission issue
usermod -aG docker kryoxi
systemctl restart kryoxi-panel

# Check what's on port 3000
lsof -i :3000
```

---

## File Structure

```
kryoxi-panel/
├── src/
│   ├── app.js                 # Express entry point
│   ├── db.js                  # NeDB database + seed
│   ├── ejsLayouts.js          # EJS layout system
│   ├── routes/
│   │   ├── auth.js            # Login, register, logout
│   │   ├── dashboard.js       # Dashboard + daily reward
│   │   ├── servers.js         # Server CRUD + controls
│   │   ├── admin.js           # Admin panel
│   │   └── api.js             # JSON API for stats
│   ├── services/
│   │   ├── docker.js          # Dockerode wrapper
│   │   └── websocket.js       # Live console streaming
│   └── middleware/
│       └── auth.js            # requireAuth, requireAdmin
├── views/
│   ├── layouts/               # main.ejs, auth.ejs
│   ├── partials/              # sidebar, topbar, flash
│   ├── auth/                  # login, register
│   ├── dashboard/             # index
│   ├── servers/               # index, create, show
│   ├── admin/                 # index
│   └── errors/                # 404
├── public/
│   ├── css/main.css           # Full black/white theme
│   └── js/main.js
├── data/                      # NeDB files (auto-created)
├── install.sh                 # VPS installer
├── update.sh                  # Update script
└── package.json
```

---

## Adding More Games

To add CS2, Valheim, Terraria etc. later:

1. Add a Docker handler in `src/services/docker.js`
2. Add a route case in `src/routes/servers.js`
3. Remove the `disabled` class from the game card in `views/servers/create.ejs`

---

## License

MIT — built by [KRYOXI](https://github.com/ElXora)
