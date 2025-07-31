# Cloudflare Domains Manager - Deployment Guide

## Overview

The Cloudflare Domains Manager is deployed on AWS EC2 Ubuntu instance at `44.212.121.39` and accessible at `https://cloudflare.w-b.dev`.

## Architecture

- **Frontend**: React application with Firebase Authentication served via nginx (production build)
- **Backend**: Express.js API with PostgreSQL database
- **Authentication**: Firebase Authentication with GitHub OAuth provider
- **Infrastructure**: Docker containers with nginx reverse proxy and SSL termination
- **SSL**: Let's Encrypt certificates managed by certbot
- **DNS**: Cloudflare DNS management with A record pointing to EC2 instance

## Deployed Services

### Docker Containers

1. **cloudflare-domains-postgres** (PostgreSQL 15)
   - Port: `127.0.0.1:5400:5432` 
   - Database for application data storage

2. **cloudflare-domains-api** (Express.js API)
   - Port: `127.0.0.1:5401:3333`
   - Node.js 20+ API server with Puppeteer for screenshots
   - Environment: Production with Cloudflare API token

3. **cloudflare-domains-ui** (React Frontend)
   - Port: `127.0.0.1:5402:3000`
   - Production build served by nginx
   - Single Page Application with React Router

### Nginx Configuration

- **Domain**: `cloudflare.w-b.dev`
- **SSL**: Let's Encrypt certificates with auto-renewal
- **Configuration file**: `/etc/nginx/sites-available/cloudflare.w-b.dev`
- **IP Access Control**: Restricted to `5.44.248.123` for sensitive endpoints
- **Proxy configuration**:
  - `/screenshots/` → API container (port 5401) for screenshot images (IP restricted)
  - `/api/` → API container (port 5401) for API endpoints (IP restricted)
  - `/health` → API health endpoint (IP restricted)
  - `/` → UI container (port 5402) for main application (public access)

## Deployment Process

### Prerequisites

- AWS EC2 Ubuntu instance with Docker and Docker Compose
- Node.js 20+ installed
- nginx and certbot installed
- Cloudflare API token with Zone:Read and DNS:Read permissions

### Deployment Steps

1. **Prepare deployment files**:
   ```bash
   # Create production docker-compose.yml with port bindings to 127.0.0.1
   # Update UI Dockerfile to use nginx for production build serving
   ```

2. **Transfer files to server**:
   ```bash
   rsync -av --exclude='node_modules' --exclude='.git' ./ ubuntu@44.212.121.39:/opt/cloudflare-domains/
   scp .env ubuntu@44.212.121.39:/opt/cloudflare-domains/
   ```

3. **Deploy containers**:
   ```bash
   cd /opt/cloudflare-domains
   docker-compose -f docker-compose.prod.yml up -d --build
   ```

4. **Configure nginx**:
   ```bash
   sudo cp deploy/nginx.conf /etc/nginx/conf.d/cloudflare.w-b.dev.conf
   sudo nginx -t
   sudo systemctl reload nginx
   ```

5. **Set up SSL**:
   ```bash
   sudo certbot --nginx -d cloudflare.w-b.dev --non-interactive --agree-tos --email admin@w-b.dev --redirect
   ```

6. **Create DNS record**:
   ```bash
   curl -X POST "https://api.cloudflare.com/client/v4/zones/ZONE_ID/dns_records" \
     -H "Authorization: Bearer CLOUDFLARE_TOKEN" \
     -H "Content-Type: application/json" \
     --data '{"type":"A","name":"cloudflare","content":"44.212.121.39","ttl":300}'
   ```

## Environment Variables

Create `.env` file in project root:

```env
CLOUDFLARE_API_TOKEN=your_cloudflare_api_token_here
NODE_ENV=production

# Firebase Authentication Configuration
VITE_FIREBASE_API_KEY=your_firebase_api_key
VITE_FIREBASE_AUTH_DOMAIN=your_auth_domain
VITE_FIREBASE_PROJECT_ID=your_project_id
VITE_FIREBASE_STORAGE_BUCKET=your_storage_bucket
VITE_FIREBASE_MESSAGING_SENDER_ID=your_sender_id
VITE_FIREBASE_APP_ID=your_app_id
VITE_FIREBASE_MEASUREMENT_ID=your_measurement_id

# Database configuration
DB_HOST=localhost
DB_PORT=5432
DB_NAME=gym_membership_db
DB_USER=postgres
DB_PASSWORD=postgres
DB_APP_USER_PASSWORD=postgres
DB_SSL=false
```

## Health Checks

- **Application Health**: `https://cloudflare.w-b.dev/health`
- **API Health**: `https://cloudflare.w-b.dev/api/health`
- **Container Status**: `docker-compose -f docker-compose.prod.yml ps`

## Monitoring and Logs

### Container Logs
```bash
# View API logs
docker logs cloudflare-domains-api

# View UI logs  
docker logs cloudflare-domains-ui

# View database logs
docker logs cloudflare-domains-postgres
```

### Nginx Logs
```bash
# Access logs
sudo tail -f /var/log/nginx/cloudflare.w-b.dev.access.log

# Error logs
sudo tail -f /var/log/nginx/cloudflare.w-b.dev.error.log
```

## SSL Certificate Management

- **Auto-renewal**: Configured via certbot
- **Manual renewal**: `sudo certbot renew`
- **Test renewal**: `sudo certbot renew --dry-run`

## Troubleshooting

### Common Issues

1. **502 Bad Gateway**: Check if containers are running and ports are correct
2. **403 Forbidden**: Ensure Vite dev server allows all hosts or use production build
3. **SSL Issues**: Verify DNS is propagated and certbot can reach the domain
4. **Database Connection**: Check PostgreSQL container health and environment variables
5. **Images not loading**: Ensure `/screenshots/` location is configured in nginx to proxy to API container
6. **Screenshot access**: Verify screenshot files exist in `/opt/cloudflare-domains/api/screenshots/`

### Container Restart
```bash
cd /opt/cloudflare-domains
docker-compose -f docker-compose.prod.yml down
docker-compose -f docker-compose.prod.yml up -d
```

### Nginx Restart
```bash
sudo systemctl restart nginx
sudo systemctl status nginx
```

## Security Considerations

- Containers bind to `127.0.0.1` only (not exposed to public internet)
- SSL/TLS termination at nginx level
- Security headers configured in nginx
- **IP-based access control**: API endpoints, screenshots, and health checks restricted to `5.44.248.123`
- Cloudflare API token with minimal required permissions
- Regular updates of base Docker images and dependencies

## Performance Optimizations

- Gzip compression enabled
- Static asset caching
- Docker multi-stage builds for smaller images
- Health checks for container orchestration
- Connection timeouts configured appropriately

## Backup and Recovery

- Database: PostgreSQL data persisted in Docker volume `postgres_data`
- Application code: Stored in `/opt/cloudflare-domains/`
- nginx configuration: Stored in `/etc/nginx/conf.d/`
- SSL certificates: Managed by Let's Encrypt in `/etc/letsencrypt/`

## Standards for Future AI Iterations

1. **Always use production builds** for UI deployment (nginx serving static files)
2. **Bind containers to 127.0.0.1** for security (only accessible via nginx proxy)
3. **Use docker-compose.prod.yml** for production deployments
4. **Configure nginx proxy routes correctly**: `/screenshots/` → API, `/api/` → API, `/` → UI (in this order)
5. **Maintain IP restrictions**: Ensure sensitive endpoints (`/api/`, `/screenshots/`, `/health`) remain restricted to authorized IPs
6. **Update this documentation** when making infrastructure changes
7. **Test health endpoints** after any deployment (from authorized IP only)
8. **Verify SSL certificates** are working and auto-renewing
9. **Test screenshot functionality** after deployment (both taking and viewing)
10. **Monitor container logs** during and after deployment
11. **Use appropriate Node.js version** (20+) as specified in user preferences
12. **Volume persistence**: Ensure screenshot storage is properly mounted between container restarts
13. **Security verification**: Always test that restricted endpoints return 403 Forbidden from unauthorized IPs