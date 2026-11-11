import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { DocumentDefinition, SubmissionFileToken } from '@flacso/contracts';
import { DocumentUploadCard } from './DocumentUploadCard.js';
import { TitleDocumentFields } from './TitleDocumentFields.js';

vi.mock('../api/client.js', () => ({
  apiClient: { removeUpload: vi.fn().mockResolvedValue(undefined) },
}));

const TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];

const document = (maxFiles: number): DocumentDefinition => ({
  key: 'cv', label: 'Curriculum Vitae', required: true, canDefer: false,
  maxFiles, maxBytes: 10 * 1024 * 1024, acceptedMimeTypes: TYPES,
});

const tituloDocument = (maxFiles: number): DocumentDefinition => ({
  key: 'titulo', label: 'Título de grado o terciario', required: true, canDefer: false,
  maxFiles, maxBytes: 10 * 1024 * 1024, acceptedMimeTypes: TYPES, companionInputKey: 'tituloDenominacion',
  alternative: { kind: 'absence', valueKey: 'sinTituloActual', activeValue: 'Si', label: 'No poseo actualmente título' },
});

const file = (token: string, fieldKey: string): SubmissionFileToken => ({
  token, fieldKey, originalName: `${token}.pdf`, size: 3, mimeType: 'application/pdf',
});

function card(maxFiles: number, files: SubmissionFileToken[]) {
  render(
    <DocumentUploadCard
      document={document(maxFiles)}
      files={files}
      uploading={false}
      disabled={false}
      onUpload={vi.fn()}
      onFileToken={vi.fn()}
      onRemove={vi.fn()}
    />,
  );
  return screen.getByLabelText(/Agregar archivo.*Curriculum/i);
}

describe('Tarjeta de documento con hasta 2 archivos', () => {
  it('explica que se pueden subir hasta 2 archivos y combinar PDF con imágenes', () => {
    card(2, []);
    expect(screen.getByText(/hasta 2 archivos/i)).toBeInTheDocument();
    expect(screen.getByText(/PDF e imágenes/i)).toBeInTheDocument();
  });

  it('con un archivo cargado todavía deja agregar el segundo y muestra cuántos hay', () => {
    const input = card(2, [file('a', 'cv')]);
    expect(input).toBeEnabled();
    expect(screen.getByText(/1 de 2 archivos/i)).toBeInTheDocument();
  });

  it('con los 2 archivos cargados bloquea el agregado y lo explica', () => {
    const input = card(2, [file('a', 'cv'), file('b', 'cv')]);
    expect(input).toBeDisabled();
    expect(screen.getByText(/máximo de 2 archivos/i)).toBeInTheDocument();
  });

  it('un documento de un solo archivo no habla de varios y se bloquea con el primero', () => {
    const input = card(1, [file('a', 'cv')]);
    expect(input).toBeDisabled();
    expect(screen.queryByText(/hasta 1 archivos/i)).not.toBeInTheDocument();
  });
});

function title(maxFiles: number, files: SubmissionFileToken[]) {
  render(
    <TitleDocumentFields
      document={tituloDocument(maxFiles)}
      values={{}}
      errors={{}}
      files={files}
      disabled={false}
      onChange={vi.fn()}
      onUpload={vi.fn()}
      onFileToken={vi.fn()}
      onRemoveToken={vi.fn()}
    />,
  );
  return screen.getByLabelText(/Archivo del título/i);
}

describe('Título con hasta 2 archivos', () => {
  it('permite adjuntar hasta 2 archivos y lo avisa', () => {
    const input = title(2, []);
    expect(input).toBeEnabled();
    expect(screen.getByText(/hasta 2 archivos/i)).toBeInTheDocument();
  });

  it('con un archivo permite agregar otro y cuenta cuántos hay', () => {
    const input = title(2, [file('a', 'titulo')]);
    expect(input).toBeEnabled();
    expect(screen.getByText(/1 de 2 archivos/i)).toBeInTheDocument();
  });

  it('con 2 archivos bloquea el agregado', () => {
    const input = title(2, [file('a', 'titulo'), file('b', 'titulo')]);
    expect(input).toBeDisabled();
    expect(screen.getByText(/2 de 2 archivos/i)).toBeInTheDocument();
  });
});
