import React from 'react';

export interface WizardStepInfo {
  id: string;
  title: string;
  order: number;
}

interface WizardProgressProps {
  steps: WizardStepInfo[];
  currentStepIndex: number;
  highestStepReached: number;
  onStepClick: (stepIndex: number) => void;
}

export const WizardProgress: React.FC<WizardProgressProps> = ({
  steps,
  currentStepIndex,
  highestStepReached,
  onStepClick,
}) => {
  const currentStep = steps[currentStepIndex];
  const progress = steps.length === 0 ? 0 : ((currentStepIndex + 1) / steps.length) * 100;

  return (
    <nav aria-label="Progreso de la preinscripción" className="wizard-progress mb-6">
      <div className="mb-3 flex items-end justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-blue-800">Paso {currentStepIndex + 1} de {steps.length}</p>
          <p className="mt-1 text-base font-semibold text-gray-900">{currentStep?.title}</p>
        </div>
        <span className="text-xs text-gray-500">{Math.round(progress)}%</span>
      </div>
      <div
        className="mb-4 h-2 overflow-hidden rounded-full bg-gray-200"
        role="progressbar"
        aria-label={`Paso ${currentStepIndex + 1} de ${steps.length}`}
        aria-valuemin={1}
        aria-valuemax={steps.length}
        aria-valuenow={currentStepIndex + 1}
      >
        <div className="h-full rounded-full bg-blue-600 transition-[width]" style={{ width: `${progress}%` }} />
      </div>
      <ol className="wizard-progress-list grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {steps.map((step, idx) => {
          const isCurrent = idx === currentStepIndex;
          const isPassed = idx < currentStepIndex;
          const isClickable = idx <= highestStepReached && idx !== currentStepIndex;

          return (
            <li key={step.id} className="wizard-progress-item">
              <button
                type="button"
                disabled={!isClickable}
                onClick={() => isClickable && onStepClick(idx)}
                className={`wizard-progress-button min-h-11 w-full text-left p-3 rounded-lg border text-sm font-medium transition-colors ${
                  isCurrent
                    ? 'border-blue-600 bg-blue-50 text-blue-900 font-semibold'
                    : isPassed
                    ? 'border-green-500 bg-green-50 text-green-800 cursor-pointer'
                    : isClickable
                    ? 'border-gray-300 hover:bg-gray-50 text-gray-700 cursor-pointer'
                    : 'border-gray-200 text-gray-400 cursor-not-allowed opacity-60'
                }`}
                aria-current={isCurrent ? 'step' : undefined}
              >
                <div className="flex items-center space-x-2">
                  <span
                    className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold ${
                      isCurrent
                        ? 'bg-blue-600 text-white'
                        : isPassed
                        ? 'bg-green-600 text-white'
                        : 'bg-gray-200 text-gray-700'
                    }`}
                  >
                    {isPassed ? '✓' : idx + 1}
                  </span>
                  <span>{step.title}</span>
                </div>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
};
