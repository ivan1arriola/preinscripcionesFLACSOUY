import { defineConfig, devices } from '@playwright/test';

const externalWebUrl = process.env.WEB_URL;

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60000,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: externalWebUrl || 'http://localhost:5173',
    trace: 'on-first-retry',
  },
  webServer: externalWebUrl
    ? undefined
    : [
        {
          command: 'pnpm --filter api dev',
          url: 'http://localhost:3000/api/health',
          reuseExistingServer: !process.env.CI,
          env: {
            POSTGRES_PORT: process.env.POSTGRES_PORT || '5433',
            ...(process.env.DATABASE_URL ? { DATABASE_URL: process.env.DATABASE_URL } : {}),
            ADMIN_ALLOWED_EMAILS: process.env.ADMIN_ALLOWED_EMAILS || 'admin@example.test',
            GOOGLE_DRIVE_MOCK: 'true',
            WORDPRESS_URL: '',
          },
        },
        {
          command: 'pnpm --filter web dev',
          url: 'http://localhost:5173',
          reuseExistingServer: !process.env.CI,
        },
      ],
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
