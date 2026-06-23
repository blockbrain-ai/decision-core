import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    passWithNoTests: true,
    include: ['src/**/*.test.ts', 'test/**/*.test.ts', 'integrations/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/**/index.ts'],
    },
  },
});
