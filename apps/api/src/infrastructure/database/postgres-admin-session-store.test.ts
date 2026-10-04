import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createKyselyDb } from './kysely.js';
import { runMigrations } from './migrate.js';
import { PostgresAdminSessionStore } from './postgres-admin-session-store.js';
import type { AdminUser } from '../../domain/form-profiles.js';

describe('PostgresAdminSessionStore (Integration with PostgreSQL)', () => {
  const dbUrl =
    process.env.DATABASE_URL ??
    'postgres://flacso:flacso_password@localhost:5433/flacso_preinscripciones';

  const db = createKyselyDb(dbUrl);
  // 1 hour TTL for testing
  const sessionStore = new PostgresAdminSessionStore(db, 60 * 60 * 1000);

  const mockAdmin: AdminUser = {
    id: 'admin_flacso_web',
    googleSubject: 'bootstrap_web_flacso',
    email: 'web@flacso.edu.uy',
    name: 'Webmaster FLACSO Uruguay',
    pictureUrl: 'https://flacso.edu.uy/avatar.png',
    role: 'admin',
    createdAt: new Date(),
    lastLoginAt: new Date(),
  };

  beforeAll(async () => {
    await runMigrations(db);
  });

  afterAll(async () => {
    await db.destroy();
  });

  it('creates and retrieves a persistent session', async () => {
    const session = await sessionStore.createSession(mockAdmin);
    expect(session.id).toMatch(/^sess_/);
    expect(session.csrfToken).toMatch(/^csrf_/);
    expect(session.user.email).toBe('web@flacso.edu.uy');
    expect(session.expiresAt.getTime()).toBeGreaterThan(Date.now());

    const retrieved = await sessionStore.getSession(session.id);
    expect(retrieved).not.toBeNull();
    expect(retrieved?.id).toBe(session.id);
    expect(retrieved?.user.email).toBe(mockAdmin.email);
    expect(retrieved?.user.name).toBe(mockAdmin.name);
    expect(retrieved?.csrfToken).toBe(session.csrfToken);
  });

  it('touches an existing session and extends its expiration', async () => {
    const session = await sessionStore.createSession(mockAdmin);
    const initialExpiry = session.expiresAt.getTime();

    // Advance 100ms
    await new Promise((resolve) => setTimeout(resolve, 100));

    const newExpiry = await sessionStore.touchSession(session.id);
    expect(newExpiry).not.toBeNull();
    expect(newExpiry!.getTime()).toBeGreaterThan(initialExpiry);

    const retrieved = await sessionStore.getSession(session.id);
    expect(retrieved?.expiresAt.getTime()).toBe(newExpiry!.getTime());
  });

  it('returns null for expired sessions and cleans them up', async () => {
    // Create a short-lived store
    const shortLivedStore = new PostgresAdminSessionStore(db, -1000); // already expired
    const expiredSession = await shortLivedStore.createSession(mockAdmin);

    const retrieved = await shortLivedStore.getSession(expiredSession.id);
    expect(retrieved).toBeNull();

    const cleaned = await shortLivedStore.cleanExpiredSessions();
    expect(cleaned).toBeGreaterThanOrEqual(1);
  });

  it('deletes a session upon logout', async () => {
    const session = await sessionStore.createSession(mockAdmin);
    await sessionStore.deleteSession(session.id);

    const retrieved = await sessionStore.getSession(session.id);
    expect(retrieved).toBeNull();
  });
});
