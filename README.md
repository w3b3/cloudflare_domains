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

- Node.js (v20+)
- npm
- Cloudflare API Token with specific permissions (see below)
- Firebase project with GitHub authentication enabled (see FIREBASE_AUTH.md)

## Setup

1. Clone the repository

2. Install dependencies
   ```
   npm run install:all
   ```

3. Create a `.env` file in the root directory with your configuration:
   ```bash
   # Copy the example template
   cp .env.example .env
   
   # Edit the .env file with your actual credentials
   # Never commit this file to version control!
   ```

   Required environment variables:
   ```env
   CLOUDFLARE_API_TOKEN=your_cloudflare_api_token_here
   
   # Firebase Configuration (see FIREBASE_AUTH.md for setup)
   VITE_FIREBASE_API_KEY=your_firebase_api_key_here
   VITE_FIREBASE_AUTH_DOMAIN=your_auth_domain_here
   VITE_FIREBASE_PROJECT_ID=your_project_id_here
   VITE_FIREBASE_STORAGE_BUCKET=your_storage_bucket_here
   VITE_FIREBASE_MESSAGING_SENDER_ID=your_messaging_sender_id_here
   VITE_FIREBASE_APP_ID=your_app_id_here
   VITE_FIREBASE_MEASUREMENT_ID=your_measurement_id_here
   ```

## Cloudflare API Token Setup

This application requires a Cloudflare API Token with specific permissions to function properly. The application only **reads** data from Cloudflare and does not modify any DNS records or zone settings.

### Required API Token Permissions

When creating your Cloudflare API token at [https://dash.cloudflare.com/profile/api-tokens](https://dash.cloudflare.com/profile/api-tokens), you need to grant the following **Zone-level permissions**:

#### Zone Permissions (Required)
- **Zone:Read** - Grants read access to zone management (to list your domains)
- **DNS:Read** - Grants read access to DNS records (to fetch DNS records for each domain)

#### Account Permissions (Optional but Recommended)
- **Zone:Read** - Grants read access to account-level zone listing

### Token Configuration Steps

1. Go to [Cloudflare Dashboard > API Tokens](https://dash.cloudflare.com/profile/api-tokens)
2. Click "Create Token"
3. Use "Custom token" template
4. Configure the following settings:

**Permissions:**
- Zone - Zone:Read
- Zone - DNS:Read

**Zone Resources:**
- Include - All zones (or specific zones you want to manage)

**Account Resources:**
- Include - All accounts (or your specific account)

**Client IP Address Filtering (Optional):**
- You can restrict the token to specific IP addresses for added security

5. Click "Continue to summary" 
6. Review and click "Create Token"
7. Copy the token value and add it to your `.env` file

### API Endpoints Used

The application makes the following API calls to Cloudflare:
- `GET /zones` - Retrieve all domains/zones in your account  
- `GET /zones/{zone_id}/dns_records` - Retrieve DNS records for each domain (A and CNAME records only)

### Security Notes

- The application only requires **read permissions** - it does not modify your DNS settings
- Store your API token securely in the `.env` file (never commit it to version control)
- Consider using IP address filtering if deploying to a fixed server
- You can test your token using: 
  ```bash
  curl "https://api.cloudflare.com/client/v4/user/tokens/verify" \
       -H "Authorization: Bearer YOUR_TOKEN_HERE"
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

### Authentication

- **Firebase Authentication**: Secure GitHub OAuth integration
- **Protected Routes**: All application access requires authentication
- **Session Management**: Automatic session persistence and management
- **User Interface**: Clean login/logout flow with user profile display

### API Features

- Cache Cloudflare API results for faster loading
- CRUD operations for domain metadata and tasks
- Screenshot generation using Puppeteer
- RESTful endpoints for all operations

### UI Features

- Modern React interface with Bootstrap styling
- Secure authentication with GitHub OAuth
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