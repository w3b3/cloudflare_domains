FROM node:21-slim AS builder

WORKDIR /app

# Copy only package files first for better caching
COPY package*.json ./

# Install dependencies
RUN npm ci

# Accept build arguments for Firebase configuration
ARG VITE_FIREBASE_API_KEY
ARG VITE_FIREBASE_AUTH_DOMAIN
ARG VITE_FIREBASE_PROJECT_ID
ARG VITE_FIREBASE_STORAGE_BUCKET
ARG VITE_FIREBASE_MESSAGING_SENDER_ID
ARG VITE_FIREBASE_APP_ID
ARG VITE_FIREBASE_MEASUREMENT_ID

# Validate that all required build arguments are provided
RUN if [ -z "$VITE_FIREBASE_API_KEY" ]; then echo "Error: VITE_FIREBASE_API_KEY build argument is required" && exit 1; fi && \
    if [ -z "$VITE_FIREBASE_AUTH_DOMAIN" ]; then echo "Error: VITE_FIREBASE_AUTH_DOMAIN build argument is required" && exit 1; fi && \
    if [ -z "$VITE_FIREBASE_PROJECT_ID" ]; then echo "Error: VITE_FIREBASE_PROJECT_ID build argument is required" && exit 1; fi && \
    if [ -z "$VITE_FIREBASE_STORAGE_BUCKET" ]; then echo "Error: VITE_FIREBASE_STORAGE_BUCKET build argument is required" && exit 1; fi && \
    if [ -z "$VITE_FIREBASE_MESSAGING_SENDER_ID" ]; then echo "Error: VITE_FIREBASE_MESSAGING_SENDER_ID build argument is required" && exit 1; fi && \
    if [ -z "$VITE_FIREBASE_APP_ID" ]; then echo "Error: VITE_FIREBASE_APP_ID build argument is required" && exit 1; fi && \
    if [ -z "$VITE_FIREBASE_MEASUREMENT_ID" ]; then echo "Error: VITE_FIREBASE_MEASUREMENT_ID build argument is required" && exit 1; fi

# Copy source code
COPY . .

# Create .env file with Firebase configuration and validate values
RUN echo "VITE_FIREBASE_API_KEY=$VITE_FIREBASE_API_KEY" > .env && \
    echo "VITE_FIREBASE_AUTH_DOMAIN=$VITE_FIREBASE_AUTH_DOMAIN" >> .env && \
    echo "VITE_FIREBASE_PROJECT_ID=$VITE_FIREBASE_PROJECT_ID" >> .env && \
    echo "VITE_FIREBASE_STORAGE_BUCKET=$VITE_FIREBASE_STORAGE_BUCKET" >> .env && \
    echo "VITE_FIREBASE_MESSAGING_SENDER_ID=$VITE_FIREBASE_MESSAGING_SENDER_ID" >> .env && \
    echo "VITE_FIREBASE_APP_ID=$VITE_FIREBASE_APP_ID" >> .env && \
    echo "VITE_FIREBASE_MEASUREMENT_ID=$VITE_FIREBASE_MEASUREMENT_ID" >> .env && \
    echo "Build-time environment variables injected successfully" && \
    cat .env

# Build stage (if needed)
RUN npm run build --if-present

# Production stage
FROM nginx:alpine AS runner

# Install curl for healthcheck
RUN apk add --no-cache curl

# Copy built application
COPY --from=builder /app/dist /usr/share/nginx/html

# Create nginx configuration
RUN echo 'server {' > /etc/nginx/conf.d/default.conf && \
    echo '    listen 3000;' >> /etc/nginx/conf.d/default.conf && \
    echo '    listen [::]:3000;' >> /etc/nginx/conf.d/default.conf && \
    echo '    server_name _;' >> /etc/nginx/conf.d/default.conf && \
    echo '    root /usr/share/nginx/html;' >> /etc/nginx/conf.d/default.conf && \
    echo '    index index.html;' >> /etc/nginx/conf.d/default.conf && \
    echo '    location / {' >> /etc/nginx/conf.d/default.conf && \
    echo '        try_files $uri $uri/ /index.html;' >> /etc/nginx/conf.d/default.conf && \
    echo '    }' >> /etc/nginx/conf.d/default.conf && \
    echo '}' >> /etc/nginx/conf.d/default.conf

EXPOSE 3000

CMD ["nginx", "-g", "daemon off;", "-c", "/etc/nginx/nginx.conf"]
