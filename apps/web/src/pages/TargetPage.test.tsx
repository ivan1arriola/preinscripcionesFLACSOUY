import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { TargetPage } from './TargetPage.js';
import { apiClient, ApiError } from '../api/client.js';
import type { FormDefinition } from '@flacso/contracts';

vi.mock('../api/client.js', async () => {
  const actual = await vi.importActual<typeof import('../api/client.js')>('../api/client.js');
  return {
    ...actual,
    apiClient: {
      listTargets: vi.fn(),
      getTarget: vi.fn(),
      submit: vi.fn(),
    },
  };
});

describe('TargetPage Component', () => {
  const mockForm: FormDefinition = {
    targetId: 'davia-c11',
    title: 'DAVIA Cohorte 11',
    kind: 'academic_offer',
    registrationOpen: true,
    configRevision: 'rev-davia',
    inputs: [
      { key: 'nombre', label: 'Nombre', type: 'text', required: true, position: 1 },
      { key: 'email', label: 'Correo electrónico', type: 'email', required: true, position: 2 },
    ],
    orientations: [],
  };

  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('renders form and successfully submits, displaying confirmation', async () => {
    vi.mocked(apiClient.getTarget).mockResolvedValue(mockForm);
    vi.mocked(apiClient.submit).mockResolvedValue({ submissionId: 'sub_test123' });

    render(<TargetPage targetId="davia-c11" onBack={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText('DAVIA Cohorte 11')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText(/Nombre/i), { target: { value: 'Martina' } });
    fireEvent.change(screen.getByLabelText(/Correo electrónico/i), { target: { value: 'martina@example.com' } });

    fireEvent.click(screen.getByRole('button', { name: /Enviar preinscripción/i }));

    await waitFor(() => {
      expect(screen.getByText(/¡Preinscripción enviada con éxito!/i)).toBeInTheDocument();
      expect(screen.getByText(/sub_test123/)).toBeInTheDocument();
    });
  });

  it('handles stale revision error from API and displays error message', async () => {
    vi.mocked(apiClient.getTarget).mockResolvedValue(mockForm);
    vi.mocked(apiClient.submit).mockRejectedValue(
      new ApiError(
        409,
        'STALE_REVISION',
        'El formulario ha sido actualizado. Por favor recargue la página.',
        { _form: ['El formulario ha sido actualizado. Por favor recargue la página.'] }
      )
    );

    render(<TargetPage targetId="davia-c11" onBack={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText('DAVIA Cohorte 11')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText(/Nombre/i), { target: { value: 'Martina' } });
    fireEvent.change(screen.getByLabelText(/Correo electrónico/i), { target: { value: 'martina@example.com' } });

    fireEvent.click(screen.getByRole('button', { name: /Enviar preinscripción/i }));

    await waitFor(() => {
      expect(screen.getByText(/El formulario ha sido actualizado/i)).toBeInTheDocument();
    });
  });
});
