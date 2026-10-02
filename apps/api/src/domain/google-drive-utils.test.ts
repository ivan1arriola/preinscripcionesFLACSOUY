import { describe, it, expect } from 'vitest';
import { extractDriveFolderId, isValidDriveFolderId } from './google-drive-utils.js';

describe('extractDriveFolderId', () => {
  it('extracts folder ID from clean ID', () => {
    expect(extractDriveFolderId('1hxhuUoIyoocL-laSfD3A8rgLigUgOH4e')).toBe('1hxhuUoIyoocL-laSfD3A8rgLigUgOH4e');
  });

  it('extracts folder ID from standard Google Drive URL', () => {
    expect(
      extractDriveFolderId('https://drive.google.com/drive/folders/1hxhuUoIyoocL-laSfD3A8rgLigUgOH4e')
    ).toBe('1hxhuUoIyoocL-laSfD3A8rgLigUgOH4e');
  });

  it('extracts folder ID from multi-account Google Drive URL with query params', () => {
    expect(
      extractDriveFolderId('https://drive.google.com/drive/u/3/folders/1hxhuUoIyoocL-laSfD3A8rgLigUgOH4e?usp=sharing')
    ).toBe('1hxhuUoIyoocL-laSfD3A8rgLigUgOH4e');
  });

  it('validates folder ID correctly', () => {
    expect(isValidDriveFolderId('1hxhuUoIyoocL-laSfD3A8rgLigUgOH4e')).toBe(true);
    expect(isValidDriveFolderId('abc')).toBe(false);
    expect(isValidDriveFolderId('invalid characters!@#$')).toBe(false);
  });
});
