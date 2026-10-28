import React from 'react';

export interface FormErrorSummaryProps {
  errors: Record<string, string | undefined>;
  orderedKeys: string[];
  onSelectField: (key: string) => void;
}

export const FormErrorSummary: React.FC<FormErrorSummaryProps> = ({ errors, orderedKeys, onSelectField }) => {
  const entries = orderedKeys
    .filter((key) => errors[key])
    .map((key) => [key, errors[key]!] as const);

  if (entries.length === 0) return null;

  return (
    <div className="error-summary" role="alert" aria-labelledby="form-error-summary-title">
      <span className="error-summary__icon" aria-hidden="true">!</span>
      <div>
        <h2 id="form-error-summary-title">Revisá estos campos antes de continuar</h2>
        <ul>
        {entries.map(([key, message]) => (
          <li key={key}>
            <a
              href={`#input-${key}`}
              onClick={(event) => {
                event.preventDefault();
                onSelectField(key);
                document.getElementById(`input-${key}`)?.focus();
              }}
            >
              {message}
            </a>
          </li>
        ))}
        </ul>
      </div>
    </div>
  );
};
