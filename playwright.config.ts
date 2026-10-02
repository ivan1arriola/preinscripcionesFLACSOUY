import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60000,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: process.env.WEB_URL || 'http://localhost:5173',
    trace: 'on-first-retry',
  },
  webServer: [
    {
      command: 'pnpm --filter api dev',
      url: 'http://localhost:3000/api/health',
      reuseExistingServer: !process.env.CI,
      env: {
        POSTGRES_PORT: process.env.POSTGRES_PORT || '5433',
        ADMIN_ALLOWED_EMAILS: 'web@flacso.edu.uy',
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
