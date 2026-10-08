import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { AdminProfilesPage } from './AdminProfilesPage.js';
import { apiClient, ApiError } from '../api/client.js';

vi.mock('../api/client.js', async () => {
  const actual = await vi.importActual<typeof import('../api/client.js')>('../api/client.js');
  return {
    ...actual,
    apiClient: {
      getAdminMe: vi.fn(),
      adminLogout: vi.fn(),
      getAdminSettings: vi.fn().mockResolvedValue({
        googleDriveFolderId: 'folder-1',
        googleDriveFolderName: 'Preinscripciones',
        googleDriveCanAddChildren: true,
        serviceAccountEmail: 'pre@flacso.iam.gserviceaccount.com',
        updatedAt: null,
        updatedBy: null,
      }),
      getAdminSpreadsheets: vi.fn().mockResolvedValue({ targets: [] }),
      getAdminEmailSettings: vi.fn().mockResolvedValue({
        enabled: true,
        configured: true,
        provider: 'smtp',
        smtp: { host: 'smtp.flacso.edu.uy', port: 587, security: 'starttls', username: 'pre@flacso.edu.uy', hasPassword: true, fromEmail: 'pr***s@flacso.edu.uy', replyToEmail: null },
        masterEmails: [],
        status: { lastConnectionTestAt: null, lastConnectionTestOk: null, lastConnectionTestError: null },
      }),
      getAdminNotifications: vi.fn().mockResolvedValue({
        ok: true,
        counts: { pending: 0, processing: 0, sent: 0, failed: 0, unknown: 0, total: 0 },
        notifications: [],
      }),
      getTelegramSettings: vi.fn().mockResolvedValue({
        telegram: {
          enabled: false,
          hasToken: false,
          chatIdsCount: 0,
          maskedChatIds: [],
          lastTestedAt: null,
          lastTestStatus: null,
          lastTestError: null,
        },
      }),
      listRecoveries: vi.fn().mockResolvedValue({
        recoveries: [],
      }),
    },
  };
});

describe('AdminProfilesPage Component', () => {
  const mockAdminUser = {
    email: 'web@flacso.edu.uy',
    name: 'Webmaster FLACSO',
    role: 'admin',
  };

  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(apiClient.getAdminSettings).mockResolvedValue({
      googleDriveFolderId: 'folder-1',
      googleDriveFolderName: 'Preinscripciones',
      googleDriveCanAddChildren: true,
      serviceAccountEmail: 'pre@flacso.iam.gserviceaccount.com',
      updatedAt: null,
      updatedBy: null,
    });
    vi.mocked(apiClient.getAdminSpreadsheets).mockResolvedValue({ targets: [] });
    vi.mocked(apiClient.getAdminEmailSettings).mockResolvedValue({
      enabled: true,
      configured: true,
      provider: 'smtp',
      smtp: { host: 'smtp.flacso.edu.uy', port: 587, security: 'starttls', username: 'pre@flacso.edu.uy', hasPassword: true, fromEmail: 'pr***s@flacso.edu.uy', replyToEmail: null },
      masterEmails: [],
      status: { lastConnectionTestAt: null, lastConnectionTestOk: null, lastConnectionTestError: null },
    });
    vi.mocked(apiClient.getAdminNotifications).mockResolvedValue({
      ok: true,
      counts: { pending: 0, processing: 0, sent: 0, failed: 0, unknown: 0, total: 0 },
      notifications: [],
    });
    vi.mocked(apiClient.getTelegramSettings).mockResolvedValue({
      telegram: {
        enabled: false,
        preinscriptionEnabled: false,
        hasToken: false,
        chatIdsCount: 0,
        maskedChatIds: [],
        lastTestedAt: null,
        lastTestStatus: null,
        lastTestError: null,
      },
    });
    vi.mocked(apiClient.listRecoveries).mockResolvedValue({
      recoveries: [],
    });
  });

  it('triggers onRequireLogin when user is not authenticated (401)', async () => {
    const handleRequireLogin = vi.fn();
    vi.mocked(apiClient.getAdminMe).mockRejectedValue(new ApiError(401, 'UNAUTHORIZED', 'No autenticado'));

    render(<AdminProfilesPage onRequireLogin={handleRequireLogin} onLogout={vi.fn()} />);

    await waitFor(() => {
      expect(handleRequireLogin).toHaveBeenCalledTimes(1);
    });
  });

  it('renders canonical form info when authenticated', async () => {
    vi.mocked(apiClient.getAdminMe).mockResolvedValue({ user: mockAdminUser, csrfToken: 'csrf-123' });

    render(<AdminProfilesPage onRequireLogin={vi.fn()} onLogout={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText('Administración de Preinscripciones')).toBeInTheDocument();
      expect(screen.getByText('web@flacso.edu.uy')).toBeInTheDocument();
      expect(screen.getByText(/Formularios Canónicos Activos/i)).toBeInTheDocument();
      expect(screen.getByText(/canonical-v1/i)).toBeInTheDocument();
      expect(screen.getByText(/5 pasos/i)).toBeInTheDocument();
    });
  });

  it('exposes a responsive tab grid without losing section navigation', async () => {
    vi.mocked(apiClient.getAdminMe).mockResolvedValue({ user: mockAdminUser, csrfToken: 'csrf-123' });
    const { container } = render(<AdminProfilesPage onRequireLogin={vi.fn()} onLogout={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('Administración de Preinscripciones')).toBeInTheDocument());

    const navigation = screen.getByRole('tablist', { name: 'Secciones de administración' });
    expect(navigation).toHaveClass('admin-section-tabs');
    expect(screen.getAllByRole('tab')).toHaveLength(5);
    expect(screen.getAllByRole('tab').every((tab) => tab.classList.contains('admin-section-tab'))).toBe(true);
    expect(container.querySelector('.admin-section-content')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: /Recuperación y Alertas/i }));
    expect(await screen.findByText(/Bandeja de Recuperación de Preinscripciones/i)).toBeInTheDocument();
  });

  it('switches between sections for Drive and Spreadsheets', async () => {
    vi.mocked(apiClient.getAdminMe).mockResolvedValue({ user: mockAdminUser, csrfToken: 'csrf-123' });

    render(<AdminProfilesPage onRequireLogin={vi.fn()} onLogout={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText(/Formularios Canónicos Activos/i)).toBeInTheDocument();
    });

    // Switch to Drive section
    const driveTab = screen.getByRole('tab', { name: /Almacenamiento Google Drive/i });
    fireEvent.click(driveTab);

    // Switch to Spreadsheets section
    const sheetsTab = screen.getByRole('tab', { name: /Planillas por oferta/i });
    fireEvent.click(sheetsTab);

    // Switch to Notifications section
    const notifsTab = screen.getByRole('tab', { name: /Notificaciones SMTP/i });
    fireEvent.click(notifsTab);

    // Switch to Recovery section
    const recoveryTab = screen.getByRole('tab', { name: /Recuperación y Alertas/i });
    fireEvent.click(recoveryTab);

    await waitFor(() => {
      expect(screen.getByText(/Bandeja de Recuperación de Preinscripciones/i)).toBeInTheDocument();
      expect(screen.getByText(/Alertas de Incidentes por Telegram/i)).toBeInTheDocument();
    });

    // Switch back to Canonical Profiles section
    const profilesTab = screen.getByRole('tab', { name: /Formularios Canónicos/i });
    fireEvent.click(profilesTab);

    expect(screen.getByText(/Formularios Canónicos Activos/i)).toBeInTheDocument();
  });
});
