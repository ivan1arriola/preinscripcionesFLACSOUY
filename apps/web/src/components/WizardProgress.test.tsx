import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { WizardProgress } from './WizardProgress.js';

describe('WizardProgress', () => {
  it('muestra el paso actual y una barra compacta sin exigir scroll horizontal', () => {
    render(
      <WizardProgress
        steps={[
          { id: 'personal', title: 'Datos personales', order: 1 },
          { id: 'contacto', title: 'Residencia y contacto', order: 2 },
          { id: 'academico', title: 'Trayectoria académica', order: 3 },
        ]}
        currentStepIndex={1}
        highestStepReached={1}
        onStepClick={vi.fn()}
      />
    );

    expect(screen.getByText('Paso 2 de 3')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '2');
    expect(screen.getByRole('button', { name: /Datos personales/i })).toBeEnabled();
    expect(screen.getByRole('button', { name: /Trayectoria académica/i })).toBeDisabled();
  });
});
