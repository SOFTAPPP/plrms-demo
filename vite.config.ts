import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // Rust build output, the database and generated bundles change constantly and are not UI source.
    watch: { ignored: ['**/src-tauri/**', '**/data/**', '**/dist/**'] },
  },
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 1800,
    rollupOptions: {
      output: {
        // Only the 3D packages go in "three", and only chart packages in "echarts". Anything they share
        // with the rest of the app (zustand, scheduler...) stays out of them, otherwise the sign-in page
        // would have to download the 1.1 MB three.js chunk just to get at those.
        manualChunks(id) {
          // Vite's dynamic-import helper is needed by the entry; left alone it lands in whichever chunk imports it last
          if (id.includes('vite/preload-helper')) return 'react';
          if (!id.includes('node_modules')) return undefined;
          if (/[\/]node_modules[\/](\.pnpm[\/][^\/]+[\/]node_modules[\/])?(three|@react-three|three-stdlib|three-mesh-bvh|maath|meshline|camera-controls|stats-gl|troika[^\/]*|react-reconciler|its-fine|suspend-react|@use-gesture|detect-gpu|hls\.js|bidi-js|webgl-sdf-generator|tunnel-rat|utility-types|react-use-measure)[\/]/.test(id)) return 'three';
          if (/[\/]node_modules[\/](\.pnpm[\/][^\/]+[\/]node_modules[\/])?(echarts|zrender)[\/]/.test(id)) return 'echarts';
          if (/[\/]node_modules[\/](\.pnpm[\/][^\/]+[\/]node_modules[\/])?(react|react-dom|react-router|react-router-dom|scheduler|zustand|use-sync-external-store)[\/]/.test(id)) return 'react';
          return undefined;
        },
      },
    },
  },
});
