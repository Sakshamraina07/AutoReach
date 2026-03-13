import { createClient } from '@supabase/supabase-js';

// ✅ Vite replaces these at build time
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

if (!supabaseUrl || !supabaseKey) {
    console.error('[Supabase] ❌ Missing environment variables. Check your .env file.');
} else {
    console.log('[Supabase] ✅ Initialized. URL:', supabaseUrl);
    console.log('[Supabase] ✅ Key prefix:', supabaseKey?.substring(0, 20));
    console.log('[Supabase] ✅ Key length:', supabaseKey.length);
}

// ✅ Custom Chrome storage adapter
const chromeStorageAdapter = {
    getItem: (key) =>
        new Promise((resolve) => {
            if (!chrome?.storage?.local) return resolve(null);
            chrome.storage.local.get([key], (result) => {
                if (chrome.runtime.lastError) return resolve(null);
                resolve(result[key] ?? null);
            });
        }),

    setItem: (key, value) =>
        new Promise((resolve) => {
            if (!chrome?.storage?.local) return resolve();
            chrome.storage.local.set({ [key]: value }, resolve);
        }),

    removeItem: (key) =>
        new Promise((resolve) => {
            if (!chrome?.storage?.local) return resolve();
            chrome.storage.local.remove([key], resolve);
        }),
};

// ✅ Supabase client with explicit headers and MV3 settings
export const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: {
        flowType: 'implicit',
        detectSessionInUrl: false,
        persistSession: true,
        autoRefreshToken: true,
        storage: chromeStorageAdapter,
    },
    global: {
        headers: {
            'apikey': supabaseKey,
            'X-Client-Info': 'supabase-js-chrome-extension',
        }
    }
});

/**
 * ✅ Direct API Test (Debugging)
 * This bypasses the SDK to verify if the Key/URL work objectively.
 */
export async function testSupabaseConnection() {
    try {
        const response = await fetch(`${supabaseUrl}/auth/v1/settings`, {
            headers: { 'apikey': supabaseKey }
        });
        const data = await response.json();
        console.log('[Supabase] Direct API Test Status:', response.status);
        if (response.status !== 200) {
            console.error('[Supabase] Direct API Test Failed:', data);
        } else {
            console.log('[Supabase] Direct API Test Successful! ✅');
        }
    } catch (err) {
        console.error('[Supabase] Direct API Test Crash:', err);
    }
}

export async function getSession() {
    const { data, error } = await supabase.auth.getSession();
    if (error) return null;
    return data?.session ?? null;
}