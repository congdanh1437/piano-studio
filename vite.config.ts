import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Relative paths so the build works from any hosting sub-path.
  base: './',
  server: { port: 5173, strictPort: true },
  test: { environment: 'node' },
});
