import crypto from 'node:crypto';
import type { Kysely } from 'kysely';
import type { DatabaseSchema } from './schema.js';
import type { AdminUser } from '../../domain/admin-user.js';
import {
  type AdminSession,
  type AdminSessionStore,
  getAdminSessionTtlMs,
} from '../../application/admin-session.js';

export class PostgresAdminSessionStore implements AdminSessionStore {
  constructor(
    private readonly db: Kysely<DatabaseSchema>,
    private readonly ttlMs: number = getAdminSessionTtlMs()
  ) {}

  async createSession(user: AdminUser): Promise<AdminSession> {
    const id = `sess_${crypto.randomBytes(32).toString('hex')}`;
    const csrfToken = `csrf_${crypto.randomBytes(24).toString('hex')}`;
    const now = new Date();
    const expiresAt = new Date(now.getTime() + this.ttlMs);

    await this.db
      .insertInto('admin_sessions')
      .values({
        id,
        user_id: user.id,
        email: user.email.toLowerCase(),
        user_data: JSON.stringify(user),
        csrf_token: csrfToken,
        created_at: now,
        expires_at: expiresAt,
      })
      .execute();

    return {
      id,
      user,
      csrfToken,
      createdAt: now,
      expiresAt,
    };
  }

  async getSession(sessionId: string): Promise<AdminSession | null> {
    const row = await this.db
      .selectFrom('admin_sessions')
      .selectAll()
      .where('id', '=', sessionId)
      .where('expires_at', '>', new Date())
      .executeTakeFirst();

    if (!row) {
      return null;
    }

    const user = (typeof row.user_data === 'string'
      ? JSON.parse(row.user_data)
      : row.user_data) as AdminUser;

    return {
      id: row.id,
      user,
      csrfToken: row.csrf_token,
      createdAt: new Date(row.created_at),
      expiresAt: new Date(row.expires_at),
    };
  }

  async touchSession(sessionId: string): Promise<Date | null> {
    const now = new Date();
    const newExpiresAt = new Date(now.getTime() + this.ttlMs);

    const result = await this.db
      .updateTable('admin_sessions')
      .set({ expires_at: newExpiresAt })
      .where('id', '=', sessionId)
      .where('expires_at', '>', now)
      .returning('expires_at')
      .executeTakeFirst();

    return result ? new Date(result.expires_at) : null;
  }

  async deleteSession(sessionId: string): Promise<void> {
    await this.db
      .deleteFrom('admin_sessions')
      .where('id', '=', sessionId)
      .execute();
  }

  async cleanExpiredSessions(): Promise<number> {
    const result = await this.db
      .deleteFrom('admin_sessions')
      .where('expires_at', '<=', new Date())
      .execute();

    return Number(result[0]?.numDeletedRows ?? 0n);
  }
}
