import { defineConfig } from 'vitest/config';

const hasTestDatabase = Boolean(process.env.CI || process.env.PREINSCRIPTIONS_TEST_DATABASE_URL);

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    fileParallelism: false,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'html'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.test.ts',
        'src/**/*.spec.ts',
        'src/infrastructure/database/migrations/**',
        'src/infrastructure/database/schema.ts',
        'src/infrastructure/fixtures/**',
        'src/ports/**',
        'dist/**',
      ],
      ...(hasTestDatabase
        ? {
            thresholds: {
              lines: 78,
              statements: 78,
              functions: 87,
              branches: 79,
            },
          }
        : {}),
    },
  },
});
