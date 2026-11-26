import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';
import { test, expect } from '@playwright/test';

const require = createRequire(path.resolve(process.cwd(), 'apps/api/package.json'));

test.describe('Admin session seeded in PostgreSQL', () => {
  test('opens /admin/perfiles directly with a seeded admin_sessions row and valid cookie', async ({ page, context, baseURL }) => {
    const databaseUrl = process.env.DATABASE_URL || process.env.PREINSCRIPTIONS_TEST_DATABASE_URL;
    test.skip(!databaseUrl, 'Requiere DATABASE_URL o PREINSCRIPTIONS_TEST_DATABASE_URL con PostgreSQL accesible.');

    const pg = require('pg') as { Pool: new (cfg: { connectionString: string }) => { query: (sql: string, params?: unknown[]) => Promise<unknown>; end: () => Promise<void> } };
    const pool = new pg.Pool({ connectionString: databaseUrl! });
    const sessionId = `sess_e2e_${crypto.randomBytes(16).toString('hex')}`;
    const csrfToken = `csrf_e2e_${crypto.randomBytes(12).toString('hex')}`;
    const adminUser = {
      id: 'e2e-admin',
      email: 'admin@example.test',
      name: 'Admin E2E',
      role: 'admin',
    };

    // expires_at no guarda zona horaria; el margen cubre la diferencia entre el host y la API.
    await pool.query(
      `INSERT INTO admin_sessions (id, user_id, email, user_data, csrf_token, expires_at)
       VALUES ($1, $2, $3, $4::jsonb, $5, CURRENT_TIMESTAMP + INTERVAL '2 days')`,
      [sessionId, adminUser.id, adminUser.email, JSON.stringify(adminUser), csrfToken]
    );

    try {
      const targetUrl = new URL(baseURL || 'http://localhost:5173');
      await context.addCookies([
        {
          name: 'flacso_admin_session',
          value: sessionId,
          domain: targetUrl.hostname,
          path: '/',
          httpOnly: true,
          sameSite: 'Lax',
        },
      ]);

      await page.goto('/admin/perfiles');
      await expect(page.getByRole('heading', { name: 'Administración de Preinscripciones' })).toBeVisible();
      await expect(page.getByText('Admin E2E')).toBeVisible();
      await expect(page.getByText('admin@example.test')).toBeVisible();
    } finally {
      await pool.query('DELETE FROM admin_sessions WHERE id = $1', [sessionId]).catch(() => {});
      await pool.end();
    }
  });
});
