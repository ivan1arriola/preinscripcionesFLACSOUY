import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { AdminCampaignTrackingCard } from './AdminCampaignTrackingCard.js';
import { apiClient, ApiError } from '../api/client.js';

vi.mock('../api/client.js', async () => {
  const actual = await vi.importActual<typeof import('../api/client.js')>('../api/client.js');
  return { ...actual, apiClient: { downloadCampaignTracking: vi.fn() } };
});

describe('AdminCampaignTrackingCard', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    URL.createObjectURL = vi.fn(() => 'blob:x');
    URL.revokeObjectURL = vi.fn();
  });

  it('avisa que hay datos personales y descarga con el rango elegido', async () => {
    vi.mocked(apiClient.downloadCampaignTracking).mockResolvedValue({ blob: new Blob(['x']), filename: 'seguimiento-campanias-2026-03-10.csv' });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    render(<AdminCampaignTrackingCard />);

    expect(screen.getByText(/datos personales/i)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Desde'), { target: { value: '2026-03-01' } });
    fireEvent.change(screen.getByLabelText('Hasta'), { target: { value: '2026-03-10' } });
    fireEvent.click(screen.getByRole('button', { name: 'Descargar CSV' }));

    await waitFor(() => expect(click).toHaveBeenCalled());
    expect(apiClient.downloadCampaignTracking).toHaveBeenCalledWith('2026-03-01', '2026-03-10');
  });

  it('muestra el error si la descarga falla', async () => {
    vi.mocked(apiClient.downloadCampaignTracking).mockRejectedValue(new ApiError(401, 'UNAUTHORIZED', 'Sesión vencida'));
    render(<AdminCampaignTrackingCard />);

    fireEvent.click(screen.getByRole('button', { name: 'Descargar CSV' }));

    expect((await screen.findByRole('alert')).textContent).toBe('Sesión vencida');
  });
});
