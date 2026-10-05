import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MobileWizardNavigation } from './MobileWizardNavigation.js';

describe('MobileWizardNavigation', () => {
  it('expone acciones táctiles y distingue continuar de revisar', () => {
    const onBack = vi.fn();
    const onContinue = vi.fn();

    render(
      <MobileWizardNavigation
        canGoBack
        canContinue
        isFinalStep={false}
        isSubmitting={false}
        onBack={onBack}
        onContinue={onContinue}
        continueLabel="Continuar"
      />
    );

    expect(screen.getByRole('button', { name: 'Atrás' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Continuar' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Atrás' }));
    fireEvent.click(screen.getByRole('button', { name: 'Continuar' }));
    expect(onBack).toHaveBeenCalledOnce();
    expect(onContinue).toHaveBeenCalledOnce();
  });

  it('deshabilita las acciones durante el envío y conserva el CTA final', () => {
    render(
      <MobileWizardNavigation
        canGoBack={false}
        canContinue={false}
        isFinalStep
        isSubmitting
        onBack={vi.fn()}
        onContinue={vi.fn()}
        continueLabel="Revisar datos"
      />
    );

    expect(screen.getByRole('button', { name: 'Atrás' })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Revisar datos/ })).toBeDisabled();
  });
});
