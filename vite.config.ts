import { defineConfig } from 'vite';
import { resolve } from 'path';

// base יחסי כדי שהאתר יעבוד בכל כתובת של GitHub Pages
export default defineConfig({
  base: './',
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        admin: resolve(__dirname, 'admin.html'),
        stats: resolve(__dirname, 'stats.html'),
        overlay: resolve(__dirname, 'overlay.html'),
        phone: resolve(__dirname, 'phone.html'),
        phoneStats: resolve(__dirname, 'phone-stats.html'),
      },
    },
  },
});
