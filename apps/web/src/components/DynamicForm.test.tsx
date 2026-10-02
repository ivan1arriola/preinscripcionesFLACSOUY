import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DynamicForm } from './DynamicForm.js';
import type { FormDefinition } from '@flacso/contracts';

describe('DynamicForm Component', () => {
  const openForm: FormDefinition = {
    targetId: 'davia-c11',
    title: 'DAVIA Cohorte 11',
    kind: 'academic_offer',
    registrationOpen: true,
    configRevision: 'rev-1',
    inputs: [
      { key: 'nombre', label: 'Nombre', type: 'text', required: true, position: 1 },
      { key: 'email', label: 'Correo electrónico', type: 'email', required: true, position: 2 },
      { key: 'telefono', label: 'Teléfono', type: 'tel', required: false, position: 3 },
      {
        key: 'orientacion',
        label: 'Orientación',
        type: 'select',
        required: true,
        position: 4,
        optionsSource: 'wordpress.orientaciones',
      },
      {
        key: 'mencion',
        label: 'Mención',
        type: 'select',
        required: false,
        position: 5,
        optionsSource: 'wordpress.menciones',
      },
    ],
    orientations: [
      {
        id: 'educacion',
        name: 'Educación',
        mentions: [],
      },
      {
        id: 'politicas',
        name: 'Políticas Públicas',
        mentions: [],
      },
    ],
    mentions: [
      { id: 'tec-edu', name: 'Tecnología Educativa' },
      { id: 'innovacion', name: 'Innovación Pública' },
    ],
  };

  it('renders all configured fields and labels', () => {
    render(<DynamicForm form={openForm} onSubmit={vi.fn()} />);

    expect(screen.getByLabelText(/Nombre/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Correo electrónico/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Teléfono/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Orientación/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Enviar preinscripción/i })).toBeInTheDocument();
  });

  it('validates required fields client-side before submit', async () => {
    const onSubmit = vi.fn();
    render(<DynamicForm form={openForm} onSubmit={onSubmit} />);

    fireEvent.click(screen.getByRole('button', { name: /Enviar preinscripción/i }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText(/El campo Nombre es obligatorio/i)).toBeInTheDocument();
  });

  it('shows orientation and mention as independent choices', () => {
    render(<DynamicForm form={openForm} onSubmit={vi.fn()} />);

    const orientacionSelect = screen.getByLabelText(/Orientación/i);

    fireEvent.change(orientacionSelect, { target: { value: 'educacion' } });
    expect(screen.getByText('Tecnología Educativa')).toBeInTheDocument();
    expect(screen.getByText('Innovación Pública')).toBeInTheDocument();
  });

  it('disables submit when registration is closed', () => {
    const closedForm: FormDefinition = {
      ...openForm,
      registrationOpen: false,
    };

    render(<DynamicForm form={closedForm} onSubmit={vi.fn()} />);

    const submitBtn = screen.getByRole('button', { name: /Inscripción cerrada/i });
    expect(submitBtn).toBeDisabled();
    expect(screen.getByText(/Preinscripción cerrada/i)).toBeInTheDocument();
  });
});
