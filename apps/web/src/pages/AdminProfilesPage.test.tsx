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
      listAdminProfiles: vi.fn(),
      getAdminProfile: vi.fn(),
      createProfileVersion: vi.fn(),
      activateProfileVersion: vi.fn(),
      adminLogout: vi.fn(),
    },
  };
});

describe('AdminProfilesPage Component', () => {
  const mockAdminUser = {
    email: 'web@flacso.edu.uy',
    name: 'Webmaster FLACSO',
    role: 'admin',
  };

  const mockProfiles = [
    { id: 'profile_diploma', type: 'diploma', name: 'Diploma', activeVersionId: 'ver_diploma_v1' },
    { id: 'profile_maestria', type: 'maestria', name: 'Maestría', activeVersionId: 'ver_maestria_v1' },
    { id: 'profile_seminar', type: 'seminar', name: 'Seminario', activeVersionId: 'ver_seminar_v1' },
  ];

  const mockDiplomaDetail = {
    profile: { id: 'profile_diploma', type: 'diploma', name: 'Diploma', activeVersionId: 'ver_diploma_v1' },
    activeVersion: {
      id: 'ver_diploma_v1',
      versionNumber: 1,
      definition: {
        steps: [{ id: 'personal', title: 'Personal', order: 1 }],
        fields: [],
        documents: [],
      },
    },
    versions: [
      {
        id: 'ver_diploma_v1',
        versionNumber: 1,
        createdBy: 'web@flacso.edu.uy',
        definition: {
          steps: [{ id: 'personal', title: 'Personal', order: 1 }],
          fields: [],
          documents: [],
        },
      },
    ],
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

  it('renders admin profile tabs and profile details when authenticated', async () => {
    vi.mocked(apiClient.getAdminMe).mockResolvedValue({ user: mockAdminUser, csrfToken: 'csrf-123' });
    vi.mocked(apiClient.listAdminProfiles).mockResolvedValue(mockProfiles);
    vi.mocked(apiClient.getAdminProfile).mockResolvedValue(mockDiplomaDetail);

    render(<AdminProfilesPage onRequireLogin={vi.fn()} onLogout={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText('Perfiles de Formulario')).toBeInTheDocument();
      expect(screen.getByText('web@flacso.edu.uy')).toBeInTheDocument();
      expect(screen.getByText('Perfil: Diploma (diploma)')).toBeInTheDocument();
      expect(screen.getByText(/Versión activa actual:/i)).toBeInTheDocument();
    });
  });

  it('handles invalid JSON in editor and shows client error', async () => {
    vi.mocked(apiClient.getAdminMe).mockResolvedValue({ user: mockAdminUser, csrfToken: 'csrf-123' });
    vi.mocked(apiClient.listAdminProfiles).mockResolvedValue(mockProfiles);
    vi.mocked(apiClient.getAdminProfile).mockResolvedValue(mockDiplomaDetail);

    render(<AdminProfilesPage onRequireLogin={vi.fn()} onLogout={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Crear nueva versión/i })).toBeInTheDocument();
    });

    const textarea = screen.getByRole('textbox');
    fireEvent.change(textarea, { target: { value: 'invalid-json' } });

    fireEvent.submit(screen.getByRole('button', { name: /Crear nueva versión/i }).closest('form')!);

    expect(screen.getByText(/El contenido debe ser un JSON válido/i)).toBeInTheDocument();
    expect(apiClient.createProfileVersion).not.toHaveBeenCalled();
  });

  it('creates new version and activates it', async () => {
    vi.mocked(apiClient.getAdminMe).mockResolvedValue({ user: mockAdminUser, csrfToken: 'csrf-123' });
    vi.mocked(apiClient.listAdminProfiles).mockResolvedValue(mockProfiles);
    vi.mocked(apiClient.getAdminProfile).mockResolvedValue(mockDiplomaDetail);
    vi.mocked(apiClient.createProfileVersion).mockResolvedValue({ id: 'ver_diploma_v2', versionNumber: 2 });
    vi.mocked(apiClient.activateProfileVersion).mockResolvedValue(undefined);

    render(<AdminProfilesPage onRequireLogin={vi.fn()} onLogout={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Crear nueva versión/i })).toBeInTheDocument();
    });

    fireEvent.submit(screen.getByRole('button', { name: /Crear nueva versión/i }).closest('form')!);

    await waitFor(() => {
      expect(apiClient.createProfileVersion).toHaveBeenCalledWith('diploma', expect.any(Object), 'csrf-123');
      expect(screen.getByText(/Versión #2 creada exitosamente/i)).toBeInTheDocument();
    });
  });
});
