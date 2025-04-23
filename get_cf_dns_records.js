// get_cf_dns_records.js
import axios from 'axios';
import process from 'process';
import dotenv from 'dotenv';
import betterSqlite3 from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

// Load environment variables from .env file
dotenv.config();

// --- Configuration ---
// Store your API Token in the .env file as:
// CLOUDFLARE_API_TOKEN=your_api_token_here
const apiToken = process.env.CLOUDFLARE_API_TOKEN;
const cloudflareApiBase = 'https://api.cloudflare.com/client/v4';
const CACHE_EXPIRATION_HOURS = 24; // Cache data for 24 hours
const DB_PATH = path.join(process.cwd(), 'cloudflare_cache.db');
const HTML_OUTPUT_PATH = path.join(process.cwd(), 'cloudflare_report.html');
// --- End Configuration ---

// Initialize SQLite database for caching
const db = initDatabase();

function initDatabase() {
    const database = betterSqlite3(DB_PATH);
    
    // Create zones table if it doesn't exist
    database.exec(`
        CREATE TABLE IF NOT EXISTS zones (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            data TEXT NOT NULL,
            timestamp INTEGER NOT NULL
        )
    `);
    
    // Create dns_records table if it doesn't exist
    database.exec(`
        CREATE TABLE IF NOT EXISTS dns_records (
            zone_id TEXT NOT NULL,
            type TEXT NOT NULL,
            data TEXT NOT NULL,
            timestamp INTEGER NOT NULL,
            PRIMARY KEY (zone_id, type)
        )
    `);
    
    return database;
}

if (!apiToken) {
    console.error('Error: CLOUDFLARE_API_TOKEN environment variable is not set.');
    console.error('Please set it with your Cloudflare API Token.');
    process.exit(1); // Exit with an error code
}

// Create an axios instance with default auth header
const cfApi = axios.create({
    baseURL: cloudflareApiBase,
    headers: {
        'Authorization': `Bearer ${apiToken}`,
        'Content-Type': 'application/json',
    },
});

// Check if cached data is fresh (less than CACHE_EXPIRATION_HOURS old)
function isCacheFresh(timestamp) {
    const now = Date.now();
    const expirationTime = CACHE_EXPIRATION_HOURS * 60 * 60 * 1000; // Convert hours to milliseconds
    return (now - timestamp) < expirationTime;
}

// Function to get all zones (domains) with caching
async function getZones() {
    try {
        console.log('Checking cache for zones...');
        
        // Check if we have fresh cached data
        const cachedZones = db.prepare('SELECT * FROM zones WHERE timestamp > ?')
            .all(Date.now() - (CACHE_EXPIRATION_HOURS * 60 * 60 * 1000));
        
        if (cachedZones.length > 0) {
            console.log(`Found ${cachedZones.length} zones in cache.`);
            return cachedZones.map(zone => JSON.parse(zone.data));
        }
        
        console.log('Cache miss or expired. Fetching zones from Cloudflare...');
        const response = await cfApi.get('/zones', {
            params: {
                per_page: 50 // Fetch up to 50 zones per request
            }
        });
        
        if (response.data.success) {
            const zones = response.data.result;
            console.log(`Found ${zones.length} zones total.`);
            
            // Clear existing zones data
            db.prepare('DELETE FROM zones').run();
            
            // Cache the zones
            const insertZone = db.prepare('INSERT OR REPLACE INTO zones (id, name, data, timestamp) VALUES (?, ?, ?, ?)');
            const now = Date.now();
            
            for (const zone of zones) {
                insertZone.run(zone.id, zone.name, JSON.stringify(zone), now);
            }
            
            return zones;
        } else {
            console.error('Error fetching zones:', response.data.errors);
            return [];
        }
    } catch (error) {
        console.error('Error making API request to fetch zones:', error.response ? error.response.data : error.message);
        return [];
    }
}

// Function to get specific DNS records (A or CNAME) for a zone with caching
async function getDnsRecords(zoneId, zoneName) {
    const recordTypes = ['A', 'CNAME'];
    let foundRecords = [];

    console.log(`\n--- Fetching records for zone: ${zoneName} (${zoneId}) ---`);

    for (const type of recordTypes) {
        try {
            console.log(`   Checking cache for ${type} records...`);
            
            // Check if we have fresh cached data
            const cachedRecords = db.prepare('SELECT * FROM dns_records WHERE zone_id = ? AND type = ? AND timestamp > ?')
                .get(zoneId, type, Date.now() - (CACHE_EXPIRATION_HOURS * 60 * 60 * 1000));
            
            let records;
            
            if (cachedRecords) {
                console.log(`   Found ${type} records in cache.`);
                records = JSON.parse(cachedRecords.data);
            } else {
                console.log(`   Cache miss or expired. Fetching ${type} records from Cloudflare...`);
                const response = await cfApi.get(`/zones/${zoneId}/dns_records`, {
                    params: {
                        type: type,
                        per_page: 100 // Fetch up to 100 records per request
                    },
                });

                if (response.data.success) {
                    records = response.data.result;
                    console.log(`   Found ${records.length} ${type} records.`);
                    
                    // Cache the records
                    const insertRecord = db.prepare('INSERT OR REPLACE INTO dns_records (zone_id, type, data, timestamp) VALUES (?, ?, ?, ?)');
                    insertRecord.run(zoneId, type, JSON.stringify(records), Date.now());
                } else {
                    console.error(`   Error fetching ${type} records for ${zoneName}:`, response.data.errors);
                    records = [];
                }
            }
            
            records.forEach(record => {
                foundRecords.push({
                    zoneName: zoneName,
                    type: record.type,
                    name: record.name,
                    content: record.content,
                    proxied: record.proxied,
                });
            });
        } catch (error) {
            console.error(`   Error processing ${type} records in zone ${zoneName}:`, error.response ? error.response.data : error.message);
        }
    }
    return foundRecords;
}

// Generate HTML report with Bootstrap styling
function generateHtmlReport(recordsByZone) {
    const bootstrapCss = 'node_modules/bootstrap/dist/css/bootstrap.min.css';
    const bootstrapJs = 'node_modules/bootstrap/dist/js/bootstrap.bundle.min.js';
    
    // Read the Bootstrap CSS and JS files
    const cssContent = fs.readFileSync(bootstrapCss, 'utf8');
    const jsContent = fs.readFileSync(bootstrapJs, 'utf8');
    
    // Generate tabs for each zone
    let tabNav = '';
    let tabContent = '';
    
    // Sort zones alphabetically
    const sortedZones = Object.keys(recordsByZone).sort();
    
    // Create the tabs
    sortedZones.forEach((zoneName, index) => {
        const isActive = index === 0 ? 'active' : '';
        const zoneId = zoneName.replace(/\./g, '-');
        
        tabNav += `
            <li class="nav-item" role="presentation">
                <button class="nav-link ${isActive}" id="${zoneId}-tab" data-bs-toggle="tab" 
                        data-bs-target="#${zoneId}" type="button" role="tab" 
                        aria-controls="${zoneId}" aria-selected="${index === 0}">
                    ${zoneName}
                </button>
            </li>
        `;
        
        const records = recordsByZone[zoneName];
        
        // Create table content for this zone
        let tableContent = '';
        
        // Get root domain record if it exists
        const rootRecord = records.find(r => r.name === zoneName);
        if (rootRecord) {
            tableContent += `
                <tr class="table-primary">
                    <td><strong>Root Domain</strong></td>
                    <td>${rootRecord.type}</td>
                    <td>${rootRecord.content}</td>
                    <td>${rootRecord.proxied ? '<span class="badge bg-success">Yes</span>' : '<span class="badge bg-secondary">No</span>'}</td>
                </tr>
            `;
        }
        
        // Get subdomains (non-root records)
        const subdomains = records
            .filter(r => r.name !== zoneName)
            .map(r => {
                const subdomain = r.name.replace(`.${zoneName}`, '');
                return { ...r, subdomain };
            })
            .sort((a, b) => a.subdomain.localeCompare(b.subdomain));
        
        subdomains.forEach(sub => {
            tableContent += `
                <tr>
                    <td>${sub.subdomain}</td>
                    <td>${sub.type}</td>
                    <td>${sub.content}</td>
                    <td>${sub.proxied ? '<span class="badge bg-success">Yes</span>' : '<span class="badge bg-secondary">No</span>'}</td>
                </tr>
            `;
        });
        
        // Create tab content
        tabContent += `
            <div class="tab-pane fade show ${isActive}" id="${zoneId}" role="tabpanel" aria-labelledby="${zoneId}-tab">
                <div class="card mt-3">
                    <div class="card-header bg-light">
                        <h5>${zoneName} <span class="badge bg-primary">${records.length} records</span></h5>
                    </div>
                    <div class="card-body">
                        <table class="table table-striped table-hover">
                            <thead class="table-dark">
                                <tr>
                                    <th>Name</th>
                                    <th>Type</th>
                                    <th>Value</th>
                                    <th>Proxied</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${tableContent}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        `;
    });
    
    // Generate the complete HTML
    const html = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Cloudflare DNS Records Report</title>
        <style>
            ${cssContent}
            
            /* Custom styles */
            body {
                padding: 20px;
                background-color: #f8f9fa;
            }
            .report-header {
                margin-bottom: 30px;
            }
            .last-updated {
                font-size: 0.9rem;
                color: #6c757d;
            }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="report-header">
                <h1 class="mb-3">Cloudflare DNS Records Report</h1>
                <p class="last-updated">Last updated: ${new Date().toLocaleString()}</p>
            </div>
            
            <ul class="nav nav-tabs" id="zoneTabs" role="tablist">
                ${tabNav}
            </ul>
            
            <div class="tab-content" id="zoneTabsContent">
                ${tabContent}
            </div>
        </div>
        
        <script>
            ${jsContent}
        </script>
    </body>
    </html>
    `;
    
    fs.writeFileSync(HTML_OUTPUT_PATH, html);
    console.log(`\nHTML report generated: ${HTML_OUTPUT_PATH}`);
}

// Main function to orchestrate fetching
async function main() {
    console.log('Starting Cloudflare DNS record fetch...');
    const zones = await getZones();

    if (!zones || zones.length === 0) {
        console.log('No zones found or error fetching zones. Exiting.');
        return;
    }

    // Object to store records by zone
    const recordsByZone = {};

    // Process zones sequentially to avoid overwhelming the API (adjust if needed)
    for (const zone of zones) {
        const records = await getDnsRecords(zone.id, zone.name);
        recordsByZone[zone.name] = records;
    }

    // Display the summary grouped by zone
    console.log('\n\n--- Summary (Grouped by Zone) ---');
    
    // Sort zones alphabetically
    const sortedZones = Object.keys(recordsByZone).sort();
    
    for (const zoneName of sortedZones) {
        const records = recordsByZone[zoneName];
        console.log(`\n--- ${zoneName} (${records.length} records) ---`);
        
        // Get root domain record if it exists
        const rootRecord = records.find(r => r.name === zoneName);
        if (rootRecord) {
            console.log(`Root domain (${rootRecord.type})`);
        }
        
        // Get subdomains (non-root records)
        const subdomains = records
            .filter(r => r.name !== zoneName)
            .map(r => {
                // Extract the subdomain part
                const subdomain = r.name.replace(`.${zoneName}`, '');
                return { subdomain, type: r.type };
            })
            .sort((a, b) => a.subdomain.localeCompare(b.subdomain));
        
        if (subdomains.length > 0) {
            console.log('Subdomains:');
            subdomains.forEach(sub => {
                console.log(`  - ${sub.subdomain} (${sub.type})`);
            });
        } else if (!rootRecord) {
            console.log('No records found.');
        }
    }

    // Generate HTML report
    generateHtmlReport(recordsByZone);
    
    console.log('\nFetch complete.');
}

// Run the main function
main();