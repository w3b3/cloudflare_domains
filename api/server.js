// server.js - API Server for Cloudflare Domains Management
import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import axios from 'axios';
import betterSqlite3 from 'better-sqlite3';
import dotenv from 'dotenv';
import puppeteer from 'puppeteer';

// Configure environment
dotenv.config({ path: '../.env' });
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = process.env.PORT || 3333;
const CLOUDFLARE_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const cloudflareApiBase = 'https://api.cloudflare.com/client/v4';
const CACHE_EXPIRATION_HOURS = 24;

// Database setup
const DB_PATH = path.join(__dirname, '../cloudflare_cache.db');
const SCREENSHOTS_DIR = path.join(__dirname, 'screenshots');

// Ensure screenshots directory exists
if (!fs.existsSync(SCREENSHOTS_DIR)) {
    fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
    console.log(`Created screenshots directory: ${SCREENSHOTS_DIR}`);
}

// Initialize database
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
    
    // Create zone_metadata table for notes, screenshots, and tags
    database.exec(`
        CREATE TABLE IF NOT EXISTS zone_metadata (
            zone_id TEXT PRIMARY KEY,
            notes TEXT,
            screenshot_path TEXT,
            tag TEXT
        )
    `);
    
    // Create zone_tasks table for task checklists
    database.exec(`
        CREATE TABLE IF NOT EXISTS zone_tasks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            zone_id TEXT NOT NULL,
            task_description TEXT NOT NULL,
            is_completed INTEGER DEFAULT 0,
            created_at INTEGER NOT NULL,
            completed_at INTEGER
        )
    `);
    
    // Check if tag column exists in zone_metadata, add it if not
    try {
        // Check if the tag column exists using a pragma query
        const columns = database.prepare('PRAGMA table_info(zone_metadata)').all();
        const tagColumnExists = columns.some(column => column.name === 'tag');
        
        if (!tagColumnExists) {
            console.log('Adding missing tag column to zone_metadata table...');
            database.exec('ALTER TABLE zone_metadata ADD COLUMN tag TEXT');
            console.log('Tag column added successfully.');
        }
    } catch (error) {
        console.error('Error checking or adding tag column:', error);
    }
    
    return database;
}

// Create Cloudflare API client
const cfApi = axios.create({
    baseURL: cloudflareApiBase,
    headers: {
        'Authorization': `Bearer ${CLOUDFLARE_API_TOKEN}`,
        'Content-Type': 'application/json',
    },
});

// Express app setup
const app = express();
app.use(cors());
app.use(bodyParser.json());
app.use('/screenshots', express.static(SCREENSHOTS_DIR));

// Check if cached data is fresh
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
        
        // Validate API token
        if (!CLOUDFLARE_API_TOKEN) {
            throw new Error('CLOUDFLARE_API_TOKEN is not set');
        }
        
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
        throw error;
    }
}

// Function to get DNS records for a zone with caching
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

// Function to get metadata for a zone
function getZoneMetadata(zoneId) {
    const metadata = db.prepare('SELECT * FROM zone_metadata WHERE zone_id = ?').get(zoneId);
    if (!metadata) {
        // Create default metadata if it doesn't exist
        db.prepare('INSERT INTO zone_metadata (zone_id, notes, screenshot_path, tag) VALUES (?, ?, ?, ?)')
          .run(zoneId, '', '', '');
        return { zone_id: zoneId, notes: '', screenshot_path: '', tag: '' };
    }
    return metadata;
}

// Function to get tasks for a zone
function getZoneTasks(zoneId) {
    return db.prepare('SELECT * FROM zone_tasks WHERE zone_id = ? ORDER BY created_at DESC').all(zoneId);
}

// Function to get all zone data including metadata and tasks
async function getEnrichedZoneData() {
    const zones = await getZones();
    const recordsByZone = {};
    
    for (const zone of zones) {
        // Get DNS records
        const records = await getDnsRecords(zone.id, zone.name);
        
        // Get metadata and tasks
        const metadata = getZoneMetadata(zone.id);
        const tasks = getZoneTasks(zone.id);
        
        recordsByZone[zone.name] = {
            zone: zone,
            records: records,
            metadata: metadata,
            tasks: tasks
        };
    }
    
    return recordsByZone;
}

// Function to take screenshots of domains
async function takeScreenshot(zoneName) {
    console.log(`Taking screenshot of ${zoneName}...`);
    const screenshotPath = path.join(SCREENSHOTS_DIR, `${zoneName}.png`);
    
    // Launch browser
    const browser = await puppeteer.launch({ 
        headless: "new", 
        defaultViewport: { width: 1280, height: 800 } 
    });
    
    try {
        const page = await browser.newPage();
        
        // Set timeout to 30 seconds
        await page.setDefaultNavigationTimeout(30000);
        
        // Navigate to the domain
        await page.goto(`http://${zoneName}`, { waitUntil: 'networkidle2' });
        
        // Take screenshot
        await page.screenshot({ path: screenshotPath, fullPage: false });
        
        console.log(`Screenshot saved to ${screenshotPath}`);
        
        // Close the page
        await page.close();
        
        // Update the database with the screenshot path
        updateZoneScreenshot(zoneName, screenshotPath);
        
        // Return a path that works with the client-side URL structure
        const filename = path.basename(screenshotPath);
        return {
            success: true,
            path: `/screenshots/${filename}`,
            message: 'Screenshot taken successfully'
        };
    } catch (error) {
        console.error(`Error taking screenshot of ${zoneName}:`, error.message);
        return {
            success: false,
            error: error.message
        };
    } finally {
        await browser.close();
    }
}

// Function to update the zone's screenshot path in the database
function updateZoneScreenshot(zoneName, screenshotPath) {
    // Find the zone ID from the name
    const zone = db.prepare('SELECT id FROM zones WHERE name = ?').get(zoneName);
    
    if (!zone) {
        console.error(`Zone not found for name: ${zoneName}`);
        return false;
    }
    
    const zoneId = zone.id;
    // Store the screenshot path relative to the API screenshots directory
    const relativePath = path.basename(screenshotPath);
    
    // Check if metadata exists for this zone
    const metadata = db.prepare('SELECT * FROM zone_metadata WHERE zone_id = ?').get(zoneId);
    
    if (metadata) {
        // Update existing metadata
        db.prepare('UPDATE zone_metadata SET screenshot_path = ? WHERE zone_id = ?')
          .run(relativePath, zoneId);
    } else {
        // Create new metadata record
        db.prepare('INSERT INTO zone_metadata (zone_id, notes, screenshot_path, tag) VALUES (?, ?, ?, ?)')
          .run(zoneId, '', relativePath, '');
    }
    
    return true;
}

// API Routes
app.get('/api/zones', async (req, res) => {
    try {
        const zones = await getZones();
        res.json({ success: true, data: zones });
    } catch (error) {
        console.error('Error fetching zones:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/api/zones/:zoneName/records', async (req, res) => {
    try {
        const { zoneName } = req.params;
        
        // Find zone ID from name
        const zone = db.prepare('SELECT id FROM zones WHERE name = ?').get(zoneName);
        
        if (!zone) {
            return res.status(404).json({
                success: false,
                error: `Zone not found: ${zoneName}`
            });
        }
        
        const records = await getDnsRecords(zone.id, zoneName);
        res.json({ success: true, data: records });
    } catch (error) {
        console.error('Error fetching DNS records:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/api/zones/:zoneName/metadata', (req, res) => {
    try {
        const { zoneName } = req.params;
        
        // Find zone ID from name
        const zone = db.prepare('SELECT id FROM zones WHERE name = ?').get(zoneName);
        
        if (!zone) {
            return res.status(404).json({
                success: false,
                error: `Zone not found: ${zoneName}`
            });
        }
        
        const metadata = getZoneMetadata(zone.id);
        res.json({ success: true, data: metadata });
    } catch (error) {
        console.error('Error fetching metadata:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/zones/:zoneName/metadata', (req, res) => {
    try {
        const { zoneName } = req.params;
        const { tag, notes } = req.body;
        
        // Find zone ID from name
        const zone = db.prepare('SELECT id FROM zones WHERE name = ?').get(zoneName);
        
        if (!zone) {
            return res.status(404).json({
                success: false,
                error: `Zone not found: ${zoneName}`
            });
        }
        
        // Update the database
        const updateStmt = db.prepare(
            'UPDATE zone_metadata SET tag = ?, notes = ? WHERE zone_id = ?'
        );
        updateStmt.run(tag || '', notes || '', zone.id);
        
        res.json({ success: true, message: 'Metadata updated successfully' });
    } catch (error) {
        console.error('Error updating metadata:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/api/zones/:zoneName/tasks', (req, res) => {
    try {
        const { zoneName } = req.params;
        
        // Find zone ID from name
        const zone = db.prepare('SELECT id FROM zones WHERE name = ?').get(zoneName);
        
        if (!zone) {
            return res.status(404).json({
                success: false,
                error: `Zone not found: ${zoneName}`
            });
        }
        
        const tasks = getZoneTasks(zone.id);
        res.json({ success: true, data: tasks });
    } catch (error) {
        console.error('Error fetching tasks:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/zones/:zoneName/tasks', (req, res) => {
    try {
        const { zoneName } = req.params;
        const { task_description } = req.body;
        
        if (!task_description) {
            return res.status(400).json({
                success: false,
                error: 'Task description is required'
            });
        }
        
        // Find zone ID from name
        const zone = db.prepare('SELECT id FROM zones WHERE name = ?').get(zoneName);
        
        if (!zone) {
            return res.status(404).json({
                success: false,
                error: `Zone not found: ${zoneName}`
            });
        }
        
        // Insert new task
        const insertStmt = db.prepare(
            'INSERT INTO zone_tasks (zone_id, task_description, is_completed, created_at) VALUES (?, ?, ?, ?)'
        );
        const result = insertStmt.run(zone.id, task_description, 0, Date.now());
        
        res.json({ 
            success: true, 
            message: 'Task created successfully',
            data: {
                id: result.lastInsertRowid,
                zone_id: zone.id,
                task_description,
                is_completed: 0,
                created_at: Date.now()
            }
        });
    } catch (error) {
        console.error('Error creating task:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.put('/api/zones/:zoneName/tasks/:taskId', (req, res) => {
    try {
        const { zoneName, taskId } = req.params;
        const { is_completed } = req.body;
        
        if (is_completed === undefined) {
            return res.status(400).json({
                success: false,
                error: 'is_completed field is required'
            });
        }
        
        // Find zone ID from name
        const zone = db.prepare('SELECT id FROM zones WHERE name = ?').get(zoneName);
        
        if (!zone) {
            return res.status(404).json({
                success: false,
                error: `Zone not found: ${zoneName}`
            });
        }
        
        // Check if task exists
        const task = db.prepare('SELECT * FROM zone_tasks WHERE id = ? AND zone_id = ?').get(taskId, zone.id);
        
        if (!task) {
            return res.status(404).json({
                success: false,
                error: `Task not found: ${taskId}`
            });
        }
        
        // Update task
        const completed_at = is_completed ? Date.now() : null;
        const updateStmt = db.prepare(
            'UPDATE zone_tasks SET is_completed = ?, completed_at = ? WHERE id = ?'
        );
        updateStmt.run(is_completed ? 1 : 0, completed_at, taskId);
        
        res.json({ success: true, message: 'Task updated successfully' });
    } catch (error) {
        console.error('Error updating task:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.delete('/api/zones/:zoneName/tasks/:taskId', (req, res) => {
    try {
        const { zoneName, taskId } = req.params;
        
        // Find zone ID from name
        const zone = db.prepare('SELECT id FROM zones WHERE name = ?').get(zoneName);
        
        if (!zone) {
            return res.status(404).json({
                success: false,
                error: `Zone not found: ${zoneName}`
            });
        }
        
        // Check if task exists
        const task = db.prepare('SELECT * FROM zone_tasks WHERE id = ? AND zone_id = ?').get(taskId, zone.id);
        
        if (!task) {
            return res.status(404).json({
                success: false,
                error: `Task not found: ${taskId}`
            });
        }
        
        // Delete task
        const deleteStmt = db.prepare('DELETE FROM zone_tasks WHERE id = ?');
        deleteStmt.run(taskId);
        
        res.json({ success: true, message: 'Task deleted successfully' });
    } catch (error) {
        console.error('Error deleting task:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/zones/:zoneName/screenshot', async (req, res) => {
    try {
        const { zoneName } = req.params;
        
        // Find zone ID from name
        const zone = db.prepare('SELECT id FROM zones WHERE name = ?').get(zoneName);
        
        if (!zone) {
            return res.status(404).json({
                success: false,
                error: `Zone not found: ${zoneName}`
            });
        }
        
        const result = await takeScreenshot(zoneName);
        res.json(result);
    } catch (error) {
        console.error('Error taking screenshot:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/api/all', async (req, res) => {
    try {
        const zoneData = await getEnrichedZoneData();
        res.json({ success: true, data: zoneData });
    } catch (error) {
        console.error('Error fetching all data:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Start the server
app.listen(PORT, () => {
    console.log(`API server running at http://localhost:${PORT}`);
}); 