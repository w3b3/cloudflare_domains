# Use Node.js 21 version
FROM node:21-slim

WORKDIR /app

# Install necessary dependencies: Puppeteer, curl
# Removed build tools (python3, make, g++)
RUN apt-get update && apt-get install -y \
    chromium \
    libpangocairo-1.0-0 \
    libx11-xcb1 \
    libxcomposite1 \
    libxcursor1 \
    libxdamage1 \
    libxi6 \
    libxtst6 \
    libnss3 \
    libcups2 \
    libxss1 \
    libxrandr2 \
    libasound2 \
    libatk1.0-0 \
    libgtk-3-0 \
    libgbm-dev \
    curl \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Copy package files first for caching
COPY package*.json ./

# Install dependencies (including devDependencies for nodemon)
RUN npm install

# Copy the rest of the application code
COPY . .

# Create screenshots directory
# Removed data directory creation
RUN mkdir -p screenshots

EXPOSE 3333

# Use the dev script from package.json
CMD ["npm", "run", "dev"]
