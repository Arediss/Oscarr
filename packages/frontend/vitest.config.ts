import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

// Pure logic only — no jsdom. Component rendering is a separate concern and would drag in a DOM
// implementation for no benefit here; these are the rules that decide what a user may do next.
export default defineConfig({
  resolve: {
    alias: { '@': resolve(import.meta.dirname, 'src') },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
