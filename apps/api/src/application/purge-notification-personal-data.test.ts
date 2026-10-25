import { describe, expect, it, afterEach } from 'vitest';
import { InMemoryEmailNotificationRepository } from '../infrastructure/database/in-memory-email-notification-repository.js';
import {
  getNotificationRetentionDays,
  purgeNotificationPersonalData,
} from './purge-notification-personal-data.js';
import { redactNotificationSnapshot, type SubmissionNotificationSnapshot } from './notification-snapshot.js';

const snapshot: SubmissionNotificationSnapshot = {
  submissionId: 'sub_1',
  targetId: 'diploma-davia',
  targetTitle: 'Diploma DAVIA',
  targetKind: 'academic_offer',
  applicantEmail: 'ana@example.com',
  applicantName: 'Ana Clara',
  notificationEmails: ['coordinacion@flacso.edu.uy'],
  values: { documento: { key: 'documento', label: 'Documento', value: '3.456.789-4' } },
  orderedFieldKeys: ['documento'],
  spreadsheetRowUrl: 'https://docs.google.com/spreadsheets/d/x/edit#gid=0&range=A2:E2',
  documentsFolderUrl: 'https://drive.google.com/drive/folders/abc',
  templateVersion: 'preinscription-notification-v1',
};

const DAY = 24 * 60 * 60 * 1000;

describe('redactNotificationSnapshot', () => {
  it('drops every personal datum but keeps what identifies the delivery', () => {
    const redacted = redactNotificationSnapshot(snapshot, new Date('2026-10-25T00:00:00Z'));

    expect(redacted).toEqual({
      submissionId: 'sub_1',
      targetId: 'diploma-davia',
      targetTitle: 'Diploma DAVIA',
      targetKind: 'academic_offer',
      applicantEmail: '',
      values: {},
      orderedFieldKeys: [],
      spreadsheetRowUrl: '',
      documentsFolderUrl: '',
      templateVersion: 'preinscription-notification-v1',
      redactedAt: '2026-10-25T00:00:00.000Z',
    });
    expect(JSON.stringify(redacted)).not.toContain('Ana');
    expect(JSON.stringify(redacted)).not.toContain('3.456.789-4');
  });
});

describe('purgeNotificationPersonalData', () => {
  async function seed(repo: InMemoryEmailNotificationRepository, sentDaysAgo: number, now: Date) {
    const [record] = await repo.ensureForSubmission({
      submissionId: `sub_${sentDaysAgo}`,
      snapshot: { ...snapshot, submissionId: `sub_${sentDaysAgo}` },
      recipients: [{ audience: 'applicant', email: 'ana@example.com' }],
    });
    await repo.markSent(record!.id, 'msg-1', new Date(now.getTime() - sentDaysAgo * DAY));
    return record!.id;
  }

  it('redacts only the notifications sent before the retention window', async () => {
    const now = new Date('2026-10-25T00:00:00Z');
    const repo = new InMemoryEmailNotificationRepository();
    const oldId = await seed(repo, 120, now);
    const recentId = await seed(repo, 10, now);

    expect(await purgeNotificationPersonalData({ repository: repo, retentionDays: 90, now })).toBe(1);

    const old = await repo.findById(oldId);
    const recent = await repo.findById(recentId);
    expect(old?.payload.redactedAt).toBeDefined();
    expect(old?.payload.values).toEqual({});
    expect(old?.status).toBe('sent');
    expect(recent?.payload.redactedAt).toBeUndefined();
    expect(recent?.payload.applicantName).toBe('Ana Clara');
  });

  it('never touches notifications that were not delivered, so they can still be retried', async () => {
    const now = new Date('2026-10-25T00:00:00Z');
    const repo = new InMemoryEmailNotificationRepository();
    const [pending] = await repo.ensureForSubmission({
      submissionId: 'sub_pending',
      snapshot: { ...snapshot, submissionId: 'sub_pending' },
      recipients: [{ audience: 'applicant', email: 'ana@example.com' }],
      availableAt: new Date(now.getTime() - 400 * DAY),
    });

    expect(await purgeNotificationPersonalData({ repository: repo, retentionDays: 90, now })).toBe(0);
    expect((await repo.findById(pending!.id))?.payload.applicantName).toBe('Ana Clara');
  });

  it('is idempotent: an already redacted notification is not processed again', async () => {
    const now = new Date('2026-10-25T00:00:00Z');
    const repo = new InMemoryEmailNotificationRepository();
    await seed(repo, 200, now);

    expect(await purgeNotificationPersonalData({ repository: repo, retentionDays: 90, now })).toBe(1);
    expect(await purgeNotificationPersonalData({ repository: repo, retentionDays: 90, now })).toBe(0);
  });
});

describe('getNotificationRetentionDays', () => {
  const original = process.env.NOTIFICATION_PAYLOAD_RETENTION_DAYS;
  afterEach(() => {
    if (original === undefined) delete process.env.NOTIFICATION_PAYLOAD_RETENTION_DAYS;
    else process.env.NOTIFICATION_PAYLOAD_RETENTION_DAYS = original;
  });

  it('defaults to 90 days and accepts a valid override', () => {
    delete process.env.NOTIFICATION_PAYLOAD_RETENTION_DAYS;
    expect(getNotificationRetentionDays()).toBe(90);
    process.env.NOTIFICATION_PAYLOAD_RETENTION_DAYS = '30';
    expect(getNotificationRetentionDays()).toBe(30);
    process.env.NOTIFICATION_PAYLOAD_RETENTION_DAYS = '0';
    expect(getNotificationRetentionDays()).toBe(90);
    process.env.NOTIFICATION_PAYLOAD_RETENTION_DAYS = 'abc';
    expect(getNotificationRetentionDays()).toBe(90);
  });
});
