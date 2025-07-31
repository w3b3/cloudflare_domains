import axios from 'axios';
import { auth } from '../firebase';

const BASE_URL = '/api';

// Create axios instance with interceptors
const apiClient = axios.create({
  baseURL: BASE_URL,
  timeout: 30000, // 30 second timeout
});

// Request interceptor to add Firebase auth token
apiClient.interceptors.request.use(
  async (config) => {
    try {
      // Get current user and auth token
      const user = auth.currentUser;
      if (user) {
        const token = await user.getIdToken();
        config.headers.Authorization = `Bearer ${token}`;
      }
    } catch (error) {
      console.error('Error getting auth token:', error);
      // Don't block the request if token retrieval fails
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Response interceptor to handle auth errors
apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      console.error('Authentication failed. User may need to sign in again.');
      // Optionally trigger a re-authentication flow here
    }
    return Promise.reject(error);
  }
);

// Get all zones (domains)
export const getZones = async () => {
  try {
    const response = await apiClient.get('/zones');
    return response.data;
  } catch (error) {
    console.error('Error fetching zones:', error);
    throw error;
  }
};

// Get DNS records for a specific zone
export const getDnsRecords = async (zoneName) => {
  try {
    const response = await apiClient.get(`/zones/${zoneName}/records`);
    return response.data;
  } catch (error) {
    console.error(`Error fetching DNS records for ${zoneName}:`, error);
    throw error;
  }
};

// Get metadata for a specific zone
export const getZoneMetadata = async (zoneName) => {
  try {
    const response = await apiClient.get(`/zones/${zoneName}/metadata`);
    return response.data;
  } catch (error) {
    console.error(`Error fetching metadata for ${zoneName}:`, error);
    throw error;
  }
};

// Update metadata for a specific zone
export const updateZoneMetadata = async (zoneName, metadata) => {
  try {
    const response = await apiClient.post(`/zones/${zoneName}/metadata`, metadata);
    return response.data;
  } catch (error) {
    console.error(`Error updating metadata for ${zoneName}:`, error);
    throw error;
  }
};

// Get tasks for a specific zone
export const getZoneTasks = async (zoneName) => {
  try {
    const response = await apiClient.get(`/zones/${zoneName}/tasks`);
    return response.data;
  } catch (error) {
    console.error(`Error fetching tasks for ${zoneName}:`, error);
    throw error;
  }
};

// Create a new task for a specific zone
export const createTask = async (zoneName, task) => {
  try {
    const response = await apiClient.post(`/zones/${zoneName}/tasks`, task);
    return response.data;
  } catch (error) {
    console.error(`Error creating task for ${zoneName}:`, error);
    throw error;
  }
};

// Update a task for a specific zone
export const updateTask = async (zoneName, taskId, updates) => {
  try {
    const response = await apiClient.put(`/zones/${zoneName}/tasks/${taskId}`, updates);
    return response.data;
  } catch (error) {
    console.error(`Error updating task ${taskId}:`, error);
    throw error;
  }
};

// Delete a task for a specific zone
export const deleteTask = async (zoneName, taskId) => {
  try {
    const response = await apiClient.delete(`/zones/${zoneName}/tasks/${taskId}`);
    return response.data;
  } catch (error) {
    console.error(`Error deleting task ${taskId}:`, error);
    throw error;
  }
};

// Take a screenshot of a domain
export const takeScreenshot = async (zoneName) => {
  try {
    const response = await apiClient.post(`/zones/${zoneName}/screenshot`);
    return response.data;
  } catch (error) {
    console.error(`Error taking screenshot of ${zoneName}:`, error);
    throw error;
  }
};

// Get all data in one call
export const getAllData = async () => {
  try {
    const response = await apiClient.get('/all');
    return response.data;
  } catch (error) {
    console.error('Error fetching all data:', error);
    throw error;
  }
}; 