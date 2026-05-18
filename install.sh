#!/bin/bash
# ============================================================
#  KRYOXI Panel Installer
#  Run as root on Ubuntu 20.04 / 22.04 / Debian 11+
# ============================================================

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

PANEL_DIR="/opt/kryoxi-panel"
SERVERS_DIR="/opt/kryoxi/servers"
PANEL_PORT=3000
PANEL_USER="kryoxi"

echo -e "${CYAN}"
echo "  ██╗  ██╗██████╗ ██╗   ██╗ ██████╗ ██╗  ██╗██╗"
echo "  ██║ ██╔╝██╔══██╗╚██╗ ██╔╝██╔═══██╗╚██╗██╔╝██║"
echo "  █████╔╝ ██████╔╝ ╚████╔╝ ██║   ██║ ╚███╔╝ ██║"
echo "  ██╔═██╗ ██╔══██╗  ╚██╔╝  ██║   ██║ ██╔██╗ ██║"
echo "  ██║  ██╗██║  ██║   ██║   ╚██████╔╝██╔╝ ██╗██║"
echo "  ╚═╝  ╚═╝╚═╝  ╚═╝   ╚═╝    ╚═════╝ ╚═╝  ╚═╝╚═╝"
echo -e "${NC}"
echo -e "${GREEN}  Game Server Panel Installer${NC}"
echo ""

# Check root
if [ "$EUID" -ne 0 ]; then
  echo -e "${RED}Please run as root: sudo bash install.sh${NC}"
  exit 1
fi

# ---- Step 1: System packages ----
echo -e "${CYAN}[1/8] Updating system & installing dependencies...${NC}"
apt-get update -qq
apt-get install -y -qq curl wget git nginx ufw ca-certificates gnupg lsb-release

# ---- Step 2: Install Node.js 20 ----
echo -e "${CYAN}[2/8] Installing Node.js 20...${NC}"

NODE_VERSION=$(node -v 2>/dev/null || echo "none")

if [[ "$NODE_VERSION" != v20* ]]; then
  echo -e "${YELLOW}    Node.js not found or wrong version ($NODE_VERSION), installing v20...${NC}"

  # Remove old node if exists
  apt-get remove -y nodejs npm 2>/dev/null || true

  # Add NodeSource repo for Node.js 20
  mkdir -p /etc/apt/keyrings
  curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
    | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg

  echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_20.x nodistro main" \
    > /etc/apt/sources.list.d/nodesource.list

  apt-get update -qq
  apt-get install -y nodejs

else
  echo -e "${GREEN}    Node.js $NODE_VERSION already installed, skipping.${NC}"
fi

# Confirm node path
NODE_PATH=$(which node)
NPM_PATH=$(which npm)
echo -e "${GREEN}    Node: $NODE_PATH — $(node -v)${NC}"
echo -e "${GREEN}    NPM:  $NPM_PATH — $(npm -v)${NC}"

# ---- Step 3: Install Docker ----
echo -e "${CYAN}[3/8] Installing Docker...${NC}"
if ! command -v docker &>/dev/null; then
  # Official Docker install script
  curl -fsSL https://get.docker.com -o /tmp/get-docker.sh
  sh /tmp/get-docker.sh
  rm /tmp/get-docker.sh
  systemctl enable docker
  systemctl start docker
  echo -e "${GREEN}    Docker installed: $(docker -v)${NC}"
else
  echo -e "${GREEN}    Docker already installed: $(docker -v)${NC}"
fi

# Pull Minecraft image in background
echo -e "${CYAN}    Pulling itzg/minecraft-server image in background...${NC}"
docker pull itzg/minecraft-server:latest &>/dev/null &

# ---- Step 4: Create user + dirs ----
echo -e "${CYAN}[4/8] Creating user and directories...${NC}"
id -u $PANEL_USER &>/dev/null || useradd -r -s /bin/false $PANEL_USER
mkdir -p $PANEL_DIR $SERVERS_DIR $PANEL_DIR/data $PANEL_DIR/logs

# Copy panel files to install dir
cp -r . $PANEL_DIR/
chown -R $PANEL_USER:$PANEL_USER $PANEL_DIR
chown -R $PANEL_USER:$PANEL_USER $SERVERS_DIR

# Add kryoxi user to docker group so it can control containers
usermod -aG docker $PANEL_USER

# ---- Step 5: npm install ----
echo -e "${CYAN}[5/8] Installing Node.js packages...${NC}"
cd $PANEL_DIR
npm install --production
chown -R $PANEL_USER:$PANEL_USER $PANEL_DIR/node_modules
echo -e "${GREEN}    Packages installed.${NC}"

# ---- Step 6: .env file ----
echo -e "${CYAN}[6/8] Generating config...${NC}"
SECRET=$(openssl rand -hex 32)
cat > $PANEL_DIR/.env << ENV
PORT=$PANEL_PORT
SESSION_SECRET=$SECRET
SERVERS_DIR=$SERVERS_DIR
APP_DEBUG=false
ENV
chown $PANEL_USER:$PANEL_USER $PANEL_DIR/.env
chmod 600 $PANEL_DIR/.env
echo -e "${GREEN}    .env created with random session secret.${NC}"

# ---- Step 7: Systemd service ----
echo -e "${CYAN}[7/8] Creating systemd service...${NC}"

# Get exact node binary path for the service
NODE_BIN=$(which node)

cat > /etc/systemd/system/kryoxi-panel.service << SERVICE
[Unit]
Description=KRYOXI Game Server Panel
After=network.target docker.service
Requires=docker.service

[Service]
Type=simple
User=$PANEL_USER
WorkingDirectory=$PANEL_DIR
EnvironmentFile=$PANEL_DIR/.env
ExecStart=$NODE_BIN src/app.js
Restart=always
RestartSec=5
StandardOutput=append:$PANEL_DIR/logs/panel.log
StandardError=append:$PANEL_DIR/logs/error.log

[Install]
WantedBy=multi-user.target
SERVICE

systemctl daemon-reload
systemctl enable kryoxi-panel
systemctl start kryoxi-panel
sleep 2

if systemctl is-active --quiet kryoxi-panel; then
  echo -e "${GREEN}    Panel service started successfully.${NC}"
else
  echo -e "${RED}    Panel failed to start. Check: journalctl -u kryoxi-panel -f${NC}"
fi

# ---- Step 8: Nginx ----
echo -e "${CYAN}[8/8] Configuring nginx...${NC}"
read -p "$(echo -e ${YELLOW})Enter your domain or server IP (e.g. panel.example.com or 1.2.3.4): $(echo -e ${NC})" DOMAIN
DOMAIN=${DOMAIN:-localhost}

cat > /etc/nginx/sites-available/kryoxi-panel << NGINX
server {
    listen 80;
    server_name $DOMAIN;

    client_max_body_size 100M;

    location / {
        proxy_pass http://127.0.0.1:$PANEL_PORT;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_read_timeout 86400;
    }
}
NGINX

ln -sf /etc/nginx/sites-available/kryoxi-panel /etc/nginx/sites-enabled/kryoxi-panel
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl restart nginx
echo -e "${GREEN}    nginx configured.${NC}"

# ---- Firewall ----
if command -v ufw &>/dev/null; then
  ufw allow 22/tcp &>/dev/null
  ufw allow 80/tcp &>/dev/null
  ufw allow 443/tcp &>/dev/null
  ufw allow 25565:25600/tcp &>/dev/null
  echo "y" | ufw enable &>/dev/null || true
  echo -e "${GREEN}    Firewall rules applied.${NC}"
fi

# ---- Optional SSL ----
echo ""
read -p "$(echo -e ${YELLOW})Install SSL certificate with Certbot? (y/N): $(echo -e ${NC})" INSTALL_SSL
if [[ "$INSTALL_SSL" =~ ^[Yy]$ ]]; then
  apt-get install -y certbot python3-certbot-nginx &>/dev/null
  certbot --nginx -d $DOMAIN --non-interactive --agree-tos --email admin@$DOMAIN \
    && echo -e "${GREEN}    SSL installed!${NC}" \
    || echo -e "${YELLOW}    Certbot failed — run manually: certbot --nginx -d $DOMAIN${NC}"
fi

# ---- Done ----
echo ""
echo -e "${GREEN}╔════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║     KRYOXI Panel Install Complete!     ║${NC}"
echo -e "${GREEN}╚════════════════════════════════════════╝${NC}"
echo ""
echo -e "  ${CYAN}Panel URL:${NC}       http://$DOMAIN"
echo -e "  ${CYAN}Default Login:${NC}   admin / admin123"
echo -e "  ${CYAN}Node.js path:${NC}    $NODE_BIN ($(node -v))"
echo -e "  ${CYAN}Panel dir:${NC}       $PANEL_DIR"
echo -e "  ${CYAN}Servers dir:${NC}     $SERVERS_DIR"
echo -e "  ${CYAN}Logs:${NC}            $PANEL_DIR/logs/"
echo -e "  ${CYAN}Internal port:${NC}   $PANEL_PORT (proxied via nginx on :80)"
echo ""
echo -e "${YELLOW}  IMPORTANT: Change the admin password after first login!${NC}"
echo ""
echo -e "  Useful commands:"
echo -e "  ${CYAN}systemctl status kryoxi-panel${NC}    — check status"
echo -e "  ${CYAN}systemctl restart kryoxi-panel${NC}   — restart"
echo -e "  ${CYAN}journalctl -u kryoxi-panel -f${NC}    — live logs"
echo ""
