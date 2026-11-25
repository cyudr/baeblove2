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
    <div
      className={`flex items-center w-full min-w-0 rounded-xl border transition-colors overflow-hidden ${
        count > 1
          ? 'bg-emerald-50 dark:bg-emerald-950/60 border-emerald-300 dark:border-emerald-800 text-emerald-900 dark:text-emerald-200'
          : 'bg-stone-50 dark:bg-stone-800 border-stone-200 dark:border-stone-700 text-stone-900 dark:text-white'
      }`}
    >
      <button
        type="button"
        onClick={handleDecrement}
        disabled={count <= 1}
        aria-label="Decrease diaper load"
        title="Decrease diaper load"
        className="px-2.5 py-2 text-xs text-stone-600 dark:text-stone-300 hover:bg-stone-200/70 dark:hover:bg-stone-700/70 transition-colors cursor-pointer disabled:opacity-45 disabled:hover:bg-transparent disabled:cursor-not-allowed shrink-0 flex items-center justify-center border-r border-stone-200/80 dark:border-stone-700/80"
      >
        <Minus className="w-3.5 h-3.5" />
      </button>

      <span className="flex-1 min-w-0 px-2 py-2 text-center text-xs font-mono font-bold select-none">
        {display}
      </span>

      <button
        type="button"
        onClick={handleIncrement}
        aria-label="Increase diaper load"
        title="Increase diaper load (x1, x2, x3...)"
        className="px-2.5 py-2 text-xs text-emerald-600 dark:text-emerald-400 hover:bg-emerald-100/80 dark:hover:bg-emerald-900/60 transition-colors cursor-pointer shrink-0 flex items-center justify-center border-l border-stone-200/80 dark:border-stone-700/80"
      >
        <Plus className="w-3.5 h-3.5" />
      </button>
    </div>
  );
};
