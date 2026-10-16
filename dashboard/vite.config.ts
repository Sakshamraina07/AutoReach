import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, strictPort: true },
  preview: { port: 4173 },
  build: {
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (!id.includes('node_modules')) return undefined;
          if (/node_modules\/(recharts|d3-|victory-vendor)/.test(id)) return 'vendor-charts';
          if (id.includes('node_modules/@supabase')) return 'vendor-supabase';
          return undefined;
        },
      },
    },
  },
});
