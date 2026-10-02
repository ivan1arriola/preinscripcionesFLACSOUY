import crypto from 'node:crypto';
import type {
  CreateProfileVersionCommand,
  FormProfileRepository,
} from '../../ports/form-profile-repository.js';
import type {
  AdminUser,
  EffectiveProfile,
  FormProfile,
  FormProfileDefinition,
  FormProfileVersion,
  SupportedOfferType,
} from '../../domain/form-profiles.js';
import {
  validateProfileDefinition,
} from '../../domain/form-profiles.js';
import type { KyselyDb } from './kysely.js';

export class PostgresFormProfileRepository implements FormProfileRepository {
  constructor(private readonly db: KyselyDb) {}

  async getActive(type: SupportedOfferType): Promise<EffectiveProfile | null> {
    const profile = await this.db
      .selectFrom('form_profiles')
      .selectAll()
      .where('type', '=', type)
      .executeTakeFirst();

    if (!profile || !profile.active_version_id) {
      return null;
    }

    const version = await this.db
      .selectFrom('form_profile_versions')
      .selectAll()
      .where('id', '=', profile.active_version_id)
      .executeTakeFirst();

    if (!version) {
      return null;
    }

    const parsedDef = typeof version.definition === 'string'
      ? JSON.parse(version.definition)
      : version.definition;

    const validated = validateProfileDefinition(type, parsedDef);

    return {
      profileId: profile.id,
      type: profile.type as SupportedOfferType,
      name: profile.name,
      versionId: version.id,
      versionNumber: version.version_number,
      definition: validated,
    };
  }

  async getActiveByProfileId(profileId: string): Promise<EffectiveProfile | null> {
    const profile = await this.db
      .selectFrom('form_profiles')
      .selectAll()
      .where('id', '=', profileId)
      .executeTakeFirst();

    if (!profile || !profile.active_version_id) {
      return null;
    }

    const version = await this.db
      .selectFrom('form_profile_versions')
      .selectAll()
      .where('id', '=', profile.active_version_id)
      .executeTakeFirst();

    if (!version) {
      return null;
    }

    const offerType = profile.type as SupportedOfferType;
    const parsedDef = typeof version.definition === 'string'
      ? JSON.parse(version.definition)
      : version.definition;

    const validated = validateProfileDefinition(offerType, parsedDef);

    return {
      profileId: profile.id,
      type: offerType,
      name: profile.name,
      versionId: version.id,
      versionNumber: version.version_number,
      definition: validated,
    };
  }

  async getById(profileId: string): Promise<FormProfile | null> {
    const row = await this.db
      .selectFrom('form_profiles')
      .selectAll()
      .where('id', '=', profileId)
      .executeTakeFirst();

    if (!row) {
      return null;
    }

    return this.mapProfile(row);
  }

  async getByType(type: SupportedOfferType): Promise<FormProfile | null> {
    const row = await this.db
      .selectFrom('form_profiles')
      .selectAll()
      .where('type', '=', type)
      .executeTakeFirst();

    if (!row) {
      return null;
    }

    return this.mapProfile(row);
  }

  async getVersionById(versionId: string): Promise<FormProfileVersion | null> {
    const row = await this.db
      .selectFrom('form_profile_versions')
      .selectAll()
      .where('id', '=', versionId)
      .executeTakeFirst();

    if (!row) {
      return null;
    }

    return this.mapVersion(row);
  }

  async listProfiles(): Promise<FormProfile[]> {
    const rows = await this.db
      .selectFrom('form_profiles')
      .selectAll()
      .orderBy('type', 'asc')
      .execute();

    return rows.map((r) => this.mapProfile(r));
  }

  async listVersions(profileId: string): Promise<FormProfileVersion[]> {
    const rows = await this.db
      .selectFrom('form_profile_versions')
      .selectAll()
      .where('profile_id', '=', profileId)
      .orderBy('version_number', 'desc')
      .execute();

    return rows.map((r) => this.mapVersion(r));
  }

  async createVersion(
    command: CreateProfileVersionCommand,
    actorEmail: string,
  ): Promise<FormProfileVersion> {
    const validated = validateProfileDefinition(command.type, command.definition);

    const profile = await this.getByType(command.type);
    if (!profile) {
      throw new Error(`Profile not found for type: ${command.type}`);
    }

    return await this.db.transaction().execute(async (trx) => {
      const maxVersionRow = await trx
        .selectFrom('form_profile_versions')
        .select((eb) => eb.fn.max('version_number').as('max_ver'))
        .where('profile_id', '=', profile.id)
        .executeTakeFirst();

      const nextNumber = ((maxVersionRow?.max_ver as number) ?? 0) + 1;
      const versionId = `ver_${command.type}_v${nextNumber}_${crypto.randomUUID().slice(0, 8)}`;

      await trx
        .insertInto('form_profile_versions')
        .values({
          id: versionId,
          profile_id: profile.id,
          version_number: nextNumber,
          definition: JSON.stringify(validated),
          created_by: actorEmail,
          created_at: new Date(),
        })
        .execute();

      await trx
        .insertInto('form_profile_audit_events')
        .values({
          id: `audit_${crypto.randomUUID()}`,
          profile_id: profile.id,
          version_id: versionId,
          action: 'version_created',
          actor_email: actorEmail,
          details: JSON.stringify({ versionNumber: nextNumber }),
          created_at: new Date(),
        })
        .execute();

      const created = await trx
        .selectFrom('form_profile_versions')
        .selectAll()
        .where('id', '=', versionId)
        .executeTakeFirstOrThrow();

      return this.mapVersion(created);
    });
  }

  async activateVersion(
    profileId: string,
    versionId: string,
    actorEmail: string,
  ): Promise<void> {
    await this.db.transaction().execute(async (trx) => {
      const version = await trx
        .selectFrom('form_profile_versions')
        .selectAll()
        .where('id', '=', versionId)
        .where('profile_id', '=', profileId)
        .executeTakeFirst();

      if (!version) {
        throw new Error(`Version ${versionId} does not exist for profile ${profileId}`);
      }

      await trx
        .updateTable('form_profiles')
        .set({
          active_version_id: versionId,
          updated_at: new Date(),
        })
        .where('id', '=', profileId)
        .execute();

      await trx
        .insertInto('form_profile_audit_events')
        .values({
          id: `audit_${crypto.randomUUID()}`,
          profile_id: profileId,
          version_id: versionId,
          action: 'version_activated',
          actor_email: actorEmail,
          details: JSON.stringify({ versionNumber: version.version_number }),
          created_at: new Date(),
        })
        .execute();
    });
  }

  async getAdminByEmail(email: string): Promise<AdminUser | null> {
    const row = await this.db
      .selectFrom('admin_users')
      .selectAll()
      .where('email', '=', email.toLowerCase().trim())
      .executeTakeFirst();

    if (!row) {
      return null;
    }

    return this.mapAdmin(row);
  }

  async getAdminByGoogleSubject(googleSubject: string): Promise<AdminUser | null> {
    const row = await this.db
      .selectFrom('admin_users')
      .selectAll()
      .where('google_subject', '=', googleSubject)
      .executeTakeFirst();

    if (!row) {
      return null;
    }

    return this.mapAdmin(row);
  }

  async recordAdminLogin(
    id: string,
    googleSubject: string,
    name: string,
    pictureUrl?: string,
  ): Promise<AdminUser> {
    await this.db
      .updateTable('admin_users')
      .set({
        google_subject: googleSubject,
        name,
        picture_url: pictureUrl ?? null,
        last_login_at: new Date(),
      })
      .where('id', '=', id)
      .execute();

    const updated = await this.db
      .selectFrom('admin_users')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirstOrThrow();

    return this.mapAdmin(updated);
  }

  private mapProfile(row: any): FormProfile {
    return {
      id: row.id,
      type: row.type as SupportedOfferType,
      name: row.name,
      activeVersionId: row.active_version_id ?? null,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };
  }

  private mapVersion(row: any): FormProfileVersion {
    const def = typeof row.definition === 'string'
      ? JSON.parse(row.definition)
      : row.definition;

    return {
      id: row.id,
      profileId: row.profile_id,
      versionNumber: Number(row.version_number),
      definition: def as FormProfileDefinition,
      createdBy: row.created_by,
      createdAt: new Date(row.created_at),
    };
  }

  private mapAdmin(row: any): AdminUser {
    return {
      id: row.id,
      googleSubject: row.google_subject,
      email: row.email,
      name: row.name,
      pictureUrl: row.picture_url ?? undefined,
      role: 'admin',
      createdAt: new Date(row.created_at),
      lastLoginAt: row.last_login_at ? new Date(row.last_login_at) : undefined,
    };
  }
}
