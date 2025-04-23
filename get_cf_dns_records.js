// get_cf_dns_records.js
import axios from 'axios';
import process from 'process';

// --- Configuration ---
// Store your API Token securely as an environment variable.
// Example: export CLOUDFLARE_API_TOKEN='YOUR_API_TOKEN_HERE' (Linux/macOS)
//       or set CLOUDFLARE_API_TOKEN=YOUR_API_TOKEN_HERE (Windows CMD)
//       or $env:CLOUDFLARE_API_TOKEN='YOUR_API_TOKEN_HERE' (Windows PowerShell)
const apiToken = process.env.CLOUDFLARE_API_TOKEN;
const cloudflareApiBase = 'https://api.cloudflare.com/client/v4';
// --- End Configuration ---

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

// Function to get all zones (domains)
async function getZones() {
    try {
        console.log('Fetching zones...');
        // Note: Cloudflare API might paginate results if you have many zones.
        // This basic script fetches the first page (default 20, max 50 per page).
        // Add pagination logic if you have more zones than the per_page limit. See 'Potential Enhancements'.
        const response = await cfApi.get('/zones', {
            params: {
                 per_page: 50 // Fetch up to 50 zones per request
            }
        });
        if (response.data.success) {
            console.log(`Found ${response.data.result_info.total_count} zones total.`);
            return response.data.result; // Array of zone objects
        } else {
            console.error('Error fetching zones:', response.data.errors);
            return [];
        }
    } catch (error) {
        console.error('Error making API request to fetch zones:', error.response ? error.response.data : error.message);
        return [];
    }
}

// Function to get specific DNS records (A or CNAME) for a zone
async function getDnsRecords(zoneId, zoneName) {
    const recordTypes = ['A', 'CNAME'];
    let foundRecords = [];

    console.log(`\n--- Fetching records for zone: ${zoneName} (${zoneId}) ---`);

    for (const type of recordTypes) {
        try {
            console.log(`   Fetching ${type} records...`);
            // Note: Similar to zones, DNS records can be paginated.
            // This script fetches the first page (default 20, max 100 per page).
            // Add pagination logic if needed. See 'Potential Enhancements'.
            const response = await cfApi.get(`/zones/${zoneId}/dns_records`, {
                params: {
                    type: type,
                    per_page: 100 // Fetch up to 100 records per request
                },
            });

            if (response.data.success) {
                 console.log(`   Found ${response.data.result_info.count} ${type} records.`);
                response.data.result.forEach(record => {
                    foundRecords.push({
                        zoneName: zoneName,
                        type: record.type,
                        name: record.name, // Fully qualified name (e.g., www.example.com)
                        content: record.content,
                        proxied: record.proxied,
                    });
                });
            } else {
                console.error(`   Error fetching ${type} records for ${zoneName}:`, response.data.errors);
            }
        } catch (error) {
            console.error(`   Error making API request for ${type} records in zone ${zoneName}:`, error.response ? error.response.data : error.message);
        }
    }
    return foundRecords;
}

// Main function to orchestrate fetching
async function main() {
    console.log('Starting Cloudflare DNS record fetch...');
    const zones = await getZones();

    if (!zones || zones.length === 0) {
        console.log('No zones found or error fetching zones. Exiting.');
        return;
    }

    let allARecords = [];
    let allCnameRecords = [];

    // Process zones sequentially to avoid overwhelming the API (adjust if needed)
    for (const zone of zones) {
        const records = await getDnsRecords(zone.id, zone.name);
        records.forEach(record => {
            if (record.type === 'A') {
                allARecords.push(record);
            } else if (record.type === 'CNAME') {
                allCnameRecords.push(record);
            }
        });
    }

    console.log('\n\n--- Summary ---');

    console.log(`\n--- A Records (${allARecords.length}) ---`);
    if (allARecords.length > 0) {
        allARecords.forEach(r => console.log(`Zone: ${r.zoneName.padEnd(25)} Type: ${r.type} Name: ${r.name.padEnd(40)} Content: ${r.content.padEnd(20)} Proxied: ${r.proxied}`));
    } else {
        console.log('No A records found.');
    }


    console.log(`\n--- CNAME Records (${allCnameRecords.length}) ---`);
     if (allCnameRecords.length > 0) {
        allCnameRecords.forEach(r => console.log(`Zone: ${r.zoneName.padEnd(25)} Type: ${r.type} Name: ${r.name.padEnd(40)} Content: ${r.content.padEnd(20)} Proxied: ${r.proxied}`));
    } else {
        console.log('No CNAME records found.');
    }


    console.log('\nFetch complete.');
}

// Run the main function
main();