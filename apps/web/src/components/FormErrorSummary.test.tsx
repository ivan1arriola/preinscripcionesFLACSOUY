import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { FormErrorSummary } from './FormErrorSummary.js';

describe('FormErrorSummary', () => {
  it('ordena los errores y permite enfocar el campo correspondiente', () => {
    const onSelectField = vi.fn();
    render(
      <FormErrorSummary
        errors={{ email: 'Ingresá un correo válido.', nombre1: 'Este campo es obligatorio.' }}
        orderedKeys={['nombre1', 'email']}
        onSelectField={onSelectField}
      />
    );

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getAllByRole('link')).toHaveLength(2);
    fireEvent.click(screen.getByRole('link', { name: /correo válido/i }));
    expect(onSelectField).toHaveBeenCalledWith('email');
  });
});
