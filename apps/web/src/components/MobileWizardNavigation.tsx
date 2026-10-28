import React from 'react';

export interface MobileWizardNavigationProps {
  canGoBack: boolean;
  canContinue: boolean;
  isFinalStep: boolean;
  isSubmitting: boolean;
  onBack: () => void;
  onContinue: () => void;
  continueLabel: string;
}

export const MobileWizardNavigation: React.FC<MobileWizardNavigationProps> = ({
  canGoBack,
  canContinue,
  isFinalStep,
  isSubmitting,
  onBack,
  onContinue,
  continueLabel,
}) => (
  <div className="wizard-navigation">
    <button
      type="button"
      onClick={onBack}
      disabled={!canGoBack || isSubmitting}
      className="wizard-secondary-action btn btn-secondary btn-back"
    >
      Atrás
    </button>
    <button
      type="button"
      onClick={onContinue}
      disabled={!canContinue || isSubmitting}
      className={`${isFinalStep ? 'wizard-submit-action' : 'wizard-primary-action'} btn btn-primary btn-next`}
    >
      {continueLabel}
      {isSubmitting && <span className="sr-only"> (procesando)</span>}
    </button>
  </div>
);
