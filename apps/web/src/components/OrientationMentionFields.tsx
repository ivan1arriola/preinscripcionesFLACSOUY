import React from 'react';
import type { Orientation } from '@flacso/contracts';

interface OrientationMentionFieldsProps {
  orientations: Orientation[];
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

export const OrientationMentionFields: React.FC<OrientationMentionFieldsProps> = ({
  orientations,
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
  const currentOrientationObj = orientations.find((o) => o.id === selectedOrientation);
  const availableMentions = currentOrientationObj?.mentions ?? [];

  const handleOrientationSelect = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newOrientation = e.target.value;
    onOrientationChange(newOrientation);

    // If current selected mention is not valid for new orientation, clear it
    const newObj = orientations.find((o) => o.id === newOrientation);
    if (!newObj?.mentions.some((m) => m.id === selectedMention)) {
      onMentionChange('');
    }
  };

  if (orientations.length === 0) {
    return null;
  }

  return (
    <div className="space-y-4">
      <div className="field-group">
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
          {orientations.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
        {orientationError && <p className="mt-1 text-sm text-red-600">{orientationError}</p>}
      </div>

      {availableMentions.length > 0 && (
        <div className="field-group">
          <label htmlFor="input-mencion" className="block text-sm font-medium text-gray-700">
            Mención {mentionRequired && <span className="text-red-600">*</span>}
          </label>
          <select
            id="input-mencion"
            name="mencion"
            value={selectedMention}
            onChange={(e) => onMentionChange(e.target.value)}
            disabled={disabled || !selectedOrientation}
            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
          >
            <option value="">-- Seleccione una mención (opcional) --</option>
            {availableMentions.map((m) => (
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
