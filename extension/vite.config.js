import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { crx } from '@crxjs/vite-plugin'

const manifest = {
  manifest_version: 3,
  name: "AutoReach - Cold Email Outreach",
  version: "1.0.0",
  description: "Automate personalized cold emails to recruiters with smart follow-ups and tracking.",
  action: { default_title: "Open AutoReach" },
  background: {
    service_worker: "src/background.js",
    type: "module"
  },
  side_panel: { default_path: "index.html" },
  permissions: [
    "sidePanel",
    "storage",
    "identity",
    "activeTab",
    "scripting",
  ],
  host_permissions: [
    "https://autoreach-pjez.onrender.com/*",
    "https://*.supabase.co/*",
    "https://accounts.google.com/*",
    "https://www.googleapis.com/*",
  ],
  oauth2: {
    client_id: "865030703352-ie39225agct02nuf2nm8qehorq3sj28n.apps.googleusercontent.com",
    scopes: ["openid", "email", "profile"]
  },
  web_accessible_resources: [
    {
      resources: ["index.html", "assets/*"],
      matches: ["<all_urls>"]
    }
  ]
};

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  return {
    plugins: [
      react(),
      crx({ manifest }),
    ],
    // ✅ Keep 'define' to ensure env vars are inlined everywhere
    define: {
      'import.meta.env.VITE_SUPABASE_URL': JSON.stringify(env.VITE_SUPABASE_URL),
      'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify(env.VITE_SUPABASE_ANON_KEY),
    },
    server: {
      port: 5173,
      strictPort: true,
      hmr: {
        port: 5173,
      },
    },
    // ✅ REMOVED rollupOptions.input override to let CRXJS manage the entry points safely
  }
})