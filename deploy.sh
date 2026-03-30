#!/usr/bin/env bash
set -euo pipefail

APP_DIR="/opt/inventory"
APP_USER="inventory"
REPO_URL="https://github.com/stephanmiehe/inventory.git"

echo "==> Installing system dependencies..."
apt-get update
apt-get install -y curl git nginx

# Install Node.js 22 LTS via NodeSource
if ! command -v node &>/dev/null; then
    echo "==> Installing Node.js 22..."
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
    apt-get install -y nodejs
fi

echo "Node.js $(node --version) installed"

# Create application user
if ! id "$APP_USER" &>/dev/null; then
    echo "==> Creating user '$APP_USER'..."
    useradd --system --create-home --shell /usr/sbin/nologin "$APP_USER"
fi

# Clone or update repo
if [ -d "$APP_DIR/.git" ]; then
    echo "==> Updating repository..."
    cd "$APP_DIR"
    sudo -u "$APP_USER" git pull --ff-only
else
    echo "==> Cloning repository..."
    git clone "$REPO_URL" "$APP_DIR"
    chown -R "$APP_USER:$APP_USER" "$APP_DIR"
fi

# Install dependencies (including dev for build)
echo "==> Installing dependencies..."
cd "$APP_DIR"
sudo -u "$APP_USER" npm ci

# Build frontend
echo "==> Building frontend..."
cd "$APP_DIR/frontend"
sudo -u "$APP_USER" npx vite build

# Prune dev dependencies
echo "==> Pruning dev dependencies..."
cd "$APP_DIR"
sudo -u "$APP_USER" npm prune --omit=dev

# Set up backend .env if missing
if [ ! -f "$APP_DIR/backend/.env" ]; then
    echo "==> Creating backend .env from example..."
    sudo -u "$APP_USER" cp "$APP_DIR/backend/.env.example" "$APP_DIR/backend/.env"
fi

# Create uploads directory
sudo -u "$APP_USER" mkdir -p "$APP_DIR/backend/uploads"

# Install systemd services
echo "==> Installing systemd services..."
cp "$APP_DIR/inventory-backend.service" /etc/systemd/system/
cp "$APP_DIR/inventory-frontend.service" /etc/systemd/system/
systemctl daemon-reload

# Install nginx config
echo "==> Configuring nginx..."
cp "$APP_DIR/inventory.nginx.conf" /etc/nginx/sites-available/inventory
ln -sf /etc/nginx/sites-available/inventory /etc/nginx/sites-enabled/inventory
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl restart nginx

# Enable and start backend
echo "==> Starting services..."
systemctl enable --now inventory-backend
systemctl start inventory-frontend

echo ""
echo "==> Deployment complete!"
echo "    Backend:  systemctl status inventory-backend"
echo "    Nginx:    systemctl status nginx"
echo "    App:      http://$(hostname -I | awk '{print $1}')"
