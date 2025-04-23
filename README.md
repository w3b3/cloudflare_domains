# Cloudflare Domains Manager

A full-stack application to manage your Cloudflare domains, DNS records, and more. This application allows you to:

- View all your Cloudflare domains
- See DNS records for each domain
- Add tags to categorize domains
- Add notes for each domain
- Manage domain-specific tasks
- Take and view screenshots of domains

## Project Structure

This is a monorepo with three main components:

- **API**: Express server that handles data fetching and manipulation
- **UI**: React frontend for user interaction
- **DB**: SQLite database for local storage

## Prerequisites

- Node.js (v16+)
- npm
- Cloudflare API Token with read/write permissions

## Setup

1. Clone the repository

2. Install dependencies
   ```
   npm run install:all
   ```

3. Create a `.env` file in the root directory with your Cloudflare API token:
   ```
   CLOUDFLARE_API_TOKEN=your_api_token_here
   ```

## Running the Application

Start both the API and UI development servers:

```
npm run dev
```

This will start:
- The API server at http://localhost:3333
- The React UI at http://localhost:3000

## Features

### API Features

- Cache Cloudflare API results for faster loading
- CRUD operations for domain metadata and tasks
- Screenshot generation using Puppeteer
- RESTful endpoints for all operations

### UI Features

- Modern React interface with Bootstrap styling
- Domain listing and details
- DNS record viewing with automatic formatting
- Task management with checkboxes and status tracking
- Domain tagging and notes system
- Screenshot viewing and management

## API Endpoints

- `GET /api/zones` - Get all domains
- `GET /api/zones/:zoneName/records` - Get DNS records for a domain
- `GET /api/zones/:zoneName/metadata` - Get metadata for a domain
- `POST /api/zones/:zoneName/metadata` - Update metadata for a domain
- `GET /api/zones/:zoneName/tasks` - Get tasks for a domain
- `POST /api/zones/:zoneName/tasks` - Create a new task
- `PUT /api/zones/:zoneName/tasks/:taskId` - Update a task
- `DELETE /api/zones/:zoneName/tasks/:taskId` - Delete a task
- `POST /api/zones/:zoneName/screenshot` - Take a screenshot of a domain
- `GET /api/all` - Get all data in a single request

## Development

- API: `npm run api:dev`
- UI: `npm run ui:dev`

## License

MIT 