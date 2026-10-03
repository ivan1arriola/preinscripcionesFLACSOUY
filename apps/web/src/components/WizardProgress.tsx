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
  return (
    <nav aria-label="Progreso de la preinscripción" className="mb-8">
      <ol className="wizard-progress-list flex flex-wrap md:flex-nowrap items-center w-full gap-2">
        {steps.map((step, idx) => {
          const isCurrent = idx === currentStepIndex;
          const isPassed = idx < currentStepIndex;
          const isClickable = idx <= highestStepReached && idx !== currentStepIndex;

          return (
            <li key={step.id} className="wizard-progress-item flex-1">
              <button
                type="button"
                disabled={!isClickable}
                onClick={() => isClickable && onStepClick(idx)}
                className={`wizard-progress-button w-full text-left p-3 rounded-lg border text-sm font-medium transition-colors ${
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
                  <span className="truncate">{step.title}</span>
                </div>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
};
