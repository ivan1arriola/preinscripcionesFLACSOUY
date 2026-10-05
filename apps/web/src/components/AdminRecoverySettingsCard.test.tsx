import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { AdminRecoverySettingsCard } from './AdminRecoverySettingsCard.js';
import { apiClient } from '../api/client.js';

vi.mock('../api/client.js', async () => {
  const actual = await vi.importActual<typeof import('../api/client.js')>('../api/client.js');
  return {
    ...actual,
    apiClient: {
      getTelegramSettings: vi.fn(),
      updateTelegramSettings: vi.fn(),
      testTelegramSettings: vi.fn(),
    },
  };
});

describe('AdminRecoverySettingsCard Component', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('renders loaded masked Telegram configuration', async () => {
    vi.mocked(apiClient.getTelegramSettings).mockResolvedValue({
      telegram: {
        enabled: true,
        hasToken: true,
        chatIdsCount: 2,
        maskedChatIds: ['-1****89', '98****21'],
        lastTestedAt: '2026-10-05T12:00:00Z',
        lastTestStatus: 'ok',
        lastTestError: null,
      },
    });

    render(<AdminRecoverySettingsCard csrfToken="csrf-test-token" />);

    await waitFor(() => {
      expect(screen.getByText(/Alertas de Incidentes por Telegram/i)).toBeInTheDocument();
      expect(screen.getByText(/Alertas activas/i)).toBeInTheDocument();
      expect(screen.getByText(/Bot configurado/i)).toBeInTheDocument();
      expect(screen.getByText('-1****89')).toBeInTheDocument();
      expect(screen.getByText('98****21')).toBeInTheDocument();
      expect(screen.getByText(/Exitosa/i)).toBeInTheDocument();
    });
  });

  it('saves updated configuration when form is submitted', async () => {
    vi.mocked(apiClient.getTelegramSettings).mockResolvedValue({
      telegram: {
        enabled: false,
        hasToken: false,
        chatIdsCount: 0,
        maskedChatIds: [],
        lastTestedAt: null,
        lastTestStatus: null,
        lastTestError: null,
      },
    });

    vi.mocked(apiClient.updateTelegramSettings).mockResolvedValue({
      ok: true,
      message: 'Configuración guardada.',
      telegram: {
        enabled: true,
        hasToken: true,
        chatIdsCount: 1,
        maskedChatIds: ['12****78'],
        lastTestedAt: null,
        lastTestStatus: null,
        lastTestError: null,
      },
    });

    render(<AdminRecoverySettingsCard csrfToken="csrf-test-token" />);

    await waitFor(() => {
      expect(screen.getByText(/Sin token de bot/i)).toBeInTheDocument();
    });

    // Toggle enabled
    const toggle = screen.getByRole('checkbox');
    fireEvent.click(toggle);

    // Enter token
    const tokenInput = screen.getByPlaceholderText(/123456789:ABCdef/i);
    fireEvent.change(tokenInput, { target: { value: '123456789:ABCdefGHI_jkl123' } });

    // Enter chat ID
    const chatInput = screen.getByPlaceholderText(/Ej: 123456789/i);
    fireEvent.change(chatInput, { target: { value: '12345678' } });

    // Click Save
    const saveBtn = screen.getByRole('button', { name: /Guardar configuración/i });
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(apiClient.updateTelegramSettings).toHaveBeenCalledWith('csrf-test-token', {
        enabled: true,
        botToken: '123456789:ABCdefGHI_jkl123',
        replaceToken: undefined,
        chatIds: ['12345678'],
      });
      expect(screen.getByText(/Configuración de alertas por Telegram guardada correctamente/i)).toBeInTheDocument();
    });
  });

  it('triggers test message when button is clicked', async () => {
    vi.mocked(apiClient.getTelegramSettings).mockResolvedValue({
      telegram: {
        enabled: true,
        hasToken: true,
        chatIdsCount: 1,
        maskedChatIds: ['12****78'],
        lastTestedAt: null,
        lastTestStatus: null,
        lastTestError: null,
      },
    });

    vi.mocked(apiClient.testTelegramSettings).mockResolvedValue({
      ok: true,
      message: 'Mensaje de prueba enviado con éxito.',
    });

    render(<AdminRecoverySettingsCard csrfToken="csrf-test-token" />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Enviar mensaje de prueba/i })).not.toBeDisabled();
    });

    const testBtn = screen.getByRole('button', { name: /Enviar mensaje de prueba/i });
    fireEvent.click(testBtn);

    await waitFor(() => {
      expect(apiClient.testTelegramSettings).toHaveBeenCalledWith('csrf-test-token', {
        chatId: undefined,
      });
      expect(screen.getByText('Mensaje de prueba enviado con éxito.')).toBeInTheDocument();
    });
  });
});
