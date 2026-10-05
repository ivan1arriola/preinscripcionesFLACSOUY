import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AdminSpreadsheetTargetRow } from './AdminSpreadsheetTargetRow.js';
import type { SpreadsheetTargetItem } from './admin-spreadsheet-view-model.js';

describe('AdminSpreadsheetTargetRow', () => {
  const activeTarget: SpreadsheetTargetItem = {
    targetId: 't-active',
    title: 'Diploma en Políticas Públicas',
    kind: 'academic_offer',
    spreadsheet: {
      spreadsheetId: 'sheet-123',
      sheetName: 'Inscripciones',
      status: 'created',
      url: 'https://docs.google.com/spreadsheets/d/sheet-123/edit',
    },
  };

  const blockedTarget: SpreadsheetTargetItem = {
    targetId: 't-blocked',
    title: 'Seminario de Historia',
    kind: 'seminar',
    spreadsheet: {
      spreadsheetId: 'sheet-456',
      sheetName: 'Inscripciones',
      status: 'blocked',
    },
  };

  it('renders title, kind and status badges', () => {
    render(
      <AdminSpreadsheetTargetRow
        target={activeTarget}
        isExpanded={false}
        onToggleExpand={vi.fn()}
        onUnlink={vi.fn()}
        isUnlinking={false}
      />
    );

    expect(screen.getByText('Diploma en Políticas Públicas')).toBeInTheDocument();
    expect(screen.getByText('Oferta académica')).toBeInTheDocument();
    expect(screen.getByText('Activa')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Abrir planilla/i })).toHaveAttribute(
      'href',
      'https://docs.google.com/spreadsheets/d/sheet-123/edit'
    );
  });

  it('toggles expansion when clicking expand button', () => {
    const onToggle = vi.fn();
    render(
      <AdminSpreadsheetTargetRow
        target={activeTarget}
        isExpanded={false}
        onToggleExpand={onToggle}
        onUnlink={vi.fn()}
        isUnlinking={false}
      />
    );

    const expandBtn = screen.getByRole('button', { name: /Detalles/i });
    fireEvent.click(expandBtn);
    expect(onToggle).toHaveBeenCalledWith('t-active');
  });

  it('renders details and unlink action when expanded', () => {
    const onUnlink = vi.fn();
    render(
      <AdminSpreadsheetTargetRow
        target={activeTarget}
        isExpanded={true}
        onToggleExpand={vi.fn()}
        onUnlink={onUnlink}
        isUnlinking={false}
      />
    );

    expect(screen.getByText(/sheet-123/)).toBeInTheDocument();
    const unlinkBtn = screen.getByRole('button', { name: /Desvincular/i });
    fireEvent.click(unlinkBtn);
    expect(onUnlink).toHaveBeenCalledWith('t-active');
  });

  it('renders blocked status badge and does not render active open link if url is missing', () => {
    render(
      <AdminSpreadsheetTargetRow
        target={blockedTarget}
        isExpanded={false}
        onToggleExpand={vi.fn()}
        onUnlink={vi.fn()}
        isUnlinking={false}
      />
    );

    expect(screen.getByText('Seminario de Historia')).toBeInTheDocument();
    expect(screen.getByText('Seminario')).toBeInTheDocument();
    expect(screen.getByText('Bloqueada')).toBeInTheDocument();
  });
});
