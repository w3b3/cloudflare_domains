// get_cf_dns_records.js
import axios from 'axios';
import process from 'process';
import dotenv from 'dotenv';
import betterSqlite3 from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import puppeteer from 'puppeteer';
import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';

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
const SCREENSHOTS_DIR = path.join(process.cwd(), 'screenshots');
const API_PORT = 3333; // Port for the metadata API server
// --- End Configuration ---

// Ensure screenshots directory exists
if (!fs.existsSync(SCREENSHOTS_DIR)) {
    fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
    console.log(`Created screenshots directory: ${SCREENSHOTS_DIR}`);
}

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

// Helper function to truncate long content values
function truncateContent(content, maxLength = 10) {
    return content.length > maxLength ? content.substring(0, maxLength) + '...' : content;
}

// Generate HTML with string concatenation instead of template literals to avoid syntax issues
function generateHtmlReport(zoneDataMap) {
    const bootstrapCss = 'node_modules/bootstrap/dist/css/bootstrap.min.css';
    const bootstrapJs = 'node_modules/bootstrap/dist/js/bootstrap.bundle.min.js';
    
    // Read the Bootstrap CSS and JS files
    const cssContent = fs.readFileSync(bootstrapCss, 'utf8');
    const jsContent = fs.readFileSync(bootstrapJs, 'utf8');
    
    // Generate tabs for each zone
    let tabNav = '';
    let tabContent = '';
    
    // Sort zones alphabetically
    const sortedZones = Object.keys(zoneDataMap).sort();
    
    // Create the tabs with larger thumbnails and text overlay
    sortedZones.forEach((zoneName, index) => {
        const isActive = index === 0 ? 'active' : '';
        const zoneId = zoneName.replace(/\./g, '-');
        const zoneData = zoneDataMap[zoneName];
        const records = zoneData.records;
        const metadata = zoneData.metadata;
        const tasks = zoneData.tasks;
        const tag = metadata.tag || '';
        
        // Check if screenshot exists for tab thumbnail
        const tabScreenshotPath = path.join(SCREENSHOTS_DIR, `${zoneName}.png`);
        const tabHasScreenshot = fs.existsSync(tabScreenshotPath);
        const tabImgSrc = `screenshots/${zoneName}.png`;
        
        // Create a visually rich tab with thumbnail as background and text overlay
        let tabStyle = 'position: relative; overflow: hidden; padding: 30px 15px; text-align: center; height: 80px; width: 150px; border-radius: 5px 5px 0 0;';
        let tabInnerHtml = '';
        
        if (tabHasScreenshot) {
            // Tab with screenshot background
            tabStyle += ' background-size: cover; background-position: center; background-image: url(\'' + tabImgSrc + '\');';
            tabInnerHtml = 
                '<div style="position: absolute; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0, 0, 0, 0.5); z-index: 1;"></div>' +
                '<div style="position: relative; z-index: 2; color: white;">' +
                '<div style="font-size: 0.8em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">' + zoneName + '</div>';
            
            // Add tag if exists
            if (tag && tag.length > 0) {
                tabInnerHtml += '<span class="badge bg-info mt-1" style="font-size: 0.7em;">' + tag + '</span>';
            }
            
            tabInnerHtml += '</div>';
        } else {
            // Fallback for tabs without screenshots
            tabStyle += ' background-color: #f8f9fa;';
            tabInnerHtml = 
                '<div style="position: relative; z-index: 2;">' +
                '<div style="font-size: 0.8em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">' + zoneName + '</div>';
            
            // Add tag if exists
            if (tag && tag.length > 0) {
                tabInnerHtml += '<span class="badge bg-info mt-1" style="font-size: 0.7em;">' + tag + '</span>';
            }
            
            tabInnerHtml += '</div>';
        }
        
        tabNav += '<li class="nav-item" role="presentation">' +
            '<button class="nav-link ' + isActive + '" id="' + zoneId + '-tab" data-bs-toggle="tab" ' +
            'data-bs-target="#' + zoneId + '" type="button" role="tab" ' +
            'style="' + tabStyle + '" ' +
            'aria-controls="' + zoneId + '" aria-selected="' + (index === 0) + '">' +
            tabInnerHtml +
            '</button>' +
            '</li>';
        
        // Create table content for this zone
        let tableContent = '';
        
        // Get root domain record if it exists
        const rootRecord = records.find(r => r.name === zoneName);
        if (rootRecord) {
            // Create clickable root domain name
            const rootName = rootRecord.name.length > 10 ? rootRecord.name.substring(0, 10) + '...' : rootRecord.name;
            const rootLink = '<a href="http://' + rootRecord.name + '" target="_blank" class="text-decoration-none"><strong>' + rootName + '</strong></a>';
            
            // Truncate content if too long
            const truncatedContent = truncateContent(rootRecord.content);
            
            tableContent += '<tr class="table-primary">' +
                '<td>' + rootLink + '</td>' +
                '<td>' + rootRecord.type + '</td>' +
                '<td><small class="text-muted">' + truncatedContent + '</small></td>' +
                '<td>' + (rootRecord.proxied ? '<span class="badge bg-success">Yes</span>' : '<span class="badge bg-secondary">No</span>') + '</td>' +
                '</tr>';
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
            // Extract the subdomain part and make it clickable
            const subdomain = sub.name.replace('.' + zoneName, '');
            
            // Truncate subdomain if too long (over 20 characters)
            const displayName = subdomain.length > 10 ? subdomain.substring(0, 10) + '...' : subdomain;
            
            // Truncate content if too long
            const truncatedContent = truncateContent(sub.content);
            
            const subdomainLink = '<a href="http://' + sub.name + '" target="_blank" class="text-decoration-none">' + displayName + '</a>';
            
            tableContent += '<tr>' +
                '<td>' + subdomainLink + '</td>' +
                '<td>' + sub.type + '</td>' +
                '<td><small class="text-muted">' + truncatedContent + '</small></td>' +
                '<td>' + (sub.proxied ? '<span class="badge bg-success">Yes</span>' : '<span class="badge bg-secondary">No</span>') + '</td>' +
                '</tr>';
        });
        
        // Format tasks as a checklist
        let tasksHtml = '<div class="mt-3">';
        if (tasks && tasks.length > 0) {
            tasksHtml += '<ul class="list-group mb-3">';
            tasks.forEach(task => {
                tasksHtml += '<li class="list-group-item">' +
                    '<div class="form-check">' +
                    '<input class="form-check-input task-checkbox" type="checkbox" ' +
                    (task.is_completed ? 'checked ' : '') +
                    'data-task-id="' + task.id + '" ' +
                    'data-zone-id="' + zoneData.zone.id + '">' +
                    '<label class="form-check-label ' + (task.is_completed ? 'text-decoration-line-through' : '') + '">' +
                    task.task_description +
                    '</label>' +
                    '</div>' +
                    '</li>';
            });
            tasksHtml += '</ul>';
        } else {
            tasksHtml += '<p>No tasks for this domain yet.</p>';
        }
        tasksHtml += '<div class="input-group mb-3">' +
            '<input type="text" class="form-control new-task-input" placeholder="Add new task..." data-zone-id="' + zoneData.zone.id + '">' +
            '<button class="btn btn-outline-primary add-task-btn" type="button" data-zone-id="' + zoneData.zone.id + '">Add</button>' +
            '</div>' +
            '</div>';
        
        // Create screenshot section
        let screenshotHtml = '<div class="mt-3">' +
            '<h5>Screenshot</h5>' +
            '<div class="mb-3">';
        
        // Check for both the database path and the actual file
        const hasScreenshotInDb = metadata.screenshot_path && metadata.screenshot_path.length > 0;
        const expectedScreenshotPath = path.join(SCREENSHOTS_DIR, `${zoneName}.png`);
        const screenshotFileExists = fs.existsSync(expectedScreenshotPath);
        
        // Use relative path for HTML display
        const relativeScreenshotPath = `screenshots/${zoneName}.png`;
        
        if (hasScreenshotInDb || screenshotFileExists) {
            // We have a screenshot - show it
            screenshotHtml += '<img src="' + relativeScreenshotPath + '" alt="' + zoneName + ' screenshot" class="img-fluid rounded shadow-sm border">';
        } else {
            screenshotHtml += '<div class="text-center p-5 bg-light rounded">' +
                '<p class="text-muted">No screenshot available</p>' +
                '</div>';
        }
        
        screenshotHtml += '</div>' +
            '<div class="mb-3">' +
            '<label for="screenshot-' + zoneId + '" class="form-label">Upload Screenshot</label>' +
            '<input class="form-control" type="file" id="screenshot-' + zoneId + '" ' +
            'accept="image/*" data-zone-id="' + zoneData.zone.id + '">' +
            '</div>' +
            '</div>';
        
        // Create notes section with tag input
        let notesHtml = '<div class="mt-3">' +
            '<h5>Domain Information</h5>' +
            '<div class="mb-3">' +
            '<label for="tag-' + zoneId + '" class="form-label">Tag (Purpose of this domain)</label>' +
            '<input type="text" class="form-control zone-tag" id="tag-' + zoneId + '" ' +
            'placeholder="e.g., Blog, E-commerce, Client Project" ' +
            'value="' + (metadata.tag || '') + '" ' +
            'data-zone-id="' + zoneData.zone.id + '">' +
            '</div>' +
            '<div class="mb-3">' +
            '<label for="notes-' + zoneId + '" class="form-label">Notes</label>' +
            '<textarea class="form-control zone-notes" id="notes-' + zoneId + '" rows="3" ' +
            'data-zone-id="' + zoneData.zone.id + '">' + (metadata.notes || '') + '</textarea>' +
            '</div>' +
            '<button class="btn btn-primary save-metadata-btn" data-zone-id="' + zoneData.zone.id + '">Save Information</button>' +
            '</div>';
        
        // Create tab content
        tabContent += '<div class="tab-pane fade show ' + isActive + '" id="' + zoneId + '" role="tabpanel" aria-labelledby="' + zoneId + '-tab">' +
            '<div class="row mt-3">' +
            '<div class="col-md-8">' +
            '<div class="card">' +
            '<div class="card-header bg-light">' +
            '<h5>' + zoneName + ' <span class="badge bg-primary">' + records.length + ' records</span></h5>' +
            '</div>' +
            '<div class="card-body">' +
            '<table class="table table-striped table-hover">' +
            '<thead class="table-dark">' +
            '<tr>' +
            '<th style="width: 25%">Name</th>' +
            '<th style="width: 10%">Type</th>' +
            '<th style="width: 50%">Target</th>' +
            '<th style="width: 15%">Proxied</th>' +
            '</tr>' +
            '</thead>' +
            '<tbody>' +
            tableContent +
            '</tbody>' +
            '</table>' +
            '</div>' +
            '</div>' +
            '<div class="card mt-3">' +
            '<div class="card-header bg-light">' +
            '<h5>Tasks</h5>' +
            '</div>' +
            '<div class="card-body">' +
            tasksHtml +
            '</div>' +
            '</div>' +
            '</div>' +
            '<div class="col-md-4">' +
            '<div class="card">' +
            '<div class="card-header bg-light">' +
            '<h5>Domain Information</h5>' +
            '</div>' +
            '<div class="card-body">' +
            screenshotHtml +
            notesHtml +
            '</div>' +
            '</div>' +
            '</div>' +
            '</div>' +
            '</div>';
    });
    
    // Generate the complete HTML using string concatenation
    const html = '<!DOCTYPE html>' +
        '<html lang="en">' +
        '<head>' +
        '<meta charset="UTF-8">' +
        '<meta name="viewport" content="width=device-width, initial-scale=1.0">' +
        '<title>Cloudflare DNS Records Report</title>' +
        '<style>' +
        cssContent +
        '/* Custom styles */' +
        'body {' +
        'padding: 20px;' +
        'background-color: #f8f9fa;' +
        '}' +
        '.report-header {' +
        'margin-bottom: 30px;' +
        '}' +
        '.last-updated {' +
        'font-size: 0.9rem;' +
        'color: #6c757d;' +
        '}' +
        '.text-decoration-line-through {' +
        'text-decoration: line-through;' +
        '}' +
        '</style>' +
        '</head>' +
        '<body>' +
        '<div class="container">' +
        '<div class="report-header">' +
        '<h1 class="mb-3">Cloudflare DNS Records Report</h1>' +
        '<p class="last-updated">Last updated: ' + new Date().toLocaleString() + '</p>' +
        '</div>' +
        '<ul class="nav nav-tabs" id="zoneTabs" role="tablist">' +
        tabNav +
        '</ul>' +
        '<div class="tab-content" id="zoneTabsContent">' +
        tabContent +
        '</div>' +
        '</div>' +
        '<script>' +
        jsContent +
        // Client-side JavaScript for interactivity
        'document.addEventListener("DOMContentLoaded", function() {' +
        // Task checkboxes
        'document.querySelectorAll(".task-checkbox").forEach(checkbox => {' +
        'checkbox.addEventListener("change", function() {' +
        'const taskId = this.dataset.taskId;' +
        'const isCompleted = this.checked ? 1 : 0;' +
        'const label = this.nextElementSibling;' +
        'if (isCompleted) {' +
        'label.classList.add("text-decoration-line-through");' +
        '} else {' +
        'label.classList.remove("text-decoration-line-through");' +
        '}' +
        '// In a real app, you would send this to the server' +
        'console.log("Task", taskId, "updated to", isCompleted);' +
        '// Store in localStorage temporarily' +
        'localStorage.setItem("task_" + taskId, isCompleted);' +
        '});' +
        '});' +
        // Add task buttons
        'document.querySelectorAll(".add-task-btn").forEach(button => {' +
        'button.addEventListener("click", function() {' +
        'const zoneId = this.dataset.zoneId;' +
        'const inputField = document.querySelector(".new-task-input[data-zone-id=\'" + zoneId + "\']");' +
        'const taskDescription = inputField.value.trim();' +
        'if (taskDescription) {' +
        '// In a real app, you would send this to the server' +
        'console.log("New task for zone", zoneId, ":", taskDescription);' +
        '// For demo purposes, append to DOM' +
        'const tasksList = this.closest(".card-body").querySelector(".list-group");' +
        'if (!tasksList) {' +
        '// Create new list if it doesn\'t exist' +
        'const newList = document.createElement("ul");' +
        'newList.className = "list-group mb-3";' +
        'this.closest(".card-body").insertBefore(newList, this.closest(".input-group").parentNode);' +
        'newList.innerHTML = createTaskItem("temp_" + Date.now(), zoneId, taskDescription, false);' +
        '} else {' +
        '// Add to existing list' +
        'tasksList.insertAdjacentHTML("afterbegin", createTaskItem("temp_" + Date.now(), zoneId, taskDescription, false));' +
        '}' +
        '// Clear input' +
        'inputField.value = "";' +
        '}' +
        '});' +
        '});' +
        // Save metadata buttons with API call
        'document.querySelectorAll(".save-metadata-btn").forEach(button => {' +
        'button.addEventListener("click", function() {' +
        '  const zoneId = this.dataset.zoneId;' +
        '  const tagInput = document.querySelector(".zone-tag[data-zone-id=\'" + zoneId + "\']");' +
        '  const tag = tagInput.value;' +
        '  const notesTextarea = document.querySelector(".zone-notes[data-zone-id=\'" + zoneId + "\']");' +
        '  const notes = notesTextarea.value;' +
        '  const saveBtn = this;' +
        '  ' +
        '  // Disable button and show loading state' +
        '  saveBtn.disabled = true;' +
        '  saveBtn.innerHTML = \'<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> Saving...\';' +
        '  ' +
        '  // Call the API to update metadata' +
        '  fetch("/api/metadata/" + zoneId, {' +
        '    method: "POST",' +
        '    headers: {' +
        '      "Content-Type": "application/json"' +
        '    },' +
        '    body: JSON.stringify({ tag, notes })' +
        '  })' +
        '  .then(response => response.json())' +
        '  .then(data => {' +
        '    if (data.success) {' +
        '      // Update the tab UI with the new tag' +
        '      const tab = document.getElementById(zoneId + "-tab");' +
        '      const tagBadge = tab.querySelector(".badge");' +
        '      if (tag && tag.length > 0) {' +
        '        if (tagBadge) {' +
        '          // Update existing badge' +
        '          tagBadge.textContent = tag;' +
        '        } else {' +
        '          // Create new badge if doesn\'t exist' +
        '          const tagHtml = document.createElement("span");' +
        '          tagHtml.className = "badge bg-info mt-1";' +
        '          tagHtml.style.fontSize = "0.7em";' +
        '          tagHtml.textContent = tag;' +
        '          const textContainer = tab.querySelector("[style*=\'z-index: 2\']");' +
        '          if (textContainer) {' +
        '            textContainer.appendChild(tagHtml);' +
        '          }' +
        '        }' +
        '      } else if (tagBadge) {' +
        '        // Remove badge if tag is empty' +
        '        tagBadge.remove();' +
        '      }' +
        '      ' +
        '      // Show success message' +
        '      alert("Information saved successfully!");' +
        '    } else {' +
        '      alert("Error saving information: " + (data.error || "Unknown error"));' +
        '    }' +
        '  })' +
        '  .catch(error => {' +
        '    console.error("Error saving metadata:", error);' +
        '    alert("Error saving information. See console for details.");' +
        '  })' +
        '  .finally(() => {' +
        '    // Re-enable button and restore text' +
        '    saveBtn.disabled = false;' +
        '    saveBtn.textContent = "Save Information";' +
        '  });' +
        '});' +
        '});' +
        // Screenshot upload 
        'document.querySelectorAll("input[type=\'file\']").forEach(input => {' +
        'input.addEventListener("change", function() {' +
        'const zoneId = this.dataset.zoneId;' +
        'const file = this.files[0];' +
        'if (file) {' +
        'const reader = new FileReader();' +
        'reader.onload = function(e) {' +
        '// Update image preview' +
        'const imgPreview = input.closest(".mt-3").querySelector("img");' +
        'if (imgPreview) {' +
        'imgPreview.src = e.target.result;' +
        '} else {' +
        '// Replace the placeholder with an image' +
        'const placeholder = input.closest(".mt-3").querySelector(".bg-light");' +
        'if (placeholder) {' +
        'placeholder.outerHTML = \'<img src="\' + e.target.result + \'" alt="Screenshot" class="img-fluid rounded shadow-sm border">\';' +
        '}' +
        '}' +
        '// In a real app, you would upload this to the server' +
        'console.log("Screenshot uploaded for zone", zoneId);' +
        '// Store in localStorage temporarily (not recommended for images in practice)' +
        'try {' +
        'localStorage.setItem("screenshot_" + zoneId, e.target.result);' +
        '} catch (err) {' +
        'console.warn("Could not store screenshot in localStorage (likely too large)");' +
        '}' +
        '};' +
        'reader.readAsDataURL(file);' +
        '}' +
        '});' +
        '});' +
        // Helper function for creating task items
        'function createTaskItem(id, zoneId, description, completed) {' +
        'return \'<li class="list-group-item">\' +' +
        '\'<div class="form-check">\' +' +
        '\'<input class="form-check-input task-checkbox" type="checkbox" \' +' +
        '(completed ? \'checked \' : \'\') +' +
        '\'data-task-id="\' + id + \'" \' +' +
        '\'data-zone-id="\' + zoneId + \'">\' +' +
        '\'<label class="form-check-label \' + (completed ? \'text-decoration-line-through\' : \'\') + \'">\' +' +
        'description +' +
        '\'</label>\' +' +
        '\'</div>\' +' +
        '\'</li>\';' +
        '}' +
        '});' +
        '</script>' +
        '</body>' +
        '</html>';
    
    fs.writeFileSync(HTML_OUTPUT_PATH, html);
    console.log(`\nHTML report generated: ${HTML_OUTPUT_PATH}`);
}

// Function to take screenshots of domains
async function takeScreenshots(zones) {
    console.log('\nTaking screenshots of domains...');
    
    // Launch browser
    const browser = await puppeteer.launch({ 
        headless: "new", 
        defaultViewport: { width: 1280, height: 800 } 
    });
    
    try {
        for (const zone of zones) {
            const zoneName = zone.name;
            const screenshotPath = path.join(SCREENSHOTS_DIR, `${zoneName}.png`);
            
            // Skip if screenshot already exists and is less than 7 days old
            if (fs.existsSync(screenshotPath)) {
                const stats = fs.statSync(screenshotPath);
                const fileAgeDays = (Date.now() - stats.mtime.getTime()) / (1000 * 60 * 60 * 24);
                
                if (fileAgeDays < 7) {
                    console.log(`  Skipping ${zoneName} - screenshot is less than 7 days old`);
                    continue;
                }
            }
            
            try {
                console.log(`  Taking screenshot of ${zoneName}...`);
                const page = await browser.newPage();
                
                // Set timeout to 30 seconds
                await page.setDefaultNavigationTimeout(30000);
                
                // Navigate to the domain
                await page.goto(`http://${zoneName}`, { waitUntil: 'networkidle2' });
                
                // Take screenshot
                await page.screenshot({ path: screenshotPath, fullPage: false });
                
                console.log(`  Screenshot saved to ${screenshotPath}`);
                
                // Close the page
                await page.close();
                
                // Update the database with the screenshot path
                updateZoneScreenshot(zone.id, screenshotPath);
                
            } catch (error) {
                console.error(`  Error taking screenshot of ${zoneName}:`, error.message);
                // Continue with the next domain
            }
        }
    } finally {
        // Close the browser
        await browser.close();
    }
    
    console.log('Screenshot capture complete!');
}

// Function to update the zone's screenshot path in the database
function updateZoneScreenshot(zoneId, screenshotPath) {
    // Check if metadata exists for this zone
    const metadata = db.prepare('SELECT * FROM zone_metadata WHERE zone_id = ?').get(zoneId);
    
    if (metadata) {
        // Update existing metadata
        db.prepare('UPDATE zone_metadata SET screenshot_path = ? WHERE zone_id = ?')
          .run(screenshotPath, zoneId);
    } else {
        // Create new metadata record
        db.prepare('INSERT INTO zone_metadata (zone_id, notes, screenshot_path, tag) VALUES (?, ?, ?, ?)')
          .run(zoneId, '', screenshotPath, '');
    }
}

// Main function to orchestrate fetching and start the server
async function main() {
    console.log('Starting Cloudflare DNS record fetch...');
    
    // Get zones directly for screenshot capture
    const zones = await getZones();
    
    if (!zones || zones.length === 0) {
        console.log('No zones found or error fetching zones. Exiting.');
        return;
    }
    
    // Take screenshots of zones
    await takeScreenshots(zones);
    
    // Get all zone data with enrichments
    const zoneDataMap = await getEnrichedZoneData();
    
    if (!zoneDataMap || Object.keys(zoneDataMap).length === 0) {
        console.log('No zone data found or error fetching zone data. Exiting.');
        return;
    }

    // Check for metadata updates from previous sessions
    checkForMetadataUpdates();

    // Display the summary grouped by zone
    console.log('\n\n--- Summary (Grouped by Zone) ---');
    
    // Sort zones alphabetically
    const sortedZones = Object.keys(zoneDataMap).sort();
    
    for (const zoneName of sortedZones) {
        const zoneData = zoneDataMap[zoneName];
        const records = zoneData.records;
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
    generateHtmlReport(zoneDataMap);
    
    console.log('\nFetch complete.');
    console.log(`\nHTML report generated: ${HTML_OUTPUT_PATH}`);
    
    // Start the API server
    console.log('\nStarting API server for metadata management...');
    startApiServer();
    
    console.log('\nKeep this process running to use the API functionality.');
    console.log('Press Ctrl+C to stop the server when done.');
}

// Function to check for metadata update files
function checkForMetadataUpdates() {
    // Get a list of all metadata_*.json files in the directory
    const files = fs.readdirSync(process.cwd());
    const metadataFiles = files.filter(file => file.startsWith('metadata_') && file.endsWith('.json'));
    
    if (metadataFiles.length > 0) {
        console.log('\nFound metadata update files. Processing...');
        
        metadataFiles.forEach(file => {
            try {
                const data = JSON.parse(fs.readFileSync(path.join(process.cwd(), file), 'utf8'));
                const { zoneId, tag, notes } = data;
                
                if (zoneId) {
                    console.log(`  Updating metadata for zone ${zoneId}`);
                    
                    // Update the database
                    const updateStmt = db.prepare(
                        'UPDATE zone_metadata SET tag = ?, notes = ? WHERE zone_id = ?'
                    );
                    updateStmt.run(tag || '', notes || '', zoneId);
                    
                    // Delete the file after processing
                    fs.unlinkSync(path.join(process.cwd(), file));
                }
            } catch (error) {
                console.error(`  Error processing metadata file ${file}:`, error.message);
            }
        });
        
        console.log('Metadata updates completed.');
    }
}

// Add API server functionality
let apiServer;

// Function to start the API server for metadata updates
function startApiServer() {
    const app = express();
    
    // Enable CORS and JSON body parsing
    app.use(cors());
    app.use(bodyParser.json());
    
    // Serve the screenshots directory
    app.use('/screenshots', express.static(SCREENSHOTS_DIR));
    
    // API endpoint to get metadata for a zone
    app.get('/api/metadata/:zoneId', (req, res) => {
        try {
            const { zoneId } = req.params;
            const metadata = getZoneMetadata(zoneId);
            res.json({ success: true, data: metadata });
        } catch (error) {
            console.error('API error getting metadata:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    });
    
    // API endpoint to update metadata for a zone
    app.post('/api/metadata/:zoneId', (req, res) => {
        try {
            const { zoneId } = req.params;
            const { tag, notes } = req.body;
            
            // Update the database
            const updateStmt = db.prepare(
                'UPDATE zone_metadata SET tag = ?, notes = ? WHERE zone_id = ?'
            );
            updateStmt.run(tag || '', notes || '', zoneId);
            
            res.json({ success: true, message: 'Metadata updated successfully' });
        } catch (error) {
            console.error('API error updating metadata:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    });
    
    // Start the server
    apiServer = app.listen(API_PORT, () => {
        console.log(`\nMetadata API server running at http://localhost:${API_PORT}`);
        console.log(`Report URL: http://localhost:${API_PORT}/cloudflare_report.html`);
    });
    
    // Also serve the HTML report
    app.use(express.static(process.cwd()));
    
    return apiServer;
}

// Run the main function
main();