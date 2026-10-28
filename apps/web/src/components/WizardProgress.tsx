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
    <nav aria-label="Progreso de la preinscripción" className="wizard-progress">
      <div className="wizard-progress__summary">
        <div>
          <p className="wizard-progress__step">Paso {currentStepIndex + 1} de {steps.length}</p>
          <p className="wizard-progress__title">{currentStep?.title}</p>
        </div>
        <span className="wizard-progress__percent">{Math.round(progress)}%</span>
      </div>
      <div
        className="wizard-progress__track"
        role="progressbar"
        aria-label={`Paso ${currentStepIndex + 1} de ${steps.length}`}
        aria-valuemin={1}
        aria-valuemax={steps.length}
        aria-valuenow={currentStepIndex + 1}
      >
        <div className="wizard-progress__bar" style={{ width: `${progress}%` }} />
      </div>
      <ol className="stepper wizard-progress-list">
        {steps.map((step, idx) => {
          const isCurrent = idx === currentStepIndex;
          const isPassed = idx < currentStepIndex;
          const isClickable = idx <= highestStepReached && idx !== currentStepIndex;
          const state = isCurrent ? ' is-current' : isPassed ? ' is-done' : '';

          return (
            <li key={step.id} className={`stepper__item${isPassed ? ' is-done' : ''}`}>
              <button
                type="button"
                disabled={!isClickable}
                onClick={() => isClickable && onStepClick(idx)}
                className={`stepper__button${state}${isClickable ? ' is-clickable' : ''}`}
                aria-current={isCurrent ? 'step' : undefined}
              >
                <span className="stepper__dot" aria-hidden="true">{isPassed ? '✓' : idx + 1}</span>
                <span className="stepper__label">{step.title}</span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
};
