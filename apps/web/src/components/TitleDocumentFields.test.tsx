import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { TitleDocumentFields } from './TitleDocumentFields.js';
import type { DocumentDefinition, SubmissionFileToken } from '@flacso/contracts';
import { apiClient } from '../api/client.js';

vi.mock('../api/client.js', () => ({
  apiClient: {
    removeUpload: vi.fn().mockResolvedValue(undefined),
  },
}));

describe('TitleDocumentFields Component', () => {
  const tituloDoc: DocumentDefinition = {
    key: 'titulo',
    label: 'Título de grado o terciario',
    required: true,
    canDefer: false,
    maxFiles: 1,
    maxBytes: 10 * 1024 * 1024,
    acceptedMimeTypes: ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'],
    companionInputKey: 'tituloDenominacion',
    alternative: {
      kind: 'absence',
      valueKey: 'sinTituloActual',
      activeValue: 'Si',
      label: 'No poseo actualmente título',
    },
  };

  it('renders title denomination, file input, and absence checkbox together', () => {
    render(
      <TitleDocumentFields
        document={tituloDoc}
        values={{}}
        errors={{}}
        files={[]}
        disabled={false}
        onChange={vi.fn()}
        onUpload={vi.fn()}
        onFileToken={vi.fn()}
        onRemoveToken={vi.fn()}
      />
    );

    expect(screen.getByLabelText(/Denominación del título/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Archivo del título/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/No poseo actualmente título/i)).toBeInTheDocument();
  });

  it('rendersReversibleTitleAbsenceToggle: marking absence hides inputs, cleans values, and calls removeUpload', async () => {
    const onChange = vi.fn();
    const onRemoveToken = vi.fn();
    const uploadedFile: SubmissionFileToken = {
      token: 'tok-tit-123',
      fieldKey: 'titulo',
      originalName: 'titulo.pdf',
      size: 1024,
      mimeType: 'application/pdf',
    };

    const { rerender } = render(
      <TitleDocumentFields
        document={tituloDoc}
        values={{ sinTituloActual: 'No', tituloDenominacion: 'Licenciada' }}
        errors={{}}
        files={[uploadedFile]}
        disabled={false}
        onChange={onChange}
        onUpload={vi.fn()}
        onFileToken={vi.fn()}
        onRemoveToken={onRemoveToken}
      />
    );

    const checkbox = screen.getByLabelText(/No poseo actualmente título/i);
    expect(checkbox).not.toBeChecked();
    expect(screen.getByLabelText(/Denominación del título/i)).toBeInTheDocument();

    // Check "No poseo actualmente título"
    fireEvent.click(checkbox);

    expect(onChange).toHaveBeenCalledWith('sinTituloActual', 'Si');
    expect(onChange).toHaveBeenCalledWith('tituloDenominacion', '');
    await waitFor(() => {
      expect(apiClient.removeUpload).toHaveBeenCalledWith('tok-tit-123');
      expect(onRemoveToken).toHaveBeenCalledWith(uploadedFile);
    });

    // Rerender with sinTituloActual: 'Si' and no files
    rerender(
      <TitleDocumentFields
        document={tituloDoc}
        values={{ sinTituloActual: 'Si', tituloDenominacion: '' }}
        errors={{}}
        files={[]}
        disabled={false}
        onChange={onChange}
        onUpload={vi.fn()}
        onFileToken={vi.fn()}
        onRemoveToken={onRemoveToken}
      />
    );

    expect(screen.queryByLabelText(/Denominación del título/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Archivo del título/i)).not.toBeInTheDocument();

    // Uncheck absence: restores inputs
    const checkedBox = screen.getByLabelText(/No poseo actualmente título/i);
    fireEvent.click(checkedBox);

    expect(onChange).toHaveBeenCalledWith('sinTituloActual', 'No');
  });
});
