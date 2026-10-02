import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { AdminLoginPage } from './AdminLoginPage.js';
import { AdminDashboardPage } from './AdminDashboardPage.js';
import { apiClient } from '../../api/client.js';

vi.mock('../../api/client.js', async () => {
  const actual = await vi.importActual<typeof import('../../api/client.js')>('../../api/client.js');
  return {
    ...actual,
    apiClient: {
      getAdminToken: vi.fn(),
      setAdminToken: vi.fn(),
      adminLogin: vi.fn(),
      adminLogout: vi.fn(),
      getAdminMe: vi.fn(),
      getAdminTargets: vi.fn(),
      getAdminTargetDiagnostics: vi.fn(),
      getAdminErrors: vi.fn(),
      resolveAdminError: vi.fn(),
      getAdminHealth: vi.fn(),
    },
  };
});

describe('Admin UI Components and Pages', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe('AdminLoginPage', () => {
    it('allows typing credentials and submits successfully', async () => {
      vi.mocked(apiClient.adminLogin).mockResolvedValue({
        token: 'test-token',
        user: { username: 'admin' },
      });
      const onSuccess = vi.fn();

      render(<AdminLoginPage onSuccess={onSuccess} />);

      expect(screen.getByText(/Acceso Administrativo/i)).toBeInTheDocument();

      fireEvent.change(screen.getByLabelText(/Usuario/i), { target: { value: 'admin' } });
      fireEvent.change(screen.getByLabelText(/Contraseña/i), { target: { value: 'flacso2026' } });

      fireEvent.click(screen.getByRole('button', { name: /Iniciar Sesión/i }));

      await waitFor(() => {
        expect(apiClient.adminLogin).toHaveBeenCalledWith('admin', 'flacso2026');
        expect(onSuccess).toHaveBeenCalled();
      });
    });
  });

  describe('AdminDashboardPage', () => {
    const mockHealth = {
      status: 'healthy' as const,
      timestamp: new Date().toISOString(),
      integrations: {
        database: { status: 'healthy' as const, message: 'PostgreSQL 3FN' },
        wordpress: { status: 'healthy' as const, message: 'REST v1 ok' },
        googleSheets: { status: 'healthy' as const, message: 'Google Sheets' },
        googleDrive: { status: 'healthy' as const, message: 'Google Drive' },
      },
    };

    const mockTargets = [
      {
        id: 'davia-c11',
        kind: 'academic_offer' as const,
        title: 'DAVIA Cohorte 11',
        registrationOpen: true,
        configRevision: 'davia-rev-1',
        status: 'operational' as const,
        issues: [],
      },
    ];

    const mockErrors = [
      {
        id: 'err-123',
        severity: 'high' as const,
        origin: 'sheets' as const,
        code: 'MISSING_COLUMNS',
        message: 'Faltan columnas requeridas',
        context: { sheetId: 'sheet-1' },
        status: 'unresolved' as const,
        createdAt: '2026-10-02T10:00:00Z',
      },
    ];

    it('renders dashboard with integrations, targets, and system errors', async () => {
      vi.mocked(apiClient.getAdminHealth).mockResolvedValue(mockHealth);
      vi.mocked(apiClient.getAdminTargets).mockResolvedValue(mockTargets);
      vi.mocked(apiClient.getAdminErrors).mockResolvedValue(mockErrors);
      vi.mocked(apiClient.resolveAdminError).mockResolvedValue({ id: 'err-123', status: 'resolved' });

      render(<AdminDashboardPage onLogout={vi.fn()} />);

      await waitFor(() => {
        expect(screen.getByText('Panel de Diagnóstico y Administración')).toBeInTheDocument();
        expect(screen.getByText('DAVIA Cohorte 11')).toBeInTheDocument();
        expect(screen.getByText('Faltan columnas requeridas')).toBeInTheDocument();
      });

      // Test resolve button
      const resolveBtn = screen.getByRole('button', { name: /Resolver/i });
      fireEvent.click(resolveBtn);

      await waitFor(() => {
        expect(apiClient.resolveAdminError).toHaveBeenCalledWith('err-123');
      });
    });

    it('opens diagnostics modal on clicking Diagnosticar', async () => {
      vi.mocked(apiClient.getAdminHealth).mockResolvedValue(mockHealth);
      vi.mocked(apiClient.getAdminTargets).mockResolvedValue(mockTargets);
      vi.mocked(apiClient.getAdminErrors).mockResolvedValue([]);
      vi.mocked(apiClient.getAdminTargetDiagnostics).mockResolvedValue({
        targetId: 'davia-c11',
        title: 'DAVIA Cohorte 11',
        status: 'healthy',
        wordpress: {
          status: 'ok',
          valid: true,
          issues: [],
          configRevision: 'rev-1',
          registrationOpen: true,
          inputsCount: 10,
        },
        sheets: {
          status: 'ok',
          spreadsheetId: 'sheet-xyz',
          sheetName: 'Respuestas',
          missingColumns: [],
          foundColumns: ['Nombre', 'Email'],
          issues: [],
        },
        drive: {
          status: 'ok',
          targetFolderId: 'folder-1',
          documentsFolderId: 'folder-2',
          issues: [],
        },
        checkedAt: new Date().toISOString(),
      });

      render(<AdminDashboardPage onLogout={vi.fn()} />);

      await waitFor(() => {
        expect(screen.getByText('DAVIA Cohorte 11')).toBeInTheDocument();
      });

      const diagBtn = screen.getByRole('button', { name: /Diagnosticar/i });
      fireEvent.click(diagBtn);

      await waitFor(() => {
        expect(apiClient.getAdminTargetDiagnostics).toHaveBeenCalledWith('davia-c11');
        expect(screen.getByText(/Diagnóstico: Saludable/i)).toBeInTheDocument();
        expect(screen.getByText(/WordPress REST v1/i)).toBeInTheDocument();
      });
    });
  });
});
