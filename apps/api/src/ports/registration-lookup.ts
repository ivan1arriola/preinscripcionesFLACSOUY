export interface RegistrationLookup {
  hasEffectiveRegistration(email: string, targetId: string): Promise<boolean>;
}
