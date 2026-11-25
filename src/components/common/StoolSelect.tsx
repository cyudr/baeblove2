import React from 'react';
import { STOOL_TYPE_OPTIONS, parseStoolValue } from '../../utils/careInterpreter';

interface StoolSelectProps {
  value: string;
  onChange: (value: string) => void;
}

export const StoolSelect: React.FC<StoolSelectProps> = ({ value, onChange }) => {
  const parsed = parseStoolValue(value);
  const selectValue = parsed.type || parsed.custom;

  return (
    <select
      aria-label="Stool color code"
      value={selectValue}
      onChange={(e) => onChange(e.target.value)}
      className="w-full min-w-0 px-2.5 sm:px-3 py-2 text-xs bg-stone-50 dark:bg-stone-800 border border-stone-200 dark:border-stone-700 text-stone-900 dark:text-white rounded-xl focus:outline-hidden focus:border-emerald-500 cursor-pointer"
    >
      <option value="">None</option>
      {STOOL_TYPE_OPTIONS.map((opt) => (
        <option key={opt.code} value={opt.code}>
          {opt.label}
        </option>
      ))}
      {parsed.custom && <option value={parsed.custom}>{parsed.custom}</option>}
    </select>
  );
};
