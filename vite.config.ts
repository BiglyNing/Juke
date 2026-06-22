import { defineConfig } from 'vite';

// Dev serves at root for convenience; production builds under '/Juke/' so asset
// paths resolve on GitHub Pages (project site at https://<user>.github.io/Juke/).
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/Juke/' : '/',
  server: {
    host: true,
  },
}));
