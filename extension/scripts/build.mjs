/**
 * Builds the extension into dist/ with plain Vite builds (no extension plugin):
 *   1. popup.html + sidepanel.html (React)
 *   2. background.js — ES-module service worker, one file
 *   3. content-gmail.js — classic script (IIFE), one file, no imports
 *   4. manifest.json generated from the build settings
 *
 *   node scripts/build.mjs [--mode development]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { build, loadEnv } from 'vite';
import { buildManifest } from './manifest.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const modeIdx = process.argv.indexOf('--mode');
const mode = modeIdx > -1 ? process.argv[modeIdx + 1] : 'production';
const env = loadEnv(mode, root, 'VITE_');
const outDir = path.join(root, 'dist');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

if (!env.VITE_API_URL) {
  console.error('VITE_API_URL is not set. Copy extension/.env.example to extension/.env.local (or .env.production) and fill it in.');
  process.exit(1);
}
const manifest = buildManifest({ version: pkg.version, apiUrl: env.VITE_API_URL, supabaseUrl: env.VITE_SUPABASE_URL || undefined });

const shared = {
  root,
  mode,
  logLevel: 'warn',
  configFile: false,
  envDir: root,
  define: { 'process.env.NODE_ENV': JSON.stringify(mode === 'production' ? 'production' : 'development') },
};

// 1. Pages
await build({
  ...shared,
  base: './',
  plugins: [react()],
  build: {
    outDir,
    emptyOutDir: true,
    sourcemap: mode !== 'production',
    rollupOptions: { input: { popup: path.join(root, 'popup.html'), sidepanel: path.join(root, 'sidepanel.html') } },
  },
});

// 2–3. Service worker and content script: single self-contained files.
for (const [entry, fileName, format] of [
  ['src/background/index.ts', 'background.js', 'es'],
  ['src/content/gmail.ts', 'content-gmail.js', 'iife'],
]) {
  await build({
    ...shared,
    publicDir: false,
    build: {
      outDir,
      emptyOutDir: false,
      sourcemap: mode !== 'production' ? 'inline' : false,
      minify: mode === 'production',
      lib: { entry: path.join(root, entry), formats: [format], name: 'AutoReach', fileName: () => fileName },
      rolldownOptions: { output: { codeSplitting: false } },
    },
  });
}

// 4. Manifest
fs.writeFileSync(path.join(outDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Built AutoReach extension ${pkg.version} (${mode}) → ${path.relative(process.cwd(), outDir) || '.'}`);
console.log(`API: ${env.VITE_API_URL}${env.VITE_DEV_LOGIN === 'true' ? '  (development sign-in enabled)' : ''}`);
