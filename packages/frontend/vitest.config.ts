import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

// Logic and static component rendering run in Node without jsdom.
// Browser interactions are verified separately against the real App.
export default defineConfig({
  resolve: {
    alias: { '@': resolve(import.meta.dirname, 'src') },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
