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
    <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-4 text-red-900" role="alert" aria-labelledby="form-error-summary-title">
      <h2 id="form-error-summary-title" className="text-base font-semibold">Revisá estos campos antes de continuar</h2>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
        {entries.map(([key, message]) => (
          <li key={key}>
            <a
              href={`#input-${key}`}
              className="font-medium underline focus:outline-none focus:ring-2 focus:ring-red-700"
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
  );
};
