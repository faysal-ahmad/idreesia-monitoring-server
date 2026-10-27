import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(() => ({
  root: import.meta.dirname,
  cacheDir: '../../node_modules/.vite/packages/security-server-ui',
  server: {
    port: 4200,
    host: 'localhost',
    proxy: {
      '/api': {
        target: 'http://security-server:3000',
        changeOrigin: true,
      },
      // Live video: only go2rtc's player scripts and its WebSocket stream endpoint are proxied
      // (mirrors nginx.conf). Its REST API is unauthenticated and lists camera credentials, so any
      // other /go2rtc/ path falls through to the app instead of reaching go2rtc.
      '^/go2rtc/(video-stream|video-rtc)\\.js$': {
        target: 'http://go2rtc:1984',
        rewrite: (path) => path.replace(/^\/go2rtc/, ''),
      },
      '^/go2rtc/api/ws(\\?|$)': {
        target: 'http://go2rtc:1984',
        ws: true,
        rewrite: (path) => path.replace(/^\/go2rtc/, ''),
      },
    },
  },
  preview: {
    port: 4200,
    host: 'localhost',
  },
  plugins: [react()],
  // Uncomment this if you are using workers.
  // worker: {
  //  plugins: [],
  // },
  build: {
    outDir: './dist',
    emptyOutDir: true,
    reportCompressedSize: true,
    commonjsOptions: {
      transformMixedEsModules: true,
    },
  },
}));
