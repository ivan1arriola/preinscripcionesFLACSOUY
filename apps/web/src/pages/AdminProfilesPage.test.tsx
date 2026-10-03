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
      getDriveStatus: vi.fn().mockResolvedValue({ operational: true, activeFolderId: 'folder-1' }),
      getTargetSpreadsheetStatus: vi.fn().mockResolvedValue({ totalTargets: 0, configuredTargets: 0, items: [] }),
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

    // Switch back to Canonical Profiles section
    const profilesTab = screen.getByRole('tab', { name: /Formularios Canónicos/i });
    fireEvent.click(profilesTab);

    expect(screen.getByText(/Formularios Canónicos Activos/i)).toBeInTheDocument();
  });
});
