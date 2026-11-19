import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
  it('permite agregar y quitar un archivo con estados legibles', async () => {
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
    fireEvent.change(screen.getByLabelText(/Agregar o arrastrar archivos.*Curriculum/i), {
      target: { files: [new File(['x'], 'cv.pdf', { type: 'application/pdf' })] },
    });
    expect(onUpload).toHaveBeenCalledOnce();
    // La carga simulada termina y la fila de «subiendo» desaparece antes de mostrar el archivo ya cargado.
    await waitFor(() => expect(screen.queryByRole('progressbar')).not.toBeInTheDocument());

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

  it('muestra el error del campo sin ocultar la acción', () => {
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

    expect(screen.getByText(/supera el tamaño/i)).toBeInTheDocument();
  });
  it('muestra el avance real de la carga con el nombre del archivo y sin mensajes repetidos', async () => {
    let report: ((percent: number) => void) | undefined;
    let finishUpload: ((token: SubmissionFileToken) => void) | undefined;
    const onUpload = vi.fn((_key: string, _file: File, onProgress?: (percent: number) => void) => {
      report = onProgress;
      return new Promise<SubmissionFileToken>((resolve) => { finishUpload = resolve; });
    });
    const onFileToken = vi.fn();
    render(
      <DocumentUploadCard document={document} files={[]} uploading={false} disabled={false} onUpload={onUpload} onFileToken={onFileToken} onRemove={vi.fn()} />
    );

    fireEvent.change(screen.getByLabelText(/Agregar o arrastrar archivos.*Curriculum/i), {
      target: { files: [new File(['x'.repeat(3000)], 'mi-cv.pdf', { type: 'application/pdf' })] },
    });

    expect(await screen.findByRole('progressbar', { name: 'Progreso de mi-cv.pdf' })).toHaveAttribute('aria-valuenow', '0');
    expect(screen.getByText('mi-cv.pdf')).toBeInTheDocument();
    // Un solo mensaje de carga: ya no se repite «Pendiente de carga» ni «Guardando archivo temporalmente».
    expect(screen.queryByText('Pendiente de carga')).not.toBeInTheDocument();
    expect(screen.queryByText(/temporalmente/i)).not.toBeInTheDocument();
    expect(screen.getByLabelText(/Agregar o arrastrar archivos.*Curriculum/i)).toBeDisabled();

    act(() => report?.(45));
    await waitFor(() => expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '45'));
    expect(screen.getByText(/Guardando archivo… 45 %/)).toHaveTextContent(/PDF · 3 KB/);
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuetext', expect.stringContaining('45 %'));

    finishUpload?.(file);
    await waitFor(() => expect(onFileToken).toHaveBeenCalledWith(file));
    await waitFor(() => expect(screen.queryByRole('progressbar')).not.toBeInTheDocument());
    expect(screen.getByLabelText(/Agregar o arrastrar archivos.*Curriculum/i)).toBeEnabled();
  });

  it('si la carga falla, vuelve al estado anterior y deja el error visible', async () => {
    const onUpload = vi.fn().mockRejectedValue(new Error('El archivo supera el tamaño permitido.'));
    const onError = vi.fn();
    render(
      <DocumentUploadCard document={document} files={[]} uploading={false} disabled={false} onUpload={onUpload} onFileToken={vi.fn()} onRemove={vi.fn()} onError={onError} />
    );

    fireEvent.change(screen.getByLabelText(/Agregar o arrastrar archivos.*Curriculum/i), {
      target: { files: [new File(['x'], 'grande.pdf', { type: 'application/pdf' })] },
    });

    await waitFor(() => expect(onError).toHaveBeenCalledWith('El archivo supera el tamaño permitido.'));
    expect(await screen.findByRole('button', { name: /Reanudar carga/i })).toBeEnabled();
    expect(screen.getByText(/interrumpida/i)).toBeInTheDocument();
    expect(screen.getAllByText('El archivo supera el tamaño permitido.')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Quitar' }));
    expect(screen.queryByText(/interrumpida/i)).not.toBeInTheDocument();
  });

  it('da feedback antes de soltar y marca un tipo no admitido con texto', () => {
    render(<DocumentUploadCard document={document} files={[]} uploading={false} disabled={false} onUpload={vi.fn()} onFileToken={vi.fn()} onRemove={vi.fn()} />);
    const zone = screen.getByText(/Agregar o arrastrar archivos/i);
    fireEvent.dragEnter(zone, { dataTransfer: { items: [{ kind: 'file', type: 'image/png' }], dropEffect: 'none' } });
    expect(screen.getByText(/Ese tipo de archivo no está admitido/i)).toBeInTheDocument();
    expect(screen.getByText(/tipo de archivo arrastrado no está admitido/i)).toBeInTheDocument();
  });

  it('mantiene progreso y reintento independientes para dos archivos', async () => {
    const reports: Array<(percent: number) => void> = [];
    const onUpload = vi.fn((_key, _file, report) => {
      reports.push(report!);
      return reports.length === 1 ? Promise.reject(new Error('Corte de red')) : new Promise<SubmissionFileToken>(() => {});
    });
    render(<DocumentUploadCard document={{ ...document, maxFiles: 2 }} files={[]} uploading={false} disabled={false} onUpload={onUpload} onFileToken={vi.fn()} onRemove={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(/Agregar o arrastrar archivos.*Curriculum/i), {
      target: { files: [new File(['a'], 'uno.pdf', { type: 'application/pdf' }), new File(['b'], 'dos.pdf', { type: 'application/pdf' })] },
    });
    expect(await screen.findByRole('button', { name: /Reanudar carga/i })).toBeEnabled();
    act(() => reports[1]?.(60));
    await waitFor(() => expect(screen.getAllByRole('progressbar').some((bar) => bar.getAttribute('aria-valuenow') === '60')).toBe(true));
  });
});
