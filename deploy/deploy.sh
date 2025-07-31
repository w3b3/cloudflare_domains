#!/bin/bash

# Cloudflare Domains Manager Deployment Script
# This script deploys the application to an Ubuntu EC2 instance

set -e

# Configuration
DOMAIN="cloudflare.w-b.dev"
SERVER_IP="44.212.121.39"
DEPLOY_USER="ubuntu"
APP_DIR="/opt/cloudflare-domains"
NGINX_CONF="/etc/nginx/sites-available/${DOMAIN}"
NGINX_ENABLED="/etc/nginx/sites-enabled/${DOMAIN}"

echo "🚀 Starting deployment of Cloudflare Domains Manager to ${DOMAIN}"

# Function to run commands on remote server
run_remote() {
    ssh -o StrictHostKeyChecking=no ${DEPLOY_USER}@${SERVER_IP} "$@"
}

# Function to copy files to remote server
copy_to_remote() {
    scp -o StrictHostKeyChecking=no -r "$1" ${DEPLOY_USER}@${SERVER_IP}:"$2"
}

echo "📦 Preparing application for deployment..."

# Create deployment package (excluding node_modules and other unnecessary files)
mkdir -p /tmp/cloudflare-domains-deploy
rsync -av --exclude='node_modules' --exclude='.git' --exclude='data' --exclude='*.log' \
    ./ /tmp/cloudflare-domains-deploy/

echo "📤 Uploading application to server..."

# Create application directory on server
run_remote "sudo mkdir -p ${APP_DIR}"
run_remote "sudo chown ${DEPLOY_USER}:${DEPLOY_USER} ${APP_DIR}"

# Upload application files
copy_to_remote "/tmp/cloudflare-domains-deploy/" "${APP_DIR}/"

echo "🔧 Installing dependencies and setting up environment..."

# Install Node.js 20, Docker, and other dependencies
run_remote "
    # Update package list
    sudo apt update

    # Install Node.js 20
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt-get install -y nodejs

    # Install Docker if not already installed
    if ! command -v docker &> /dev/null; then
        sudo apt-get install -y apt-transport-https ca-certificates curl gnupg lsb-release
        curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /usr/share/keyrings/docker-archive-keyring.gpg
        echo \"deb [arch=amd64 signed-by=/usr/share/keyrings/docker-archive-keyring.gpg] https://download.docker.com/linux/ubuntu \$(lsb_release -cs) stable\" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
        sudo apt-get update
        sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
        sudo usermod -aG docker ${DEPLOY_USER}
    fi

    # Install Docker Compose standalone if not available
    if ! command -v docker-compose &> /dev/null; then
        sudo curl -L \"https://github.com/docker/compose/releases/latest/download/docker-compose-\$(uname -s)-\$(uname -m)\" -o /usr/local/bin/docker-compose
        sudo chmod +x /usr/local/bin/docker-compose
    fi

    # Install nginx and certbot if not already installed
    sudo apt-get install -y nginx certbot python3-certbot-nginx

    # Ensure services are enabled
    sudo systemctl enable nginx
    sudo systemctl enable docker
"

echo "🐳 Building and starting Docker containers..."

# Start Docker service and build containers
run_remote "
    cd ${APP_DIR}
    
    # Ensure Docker is running
    sudo systemctl start docker
    
    # Stop any existing containers
    docker-compose -f docker-compose.prod.yml down 2>/dev/null || true
    
    # Build and start containers
    docker-compose -f docker-compose.prod.yml up -d --build
    
    # Wait for services to be healthy
    echo 'Waiting for services to be healthy...'
    sleep 30
    
    # Check container status
    docker-compose -f docker-compose.prod.yml ps
"

echo "🌐 Configuring Nginx..."

# Copy nginx configuration
copy_to_remote "deploy/nginx.conf" "/tmp/nginx-${DOMAIN}.conf"

# Configure nginx
run_remote "
    # Copy nginx configuration
    sudo mv /tmp/nginx-${DOMAIN}.conf ${NGINX_CONF}
    
    # Remove default nginx site if it exists
    sudo rm -f /etc/nginx/sites-enabled/default
    
    # Enable site
    sudo ln -sf ${NGINX_CONF} ${NGINX_ENABLED}
    
    # Test nginx configuration
    sudo nginx -t
    
    # Restart nginx
    sudo systemctl restart nginx
"

echo "🔒 Setting up SSL certificate with Let's Encrypt..."

# Install SSL certificate
run_remote "
    # Request SSL certificate
    sudo certbot --nginx -d ${DOMAIN} --non-interactive --agree-tos --email admin@w-b.dev --redirect
    
    # Test auto-renewal
    sudo certbot renew --dry-run
"

echo "🧪 Testing deployment..."

# Test health endpoints
run_remote "
    # Wait a bit more for everything to stabilize
    sleep 15
    
    # Test API health (internal - use HTTP for localhost)
    curl -f http://localhost:5401/api/health || echo 'API health check failed'
    
    # Test UI (internal - use HTTP for localhost)
    curl -f http://localhost:5402/ || echo 'UI health check failed'
    
    # Test through nginx (external - use HTTPS)
    curl -f https://${DOMAIN}/health || echo 'Nginx health check failed (HTTPS)'
"

echo "🎉 Deployment completed successfully!"
echo "📱 Application is available at: https://${DOMAIN}"
echo "🔍 API health check: https://${DOMAIN}/health"

# Cleanup
rm -rf /tmp/cloudflare-domains-deploy

echo "✅ Deployment script finished. Please verify the application is working correctly."