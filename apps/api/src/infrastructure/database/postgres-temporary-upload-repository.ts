import { sql, type Kysely } from 'kysely';
import type { DatabaseSchema } from './schema.js';
import type {
  CreateTemporaryUploadInput,
  TemporaryUploadRecord,
  TemporaryUploadRepository,
} from '../../ports/temporary-upload-repository.js';

export class PostgresTemporaryUploadRepository implements TemporaryUploadRepository {
  private readonly defaultTtlMs: number;

  constructor(
    private readonly db: Kysely<DatabaseSchema>,
    ttlMs: number = 30 * 60 * 1000 // 30 minutes default
  ) {
    this.defaultTtlMs = ttlMs;
  }

  async create(input: CreateTemporaryUploadInput): Promise<TemporaryUploadRecord> {
    const expiresAt = input.expiresAt ?? new Date(Date.now() + this.defaultTtlMs);

    const row = await this.db
      .insertInto('temporary_uploads')
      .values({
        token: input.token,
        session_id: input.sessionId,
        target_id: input.targetId ?? null,
        field_key: input.fieldKey,
        original_name: input.originalName,
        mime_type: input.mimeType,
        size: input.size,
        expires_at: expiresAt,
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    return this.mapRow(row);
  }

  async get(token: string, sessionId?: string): Promise<TemporaryUploadRecord | null> {
    let query = this.db
      .selectFrom('temporary_uploads')
      .selectAll()
      .where('token', '=', token);

    if (sessionId) {
      query = query.where('session_id', '=', sessionId);
    }

    const row = await query.executeTakeFirst();
    return row ? this.mapRow(row) : null;
  }

  async listBySession(sessionId: string): Promise<TemporaryUploadRecord[]> {
    const rows = await this.db
      .selectFrom('temporary_uploads')
      .selectAll()
      .where('session_id', '=', sessionId)
      .execute();

    return rows.map((r) => this.mapRow(r));
  }

  async touch(sessionId: string, newExpiresAt?: Date): Promise<void> {
    const expiresAt = newExpiresAt ?? new Date(Date.now() + this.defaultTtlMs);
    await this.db
      .updateTable('temporary_uploads')
      .set({
        last_activity_at: sql`CURRENT_TIMESTAMP`,
        expires_at: expiresAt,
      })
      .where('session_id', '=', sessionId)
      .execute();
  }

  async remove(token: string, sessionId?: string): Promise<boolean> {
    let query = this.db
      .deleteFrom('temporary_uploads')
      .where('token', '=', token);

    if (sessionId) {
      query = query.where('session_id', '=', sessionId);
    }

    const result = await query.executeTakeFirst();
    return (result.numDeletedRows ?? 0n) > 0n;
  }

  async listExpired(before: Date): Promise<TemporaryUploadRecord[]> {
    const rows = await this.db
      .selectFrom('temporary_uploads')
      .selectAll()
      .where('expires_at', '<', before)
      .execute();

    return rows.map((r) => this.mapRow(r));
  }

  async deleteMetadata(token: string): Promise<void> {
    await this.db
      .deleteFrom('temporary_uploads')
      .where('token', '=', token)
      .execute();
  }

  private mapRow(row: any): TemporaryUploadRecord {
    return {
      token: row.token,
      sessionId: row.session_id,
      targetId: row.target_id ?? undefined,
      fieldKey: row.field_key,
      originalName: row.original_name,
      mimeType: row.mime_type,
      size: Number(row.size),
      createdAt: new Date(row.created_at),
      lastActivityAt: new Date(row.last_activity_at),
      expiresAt: new Date(row.expires_at),
    };
  }
}
