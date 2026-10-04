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
      offerType: 'diploma',
      configRevision: 'rev-1',
      status: 'operational',
      issues: [],
    },
    {
      id: 'mg-c8',
      kind: 'academic_offer',
      title: 'Maestría en Género Cohorte 8',
      registrationOpen: false,
      offerType: 'maestria',
      configRevision: 'rev-2',
      status: 'closed',
      issues: [],
    },
    {
      id: 'inc-1',
      kind: 'academic_offer',
      title: 'Oferta Incompatible',
      registrationOpen: true,
      offerType: 'especializacion',
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
    });

    expect(screen.getByRole('tab', { name: /Oferta académica/i })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: /Seminarios/i })).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByRole('heading', { name: 'Oferta académica' })).toBeInTheDocument();
    expect(screen.getByText('3 propuestas')).toBeInTheDocument();

    expect(screen.getByText('Abierta')).toBeInTheDocument();
    expect(screen.getByText('Cerrada')).toBeInTheDocument();
    expect(screen.getByText('Incompatible')).toBeInTheDocument();
    expect(screen.getByText(/campo_desconocido/i)).toBeInTheDocument();

    const openBtn = screen.getAllByRole('button', { name: /Completar preinscripción/i })[0]!;
    fireEvent.click(openBtn);
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'davia-c11' }));

    fireEvent.click(screen.getByRole('tab', { name: /Seminarios/i }));
    expect(screen.getByRole('heading', { name: 'Seminarios' })).toBeInTheDocument();
    expect(screen.getByText('Seminario de Investigación Cualitativa')).toBeInTheDocument();
  });

  it('keeps one academic category open at a time', async () => {
    vi.mocked(apiClient.listTargets).mockResolvedValue(mockTargets);

    render(<HomePage onSelectTarget={vi.fn()} />);

    await waitFor(() => expect(screen.getByTestId('offer-group-diploma')).toBeInTheDocument());

    expect(screen.getByTestId('offer-group-maestria')).not.toHaveAttribute('open');
    expect(screen.getByTestId('offer-group-especializacion')).not.toHaveAttribute('open');
    expect(screen.getByTestId('offer-group-diploma')).not.toHaveAttribute('open');

    fireEvent.click(screen.getByText('Diplomas'));
    expect(screen.getByTestId('offer-group-diploma')).toHaveAttribute('open');

    fireEvent.click(screen.getByText('Maestrías'));
    expect(screen.getByTestId('offer-group-maestria')).toHaveAttribute('open');
    expect(screen.getByTestId('offer-group-diploma')).not.toHaveAttribute('open');
  });

  it('filters the active catalogue tab by proposal title', async () => {
    vi.mocked(apiClient.listTargets).mockResolvedValue(mockTargets);

    render(<HomePage onSelectTarget={vi.fn()} />);

    await waitFor(() => expect(screen.getByRole('searchbox', { name: /Buscar propuesta/i })).toBeInTheDocument());

    fireEvent.change(screen.getByRole('searchbox', { name: /Buscar propuesta/i }), { target: { value: 'DAVIA' } });

    expect(screen.getByTestId('offer-group-diploma')).toBeInTheDocument();
    expect(screen.queryByTestId('offer-group-maestria')).not.toBeInTheDocument();
    expect(screen.queryByTestId('offer-group-especializacion')).not.toBeInTheDocument();
  });

  it('does not duplicate seminar cards for historical editions under the same permalink', async () => {
    const targetsWithEditions: DiagnosticTarget[] = [
      {
        id: 'sem-ed1',
        kind: 'seminar',
        title: 'Seminario Cualitativo Edición 1',
        registrationOpen: false,
        registrationAvailability: 'closed',
        configRevision: 'rev-1',
        status: 'closed',
        issues: [],
        urls: {
          legacyRegistration: 'https://flacso.edu.uy/seminario/investigacion-cualitativa/',
        },
      },
      {
        id: 'sem-ed2',
        kind: 'seminar',
        title: 'Seminario Cualitativo Edición 2',
        registrationOpen: true,
        registrationAvailability: 'open',
        configRevision: 'rev-2',
        status: 'operational',
        issues: [],
        urls: {
          legacyRegistration: 'https://flacso.edu.uy/seminario/investigacion-cualitativa/',
        },
      },
    ];

    vi.mocked(apiClient.listTargets).mockResolvedValue(targetsWithEditions);

    render(<HomePage onSelectTarget={vi.fn()} />);

    await waitFor(() => expect(screen.getByRole('tab', { name: /Seminarios/i })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('tab', { name: /Seminarios/i }));
    expect(screen.getByRole('heading', { name: 'Seminarios' })).toBeInTheDocument();

    expect(screen.getByText('Seminario Cualitativo Edición 2')).toBeInTheDocument();
    expect(screen.queryByText('Seminario Cualitativo Edición 1')).not.toBeInTheDocument();
  });
});
