import { defineConfig, loadEnv } from 'vite';
export default defineConfig(({ mode }) => ({
  base: loadEnv(mode, process.cwd(), 'VITE_').VITE_BASE_PATH || '/',
  server: { host: '0.0.0.0', port: 5178, strictPort: true, proxy: { '/ws': { target: 'ws://127.0.0.1:8796', ws: true }, '/api': 'http://127.0.0.1:8796' } },
  build: { outDir: 'dist/web', target: 'es2020' }
}));
