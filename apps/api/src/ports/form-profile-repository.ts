import type {
  AdminUser,
  EffectiveProfile,
  FormProfile,
  FormProfileDefinition,
  FormProfileVersion,
  SupportedOfferType,
} from '../domain/form-profiles.js';

export interface CreateProfileVersionCommand {
  type: SupportedOfferType;
  definition: FormProfileDefinition;
}

export interface FormProfileRepository {
  getActive(type: SupportedOfferType): Promise<EffectiveProfile | null>;
  getActiveByProfileId(profileId: string): Promise<EffectiveProfile | null>;
  getById(profileId: string): Promise<FormProfile | null>;
  getByType(type: SupportedOfferType): Promise<FormProfile | null>;
  getVersionById(versionId: string): Promise<FormProfileVersion | null>;
  listProfiles(): Promise<FormProfile[]>;
  listVersions(profileId: string): Promise<FormProfileVersion[]>;
  createVersion(command: CreateProfileVersionCommand, actorEmail: string): Promise<FormProfileVersion>;
  activateVersion(profileId: string, versionId: string, actorEmail: string): Promise<void>;

  // Admin user
  getAdminByEmail(email: string): Promise<AdminUser | null>;
  getAdminByGoogleSubject(googleSubject: string): Promise<AdminUser | null>;
  recordAdminLogin(id: string, googleSubject: string, name: string, pictureUrl?: string): Promise<AdminUser>;
}
