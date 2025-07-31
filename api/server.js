// server.js - API Server for Cloudflare Domains Management
import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import axios from 'axios';
import pg from 'pg'; // Use pg instead of better-sqlite3
import dotenv from 'dotenv';
import puppeteer from 'puppeteer';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import validator from 'validator';
import admin from 'firebase-admin';

const { Pool } = pg;

// Configure environment
// Load .env file from root, relative to this file's location in api/
dotenv.config({ path: path.join(path.dirname(fileURLToPath(import.meta.url)), '../.env') });

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = process.env.PORT || 3333;
const CLOUDFLARE_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const cloudflareApiBase = 'https://api.cloudflare.com/client/v4';
const CACHE_EXPIRATION_HOURS = 24;

// Firebase Admin SDK initialization
try {
    // Initialize Firebase Admin with project ID (no service account key needed for Firebase Auth verification)
    if (!admin.apps.length) {
        admin.initializeApp({
            projectId: process.env.VITE_FIREBASE_PROJECT_ID || 'cloudflare-domains-manager'
        });
    }
    console.log('Firebase Admin initialized successfully');
} catch (error) {
    console.error('Firebase Admin initialization failed:', error);
    console.log('Note: Firebase Admin is required for API authentication');
}

// Screenshots directory setup
const SCREENSHOTS_DIR = path.join(__dirname, 'screenshots');

// Ensure screenshots directory exists
if (!fs.existsSync(SCREENSHOTS_DIR)) {
    fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
    console.log(`Created screenshots directory: ${SCREENSHOTS_DIR}`);
}

// PostgreSQL Pool setup
const pool = new Pool({
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT || '5432', 10),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false, // Basic SSL handling
});

// Database initialization
async function initDatabase() {
    let client;
    try {
        client = await pool.connect();
        console.log('Connected to PostgreSQL database.');

        // Create zones table
        await client.query(`
            CREATE TABLE IF NOT EXISTS zones (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL UNIQUE,
                data JSONB NOT NULL,
                timestamp TIMESTAMPTZ NOT NULL
            )
        `);

        // Create dns_records table
        await client.query(`
            CREATE TABLE IF NOT EXISTS dns_records (
                zone_id TEXT NOT NULL REFERENCES zones(id) ON DELETE CASCADE,
                type TEXT NOT NULL,
                data JSONB NOT NULL,
                timestamp TIMESTAMPTZ NOT NULL,
                PRIMARY KEY (zone_id, type)
            )
        `);

        // Create zone_metadata table
        await client.query(`
            CREATE TABLE IF NOT EXISTS zone_metadata (
                zone_id TEXT PRIMARY KEY REFERENCES zones(id) ON DELETE CASCADE,
                notes TEXT,
                screenshot_path TEXT,
                tag TEXT
            )
        `);

        // Create zone_tasks table
        await client.query(`
            CREATE TABLE IF NOT EXISTS zone_tasks (
                id SERIAL PRIMARY KEY,
                zone_id TEXT NOT NULL REFERENCES zones(id) ON DELETE CASCADE,
                task_description TEXT NOT NULL,
                is_completed BOOLEAN DEFAULT false,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                completed_at TIMESTAMPTZ
            )
        `);

        console.log('Database tables ensured.');
    } catch (error) {
        console.error('Error initializing database:', error);
        // Exit if database initialization fails, as the app cannot function
        process.exit(1);
    } finally {
        if (client) {
            client.release(); // Release the client back to the pool
        }
    }
}

// Initialize DB on startup
initDatabase();

// Create Cloudflare API client
const cfApi = axios.create({
    baseURL: cloudflareApiBase,
    headers: {
        'Authorization': `Bearer ${CLOUDFLARE_API_TOKEN}`,
        'Content-Type': 'application/json',
    },
});

// Input validation functions
const validateZoneName = (zoneName) => {
    if (!zoneName || typeof zoneName !== 'string') {
        return { valid: false, error: 'Zone name is required and must be a string' };
    }
    
    // Basic domain name validation
    if (!validator.isFQDN(zoneName, { require_tld: true, allow_underscores: false })) {
        return { valid: false, error: 'Invalid zone name format' };
    }
    
    if (zoneName.length > 253) {
        return { valid: false, error: 'Zone name too long' };
    }
    
    return { valid: true };
};

const validateTaskDescription = (description) => {
    if (!description || typeof description !== 'string') {
        return { valid: false, error: 'Task description is required and must be a string' };
    }
    
    if (description.length > 1000) {
        return { valid: false, error: 'Task description must be less than 1000 characters' };
    }
    
    // Basic XSS prevention - strip HTML tags
    const sanitized = validator.escape(description.trim());
    return { valid: true, sanitized };
};

const validateMetadata = (tag, notes) => {
    const errors = [];
    let sanitizedTag = '';
    let sanitizedNotes = '';
    
    if (tag !== undefined) {
        if (typeof tag !== 'string') {
            errors.push('Tag must be a string');
        } else if (tag.length > 100) {
            errors.push('Tag must be less than 100 characters');
        } else {
            sanitizedTag = validator.escape(tag.trim());
        }
    }
    
    if (notes !== undefined) {
        if (typeof notes !== 'string') {
            errors.push('Notes must be a string');
        } else if (notes.length > 5000) {
            errors.push('Notes must be less than 5000 characters');
        } else {
            sanitizedNotes = validator.escape(notes.trim());
        }
    }
    
    return {
        valid: errors.length === 0,
        errors,
        sanitized: { tag: sanitizedTag, notes: sanitizedNotes }
    };
};

// Authentication middleware
const verifyFirebaseToken = async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ 
                success: false, 
                error: 'Unauthorized: No valid authentication token provided' 
            });
        }

        const token = authHeader.substring(7); // Remove 'Bearer ' prefix
        const decodedToken = await admin.auth().verifyIdToken(token);
        
        // Add user info to request
        req.user = {
            uid: decodedToken.uid,
            email: decodedToken.email,
            emailVerified: decodedToken.email_verified
        };
        
        next();
    } catch (error) {
        console.error('Authentication error:', error.message);
        return res.status(401).json({ 
            success: false, 
            error: 'Unauthorized: Invalid authentication token' 
        });
    }
};

// Rate limiting
const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // Limit each IP to 100 requests per windowMs
    message: {
        success: false,
        error: 'Too many requests from this IP, please try again after 15 minutes.'
    },
    standardHeaders: true,
    legacyHeaders: false,
});

// Express app setup
const app = express();

// Security headers
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            imgSrc: ["'self'", "data:", "https:"],
        },
    },
}));

// Rate limiting
app.use('/api/', apiLimiter);

// CORS configuration - restrict to specific origins
app.use(cors({
    origin: [
        'https://cloudflare.w-b.dev',
        'http://localhost:3000',
        'http://localhost:5402'
    ],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

// Body parsing with size limits
app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '10mb' }));

// Static file serving with authentication for screenshots
app.use('/screenshots', verifyFirebaseToken, express.static(SCREENSHOTS_DIR));

// Health Check Endpoint (no authentication required)
app.get('/api/health', async (req, res) => {
    try {
        const client = await pool.connect();
        await client.query('SELECT 1'); // Simple query to check connection
        client.release();
        res.status(200).json({ status: 'ok', db: 'connected' });
    } catch (error) {
        console.error('Health check failed:', error);
        res.status(503).json({ status: 'error', db: 'disconnected', error: error.message });
    }
});

// Check if cached data is fresh (using PostgreSQL TIMESTAMPTZ)
function isCacheFresh(timestamp) {
    if (!timestamp) return false;
    const now = new Date();
    const cacheDate = new Date(timestamp); // PG returns Date objects
    const expirationTime = CACHE_EXPIRATION_HOURS * 60 * 60 * 1000;
    return (now.getTime() - cacheDate.getTime()) < expirationTime;
}

// Function to get all zones (domains) with caching
async function getZones() {
    try {
        console.log('Checking cache for zones...');

        // Check if we have fresh cached data (querying based on timestamp)
        const cacheCutoff = new Date(Date.now() - (CACHE_EXPIRATION_HOURS * 60 * 60 * 1000));
        const cachedResult = await pool.query('SELECT data, timestamp FROM zones WHERE timestamp > $1', [cacheCutoff]);

        if (cachedResult.rows.length > 0 && isCacheFresh(cachedResult.rows[0].timestamp)) { // Check timestamp of first row as indicator
             console.log(`Found ${cachedResult.rows.length} zones in cache.`);
             return cachedResult.rows.map(row => row.data); // Return the JSONB data directly
        }

        console.log('Cache miss or expired. Fetching zones from Cloudflare...');

        if (!CLOUDFLARE_API_TOKEN) {
            throw new Error('CLOUDFLARE_API_TOKEN is not set');
        }

        const response = await cfApi.get('/zones', { params: { per_page: 50 } });

        if (response.data.success) {
            const zones = response.data.result;
            console.log(`Found ${zones.length} zones total.`);

            const client = await pool.connect();
            try {
                await client.query('BEGIN'); // Start transaction
                // Clear existing zones data (optional, depends on desired cache strategy)
                // await client.query('DELETE FROM zones');

                const insertZoneQuery = `
                    INSERT INTO zones (id, name, data, timestamp)
                    VALUES ($1, $2, $3, $4)
                    ON CONFLICT (id) DO UPDATE SET
                        name = EXCLUDED.name,
                        data = EXCLUDED.data,
                        timestamp = EXCLUDED.timestamp
                `;
                const now = new Date(); // Use JS Date object for TIMESTAMPTZ

                for (const zone of zones) {
                    await client.query(insertZoneQuery, [zone.id, zone.name, zone, now]); // Store entire zone object in JSONB
                }
                await client.query('COMMIT'); // Commit transaction
            } catch (error) {
                await client.query('ROLLBACK'); // Rollback on error
                console.error('Error caching zones in DB:', error);
                throw error; // Re-throw DB error
            } finally {
                client.release();
            }

            return zones;
        } else {
            console.error('Error fetching zones from Cloudflare API:', response.data.errors);
            return []; // Return empty on API error
        }
    } catch (error) {
        console.error('Error in getZones:', error.response ? error.response.data : error.message);
        // Attempt to return potentially stale cache if API fails? Or throw?
        // For now, just throw
        throw error;
    }
}

// Function to get DNS records for a zone with caching
async function getDnsRecords(zoneId, zoneName) {
    const recordTypes = ['A', 'CNAME']; // Only cache these types for now
    let allFoundRecords = [];
    const cacheCutoff = new Date(Date.now() - (CACHE_EXPIRATION_HOURS * 60 * 60 * 1000));

    console.log(`
--- Fetching records for zone: ${zoneName} (${zoneId}) ---`);

    for (const type of recordTypes) {
        try {
            console.log(`   Checking cache for ${type} records...`);

            const cachedResult = await pool.query(
                'SELECT data, timestamp FROM dns_records WHERE zone_id = $1 AND type = $2 AND timestamp > $3',
                [zoneId, type, cacheCutoff]
            );

            let records;

            if (cachedResult.rows.length > 0 && isCacheFresh(cachedResult.rows[0].timestamp)) {
                console.log(`   Found ${type} records in cache.`);
                records = cachedResult.rows[0].data; // Get JSONB data
            } else {
                console.log(`   Cache miss or expired. Fetching ${type} records from Cloudflare...`);
                const response = await cfApi.get(`/zones/${zoneId}/dns_records`, {
                    params: { type: type, per_page: 100 },
                });

                if (response.data.success) {
                    records = response.data.result;
                    console.log(`   Found ${records.length} ${type} records from API.`);

                    // Cache the records
                    const insertRecordQuery = `
                        INSERT INTO dns_records (zone_id, type, data, timestamp)
                        VALUES ($1, $2, $3, $4)
                        ON CONFLICT (zone_id, type) DO UPDATE SET
                            data = EXCLUDED.data,
                            timestamp = EXCLUDED.timestamp
                    `;
                    await pool.query(insertRecordQuery, [zoneId, type, JSON.stringify(records), new Date()]); // Store records array as JSON string in JSONB
                } else {
                    console.error(`   Error fetching ${type} records for ${zoneName} from API:`, response.data.errors);
                    records = []; // Default to empty on error
                }
            }

            // Format records for output
            records.forEach(record => {
                allFoundRecords.push({
                    zoneName: zoneName,
                    type: record.type,
                    name: record.name,
                    content: record.content,
                    proxied: record.proxied,
                });
            });
        } catch (error) {
            console.error(`   Error processing ${type} records in zone ${zoneName}:`, error.response ? error.response.data : error.message);
            // Continue to next type on error
        }
    }
    return allFoundRecords;
}

// Function to get metadata for a zone
async function getZoneMetadata(zoneId) {
    try {
        const result = await pool.query('SELECT notes, screenshot_path, tag FROM zone_metadata WHERE zone_id = $1', [zoneId]);
        if (result.rows.length > 0) {
            return result.rows[0];
        } else {
            // Create default metadata if it doesn't exist
            await pool.query(
                'INSERT INTO zone_metadata (zone_id, notes, screenshot_path, tag) VALUES ($1, $2, $3, $4) ON CONFLICT (zone_id) DO NOTHING',
                [zoneId, '', '', '']
            );
            return { zone_id: zoneId, notes: '', screenshot_path: '', tag: '' };
        }
    } catch (error) {
        console.error(`Error getting metadata for zone ${zoneId}:`, error);
        // Return default or throw? Returning default for now.
        return { zone_id: zoneId, notes: '', screenshot_path: '', tag: '' };
    }
}

// Function to get tasks for a zone
async function getZoneTasks(zoneId) {
    try {
        const result = await pool.query('SELECT id, task_description, is_completed, created_at, completed_at FROM zone_tasks WHERE zone_id = $1 ORDER BY created_at DESC', [zoneId]);
        return result.rows;
    } catch (error) {
        console.error(`Error getting tasks for zone ${zoneId}:`, error);
        return []; // Return empty array on error
    }
}

// Function to get all zone data including metadata and tasks
async function getEnrichedZoneData() {
    const zones = await getZones(); // This now returns the data part directly
    const enrichedData = {};

    for (const zone of zones) {
        try {
            // Zone data is already fetched
            const zoneId = zone.id;
            const zoneName = zone.name;

            // Get other data concurrently
            const [records, metadata, tasks] = await Promise.all([
                getDnsRecords(zoneId, zoneName),
                getZoneMetadata(zoneId),
                getZoneTasks(zoneId)
            ]);

            enrichedData[zoneName] = {
                zone: zone, // Keep the full zone object
                records: records,
                metadata: metadata,
                tasks: tasks
            };
        } catch (error) {
            console.error(`Error enriching data for zone ${zone.name}:`, error);
            // Optionally skip this zone or add error information
        }
    }

    return enrichedData;
}

// Function to take screenshots of domains (Puppeteer logic unchanged)
async function takeScreenshot(zoneName) {
    console.log(`Taking screenshot of ${zoneName}...`);
    const screenshotPath = path.join(SCREENSHOTS_DIR, `${zoneName}.png`);

    // Launch browser
    const browser = await puppeteer.launch({
        executablePath: '/usr/bin/chromium', // Explicitly use system Chromium
        headless: "new",
        defaultViewport: { width: 1280, height: 800 },
         // Add args for running in Docker container without sandbox
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage' // Add this flag
        ]
    });

    try {
        const page = await browser.newPage();
        await page.setDefaultNavigationTimeout(30000);
        await page.goto(`http://${zoneName}`, { waitUntil: 'networkidle2' });
        await page.screenshot({ path: screenshotPath, fullPage: false });
        await page.close();

        console.log(`Screenshot saved to ${screenshotPath}`);

        // Update the database with the screenshot path
        await updateZoneScreenshot(zoneName, screenshotPath); // Make sure this is async

        const filename = path.basename(screenshotPath);
        return {
            success: true,
            path: `/screenshots/${filename}`, // Client-side path
            message: 'Screenshot taken successfully'
        };
    } catch (error) {
        console.error(`Error taking screenshot of ${zoneName}:`, error.message);
        return {
            success: false,
            error: error.message
        };
    } finally {
        if (browser) {
            await browser.close();
        }
    }
}

// Function to update the zone's screenshot path in the database
async function updateZoneScreenshot(zoneName, screenshotPath) {
    try {
        // Find the zone ID from the name
        const zoneResult = await pool.query('SELECT id FROM zones WHERE name = $1', [zoneName]);

        if (zoneResult.rows.length === 0) {
            console.error(`Zone not found for name: ${zoneName}`);
            return false;
        }
        const zoneId = zoneResult.rows[0].id;

        // Store the relative path (filename)
        const relativePath = path.basename(screenshotPath);

        // Use INSERT ... ON CONFLICT DO UPDATE (UPSERT)
        const upsertQuery = `
            INSERT INTO zone_metadata (zone_id, screenshot_path, notes, tag)
            VALUES ($1, $2, '', '')
            ON CONFLICT (zone_id) DO UPDATE SET
                screenshot_path = EXCLUDED.screenshot_path
        `;
        await pool.query(upsertQuery, [zoneId, relativePath]);

        console.log(`Updated screenshot path for zone ${zoneName} (${zoneId})`);
        return true;
    } catch (error) {
        console.error(`Error updating screenshot path for zone ${zoneName}:`, error);
        return false;
    }
}

// --- API Routes ---
// (Refactored to use async/await and pool.query)

// GET /api/zones (protected)
app.get('/api/zones', verifyFirebaseToken, async (req, res) => {
    try {
        const zones = await getZones(); // Fetches from cache or API
        res.json({ success: true, data: zones });
    } catch (error) {
        console.error('GET /api/zones Error:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch zones' });
    }
});

// GET /api/zones/:zoneName/records (protected)
app.get('/api/zones/:zoneName/records', verifyFirebaseToken, async (req, res) => {
    const { zoneName } = req.params;
    try {
        const zoneResult = await pool.query('SELECT id FROM zones WHERE name = $1', [zoneName]);
        if (zoneResult.rows.length === 0) {
            return res.status(404).json({ success: false, error: `Zone not found: ${zoneName}` });
        }
        const zoneId = zoneResult.rows[0].id;
        const records = await getDnsRecords(zoneId, zoneName);
        res.json({ success: true, data: records });
    } catch (error) {
        console.error(`GET /api/zones/${zoneName}/records Error:`, error);
        res.status(500).json({ success: false, error: 'Failed to fetch DNS records' });
    }
});

// GET /api/zones/:zoneName/metadata (protected)
app.get('/api/zones/:zoneName/metadata', verifyFirebaseToken, async (req, res) => {
    const { zoneName } = req.params;
    try {
        const zoneResult = await pool.query('SELECT id FROM zones WHERE name = $1', [zoneName]);
        if (zoneResult.rows.length === 0) {
            return res.status(404).json({ success: false, error: `Zone not found: ${zoneName}` });
        }
        const zoneId = zoneResult.rows[0].id;
        const metadata = await getZoneMetadata(zoneId);
        res.json({ success: true, data: metadata });
    } catch (error) {
        console.error(`GET /api/zones/${zoneName}/metadata Error:`, error);
        res.status(500).json({ success: false, error: 'Failed to fetch metadata' });
    }
});

// POST /api/zones/:zoneName/metadata (protected)
app.post('/api/zones/:zoneName/metadata', verifyFirebaseToken, async (req, res) => {
    const { zoneName } = req.params;
    const { tag, notes } = req.body;
    
    // Validate zone name
    const zoneValidation = validateZoneName(zoneName);
    if (!zoneValidation.valid) {
        return res.status(400).json({ success: false, error: zoneValidation.error });
    }
    
    // Validate and sanitize metadata
    const metadataValidation = validateMetadata(tag, notes);
    if (!metadataValidation.valid) {
        return res.status(400).json({ success: false, error: metadataValidation.errors.join(', ') });
    }
    
    const { tag: sanitizedTag, notes: sanitizedNotes } = metadataValidation.sanitized;
    
    try {
        const zoneResult = await pool.query('SELECT id FROM zones WHERE name = $1', [zoneName]);
        if (zoneResult.rows.length === 0) {
            return res.status(404).json({ success: false, error: `Zone not found: ${zoneName}` });
        }
        const zoneId = zoneResult.rows[0].id;

        // UPSERT metadata
        const upsertQuery = `
            INSERT INTO zone_metadata (zone_id, tag, notes, screenshot_path)
            VALUES ($1, $2, $3, '')
            ON CONFLICT (zone_id) DO UPDATE SET
                tag = EXCLUDED.tag,
                notes = EXCLUDED.notes
        `;
        await pool.query(upsertQuery, [zoneId, sanitizedTag || '', sanitizedNotes || '']);

        res.json({ success: true, message: 'Metadata updated successfully' });
    } catch (error) {
        console.error(`POST /api/zones/${zoneName}/metadata Error:`, error);
        res.status(500).json({ success: false, error: 'Failed to update metadata' });
    }
});

// GET /api/zones/:zoneName/tasks (protected)
app.get('/api/zones/:zoneName/tasks', verifyFirebaseToken, async (req, res) => {
    const { zoneName } = req.params;
    try {
        const zoneResult = await pool.query('SELECT id FROM zones WHERE name = $1', [zoneName]);
        if (zoneResult.rows.length === 0) {
            return res.status(404).json({ success: false, error: `Zone not found: ${zoneName}` });
        }
        const zoneId = zoneResult.rows[0].id;
        const tasks = await getZoneTasks(zoneId);
        res.json({ success: true, data: tasks });
    } catch (error) {
        console.error(`GET /api/zones/${zoneName}/tasks Error:`, error);
        res.status(500).json({ success: false, error: 'Failed to fetch tasks' });
    }
});

// POST /api/zones/:zoneName/tasks (protected)
app.post('/api/zones/:zoneName/tasks', verifyFirebaseToken, async (req, res) => {
    const { zoneName } = req.params;
    const { task_description } = req.body;
    
    // Validate zone name
    const zoneValidation = validateZoneName(zoneName);
    if (!zoneValidation.valid) {
        return res.status(400).json({ success: false, error: zoneValidation.error });
    }
    
    // Validate and sanitize task description
    const taskValidation = validateTaskDescription(task_description);
    if (!taskValidation.valid) {
        return res.status(400).json({ success: false, error: taskValidation.error });
    }
    
    const sanitizedDescription = taskValidation.sanitized;
    
    try {
        const zoneResult = await pool.query('SELECT id FROM zones WHERE name = $1', [zoneName]);
        if (zoneResult.rows.length === 0) {
            return res.status(404).json({ success: false, error: `Zone not found: ${zoneName}` });
        }
        const zoneId = zoneResult.rows[0].id;

        const insertQuery = `
            INSERT INTO zone_tasks (zone_id, task_description, is_completed, created_at)
            VALUES ($1, $2, $3, $4)
            RETURNING id, created_at
        `;
        // Use current time for created_at
        const result = await pool.query(insertQuery, [zoneId, sanitizedDescription, false, new Date()]);

        res.status(201).json({
            success: true,
            message: 'Task created successfully',
            data: {
                id: result.rows[0].id,
                zone_id: zoneId,
                task_description: sanitizedDescription,
                is_completed: false,
                created_at: result.rows[0].created_at // Return timestamp from DB
            }
        });
    } catch (error) {
        console.error(`POST /api/zones/${zoneName}/tasks Error:`, error);
        res.status(500).json({ success: false, error: 'Failed to create task' });
    }
});

// PUT /api/zones/:zoneName/tasks/:taskId (protected)
app.put('/api/zones/:zoneName/tasks/:taskId', verifyFirebaseToken, async (req, res) => {
    const { zoneName, taskId } = req.params;
    const { is_completed } = req.body; // Expect boolean
    if (is_completed === undefined) {
        return res.status(400).json({ success: false, error: 'is_completed field (boolean) is required' });
    }
    try {
        const zoneResult = await pool.query('SELECT id FROM zones WHERE name = $1', [zoneName]);
        if (zoneResult.rows.length === 0) {
            return res.status(404).json({ success: false, error: `Zone not found: ${zoneName}` });
        }
        const zoneId = zoneResult.rows[0].id;

        // Check if task exists for this zone
        const taskCheck = await pool.query('SELECT id FROM zone_tasks WHERE id = $1 AND zone_id = $2', [taskId, zoneId]);
        if (taskCheck.rows.length === 0) {
             return res.status(404).json({ success: false, error: `Task not found: ${taskId} for zone ${zoneName}` });
        }

        const completed_at = is_completed ? new Date() : null;
        const updateQuery = `
            UPDATE zone_tasks
            SET is_completed = $1, completed_at = $2
            WHERE id = $3
        `;
        await pool.query(updateQuery, [is_completed, completed_at, taskId]);

        res.json({ success: true, message: 'Task updated successfully' });
    } catch (error) {
        console.error(`PUT /api/zones/${zoneName}/tasks/${taskId} Error:`, error);
        res.status(500).json({ success: false, error: 'Failed to update task' });
    }
});

// DELETE /api/zones/:zoneName/tasks/:taskId (protected)
app.delete('/api/zones/:zoneName/tasks/:taskId', verifyFirebaseToken, async (req, res) => {
    const { zoneName, taskId } = req.params;
    try {
        const zoneResult = await pool.query('SELECT id FROM zones WHERE name = $1', [zoneName]);
        if (zoneResult.rows.length === 0) {
            return res.status(404).json({ success: false, error: `Zone not found: ${zoneName}` });
        }
        const zoneId = zoneResult.rows[0].id;

        // Delete the task and check if a row was affected
        const deleteResult = await pool.query('DELETE FROM zone_tasks WHERE id = $1 AND zone_id = $2', [taskId, zoneId]);

        if (deleteResult.rowCount === 0) {
             return res.status(404).json({ success: false, error: `Task not found: ${taskId} for zone ${zoneName}` });
        }

        res.json({ success: true, message: 'Task deleted successfully' });
    } catch (error) {
        console.error(`DELETE /api/zones/${zoneName}/tasks/${taskId} Error:`, error);
        res.status(500).json({ success: false, error: 'Failed to delete task' });
    }
});

// POST /api/zones/:zoneName/screenshot (protected)
app.post('/api/zones/:zoneName/screenshot', verifyFirebaseToken, async (req, res) => {
    const { zoneName } = req.params;
    try {
        // Check if zone exists before attempting screenshot
        const zoneResult = await pool.query('SELECT id FROM zones WHERE name = $1', [zoneName]);
        if (zoneResult.rows.length === 0) {
            return res.status(404).json({ success: false, error: `Zone not found: ${zoneName}` });
        }

        const result = await takeScreenshot(zoneName); // takeScreenshot now updates DB
        res.json(result); // Send back success/failure from takeScreenshot
    } catch (error) {
        console.error(`POST /api/zones/${zoneName}/screenshot Error:`, error);
        res.status(500).json({ success: false, error: 'Failed to take screenshot' });
    }
});

// GET /api/all (protected)
app.get('/api/all', verifyFirebaseToken, async (req, res) => {
    try {
        const zoneData = await getEnrichedZoneData();
        res.json({ success: true, data: zoneData });
    } catch (error) {
        console.error('GET /api/all Error:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch all data' });
    }
});

// Graceful shutdown
async function gracefulShutdown() {
  console.log('Received shutdown signal. Closing PostgreSQL pool...');
  try {
    await pool.end();
    console.log('PostgreSQL pool closed.');
    process.exit(0);
  } catch (error) {
    console.error('Error closing PostgreSQL pool:', error);
    process.exit(1);
  }
}

process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

// Start the server
app.listen(PORT, () => {
    console.log(`API server running at http://localhost:${PORT}`);
});

// Catch unhandled errors
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  // Application specific logging, throwing an error, or other logic here
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  // Application specific logging, throwing an error, or other logic here
  // Consider shutting down gracefully
  gracefulShutdown();
}); 