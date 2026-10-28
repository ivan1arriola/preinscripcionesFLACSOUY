import React from 'react';

interface OrientationOption {
  id: string;
  name: string;
}

interface OrientationMentionFieldsProps {
  orientations: Array<string | OrientationOption | any>;
  mentions?: Array<string | OrientationOption | any>;
  selectedOrientation: string;
  selectedMention: string;
  onOrientationChange: (orientationId: string) => void;
  onMentionChange: (mentionId: string) => void;
  orientationRequired?: boolean;
  mentionRequired?: boolean;
  orientationError?: string;
  mentionError?: string;
  disabled?: boolean;
}

const normalizeOption = (item: string | OrientationOption | any): OrientationOption => {
  if (typeof item === 'string') {
    return { id: item, name: item };
  }
  return {
    id: item?.id ?? item?.name ?? '',
    name: item?.name ?? item?.id ?? '',
  };
};

export const OrientationMentionFields: React.FC<OrientationMentionFieldsProps> = ({
  orientations = [],
  mentions = [],
  selectedOrientation,
  selectedMention,
  onOrientationChange,
  onMentionChange,
  orientationRequired = true,
  mentionRequired = false,
  orientationError,
  mentionError,
  disabled = false,
}) => {
  const normalizedOrientations = orientations.map(normalizeOption);
  const normalizedMentions = mentions.map(normalizeOption);

  const handleOrientationSelect = (e: React.ChangeEvent<HTMLSelectElement>) => onOrientationChange(e.target.value);

  if (normalizedOrientations.length === 0 && normalizedMentions.length === 0) {
    return null;
  }

  return (
    <div className="fields-grid">
      {normalizedOrientations.length > 0 && <div className={`field-group field-group--wide${orientationError ? ' has-error' : ''}`}>
        <label htmlFor="input-orientacion" className="field-label">
          Orientación {orientationRequired && <span className="field-required">*</span>}
        </label>
        <select
          id="input-orientacion"
          name="orientacion"
          value={selectedOrientation}
          onChange={handleOrientationSelect}
          disabled={disabled}
          aria-invalid={orientationError ? true : undefined}
        >
          <option value="">Seleccioná una orientación</option>
          {normalizedOrientations.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
        {orientationError && <p className="field-error">{orientationError}</p>}
      </div>}

      {normalizedMentions.length > 0 && (
        <div className={`field-group field-group--wide${mentionError ? ' has-error' : ''}`}>
          <label htmlFor="input-mencion" className="field-label">
            Mención {mentionRequired && <span className="field-required">*</span>}
          </label>
          <select
            id="input-mencion"
            name="mencion"
            value={selectedMention}
            onChange={(e) => onMentionChange(e.target.value)}
            disabled={disabled}
            aria-invalid={mentionError ? true : undefined}
          >
            <option value="">Seleccioná una mención (opcional)</option>
            {normalizedMentions.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
          {mentionError && <p className="field-error">{mentionError}</p>}
        </div>
      )}
    </div>
  );
};
