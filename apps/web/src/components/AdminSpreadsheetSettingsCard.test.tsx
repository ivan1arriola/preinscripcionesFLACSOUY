import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { AdminSpreadsheetSettingsCard } from './AdminSpreadsheetSettingsCard.js';
import { apiClient } from '../api/client.js';

vi.mock('../api/client.js', async () => {
  const actual = await vi.importActual<typeof import('../api/client.js')>('../api/client.js');
  return {
    ...actual,
    apiClient: {
      getAdminSpreadsheets: vi.fn(),
      provisionAdminSpreadsheets: vi.fn(),
      unlinkAdminSpreadsheet: vi.fn(),
    },
  };
});

describe('AdminSpreadsheetSettingsCard Component', () => {
  const mockTargets = [
    {
      targetId: 't1',
      title: 'Maestría en Educación y Sociedad',
      kind: 'academic_offer',
      spreadsheet: {
        spreadsheetId: 'sheet-1',
        sheetName: 'Inscripciones',
        status: 'unchanged' as const,
        url: 'https://docs.google.com/spreadsheets/d/sheet-1',
      },
    },
    {
      targetId: 't2',
      title: 'Seminario de Políticas Públicas',
      kind: 'seminar',
      spreadsheet: {
        spreadsheetId: 'sheet-2',
        sheetName: 'Inscripciones',
        status: 'blocked' as const,
      },
    },
    {
      targetId: 't3',
      title: 'Diploma en Género',
      kind: 'academic_offer',
      spreadsheet: null,
    },
  ];

  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(apiClient.provisionAdminSpreadsheets).mockResolvedValue({
      targets: mockTargets,
      reconciliation: { status: 'unchanged' } as any,
    } as any);
  });

  it('renders metrics summary and grouped sections', async () => {
    vi.mocked(apiClient.getAdminSpreadsheets).mockResolvedValue({
      targets: mockTargets,
    });

    render(<AdminSpreadsheetSettingsCard csrfToken="test-csrf" />);

    await waitFor(() => {
      // Metrics
      expect(screen.getByText(/3 destinos/i)).toBeInTheDocument();
      expect(screen.getByText(/1 lista\/activa/i)).toBeInTheDocument();
      expect(screen.getByText(/2 requieren atención/i)).toBeInTheDocument();

      // Group headings
      expect(screen.getByText(/Requieren atención \(2\)/i)).toBeInTheDocument();
      expect(screen.getByText(/Planillas disponibles \(1\)/i)).toBeInTheDocument();

      // Targets rendered
      expect(screen.getByText('Maestría en Educación y Sociedad')).toBeInTheDocument();
      expect(screen.getByText('Seminario de Políticas Públicas')).toBeInTheDocument();
      expect(screen.getByText('Diploma en Género')).toBeInTheDocument();
    });
  });

  it('filters targets by search query and shows clear filters when no results', async () => {
    vi.mocked(apiClient.getAdminSpreadsheets).mockResolvedValue({
      targets: mockTargets,
    });

    render(<AdminSpreadsheetSettingsCard csrfToken="test-csrf" />);

    await waitFor(() => {
      expect(screen.getByText('Maestría en Educación y Sociedad')).toBeInTheDocument();
    });

    const searchInput = screen.getByPlaceholderText(/Buscar por título o código/i);
    fireEvent.change(searchInput, { target: { value: 'genero' } });

    await waitFor(() => {
      expect(screen.getByText('Diploma en Género')).toBeInTheDocument();
      expect(screen.queryByText('Maestría en Educación y Sociedad')).not.toBeInTheDocument();
    });

    // Query with no match
    fireEvent.change(searchInput, { target: { value: 'inexistente' } });

    await waitFor(() => {
      expect(screen.getByText(/No se encontraron planillas con los filtros aplicados/i)).toBeInTheDocument();
    });

    // Clear filters
    const clearBtn = screen.getAllByRole('button', { name: /Limpiar filtros/i })[0]!;
    fireEvent.click(clearBtn);

    await waitFor(() => {
      expect(screen.getByText('Maestría en Educación y Sociedad')).toBeInTheDocument();
    });
  });

  it('filters targets by kind selector', async () => {
    vi.mocked(apiClient.getAdminSpreadsheets).mockResolvedValue({
      targets: mockTargets,
    });

    render(<AdminSpreadsheetSettingsCard csrfToken="test-csrf" />);

    await waitFor(() => {
      expect(screen.getByText('Seminario de Políticas Públicas')).toBeInTheDocument();
    });

    const kindSelect = screen.getByLabelText(/Tipo de oferta/i);
    fireEvent.change(kindSelect, { target: { value: 'seminar' } });

    await waitFor(() => {
      expect(screen.getByText('Seminario de Políticas Públicas')).toBeInTheDocument();
      expect(screen.queryByText('Maestría en Educación y Sociedad')).not.toBeInTheDocument();
    });
  });

  it('preserves unlink confirmation and action on filtered target', async () => {
    vi.mocked(apiClient.getAdminSpreadsheets).mockResolvedValue({
      targets: mockTargets,
    });
    vi.mocked(apiClient.unlinkAdminSpreadsheet).mockResolvedValue({
      ok: true,
      message: 'Planilla desvinculada exitosamente.',
    });
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    render(<AdminSpreadsheetSettingsCard csrfToken="test-csrf" />);

    await waitFor(() => {
      expect(screen.getByText('Maestría en Educación y Sociedad')).toBeInTheDocument();
    });

    // Expand t1 row (Maestría en Educación y Sociedad)
    const t1Title = screen.getByText('Maestría en Educación y Sociedad');
    const t1Row = t1Title.closest('div.rounded-lg') as HTMLElement;
    const expandBtn = within(t1Row).getByRole('button', { name: /Detalles/i });
    fireEvent.click(expandBtn);

    await waitFor(() => {
      expect(within(t1Row).getByRole('button', { name: /Desvincular planilla/i })).toBeInTheDocument();
    });

    const unlinkBtn = within(t1Row).getByRole('button', { name: /Desvincular planilla/i });
    fireEvent.click(unlinkBtn);

    expect(window.confirm).toHaveBeenCalled();
    expect(apiClient.unlinkAdminSpreadsheet).toHaveBeenCalledWith('t1', 'test-csrf');
  });
});
