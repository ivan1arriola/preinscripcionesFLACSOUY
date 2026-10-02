import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { HomePage } from './HomePage.js';
import { apiClient } from '../api/client.js';
import type { DiagnosticTarget } from '@flacso/contracts';

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

describe('HomePage Component', () => {
  const mockTargets: DiagnosticTarget[] = [
    {
      id: 'davia-c11',
      kind: 'academic_offer',
      title: 'DAVIA Cohorte 11',
      registrationOpen: true,
      configRevision: 'rev-1',
      status: 'operational',
      issues: [],
    },
    {
      id: 'mg-c8',
      kind: 'academic_offer',
      title: 'Maestría en Género Cohorte 8',
      registrationOpen: false,
      configRevision: 'rev-2',
      status: 'closed',
      issues: [],
    },
    {
      id: 'inc-1',
      kind: 'academic_offer',
      title: 'Oferta Incompatible',
      registrationOpen: true,
      configRevision: 'rev-3',
      status: 'incompatible',
      issues: ['Clave de input no soportada: campo_desconocido'],
    },
    {
      id: 'sem-1',
      kind: 'seminar',
      title: 'Seminario de Investigación Cualitativa',
      registrationOpen: true,
      configRevision: 'rev-4',
      status: 'operational',
      issues: [],
    },
  ];

  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('renders target list with correct status badges and issues', async () => {
    vi.mocked(apiClient.listTargets).mockResolvedValue(mockTargets);
    const onSelect = vi.fn();

    render(<HomePage onSelectTarget={onSelect} />);

    expect(screen.getByText(/Cargando destinos/i)).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText('DAVIA Cohorte 11')).toBeInTheDocument();
      expect(screen.getByText('Maestría en Género Cohorte 8')).toBeInTheDocument();
      expect(screen.getByText('Oferta Incompatible')).toBeInTheDocument();
      expect(screen.getByText('Seminario de Investigación Cualitativa')).toBeInTheDocument();
    });

    expect(screen.getByRole('heading', { name: 'Oferta académica' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Seminarios' })).toBeInTheDocument();
    expect(screen.getByText('3 propuestas')).toBeInTheDocument();
    expect(screen.getByText('1 propuesta')).toBeInTheDocument();

    expect(screen.getAllByText('Abierta')).toHaveLength(2);
    expect(screen.getByText('Cerrada')).toBeInTheDocument();
    expect(screen.getByText('Incompatible')).toBeInTheDocument();
    expect(screen.getByText(/campo_desconocido/i)).toBeInTheDocument();

    const openBtn = screen.getAllByRole('button', { name: /Completar preinscripción/i })[0]!;
    fireEvent.click(openBtn);
    expect(onSelect).toHaveBeenCalledWith('davia-c11');
  });
});
