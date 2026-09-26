import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['server/tests/**/*.test.ts', 'web/src/**/*.test.ts', 'shared/**/*.test.ts'],
    environment: 'node',
    testTimeout: 10_000,
  },
});
