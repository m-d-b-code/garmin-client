import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // No test may hit Garmin: responses are recorded fixtures, fetch is injected.
    environment: 'node',
    passWithNoTests: true,
  },
});
