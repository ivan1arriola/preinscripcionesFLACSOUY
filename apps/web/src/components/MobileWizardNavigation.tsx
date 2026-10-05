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
  <div className="wizard-navigation sticky bottom-0 z-10 -mx-1 flex items-center gap-3 border-t bg-white/95 px-1 py-3 backdrop-blur supports-[backdrop-filter]:bg-white/80" style={{ paddingBottom: 'max(.75rem, env(safe-area-inset-bottom))' }}>
    <button
      type="button"
      onClick={onBack}
      disabled={!canGoBack || isSubmitting}
      className="wizard-secondary-action min-h-11 flex-1 rounded-md border border-gray-300 bg-white px-4 py-3 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:invisible"
    >
      Atrás
    </button>
    <button
      type="button"
      onClick={onContinue}
      disabled={!canContinue || isSubmitting}
      className={`${isFinalStep ? 'wizard-submit-action' : 'wizard-primary-action'} min-h-11 flex-[1.35] rounded-md px-4 py-3 text-sm font-semibold text-white shadow-sm transition-colors disabled:cursor-not-allowed disabled:opacity-60`}
    >
      {continueLabel}
      {isSubmitting && <span className="sr-only"> (procesando)</span>}
    </button>
  </div>
);
