import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { AdminDriveSettingsCard } from './AdminDriveSettingsCard.js';
import { apiClient } from '../api/client.js';

vi.mock('../api/client.js', async () => {
  const actual = await vi.importActual<typeof import('../api/client.js')>('../api/client.js');
  return {
    ...actual,
    apiClient: {
      getAdminSettings: vi.fn(),
      updateGoogleDriveFolder: vi.fn(),
    },
  };
});

const settings = {
  googleDriveFolderId: 'carpeta-actual',
  googleDriveFolderName: 'Preinscripciones',
  googleDriveCanAddChildren: true,
  serviceAccountEmail: 'cuenta@proyecto.iam.gserviceaccount.com',
  updatedAt: null,
  updatedBy: null,
};

describe('AdminDriveSettingsCard', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(apiClient.getAdminSettings).mockResolvedValue(settings as any);
  });

  it('mantiene visible el aviso de planillas bloqueadas después de recargar la configuración', async () => {
    vi.mocked(apiClient.updateGoogleDriveFolder).mockResolvedValue({
      googleDriveFolderId: 'carpeta-nueva',
      googleDriveFolderName: 'Nueva',
      googleDriveCanAddChildren: true,
      reconciliation: { status: 'blocked', targets: [] },
    } as any);

    render(<AdminDriveSettingsCard csrfToken="csrf-test" />);

    fireEvent.change(await screen.findByLabelText(/ID o URL/i), { target: { value: 'carpeta-nueva' } });
    fireEvent.click(screen.getByRole('button', { name: /Guardar cambios/i }));

    expect(await screen.findByText(/no pudieron reconciliarse/i)).toBeInTheDocument();
    // La recarga posterior del GET no debe borrar el error que dejó el guardado.
    await waitFor(() => expect(apiClient.getAdminSettings).toHaveBeenCalledTimes(2));
    expect(await screen.findByText(/no pudieron reconciliarse/i)).toBeInTheDocument();
  });
});
