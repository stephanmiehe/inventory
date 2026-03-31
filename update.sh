#!/usr/bin/env bash
set -euo pipefail

APP_DIR="/opt/inventory"
APP_USER="inventory"

cd "$APP_DIR"

echo "==> Pulling latest changes..."
sudo -u "$APP_USER" git pull --ff-only

sudo chown -R "$APP_USER:$APP_USER" "$APP_DIR"

echo "==> Installing dependencies..."
sudo -u "$APP_USER" npm ci

echo "==> Building frontend..."
cd "$APP_DIR/frontend"
sudo -u "$APP_USER" npx vite build

echo "==> Pruning dev dependencies..."
cd "$APP_DIR"
sudo -u "$APP_USER" npm prune --omit=dev

echo "==> Restarting backend..."
systemctl restart inventory-backend

echo "==> Done!"
