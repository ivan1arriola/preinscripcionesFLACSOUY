import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { DocumentDefinition, SubmissionFileToken } from '@flacso/contracts';
import { DocumentUploadCard } from './DocumentUploadCard.js';

const document: DocumentDefinition = {
  key: 'cv',
  label: 'Curriculum Vitae',
  required: true,
  acceptedMimeTypes: ['application/pdf'],
};

const file: SubmissionFileToken = {
  token: 'token-cv',
  fieldKey: 'cv',
  originalName: 'cv.pdf',
  size: 2048,
  mimeType: 'application/pdf',
};

describe('DocumentUploadCard', () => {
  it('permite agregar y quitar un archivo con estados legibles', () => {
    const onUpload = vi.fn().mockResolvedValue(file);
    const onFileToken = vi.fn();
    const onRemove = vi.fn();

    const { rerender } = render(
      <DocumentUploadCard
        document={document}
        files={[]}
        uploading={false}
        error={undefined}
        disabled={false}
        onUpload={onUpload}
        onFileToken={onFileToken}
        onRemove={onRemove}
      />
    );

    expect(screen.getByText('Pendiente de carga')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Agregar archivo.*Curriculum/i), {
      target: { files: [new File(['x'], 'cv.pdf', { type: 'application/pdf' })] },
    });
    expect(onUpload).toHaveBeenCalledOnce();

    rerender(
      <DocumentUploadCard
        document={document}
        files={[file]}
        uploading={false}
        error={undefined}
        disabled={false}
        onUpload={onUpload}
        onFileToken={onFileToken}
        onRemove={onRemove}
      />
    );
    expect(screen.getByText('cv.pdf')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Quitar cv\.pdf/i }));
    expect(onRemove).toHaveBeenCalledWith(file);
  });

  it('muestra carga y error sin ocultar la acción', () => {
    render(
      <DocumentUploadCard
        document={document}
        files={[]}
        uploading
        error="El archivo supera el tamaño permitido."
        disabled={false}
        onUpload={vi.fn()}
        onFileToken={vi.fn()}
        onRemove={vi.fn()}
      />
    );

    expect(screen.getByRole('status')).toHaveTextContent(/Guardando archivo/i);
    expect(screen.getByText(/supera el tamaño/i)).toBeInTheDocument();
  });
});
