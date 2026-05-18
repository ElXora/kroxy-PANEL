#!/bin/bash
# KRYOXI Panel Updater
PANEL_DIR="/opt/kryoxi-panel"

echo "[*] Stopping panel..."
systemctl stop kryoxi-panel

echo "[*] Backing up data..."
cp -r $PANEL_DIR/data /tmp/kryoxi-data-backup

echo "[*] Copying new files..."
cp -r . $PANEL_DIR/
cp -r /tmp/kryoxi-data-backup $PANEL_DIR/data

echo "[*] Installing dependencies..."
cd $PANEL_DIR && npm install --production

echo "[*] Starting panel..."
systemctl start kryoxi-panel
echo "[✓] Done!"
