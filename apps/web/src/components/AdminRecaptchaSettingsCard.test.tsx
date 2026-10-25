import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { AdminRecaptchaSettingsCard } from './AdminRecaptchaSettingsCard.js';
import { apiClient } from '../api/client.js';

vi.mock('../api/client.js', async () => {
  const actual = await vi.importActual<typeof import('../api/client.js')>('../api/client.js');
  return {
    ...actual,
    apiClient: {
      getRecaptchaSettings: vi.fn(),
      updateRecaptchaSettings: vi.fn(),
    },
  };
});

describe('AdminRecaptchaSettingsCard', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('shows the saved configuration without ever exposing the secret key', async () => {
    vi.mocked(apiClient.getRecaptchaSettings).mockResolvedValue({
      recaptcha: { enabled: true, siteKey: 'sitio-publico', hasSecretKey: true, minScore: 0.7 },
    });

    render(<AdminRecaptchaSettingsCard csrfToken="csrf-token" />);

    await waitFor(() => {
      expect(screen.getByLabelText('Clave del sitio')).toHaveValue('sitio-publico');
    });
    expect(screen.getByLabelText('Clave secreta')).toHaveValue('');
    expect(screen.getByLabelText('Clave secreta')).toHaveAttribute('placeholder', expect.stringContaining('guardada'));
    expect(screen.getByLabelText(/Puntaje mínimo/)).toHaveValue(0.7);
    expect(screen.getByText(/reCAPTCHA está activo/)).toBeInTheDocument();
  });

  it('saves the keys with the CSRF token and clears the secret field afterwards', async () => {
    vi.mocked(apiClient.getRecaptchaSettings).mockResolvedValue({
      recaptcha: { enabled: false, siteKey: '', hasSecretKey: false, minScore: 0.5 },
    });
    vi.mocked(apiClient.updateRecaptchaSettings).mockResolvedValue({
      ok: true,
      message: 'Configuración de reCAPTCHA guardada correctamente.',
      recaptcha: { enabled: true, siteKey: 'nueva-clave', hasSecretKey: true, minScore: 0.5 },
    });

    render(<AdminRecaptchaSettingsCard csrfToken="csrf-token" />);
    await waitFor(() => expect(screen.getByLabelText('Clave del sitio')).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText('Clave del sitio'), { target: { value: 'nueva-clave' } });
    fireEvent.change(screen.getByLabelText('Clave secreta'), { target: { value: 'secreto-nuevo' } });
    fireEvent.click(screen.getByLabelText(/Exigir reCAPTCHA/));
    fireEvent.click(screen.getByRole('button', { name: /Guardar cambios/ }));

    await waitFor(() => {
      expect(apiClient.updateRecaptchaSettings).toHaveBeenCalledWith('csrf-token', {
        enabled: true,
        siteKey: 'nueva-clave',
        secretKey: 'secreto-nuevo',
        minScore: 0.5,
      });
    });
    expect(await screen.findByText('Configuración de reCAPTCHA guardada correctamente.')).toBeInTheDocument();
    expect(screen.getByLabelText('Clave secreta')).toHaveValue('');
  });

  it('shows the server error when the keys are rejected', async () => {
    vi.mocked(apiClient.getRecaptchaSettings).mockResolvedValue({
      recaptcha: { enabled: false, siteKey: '', hasSecretKey: false, minScore: 0.5 },
    });
    const { ApiError } = await vi.importActual<typeof import('../api/client.js')>('../api/client.js');
    vi.mocked(apiClient.updateRecaptchaSettings).mockRejectedValue(
      new ApiError(400, 'INVALID_RECAPTCHA_CONFIG', 'Para activar reCAPTCHA hacen falta la clave del sitio y la clave secreta.'),
    );

    render(<AdminRecaptchaSettingsCard csrfToken="csrf-token" />);
    await waitFor(() => expect(screen.getByLabelText('Clave del sitio')).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText(/Exigir reCAPTCHA/));
    fireEvent.click(screen.getByRole('button', { name: /Guardar cambios/ }));

    expect(await screen.findByRole('alert')).toHaveTextContent('hacen falta la clave del sitio');
  });
});
