import React from 'react';
import { Minus, Plus } from 'lucide-react';
import { formatDiaperLoad, parseDiaperLoadCount } from '../../utils/careInterpreter';

interface DiaperLoadControlProps {
  value: string;
  onChange: (value: string) => void;
}

export const DiaperLoadControl: React.FC<DiaperLoadControlProps> = ({ value, onChange }) => {
  const count = parseDiaperLoadCount(value, 1);
  const display = formatDiaperLoad(count);

  const handleIncrement = () => {
    onChange(formatDiaperLoad(count + 1));
  };

  const handleDecrement = () => {
    onChange(formatDiaperLoad(Math.max(1, count - 1)));
  };

  return (
    <div className="flex items-center gap-1.5">
      <button
        type="button"
        onClick={handleIncrement}
        title="Click to increase diaper load (x1, x2, x3...)"
        className={`flex-1 min-w-0 px-2.5 sm:px-3 py-2 text-xs font-mono font-bold rounded-xl border transition-colors flex items-center justify-between gap-1.5 cursor-pointer select-none ${
          count > 1
            ? 'bg-emerald-50 dark:bg-emerald-950/60 border-emerald-300 dark:border-emerald-800 text-emerald-900 dark:text-emerald-200 hover:bg-emerald-100 dark:hover:bg-emerald-900/70'
            : 'bg-stone-50 dark:bg-stone-800 border-stone-200 dark:border-stone-700 text-stone-900 dark:text-white hover:bg-stone-100 dark:hover:bg-stone-700'
        }`}
      >
        <span>{display}</span>
        <Plus className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
      </button>

      {count > 1 && (
        <button
          type="button"
          onClick={handleDecrement}
          aria-label="Decrease diaper load"
          title="Decrease diaper load"
          className="px-2 py-2 text-xs rounded-xl bg-stone-100 dark:bg-stone-800 hover:bg-stone-200 dark:hover:bg-stone-700 border border-stone-200 dark:border-stone-700 text-stone-600 dark:text-stone-300 transition-colors cursor-pointer shrink-0"
        >
          <Minus className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
};
