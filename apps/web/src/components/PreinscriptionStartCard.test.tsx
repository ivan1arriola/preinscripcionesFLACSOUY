import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { PreinscriptionStartCard } from './PreinscriptionStartCard.js';

describe('PreinscriptionStartCard', () => {
  it('explica la preinscripción, los documentos y permite comenzar', () => {
    const onStart = vi.fn();

    render(
      <PreinscriptionStartCard
        title="Diploma en Educación"
        documentSummary={[
          { label: 'Documento de identidad', required: true },
          { label: 'Curriculum Vitae', required: false },
        ]}
        sectionCount={5}
        onStart={onStart}
        disabled={false}
      />
    );

    expect(screen.getByRole('heading', { name: 'Antes de comenzar' })).toBeInTheDocument();
    expect(screen.getByText('Diploma en Educación')).toBeInTheDocument();
    expect(screen.getByText(/5 secciones/i)).toBeInTheDocument();
    expect(screen.getByText('Documento de identidad')).toBeInTheDocument();
    expect(screen.getByText(/obligatorio/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Comenzar preinscripción/i })).toBeEnabled();

    fireEvent.click(screen.getByRole('button', { name: /Comenzar preinscripción/i }));
    expect(onStart).toHaveBeenCalledOnce();
  });

  it('no expone campos del formulario mientras la persona no comienza', () => {
    render(
      <PreinscriptionStartCard
        title="Seminario"
        documentSummary={[]}
        sectionCount={4}
        onStart={vi.fn()}
        disabled
      />
    );

    expect(screen.queryByLabelText(/Primer nombre/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Comenzar preinscripción/i })).toBeDisabled();
  });
});
