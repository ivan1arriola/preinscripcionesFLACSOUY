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
  { key: 'aceptaDifusion', label: '¿Autorizás la difusión de tu nombre y foto?', type: 'select', required: true, position: 6 },
];

describe('UniversalFields identity and contact controls', () => {
  it('uses the Uruguayan identity card flow and hides the issuer country', () => {
    const onChange = vi.fn();
    render(<UniversalFields inputs={inputs} values={{ tipoDocumento: 'cedula_uruguaya' }} errors={{}} disabled={false} onChange={onChange} />);

    expect(screen.getByLabelText(/Cédula de identidad uruguaya/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/País emisor del documento/i)).not.toBeInTheDocument();

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

    expect(screen.getByText('🇺🇾 +598')).toBeInTheDocument();
  });
});
