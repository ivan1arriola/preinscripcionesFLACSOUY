import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { AdminFailedSubmissionsCard } from './AdminFailedSubmissionsCard.js';
import { apiClient } from '../api/client.js';

vi.mock('../api/client.js', async () => {
  const actual = await vi.importActual<typeof import('../api/client.js')>('../api/client.js');
  return {
    ...actual,
    apiClient: {
      listRecoveries: vi.fn(),
      getRecovery: vi.fn(),
      retryRecovery: vi.fn(),
      discardRecovery: vi.fn(),
    },
  };
});

describe('AdminFailedSubmissionsCard Component', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  const mockRecovery = {
    id: 'rec-1',
    submissionId: 'sub-test-123',
    targetId: 'diplomado-salud-c2',
    targetTitle: 'Diplomado en Salud',
    targetKind: 'diploma',
    stage: 'sheets' as const,
    status: 'failed' as const,
    safeError: 'Google Sheets 503 Backend Error',
    attemptCount: 1,
    lastAttemptAt: '2026-10-05T12:00:00Z',
    retentionExpiresAt: new Date(Date.now() + 6 * 24 * 60 * 60 * 1000).toISOString(),
    resolvedAt: null,
    discardedAt: null,
    discardedBy: null,
    discardReason: null,
    createdAt: '2026-10-05T11:00:00Z',
    updatedAt: '2026-10-05T12:00:00Z',
    filesCount: 2,
  };

  it('renders recoveries table with operational metadata', async () => {
    vi.mocked(apiClient.listRecoveries).mockResolvedValue({
      recoveries: [mockRecovery],
    });

    render(<AdminFailedSubmissionsCard csrfToken="csrf-test-token" />);

    await waitFor(() => {
      expect(screen.getByText('sub-test-123')).toBeInTheDocument();
      expect(screen.getByText('Diplomado en Salud')).toBeInTheDocument();
      expect(screen.getAllByText('Google Sheets').length).toBeGreaterThan(0);
      expect(screen.getByText('● Pendiente')).toBeInTheDocument();
      expect(screen.getByText('Google Sheets 503 Backend Error')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Reintentar' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Detalle' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Descartar' })).toBeInTheDocument();
    });
  });

  it('opens detail drawer and shows document status and missing explanation', async () => {
    vi.mocked(apiClient.listRecoveries).mockResolvedValue({
      recoveries: [mockRecovery],
    });

    vi.mocked(apiClient.getRecovery).mockResolvedValue({
      recovery: {
        ...mockRecovery,
        files: [
          {
            token: 'tok-1',
            fieldKey: 'identityDocument',
            originalName: 'cedula.pdf',
            mimeType: 'application/pdf',
            sizeBytes: 102400,
            driveFileId: 'drive-file-abc',
            uploadedAt: '2026-10-05T11:00:00Z',
            status: 'stored_in_drive',
          },
          {
            token: 'tok-2',
            fieldKey: 'curriculum',
            originalName: 'cv.pdf',
            mimeType: 'application/pdf',
            sizeBytes: 204800,
            uploadedAt: '2026-10-05T11:00:00Z',
            status: 'missing',
          },
        ],
      },
    });

    render(<AdminFailedSubmissionsCard csrfToken="csrf-test-token" />);

    await waitFor(() => {
      expect(screen.getByText('sub-test-123')).toBeInTheDocument();
    });

    // Open detail
    const detailBtn = screen.getByRole('button', { name: /Detalle/i });
    fireEvent.click(detailBtn);

    await waitFor(() => {
      expect(screen.getByText('cedula.pdf')).toBeInTheDocument();
      expect(screen.getByText(/Confirmado en Drive/i)).toBeInTheDocument();
      expect(screen.getByText('cv.pdf')).toBeInTheDocument();
      expect(screen.getByText(/Archivo vencido \/ no disponible/i)).toBeInTheDocument();
      expect(screen.getByText(/El archivo temporal expiró; el postulante debe reenviarlo/i)).toBeInTheDocument();
    });
  });

  it('calls retryRecovery on retry button click', async () => {
    vi.mocked(apiClient.listRecoveries).mockResolvedValue({
      recoveries: [mockRecovery],
    });

    vi.mocked(apiClient.retryRecovery).mockResolvedValue({
      ok: true,
      submissionId: 'sub-test-123',
      message: 'Procesamiento completado correctamente.',
    });

    render(<AdminFailedSubmissionsCard csrfToken="csrf-test-token" />);

    await waitFor(() => {
      expect(screen.getByText('sub-test-123')).toBeInTheDocument();
    });

    const retryBtn = screen.getByRole('button', { name: /Reintentar/i });
    fireEvent.click(retryBtn);

    await waitFor(() => {
      expect(apiClient.retryRecovery).toHaveBeenCalledWith('rec-1', 'csrf-test-token');
      expect(screen.getByText(/Preinscripción reintentada con éxito/i)).toBeInTheDocument();
    });
  });

  it('calls discardRecovery when confirming discard in modal', async () => {
    vi.mocked(apiClient.listRecoveries).mockResolvedValue({
      recoveries: [mockRecovery],
    });

    vi.mocked(apiClient.discardRecovery).mockResolvedValue({
      ok: true,
      message: 'Caso descartado correctamente.',
    });

    render(<AdminFailedSubmissionsCard csrfToken="csrf-test-token" />);

    await waitFor(() => {
      expect(screen.getByText('sub-test-123')).toBeInTheDocument();
    });

    // Click discard
    const discardBtn = screen.getByRole('button', { name: /Descartar/i });
    fireEvent.click(discardBtn);

    // Modal opens
    await waitFor(() => {
      expect(screen.getByText(/¿Descartar incidente de preinscripción\?/i)).toBeInTheDocument();
    });

    const reasonInput = screen.getByPlaceholderText(/Postulante duplicado/i);
    fireEvent.change(reasonInput, { target: { value: 'Postulante duplicado' } });

    const confirmBtn = screen.getByRole('button', { name: /Confirmar descarte definitivo/i });
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(apiClient.discardRecovery).toHaveBeenCalledWith('rec-1', 'csrf-test-token', 'Postulante duplicado');
      expect(screen.getByText('Caso descartado correctamente.')).toBeInTheDocument();
    });
  });
});
