import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  plugins: [ vue() ],
  build: {
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        images: fileURLToPath(new URL('./images.html', import.meta.url)),
        order: fileURLToPath(new URL('./order.html', import.meta.url))
      }
    }
  }
});
