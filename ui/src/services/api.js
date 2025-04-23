import axios from 'axios';

const BASE_URL = '/api';

// Get all zones (domains)
export const getZones = async () => {
  try {
    const response = await axios.get(`${BASE_URL}/zones`);
    return response.data;
  } catch (error) {
    console.error('Error fetching zones:', error);
    throw error;
  }
};

// Get DNS records for a specific zone
export const getDnsRecords = async (zoneName) => {
  try {
    const response = await axios.get(`${BASE_URL}/zones/${zoneName}/records`);
    return response.data;
  } catch (error) {
    console.error(`Error fetching DNS records for ${zoneName}:`, error);
    throw error;
  }
};

// Get metadata for a specific zone
export const getZoneMetadata = async (zoneName) => {
  try {
    const response = await axios.get(`${BASE_URL}/zones/${zoneName}/metadata`);
    return response.data;
  } catch (error) {
    console.error(`Error fetching metadata for ${zoneName}:`, error);
    throw error;
  }
};

// Update metadata for a specific zone
export const updateZoneMetadata = async (zoneName, metadata) => {
  try {
    const response = await axios.post(`${BASE_URL}/zones/${zoneName}/metadata`, metadata);
    return response.data;
  } catch (error) {
    console.error(`Error updating metadata for ${zoneName}:`, error);
    throw error;
  }
};

// Get tasks for a specific zone
export const getZoneTasks = async (zoneName) => {
  try {
    const response = await axios.get(`${BASE_URL}/zones/${zoneName}/tasks`);
    return response.data;
  } catch (error) {
    console.error(`Error fetching tasks for ${zoneName}:`, error);
    throw error;
  }
};

// Create a new task for a specific zone
export const createTask = async (zoneName, task) => {
  try {
    const response = await axios.post(`${BASE_URL}/zones/${zoneName}/tasks`, task);
    return response.data;
  } catch (error) {
    console.error(`Error creating task for ${zoneName}:`, error);
    throw error;
  }
};

// Update a task for a specific zone
export const updateTask = async (zoneName, taskId, updates) => {
  try {
    const response = await axios.put(`${BASE_URL}/zones/${zoneName}/tasks/${taskId}`, updates);
    return response.data;
  } catch (error) {
    console.error(`Error updating task ${taskId}:`, error);
    throw error;
  }
};

// Delete a task for a specific zone
export const deleteTask = async (zoneName, taskId) => {
  try {
    const response = await axios.delete(`${BASE_URL}/zones/${zoneName}/tasks/${taskId}`);
    return response.data;
  } catch (error) {
    console.error(`Error deleting task ${taskId}:`, error);
    throw error;
  }
};

// Take a screenshot of a domain
export const takeScreenshot = async (zoneName) => {
  try {
    const response = await axios.post(`${BASE_URL}/zones/${zoneName}/screenshot`);
    return response.data;
  } catch (error) {
    console.error(`Error taking screenshot of ${zoneName}:`, error);
    throw error;
  }
};

// Get all data in one call
export const getAllData = async () => {
  try {
    const response = await axios.get(`${BASE_URL}/all`);
    return response.data;
  } catch (error) {
    console.error('Error fetching all data:', error);
    throw error;
  }
}; 