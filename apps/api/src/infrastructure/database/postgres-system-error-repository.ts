import type { Kysely } from 'kysely';
import type { DatabaseSchema } from './schema.js';
import type {
  SystemErrorRepository,
  FindErrorsFilter,
} from '../../ports/system-error-repository.js';
import {
  type SystemErrorRecord,
  type ErrorSeverity,
  type ErrorOrigin,
  type ErrorStatus,
  resolveSystemError,
} from '../../domain/system-error.js';

export class PostgresSystemErrorRepository implements SystemErrorRepository {
  constructor(private readonly db: Kysely<DatabaseSchema>) {}

  async save(error: SystemErrorRecord): Promise<void> {
    const existing = await this.findById(error.id);

    if (existing) {
      await this.db
        .updateTable('system_errors')
        .set({
          severity: error.severity,
          origin: error.origin,
          code: error.code,
          message: error.message,
          context: JSON.stringify(error.context),
          target_id: error.targetId || null,
          status: error.status,
          resolved_at: error.resolvedAt ? new Date(error.resolvedAt) : null,
          resolved_by: error.resolvedBy || null,
          updated_at: new Date(error.updatedAt),
        })
        .where('id', '=', error.id)
        .execute();
    } else {
      await this.db
        .insertInto('system_errors')
        .values({
          id: error.id,
          severity: error.severity,
          origin: error.origin,
          code: error.code,
          message: error.message,
          context: JSON.stringify(error.context),
          target_id: error.targetId || null,
          status: error.status,
          resolved_at: error.resolvedAt ? new Date(error.resolvedAt) : null,
          resolved_by: error.resolvedBy || null,
          created_at: new Date(error.createdAt),
          updated_at: new Date(error.updatedAt),
        })
        .execute();
    }
  }

  async findById(id: string): Promise<SystemErrorRecord | null> {
    const row = await this.db
      .selectFrom('system_errors')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();

    if (!row) {
      return null;
    }

    return this.mapRow(row);
  }

  async findMany(filter: FindErrorsFilter = {}): Promise<SystemErrorRecord[]> {
    let query = this.db.selectFrom('system_errors').selectAll();

    if (filter.status) {
      query = query.where('status', '=', filter.status);
    }

    if (filter.origin) {
      query = query.where('origin', '=', filter.origin);
    }

    if (filter.severity) {
      query = query.where('severity', '=', filter.severity);
    }

    if (filter.targetId) {
      query = query.where('target_id', '=', filter.targetId);
    }

    query = query.orderBy('created_at', 'desc');

    if (filter.limit) {
      query = query.limit(filter.limit);
    }

    const rows = await query.execute();
    return rows.map((row) => this.mapRow(row));
  }

  async resolve(
    id: string,
    resolvedBy: string,
    now: Date = new Date()
  ): Promise<SystemErrorRecord | null> {
    const error = await this.findById(id);
    if (!error) {
      return null;
    }

    const updated = resolveSystemError(error, resolvedBy, now);
    await this.save(updated);
    return updated;
  }

  private mapRow(row: any): SystemErrorRecord {
    let parsedContext: Record<string, unknown> = {};
    if (typeof row.context === 'string') {
      try {
        parsedContext = JSON.parse(row.context);
      } catch {
        parsedContext = {};
      }
    } else if (typeof row.context === 'object' && row.context !== null) {
      parsedContext = row.context;
    }

    return {
      id: row.id,
      severity: row.severity as ErrorSeverity,
      origin: row.origin as ErrorOrigin,
      code: row.code,
      message: row.message,
      context: parsedContext,
      targetId: row.target_id || undefined,
      status: row.status as ErrorStatus,
      resolvedAt: row.resolved_at ? new Date(row.resolved_at).toISOString() : undefined,
      resolvedBy: row.resolved_by || undefined,
      createdAt: new Date(row.created_at).toISOString(),
      updatedAt: new Date(row.updated_at).toISOString(),
    };
  }
}
