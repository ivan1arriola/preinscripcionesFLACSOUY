import { describe, expect, it } from 'vitest';
import { shouldQueueEnrollmentNotice, type MauticConfig } from './mautic-config.js';

describe('shouldQueueEnrollmentNotice', () => {
  it('keeps an enabled notice even when Mautic URL or secret is not ready', () => {
    const config = { enrollmentNotifyEnabled: true, baseUrl: '', enrollmentSecret: '' } as MauticConfig;
    expect(shouldQueueEnrollmentNotice(config)).toBe(true);
  });
  it('honors an explicitly disabled notice', () => {
    expect(shouldQueueEnrollmentNotice({ enrollmentNotifyEnabled: false } as MauticConfig)).toBe(false);
  });
});
