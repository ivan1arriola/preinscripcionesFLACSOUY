import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { AdminNotificationsSettingsCard } from './AdminNotificationsSettingsCard.js';
import { apiClient, ApiError, type AdminEmailSettings } from '../api/client.js';

vi.mock('../api/client.js', async () => {
  const actual = await vi.importActual<typeof import('../api/client.js')>('../api/client.js');
  return {
    ...actual,
    apiClient: {
      getAdminEmailSettings: vi.fn(),
      updateAdminEmailSettings: vi.fn(),
      sendTestAdminEmail: vi.fn(),
      getAdminNotifications: vi.fn(),
      retryAdminNotification: vi.fn(),
      dispatchAdminNotifications: vi.fn(),
    },
  };
});

describe('AdminNotificationsSettingsCard Component', () => {
  const mockEmailSettings: AdminEmailSettings = {
    enabled: true,
    configured: true,
    provider: 'smtp',
    smtp: {
      host: 'smtp.flacso.edu.uy',
      port: 587,
      security: 'starttls',
      username: 'flacso_mailer',
      hasPassword: true,
      fromEmail: 'no***s@flacso.edu.uy',
      replyToEmail: 'co***s@flacso.edu.uy',
    },
    masterEmails: ['admin@flacso.edu.uy', 'soporte@flacso.edu.uy'],
    status: {
      lastConnectionTestAt: null,
      lastConnectionTestOk: null,
      lastConnectionTestError: null,
    },
  };

  const mockOutbox = {
    ok: true,
    counts: {
      pending: 1,
      processing: 0,
      sent: 5,
      failed: 1,
      unknown: 0,
      total: 7,
    },
    notifications: [],
  };

  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(apiClient.getAdminEmailSettings).mockResolvedValue(mockEmailSettings);
    vi.mocked(apiClient.getAdminNotifications).mockResolvedValue(mockOutbox);
  });

  it('renders 4 visual sections and read-only masked status', async () => {
    render(<AdminNotificationsSettingsCard csrfToken="csrf-token-123" />);

    await waitFor(() => {
      expect(screen.getByText(/1\. Conexión SMTP/i)).toBeInTheDocument();
      expect(screen.getByText(/2\. Credenciales/i)).toBeInTheDocument();
      expect(screen.getByText(/3\. Remitente y respuesta/i)).toBeInTheDocument();
      expect(screen.getByText(/4\. Destinatarios maestros/i)).toBeInTheDocument();
    });

    // Check read-only masked status
    expect(screen.getByText('no***s@flacso.edu.uy')).toBeInTheDocument();
    expect(screen.getByText('co***s@flacso.edu.uy')).toBeInTheDocument();

    // Check inputs are empty with placeholder
    const fromInput = screen.getByPlaceholderText('Dejar vacío para conservar el remitente actual');
    expect(fromInput).toHaveValue('');

    const replyToInput = screen.getByPlaceholderText('Dejar vacío para conservar la dirección de respuesta actual');
    expect(replyToInput).toHaveValue('');

    const passwordInput = screen.getByPlaceholderText('Dejar vacío para conservar la contraseña actual');
    expect(passwordInput).toHaveValue('');
  });

  it('saves settings and displays success confirmation when enabled', async () => {
    vi.mocked(apiClient.updateAdminEmailSettings).mockResolvedValue({
      ...mockEmailSettings,
      smtp: {
        ...mockEmailSettings.smtp,
        host: 'smtp.updated.flacso.edu.uy',
      },
    });

    render(<AdminNotificationsSettingsCard csrfToken="csrf-token-123" />);

    await waitFor(() => {
      expect(screen.getByText(/1\. Conexión SMTP/i)).toBeInTheDocument();
    });

    const hostInput = screen.getByDisplayValue('smtp.flacso.edu.uy');
    fireEvent.change(hostInput, { target: { value: 'smtp.updated.flacso.edu.uy' } });

    const submitBtn = screen.getByRole('button', { name: /Guardar Configuración de Correo/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(apiClient.updateAdminEmailSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          enabled: true,
          host: 'smtp.updated.flacso.edu.uy',
          fromEmail: undefined,
          replyToEmail: undefined,
          password: undefined,
          replacePassword: false,
        }),
        'csrf-token-123'
      );
      expect(
        screen.getByText(/Configuración SMTP y destinatarios maestros guardada con éxito/i)
      ).toBeInTheDocument();
    });
  });

  it('displays clear note when saved with automatic notifications disabled', async () => {
    vi.mocked(apiClient.updateAdminEmailSettings).mockResolvedValue({
      ...mockEmailSettings,
      enabled: false,
    });

    render(<AdminNotificationsSettingsCard csrfToken="csrf-token-123" />);

    await waitFor(() => {
      expect(screen.getByText(/1\. Conexión SMTP/i)).toBeInTheDocument();
    });

    // Uncheck enabled switch
    const switchInput = screen.getByRole('checkbox', {
      name: /Habilitar envío automático de notificaciones por correo/i,
    });
    fireEvent.click(switchInput);

    const submitBtn = screen.getByRole('button', { name: /Guardar Configuración de Correo/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(
        screen.getByText(
          /Configuración SMTP guardada correctamente\. Nota: el envío automático se encuentra deshabilitado\./i
        )
      ).toBeInTheDocument();
    });
  });

  it('displays structured error details (message, reason, action) on validation failure', async () => {
    vi.mocked(apiClient.updateAdminEmailSettings).mockRejectedValue(
      new ApiError(
        400,
        'INVALID_REQUEST',
        'El remitente debe ser una dirección de correo válida.',
        undefined,
        undefined,
        'fromEmail',
        'El remitente debe ser una dirección de correo válida.',
        'Verifique el formato del remitente (ej. notificaciones@flacso.edu.uy).'
      )
    );

    render(<AdminNotificationsSettingsCard csrfToken="csrf-token-123" />);

    await waitFor(() => {
      expect(screen.getByText(/1\. Conexión SMTP/i)).toBeInTheDocument();
    });

    const submitBtn = screen.getByRole('button', { name: /Guardar Configuración de Correo/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
      expect(screen.getByText(/El remitente debe ser una dirección de correo válida\./i)).toBeInTheDocument();
      expect(
        screen.getByText(/Verifique el formato del remitente \(ej\. notificaciones@flacso\.edu\.uy\)\./i)
      ).toBeInTheDocument();
    });
  });

  it('sends test email and shows result message', async () => {
    vi.mocked(apiClient.sendTestAdminEmail).mockResolvedValue({
      ok: true,
      providerMessageId: 'smtp-msg-999',
      recipient: 'postulante@flacso.edu.uy',
    });

    render(<AdminNotificationsSettingsCard csrfToken="csrf-token-123" />);

    await waitFor(() => {
      expect(screen.getByText(/Envío de prueba SMTP/i)).toBeInTheDocument();
    });

    const testInput = screen.getByPlaceholderText('correo-destino@flacso.edu.uy');
    fireEvent.change(testInput, { target: { value: 'postulante@flacso.edu.uy' } });

    const sendBtn = screen.getByRole('button', { name: /Enviar correo de prueba/i });
    fireEvent.click(sendBtn);

    await waitFor(() => {
      expect(apiClient.sendTestAdminEmail).toHaveBeenCalledWith(
        'postulante@flacso.edu.uy',
        'csrf-token-123'
      );
      expect(
        screen.getByText(/Correo de prueba enviado con éxito a postulante@flacso\.edu\.uy/i)
      ).toBeInTheDocument();
    });
  });
});
