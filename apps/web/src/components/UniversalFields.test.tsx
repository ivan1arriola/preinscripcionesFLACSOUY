import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { InputDefinition } from '@flacso/contracts';
import { UniversalFields } from './UniversalFields.js';

const inputs: InputDefinition[] = [
  { key: 'tipoDocumento', label: 'Tipo de documento', type: 'select', required: true, position: 1 },
  { key: 'documento', label: 'Número de documento', type: 'text', required: true, position: 2 },
  { key: 'paisEmisorDocumento', label: 'País emisor del documento', type: 'text', required: true, position: 3 },
  { key: 'celular', label: 'Celular', type: 'tel', required: true, position: 4 },
  { key: 'tieneConvenio', label: '¿Te corresponde algún convenio?', type: 'select', required: true, position: 5 },
  { key: 'aceptaDifusion', label: '¿Autorizás la difusión de imagen por parte de FLACSO Uruguay?', type: 'select', required: true, position: 6 },
];

describe('UniversalFields identity and contact controls', () => {
  it('uses the Uruguayan identity card flow and keeps the issuer country in place, fixed to Uruguay', () => {
    const onChange = vi.fn();
    render(<UniversalFields inputs={inputs} values={{ tipoDocumento: 'cedula_uruguaya' }} errors={{}} disabled={false} onChange={onChange} />);

    expect(screen.getByLabelText(/Cédula de identidad uruguaya/i)).toBeInTheDocument();
    // El campo no aparece ni desaparece según el documento: así el formulario no se mueve.
    expect(screen.getByLabelText(/País emisor del documento/i)).toBeDisabled();
    expect(screen.getByLabelText(/País emisor del documento/i)).toHaveValue('Uruguay');
    expect(onChange).toHaveBeenCalledWith('paisEmisorDocumento', 'Uruguay');

    fireEvent.change(screen.getByLabelText(/Cédula de identidad uruguaya/i), { target: { value: '34567894' } });
    expect(onChange).toHaveBeenLastCalledWith('documento', '3.456.789-4');
    expect(screen.getByText('Cédula válida.')).toBeInTheDocument();
  });

  it('normalizes the phone after selecting its country', () => {
    const onChange = vi.fn();
    render(<UniversalFields inputs={inputs} values={{ celular: '' }} errors={{}} disabled={false} onChange={onChange} />);

    fireEvent.change(screen.getByLabelText(/País del teléfono/i), { target: { value: 'UY' } });
    fireEvent.change(screen.getByLabelText(/^Celular/), { target: { value: '099 123 456' } });

    expect(onChange).toHaveBeenLastCalledWith('celular', '+59899123456');
    expect(screen.getByText('Se guardará como +59899123456.')).toBeInTheDocument();
  });

  it('presents yes-or-no answers as radio buttons', () => {
    render(<UniversalFields inputs={inputs} values={{}} errors={{}} disabled={false} onChange={vi.fn()} />);

    expect(screen.getAllByRole('radio', { name: 'Sí' })).toHaveLength(2);
    expect(screen.getAllByRole('radio', { name: 'No' })).toHaveLength(2);
    expect(screen.queryByRole('combobox', { name: /¿Te corresponde algún convenio/i })).not.toBeInTheDocument();
  });

  it('shows the country flag and calling code next to the phone number', () => {
    render(<UniversalFields inputs={inputs} values={{ celular: '' }} errors={{}} disabled={false} onChange={vi.fn()} />);

    expect(screen.getByLabelText(/País del teléfono/i)).toHaveValue('UY');
    expect(screen.getByRole('option', { name: /Uruguay \+598/i })).toBeInTheDocument();
  });

  it('renders the Uruguay SVG flag and calling code by default', () => {
    const { container } = render(<UniversalFields inputs={inputs} values={{ celular: '' }} errors={{}} disabled={false} onChange={vi.fn()} />);

    expect(screen.getByLabelText(/País del teléfono/i)).toHaveValue('UY');
    const svg = container.querySelector('.phone-input svg');
    expect(svg).toBeInTheDocument();
    expect(svg?.tagName.toLowerCase()).toBe('svg');
    expect(screen.getByText('+598')).toBeInTheDocument();
  });

  it('updates the visible flag and calling code when country changes', () => {
    const { container } = render(<UniversalFields inputs={inputs} values={{ celular: '' }} errors={{}} disabled={false} onChange={vi.fn()} />);

    fireEvent.change(screen.getByLabelText(/País del teléfono/i), { target: { value: 'AR' } });

    expect(screen.getByLabelText(/País del teléfono/i)).toHaveValue('AR');
    expect(screen.getByText('+54')).toBeInTheDocument();
    const svg = container.querySelector('.phone-input svg');
    expect(svg).toBeInTheDocument();
    expect(svg?.innerHTML).toContain('338AF3');
  });

  it('updates the phone placeholder when the selected country changes', () => {
    render(<UniversalFields inputs={inputs} values={{ celular: '' }} errors={{}} disabled={false} onChange={vi.fn()} />);

    fireEvent.change(screen.getByLabelText(/País del teléfono/i), { target: { value: 'AR' } });

    expect(screen.getByLabelText(/^Celular/)).toHaveAttribute('placeholder', '11 1234 5678');
  });

  it('does not render a duplicate prefix over the country selector', () => {
    const { container } = render(<UniversalFields inputs={inputs} values={{ celular: '' }} errors={{}} disabled={false} onChange={vi.fn()} />);

    expect(container.querySelector('.phone-prefix')).not.toBeInTheDocument();
  });
});

describe('UniversalFields stable layout, autocomplete and blur', () => {
  const identityInputs: InputDefinition[] = [
    { key: 'nombre1', label: 'Primer nombre', type: 'text', required: true, position: 1 },
    { key: 'email', label: 'Correo electrónico', type: 'email', required: true, position: 2 },
    { key: 'tipoDocumento', label: 'Tipo de documento', type: 'select', required: true, position: 3 },
    { key: 'paisEmisorDocumento', label: 'País emisor del documento', type: 'text', required: true, position: 4 },
    { key: 'documento', label: 'Número de documento', type: 'text', required: true, position: 5 },
  ];

  it('sets the issuer country to Uruguay when choosing the Uruguayan ID, and clears it when leaving it', () => {
    const onChange = vi.fn();
    const { rerender } = render(<UniversalFields inputs={identityInputs} values={{}} errors={{}} disabled={false} onChange={onChange} />);

    fireEvent.change(screen.getByLabelText(/Tipo de documento/i), { target: { value: 'cedula_uruguaya' } });
    expect(onChange).toHaveBeenCalledWith('tipoDocumento', 'cedula_uruguaya');
    expect(onChange).toHaveBeenCalledWith('paisEmisorDocumento', 'Uruguay');

    onChange.mockClear();
    rerender(<UniversalFields inputs={identityInputs} values={{ tipoDocumento: 'cedula_uruguaya', paisEmisorDocumento: 'Uruguay' }} errors={{}} disabled={false} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText(/Tipo de documento/i), { target: { value: 'pasaporte' } });
    expect(onChange).toHaveBeenCalledWith('paisEmisorDocumento', '');
  });

  it('keeps the same fields on screen for every document type and always shows a help line', () => {
    const labelsFor = (tipoDocumento?: string) => {
      const { unmount } = render(<UniversalFields inputs={identityInputs} values={tipoDocumento ? { tipoDocumento } : {}} errors={{}} disabled={false} onChange={vi.fn()} />);
      const count = screen.getAllByRole('textbox').length + screen.getAllByRole('combobox').length;
      const hint = document.getElementById('documento-ayuda')?.textContent ?? '';
      unmount();
      return { count, hint };
    };

    const none = labelsFor(undefined);
    const cedula = labelsFor('cedula_uruguaya');
    const passport = labelsFor('pasaporte');
    const foreign = labelsFor('documento_extranjero');

    expect(new Set([none.count, cedula.count, passport.count, foreign.count]).size).toBe(1);
    for (const { hint } of [none, cedula, passport, foreign]) expect(hint.length).toBeGreaterThan(10);
    expect(passport.hint).toMatch(/pasaporte/i);
  });

  it('adds autocomplete hints and reports when a field loses focus', () => {
    const onBlurField = vi.fn();
    render(<UniversalFields inputs={identityInputs} values={{}} errors={{}} disabled={false} onChange={vi.fn()} onBlurField={onBlurField} />);

    expect(screen.getByLabelText(/Primer nombre/i)).toHaveAttribute('autocomplete', 'given-name');
    expect(screen.getByLabelText(/Correo electrónico/i)).toHaveAttribute('autocomplete', 'email');

    fireEvent.blur(screen.getByLabelText(/Primer nombre/i));
    expect(onBlurField).toHaveBeenCalledWith('nombre1');
  });

  it('marks the field as invalid for assistive technology when it has an error', () => {
    render(<UniversalFields inputs={identityInputs} values={{}} errors={{ nombre1: 'El campo Primer nombre es obligatorio.' }} disabled={false} onChange={vi.fn()} />);
    const field = screen.getByLabelText(/Primer nombre/i);
    expect(field).toHaveAttribute('aria-invalid', 'true');
    expect(field.getAttribute('aria-describedby')).toContain('error-nombre1');
  });
});
