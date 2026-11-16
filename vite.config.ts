import { defineConfig } from 'vite';
import { resolve } from 'path';

// base יחסי כדי שהאתר יעבוד בכל כתובת של GitHub Pages
export default defineConfig({
  base: './',
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        map: resolve(__dirname, 'map.html'),
        admin: resolve(__dirname, 'admin.html'),
        stats: resolve(__dirname, 'stats.html'),
      },
    },
  },
});
