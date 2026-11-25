import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MessageSquareText, X } from 'lucide-react';

interface RemarkTooltipCellProps {
  remark: string | null | undefined;
  label?: string;
}

export const RemarkTooltipCell: React.FC<RemarkTooltipCellProps> = ({
  remark,
  label = 'Remark',
}) => {
  const cleaned = (remark ?? '').trim();
  const [isOpen, setIsOpen] = useState(false);
  const [coords, setCoords] = useState<{
    top: number;
    left: number;
    placement: 'top' | 'bottom';
  } | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);

  const updatePosition = () => {
    const btn = triggerRef.current;
    if (!btn) return;
    const rect = btn.getBoundingClientRect();
    const tooltipWidth = 280;
    const estimatedHeight = 120;
    const margin = 10;

    let left = rect.left + rect.width / 2 - tooltipWidth / 2;
    left = Math.max(margin, Math.min(window.innerWidth - tooltipWidth - margin, left));

    const spaceBelow = window.innerHeight - rect.bottom;
    const placement: 'top' | 'bottom' =
      spaceBelow < estimatedHeight && rect.top > estimatedHeight ? 'top' : 'bottom';
    const top = placement === 'bottom' ? rect.bottom + 8 : rect.top - 8;

    setCoords({ top, left, placement });
  };

  useLayoutEffect(() => {
    if (!isOpen) return;
    updatePosition();
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    const handlePointerDown = (e: MouseEvent | TouchEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (triggerRef.current?.contains(target)) return;
      if (popoverRef.current?.contains(target)) return;
      setIsOpen(false);
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsOpen(false);
    };

    const handleViewportChange = () => {
      updatePosition();
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('touchstart', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('scroll', handleViewportChange, true);
    window.addEventListener('resize', handleViewportChange);

    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('touchstart', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('scroll', handleViewportChange, true);
      window.removeEventListener('resize', handleViewportChange);
    };
  }, [isOpen]);

  if (!cleaned) {
    return <span className="text-stone-400 dark:text-stone-500">—</span>;
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setIsOpen((prev) => !prev);
        }}
        aria-expanded={isOpen}
        aria-label={`View ${label.toLowerCase()}`}
        title={`Click to view ${label.toLowerCase()}`}
        className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg border text-[11px] font-semibold transition-colors cursor-pointer whitespace-nowrap ${
          isOpen
            ? 'bg-emerald-100 dark:bg-emerald-950/70 border-emerald-300 dark:border-emerald-700 text-emerald-900 dark:text-emerald-200'
            : 'bg-stone-100/90 dark:bg-stone-800 border-stone-200/80 dark:border-stone-700 text-stone-600 dark:text-stone-300 hover:bg-stone-200/70 dark:hover:bg-stone-700 hover:text-stone-900 dark:hover:text-white'
        }`}
      >
        <MessageSquareText className="w-3.5 h-3.5 shrink-0" />
        <span>View</span>
      </button>

      {isOpen &&
        coords &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={popoverRef}
            role="tooltip"
            style={{
              position: 'fixed',
              top: coords.top,
              left: coords.left,
              width: 280,
              transform: coords.placement === 'top' ? 'translateY(-100%)' : undefined,
              zIndex: 70,
            }}
            className="rounded-2xl bg-stone-900 dark:bg-stone-800 text-stone-100 border border-stone-700 dark:border-stone-600 shadow-xl p-3 text-xs"
          >
            <div className="flex items-center justify-between gap-2 pb-1.5 mb-1.5 border-b border-stone-700/80">
              <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-400 flex items-center gap-1.5">
                <MessageSquareText className="w-3 h-3" />
                <span>{label}</span>
              </span>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                aria-label="Close remark tooltip"
                className="p-0.5 rounded-md text-stone-400 hover:text-white hover:bg-stone-700 transition-colors cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            <p className="text-xs leading-relaxed text-stone-100 whitespace-pre-wrap break-words max-h-48 overflow-y-auto">
              {cleaned}
            </p>
          </div>,
          document.body
        )}
    </>
  );
};
