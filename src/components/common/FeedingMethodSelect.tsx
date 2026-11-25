import React from 'react';
import {
  FEEDING_METHOD_OPTIONS,
  normalizeFeedingMethod,
} from '../../utils/careInterpreter';

interface FeedingMethodSelectProps {
  value: string;
  onChange: (value: string) => void;
}

export const FeedingMethodSelect: React.FC<FeedingMethodSelectProps> = ({
  value,
  onChange,
}) => {
  const normalized = normalizeFeedingMethod(value);
  const isKnownOption = FEEDING_METHOD_OPTIONS.some((opt) => opt.value === normalized);
  const customValue = normalized && !isKnownOption ? normalized : '';

  return (
    <select
      aria-label="Feeding method"
      value={normalized}
      onChange={(e) => onChange(e.target.value)}
      className="w-full min-w-0 px-2.5 sm:px-3 py-2 text-xs bg-stone-50 dark:bg-stone-800 border border-stone-200 dark:border-stone-700 text-stone-900 dark:text-white rounded-xl focus:outline-hidden focus:border-emerald-500 cursor-pointer"
    >
      <option value="" className="bg-white dark:bg-stone-900 text-stone-900 dark:text-stone-100">
        None
      </option>
      {FEEDING_METHOD_OPTIONS.map((opt) => (
        <option
          key={opt.value}
          value={opt.value}
          className="bg-white dark:bg-stone-900 text-stone-900 dark:text-stone-100"
        >
          {opt.label}
        </option>
      ))}
      {customValue && (
        <option
          value={customValue}
          className="bg-white dark:bg-stone-900 text-stone-900 dark:text-stone-100"
        >
          {customValue}
        </option>
      )}
    </select>
  );
};
