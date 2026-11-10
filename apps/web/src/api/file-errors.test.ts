import { describe, expect, it } from 'vitest';
import type { SubmissionFileToken } from '@flacso/contracts';
import { ApiError } from './client.js';
import { EXPIRED_FILE_MESSAGE, expiredFileFields, withoutExpiredFiles } from './file-errors.js';

const file = (token: string, fieldKey: string): SubmissionFileToken => ({
  token, fieldKey, originalName: `${token}.pdf`, size: 3, mimeType: 'application/pdf',
});

describe('expiredFileFields', () => {
  it('devuelve los campos informados por el servidor cuando venció algún archivo', () => {
    const error = new ApiError(400, 'FILE_EXPIRED', 'vencieron', undefined, undefined, 'cv', undefined, undefined, ['cv', 'titulo']);
    expect(expiredFileFields(error)).toEqual(['cv', 'titulo']);
  });

  it('usa el campo único si el servidor no mandó la lista (versión anterior de la API)', () => {
    const error = new ApiError(400, 'FILE_EXPIRED', 'venció', undefined, undefined, 'cv');
    expect(expiredFileFields(error)).toEqual(['cv']);
  });

  it('ignora cualquier otro error', () => {
    expect(expiredFileFields(new ApiError(400, 'INVALID_FILE', 'otro campo', undefined, undefined, 'cv'))).toEqual([]);
    expect(expiredFileFields(new Error('red'))).toEqual([]);
    expect(expiredFileFields(undefined)).toEqual([]);
  });
});

describe('withoutExpiredFiles', () => {
  it('quita de la pantalla solo los archivos de los campos vencidos', () => {
    const files = [file('a', 'identidad'), file('b', 'cv'), file('c', 'titulo'), file('d', 'titulo')];
    expect(withoutExpiredFiles(files, ['cv', 'titulo']).map((f) => f.token)).toEqual(['a']);
  });

  it('devuelve la misma lista si no hay campos vencidos', () => {
    const files = [file('a', 'identidad')];
    expect(withoutExpiredFiles(files, [])).toBe(files);
  });
});

describe('EXPIRED_FILE_MESSAGE', () => {
  it('le dice a la persona qué hacer', () => {
    expect(EXPIRED_FILE_MESSAGE).toMatch(/venció/i);
    expect(EXPIRED_FILE_MESSAGE).toMatch(/cargarlo/i);
  });
});
