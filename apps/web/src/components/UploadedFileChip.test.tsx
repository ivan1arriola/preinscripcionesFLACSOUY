import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { SubmissionFileToken } from '@flacso/contracts';
import { UploadedFileChip } from './UploadedFileChip.js';
import { forgetPreview, getPreview, previewKind, rememberPreview } from '../domain/file-previews.js';

const image: SubmissionFileToken = { token: 'tok-img', fieldKey: 'identidad', originalName: 'cedula.jpg', size: 2_500_000, mimeType: 'image/jpeg' };
const pdf: SubmissionFileToken = { token: 'tok-pdf', fieldKey: 'cv', originalName: 'cv.pdf', size: 48_213, mimeType: 'application/pdf' };

describe('UploadedFileChip', () => {
  const createObjectURL = vi.fn((file: Blob) => `blob:local/${(file as File).name}`);
  const revokeObjectURL = vi.fn();

  beforeEach(() => {
    URL.createObjectURL = createObjectURL as unknown as typeof URL.createObjectURL;
    URL.revokeObjectURL = revokeObjectURL;
  });

  afterEach(() => {
    forgetPreview(image.token);
    forgetPreview(pdf.token);
    createObjectURL.mockClear();
    revokeObjectURL.mockClear();
  });

  it('shows the name, the size and a thumbnail of an image', () => {
    rememberPreview(image.token, new File(['x'], 'cedula.jpg', { type: 'image/jpeg' }));
    const { container } = render(<ul><UploadedFileChip file={image} disabled={false} onRemove={vi.fn()} /></ul>);

    expect(screen.getByText('cedula.jpg')).toBeInTheDocument();
    expect(screen.getByText('2.4 MB')).toBeInTheDocument();
    expect(container.querySelector('img.file-chip__img')).toHaveAttribute('src', 'blob:local/cedula.jpg');
  });

  it('opens the full preview of an image and closes it with Escape', () => {
    rememberPreview(image.token, new File(['x'], 'cedula.jpg', { type: 'image/jpeg' }));
    render(<ul><UploadedFileChip file={image} disabled={false} onRemove={vi.fn()} /></ul>);

    fireEvent.click(screen.getByRole('button', { name: 'Ver cedula.jpg' }));
    const dialog = screen.getByRole('dialog', { name: /Vista previa de cedula\.jpg/ });
    expect(dialog.querySelector('img')).toHaveAttribute('src', 'blob:local/cedula.jpg');
    expect(screen.getByRole('link', { name: /Abrir en otra pestaña/ })).toHaveAttribute('href', 'blob:local/cedula.jpg');

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('shows a PDF in the dialog with an embedded viewer, and a PDF label as thumbnail when it cannot be drawn', () => {
    rememberPreview(pdf.token, new File(['%PDF-1.4'], 'cv.pdf', { type: 'application/pdf' }));
    render(<ul><UploadedFileChip file={pdf} disabled={false} onRemove={vi.fn()} /></ul>);

    fireEvent.click(screen.getByRole('button', { name: 'Ver cv.pdf' }));
    expect(screen.getByTitle('Vista previa de cv.pdf')).toHaveAttribute('src', 'blob:local/cv.pdf');
  });

  it('removes the file and frees the local copy', () => {
    const onRemove = vi.fn();
    rememberPreview(image.token, new File(['x'], 'cedula.jpg', { type: 'image/jpeg' }));
    render(<ul><UploadedFileChip file={image} disabled={false} onRemove={onRemove} removeLabel="Quitar cedula.jpg" /></ul>);

    fireEvent.click(screen.getByRole('button', { name: 'Quitar cedula.jpg' }));
    expect(onRemove).toHaveBeenCalledWith(image);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:local/cedula.jpg');
    expect(getPreview(image.token)).toBeUndefined();
  });

  it('still lists the file, without preview buttons, when no local copy is available', () => {
    render(<ul><UploadedFileChip file={pdf} disabled={false} onRemove={vi.fn()} /></ul>);
    expect(screen.getByText('cv.pdf')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Ver/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Quitar' })).toBeEnabled();
  });

  it('does not allow removing while the form is disabled', () => {
    render(<ul><UploadedFileChip file={pdf} disabled onRemove={vi.fn()} /></ul>);
    expect(screen.getByRole('button', { name: 'Quitar' })).toBeDisabled();
  });
});

describe('previewKind', () => {
  it('tells images, PDFs and other files apart', () => {
    expect(previewKind('image/png')).toBe('image');
    expect(previewKind('application/pdf')).toBe('pdf');
    expect(previewKind('', 'CV.PDF')).toBe('pdf');
    expect(previewKind('text/plain', 'a.txt')).toBe('other');
  });
});
