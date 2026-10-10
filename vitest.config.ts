import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    testTimeout: 30_000,
    hookTimeout: 120_000,
    // Browser tests start a real Chrome; keep files sequential so they do not fight for CPU.
    fileParallelism: true,
    poolOptions: { forks: { singleFork: false } },
  },
});
