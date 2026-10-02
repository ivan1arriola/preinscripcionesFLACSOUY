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
  getDefaultProfileDefinition,
  SUPPORTED_OFFER_TYPES,
  validateProfileDefinition,
} from '../../domain/form-profiles.js';

export class MemoryFormProfileRepository implements FormProfileRepository {
  private profiles = new Map<string, FormProfile>();
  private versions = new Map<string, FormProfileVersion>();
  private admins = new Map<string, AdminUser>();

  constructor(private readonly definitions: Partial<Record<SupportedOfferType, FormProfileDefinition>> = {}) {
    this.seedDefaults();
  }

  private seedDefaults() {
    this.admins.set('web@flacso.edu.uy', {
      id: 'admin_flacso_web',
      googleSubject: 'bootstrap_web_flacso',
      email: 'web@flacso.edu.uy',
      name: 'Webmaster FLACSO Uruguay',
      role: 'admin',
      createdAt: new Date(),
    });

    for (const type of SUPPORTED_OFFER_TYPES) {
      const profileId = `profile_${type}`;
      const versionId = `ver_${type}_v1`;
      const def = this.definitions[type] ?? getDefaultProfileDefinition(type);

      this.profiles.set(profileId, {
        id: profileId,
        type,
        name: type.toUpperCase(),
        activeVersionId: versionId,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      this.versions.set(versionId, {
        id: versionId,
        profileId,
        versionNumber: 1,
        definition: def,
        createdBy: 'system',
        createdAt: new Date(),
      });
    }
  }

  async getActive(type: SupportedOfferType): Promise<EffectiveProfile | null> {
    const profile = Array.from(this.profiles.values()).find((p) => p.type === type);
    if (!profile || !profile.activeVersionId) return null;

    const version = this.versions.get(profile.activeVersionId);
    if (!version) return null;

    return {
      profileId: profile.id,
      type: profile.type,
      name: profile.name,
      versionId: version.id,
      versionNumber: version.versionNumber,
      definition: version.definition,
    };
  }

  async getActiveByProfileId(profileId: string): Promise<EffectiveProfile | null> {
    const profile = this.profiles.get(profileId);
    if (!profile || !profile.activeVersionId) return null;

    const version = this.versions.get(profile.activeVersionId);
    if (!version) return null;

    return {
      profileId: profile.id,
      type: profile.type,
      name: profile.name,
      versionId: version.id,
      versionNumber: version.versionNumber,
      definition: version.definition,
    };
  }

  async getById(profileId: string): Promise<FormProfile | null> {
    return this.profiles.get(profileId) ?? null;
  }

  async getByType(type: SupportedOfferType): Promise<FormProfile | null> {
    return Array.from(this.profiles.values()).find((p) => p.type === type) ?? null;
  }

  async getVersionById(versionId: string): Promise<FormProfileVersion | null> {
    return this.versions.get(versionId) ?? null;
  }

  async listProfiles(): Promise<FormProfile[]> {
    return Array.from(this.profiles.values());
  }

  async listVersions(profileId: string): Promise<FormProfileVersion[]> {
    return Array.from(this.versions.values())
      .filter((v) => v.profileId === profileId)
      .sort((a, b) => b.versionNumber - a.versionNumber);
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

    const versions = await this.listVersions(profile.id);
    const nextNumber = (versions[0]?.versionNumber ?? 0) + 1;
    const versionId = `ver_${command.type}_v${nextNumber}_${Math.random().toString(36).slice(2, 8)}`;

    const newVersion: FormProfileVersion = {
      id: versionId,
      profileId: profile.id,
      versionNumber: nextNumber,
      definition: validated,
      createdBy: actorEmail,
      createdAt: new Date(),
    };

    this.versions.set(versionId, newVersion);
    return newVersion;
  }

  async activateVersion(profileId: string, versionId: string): Promise<void> {
    const profile = this.profiles.get(profileId);
    if (!profile) throw new Error(`Profile ${profileId} not found`);
    const version = this.versions.get(versionId);
    if (!version || version.profileId !== profileId) {
      throw new Error(`Version ${versionId} not found for profile ${profileId}`);
    }
    profile.activeVersionId = versionId;
    profile.updatedAt = new Date();
  }

  async getAdminByEmail(email: string): Promise<AdminUser | null> {
    return this.admins.get(email.toLowerCase().trim()) ?? null;
  }

  async getAdminByGoogleSubject(googleSubject: string): Promise<AdminUser | null> {
    return Array.from(this.admins.values()).find((a) => a.googleSubject === googleSubject) ?? null;
  }

  async recordAdminLogin(
    id: string,
    googleSubject: string,
    name: string,
    pictureUrl?: string,
  ): Promise<AdminUser> {
    const admin = Array.from(this.admins.values()).find((a) => a.id === id);
    if (!admin) throw new Error(`Admin ${id} not found`);
    admin.googleSubject = googleSubject;
    admin.name = name;
    admin.pictureUrl = pictureUrl;
    admin.lastLoginAt = new Date();
    return { ...admin };
  }
}
