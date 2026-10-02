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
    <div className="space-y-4">
      {normalizedOrientations.length > 0 && <div className="field-group">
        <label htmlFor="input-orientacion" className="block text-sm font-medium text-gray-700">
          Orientación {orientationRequired && <span className="text-red-600">*</span>}
        </label>
        <select
          id="input-orientacion"
          name="orientacion"
          value={selectedOrientation}
          onChange={handleOrientationSelect}
          disabled={disabled}
          className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
        >
          <option value="">-- Seleccione una orientación --</option>
          {normalizedOrientations.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
        {orientationError && <p className="mt-1 text-sm text-red-600">{orientationError}</p>}
      </div>}

      {normalizedMentions.length > 0 && (
        <div className="field-group">
          <label htmlFor="input-mencion" className="block text-sm font-medium text-gray-700">
            Mención {mentionRequired && <span className="text-red-600">*</span>}
          </label>
          <select
            id="input-mencion"
            name="mencion"
            value={selectedMention}
            onChange={(e) => onMentionChange(e.target.value)}
            disabled={disabled}
            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
          >
            <option value="">-- Seleccione una mención (opcional) --</option>
            {normalizedMentions.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
          {mentionError && <p className="mt-1 text-sm text-red-600">{mentionError}</p>}
        </div>
      )}
    </div>
  );
};
