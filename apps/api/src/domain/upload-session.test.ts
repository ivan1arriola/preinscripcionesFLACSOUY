import { describe, it, expect } from 'vitest';
import {
  isSessionExpired,
  validateFileUpload,
  touchSession,
  addFileToSession,
  removeFileFromSession,
  type UploadSession,
  type UploadedFileInfo,
  MAX_FILE_SIZE_BYTES,
} from './upload-session.js';

describe('UploadSession Domain Rules (Pure Functions)', () => {
  const baseTime = new Date('2026-10-02T10:00:00Z');

  const createDummySession = (lastActivity = baseTime): UploadSession => ({
    id: 'sess_1234567890abcdef',
    createdAt: baseTime,
    lastActivityAt: lastActivity,
    files: [],
  });

  it('determines session expiration based on 30 minutes of inactivity', () => {
    const session = createDummySession();

    // 29 minutes later: not expired
    const time29m = new Date(baseTime.getTime() + 29 * 60 * 1000);
    expect(isSessionExpired(session, time29m)).toBe(false);

    // 30 minutes later: expired
    const time30m = new Date(baseTime.getTime() + 30 * 60 * 1000);
    expect(isSessionExpired(session, time30m)).toBe(true);

    // 31 minutes later: expired
    const time31m = new Date(baseTime.getTime() + 31 * 60 * 1000);
    expect(isSessionExpired(session, time31m)).toBe(true);
  });

  it('updates last activity when session is touched', () => {
    const session = createDummySession();
    const touchTime = new Date(baseTime.getTime() + 15 * 60 * 1000);

    const touched = touchSession(session, touchTime);
    expect(touched.lastActivityAt).toEqual(touchTime);

    // 25 minutes after touch (40 min after creation): still not expired because activity was renewed
    const time40m = new Date(baseTime.getTime() + 40 * 60 * 1000);
    expect(isSessionExpired(touched, time40m)).toBe(false);
  });

  it('validates allowed MIME types and file sizes', () => {
    // Valid PDF
    expect(
      validateFileUpload({
        originalName: 'titulo.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 2 * 1024 * 1024,
      })
    ).toEqual({ valid: true });

    // Valid JPG and PNG
    expect(
      validateFileUpload({
        originalName: 'cedula.jpg',
        mimeType: 'image/jpeg',
        sizeBytes: 1 * 1024 * 1024,
      })
    ).toEqual({ valid: true });
    expect(
      validateFileUpload({
        originalName: 'cedula.png',
        mimeType: 'image/png',
        sizeBytes: 1 * 1024 * 1024,
      })
    ).toEqual({ valid: true });

    // Exceeds max file size
    const oversized = validateFileUpload({
      originalName: 'big.pdf',
      mimeType: 'application/pdf',
      sizeBytes: MAX_FILE_SIZE_BYTES + 1,
    });
    expect(oversized.valid).toBe(false);
    expect(oversized.error).toContain('tamaño');

    // Disallowed MIME type (e.g. executable or zip)
    const invalidType = validateFileUpload({
      originalName: 'document.zip',
      mimeType: 'application/zip',
      sizeBytes: 500,
    });
    expect(invalidType.valid).toBe(false);
    expect(invalidType.error).toContain('tipo de archivo');
  });

  it('adds and removes files within session and updates activity timestamp', () => {
    const session = createDummySession();
    const fileTime = new Date(baseTime.getTime() + 5 * 60 * 1000);

    const file1: UploadedFileInfo = {
      id: 'file_aaa',
      originalName: 'cedula.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 1024,
      uploadedAt: fileTime,
    };

    const sessionWithFile = addFileToSession(session, file1, fileTime);
    expect(sessionWithFile.files).toHaveLength(1);
    expect(sessionWithFile.files[0]!.id).toBe('file_aaa');
    expect(sessionWithFile.lastActivityAt).toEqual(fileTime);

    const removeTime = new Date(baseTime.getTime() + 10 * 60 * 1000);
    const sessionAfterRemove = removeFileFromSession(sessionWithFile, 'file_aaa', removeTime);
    expect(sessionAfterRemove.files).toHaveLength(0);
    expect(sessionAfterRemove.lastActivityAt).toEqual(removeTime);
  });
});
