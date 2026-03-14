import axios from 'axios';

// ✅ Hardcoded to avoid crxjs env injection bug
const API_URL = 'https://autoreach-production.up.railway.app';

export const api = axios.create({
    baseURL: API_URL,
    headers: {
        'Content-Type': 'application/json'
    }
});

// ✅ Intercept every request and attach Supabase JWT from chrome.storage
api.interceptors.request.use((config) => {
    return new Promise((resolve, reject) => {
        if (!chrome?.storage?.local) {
            console.warn('[API] chrome.storage.local not available');
            return resolve(config);
        }

        chrome.storage.local.get(['sessionToken'], (result) => {
            if (chrome.runtime.lastError) {
                console.error('[API] storage get error:', chrome.runtime.lastError);
                return resolve(config); // proceed without token
            }

            if (result.sessionToken) {
                config.headers.Authorization = `Bearer ${result.sessionToken}`;
            } else {
                console.warn('[API] No sessionToken found in chrome.storage');
            }

            resolve(config);
        });
    });
}, (error) => {
    return Promise.reject(error);
});

// ✅ Intercept responses to catch 401s globally
api.interceptors.response.use(
    (response) => response,
    (error) => {
        if (error.response?.status === 401) {
            console.error('[API] 401 Unauthorized — token may be expired or invalid');
        }
        if (error.response?.status === 500) {
            console.error('[API] 500 Server Error:', error.response?.data);
        }
        return Promise.reject(error);
    }
);