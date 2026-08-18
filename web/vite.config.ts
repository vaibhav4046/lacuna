import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * The React application, built as a sibling of the server that already exists.
 *
 * The dev server proxies /api to the running Node server rather than mocking
 * it, because a mock is a second answer to every question and the whole point
 * of this product is that there is one. Port 3016 is chosen to sit clear of
 * 3014 (npm run serve) and 3015 (the snapshot and parity harnesses), so all
 * three can run at once while a route is being checked against the oracle.
 */
export default defineConfig({
  plugins: [react()],
  server: {
    // Bound to the loopback address rather than the name. Vite's default host
    // is "localhost", which Node resolves to ::1 on Windows and then binds
    // there only, so http://127.0.0.1:3016 is refused while
    // http://localhost:3016 works. A refused connection renders as a white
    // browser error page, which is what a broken product looks like from the
    // outside, and it is how this one was reported.
    host: '127.0.0.1',
    port: 3016,
    strictPort: true,
    proxy: {
      '/api': { target: 'http://127.0.0.1:3014', changeOrigin: false },
    },
  },
  // An inline PostCSS config, deliberately empty. Without it Vite walks up the
  // directory tree looking for postcss.config.js, finds one belonging to an
  // unrelated project two levels up, and drags Tailwind and its preflight
  // reset into this build. The design is verbatim inline styles plus a single
  // stylesheet. There is no CSS framework in it, and one must not arrive by
  // accident from a neighbouring directory.
  css: { postcss: { plugins: [] } },
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    // Every byte the page loads is served from this origin, which is what the
    // content security policy for this application says and the only way the
    // inline styles the design is made of can survive without 'unsafe-inline'.
    sourcemap: false,
    target: 'es2022',
  },
});
