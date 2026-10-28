import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { getCanonicalFormDefinition } from '@flacso/contracts';
import type { AcademicTarget, SubmissionFileToken } from '@flacso/contracts';
import { PreinscriptionSummary } from './PreinscriptionSummary.js';
import { forgetPreview, rememberPreview } from '../domain/file-previews.js';

const target: AcademicTarget = {
  id: 'davia',
  kind: 'academic_offer',
  title: 'DAVIA',
  offerType: 'diploma',
  registrationOpen: true,
  configRevision: 'rev',
  orientations: [],
  mentions: [],
};

const identity: SubmissionFileToken = { token: 'tok-dni', fieldKey: 'identidad', originalName: 'dni.jpg', size: 204_800, mimeType: 'image/jpeg' };
const cv: SubmissionFileToken = { token: 'tok-cv', fieldKey: 'cv', originalName: 'cv.pdf', size: 51_200, mimeType: 'application/pdf' };

describe('PreinscriptionSummary file previews', () => {
  beforeEach(() => {
    URL.createObjectURL = vi.fn((file: Blob) => `blob:local/${(file as File).name}`) as unknown as typeof URL.createObjectURL;
    URL.revokeObjectURL = vi.fn();
  });
  afterEach(() => {
    forgetPreview(identity.token);
    forgetPreview(cv.token);
  });

  it('shows each uploaded document with a thumbnail and a view button, but without a remove button', () => {
    const result = getCanonicalFormDefinition(target);
    if (!result.ok) throw new Error(result.error.message);
    rememberPreview(identity.token, new File(['x'], 'dni.jpg', { type: 'image/jpeg' }));
    rememberPreview(cv.token, new File(['%PDF-1.4'], 'cv.pdf', { type: 'application/pdf' }));

    const { container } = render(
      <PreinscriptionSummary form={result.value} values={{}} files={[identity, cv]} onEditStep={vi.fn()} onConfirm={vi.fn()} disabled={false} />
    );

    expect(screen.getByText('dni.jpg')).toBeInTheDocument();
    expect(screen.getByText('200 KB')).toBeInTheDocument();
    expect(container.querySelector('img.file-chip__img')).toHaveAttribute('src', 'blob:local/dni.jpg');
    expect(screen.queryByRole('button', { name: /Quitar/ })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Ver dni.jpg' }));
    expect(screen.getByRole('dialog', { name: /Vista previa de dni\.jpg/ })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
