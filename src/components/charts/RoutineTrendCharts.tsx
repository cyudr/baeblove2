import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Baby, Clock, Droplets } from 'lucide-react';
import type { BabyMeasurement, ChildProfile, GrowthRecord, RoutineRecord } from '../../types';
import { UnitConverter } from '../../data/growthStandards';
import { parseCalendarDateUTC } from '../../utils/ageCalculator';
import {
  buildDailyRoutineSeries,
  buildDailyWeightResolver,
  buildMonthlyRoutineBoxPlots,
  buildWeeklyRoutineBoxPlots,
  isMilkTargetEligibleOnDate,
  type BoxPlotStats,
  type DailyRoutineBucket,
  type DailySpanOption,
  type MonthlySpanOption,
  type ResolvedDailyWeight,
  type RoutineChartGranularity,
  type RoutineInterpretation,
  type RoutinePeriodBoxPlotBucket,
  type WeeklySpanOption,
} from '../../utils/careInterpreter';

const DAILY_SPANS: { value: DailySpanOption; label: string }[] = [
  { value: 7, label: '7D' },
  { value: 14, label: '14D' },
  { value: 30, label: '30D' },
  { value: 'all', label: 'All' },
];

const WEEKLY_SPANS: { value: WeeklySpanOption; label: string }[] = [
  { value: 4, label: '4W' },
  { value: 8, label: '8W' },
  { value: 12, label: '12W' },
  { value: 'all', label: 'All' },
];

const MONTHLY_SPANS: { value: MonthlySpanOption; label: string }[] = [
  { value: 3, label: '3M' },
  { value: 6, label: '6M' },
  { value: 12, label: '12M' },
  { value: 'all', label: 'All' },
];

const GRANULARITY_OPTIONS: { value: RoutineChartGranularity; label: string }[] = [
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
];

function computeNiceAxisMax(rawMax: number, minFloor: number): number {
  const safe = Math.max(minFloor, rawMax);
  if (safe <= 12) return Math.ceil(safe / 2) * 2;
  if (safe <= 30) return Math.ceil(safe / 5) * 5;
  if (safe <= 100) return Math.ceil(safe / 20) * 20;
  if (safe <= 500) return Math.ceil(safe / 100) * 100;
  if (safe <= 2000) return Math.ceil(safe / 200) * 200;
  return Math.ceil(safe / 500) * 500;
}

function formatNum(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

interface PeriodIndexBadge {
  short: string;
  full: string;
}

function getIsoWeekNumber(dateStr: string): number {
  const utc = parseCalendarDateUTC(dateStr);
  if (utc === null) return 1;
  const d = new Date(utc);
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = Date.UTC(d.getUTCFullYear(), 0, 1);
  return Math.ceil(((d.getTime() - yearStart) / 86_400_000 + 1) / 7);
}

function getDayIndexLabel(dateStr: string, birthDate?: string | null): PeriodIndexBadge | null {
  const dateUtc = parseCalendarDateUTC(dateStr);
  if (dateUtc === null) return null;

  const birthUtc = birthDate ? parseCalendarDateUTC(birthDate) : null;
  if (birthUtc !== null) {
    const rawDays = Math.round((dateUtc - birthUtc) / 86_400_000);
    if (rawDays < 0) return null;
    return { short: `D${rawDays}`, full: `Day ${rawDays}` };
  }

  const d = new Date(dateUtc);
  const yearStart = Date.UTC(d.getUTCFullYear(), 0, 1);
  const dayOfYear = Math.floor((dateUtc - yearStart) / 86_400_000) + 1;
  return { short: `D${dayOfYear}`, full: `Day ${dayOfYear}` };
}

function getWeekIndexLabel(mondayStr: string, birthDate?: string | null): PeriodIndexBadge | null {
  const startUtc = parseCalendarDateUTC(mondayStr);
  if (startUtc === null) return null;

  const birthUtc = birthDate ? parseCalendarDateUTC(birthDate) : null;
  if (birthUtc !== null) {
    const endUtc = startUtc + 6 * 86_400_000;
    if (endUtc < birthUtc) return null;
    const midUtc = startUtc + 3 * 86_400_000;
    const midDays = Math.round((midUtc - birthUtc) / 86_400_000);
    const weekNum = Math.floor(Math.max(0, midDays) / 7) + 1;
    return { short: `W${weekNum}`, full: `Week ${weekNum}` };
  }

  const isoWeek = getIsoWeekNumber(mondayStr);
  return { short: `W${isoWeek}`, full: `Week ${isoWeek}` };
}

function getMonthIndexLabel(ymKey: string, birthDate?: string | null): PeriodIndexBadge | null {
  const match = /^(\d{4})-(\d{2})/.exec(ymKey);
  if (!match) return null;
  const y = Number(match[1]);
  const m = Number(match[2]);

  if (birthDate) {
    const birthMatch = /^(\d{4})-(\d{2})/.exec(birthDate.trim());
    if (birthMatch) {
      const by = Number(birthMatch[1]);
      const bm = Number(birthMatch[2]);
      const diff = (y - by) * 12 + (m - bm);
      if (diff < 0) return null;
      const monthNum = diff + 1;
      return { short: `M${monthNum}`, full: `Month ${monthNum}` };
    }
  }

  return { short: `M${m}`, full: `Month ${m}` };
}

function formatUtcDateYMD(utcMs: number): string {
  const d = new Date(utcMs);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function getPeriodEligibleMilkDates(
  granularity: 'weekly' | 'monthly',
  periodKey: string,
  focusDate?: string,
  birthDate?: string | null
): string[] {
  const allDates: string[] = [];
  if (granularity === 'weekly') {
    const startUtc = parseCalendarDateUTC(periodKey);
    if (startUtc === null) return [];
    for (let i = 0; i < 7; i++) {
      allDates.push(formatUtcDateYMD(startUtc + i * 86_400_000));
    }
  } else {
    const match = /^(\d{4})-(\d{2})/.exec(periodKey);
    if (!match) return [];
    const y = Number(match[1]);
    const m = Number(match[2]);
    const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
    for (let day = 1; day <= daysInMonth; day++) {
      allDates.push(`${match[1]}-${match[2]}-${String(day).padStart(2, '0')}`);
    }
  }

  const cappedDates = focusDate ? allDates.filter((d) => d <= focusDate) : allDates;
  const candidateDates = cappedDates.length > 0 ? cappedDates : allDates;
  return candidateDates.filter((d) => isMilkTargetEligibleOnDate(d, birthDate));
}

function computePeriodRecommendedMl(
  granularity: 'weekly' | 'monthly',
  periodKey: string,
  effectiveRateMlPerKg: number | null,
  resolveWeight: (dateStr: string) => ResolvedDailyWeight | null,
  focusDate?: string,
  birthDate?: string | null,
  minRateMlPerKg?: number | null,
  maxRateMlPerKg?: number | null
): { targetMl: number; minMl: number | null; maxMl: number | null; avgWeightKg: number } | null {
  if (!effectiveRateMlPerKg || effectiveRateMlPerKg <= 0) return null;

  const eligibleDates = getPeriodEligibleMilkDates(granularity, periodKey, focusDate, birthDate);
  if (eligibleDates.length === 0) return null;

  const weights: number[] = [];
  for (const dateStr of eligibleDates) {
    const resolved = resolveWeight(dateStr);
    if (resolved && resolved.weightKg > 0) {
      weights.push(resolved.weightKg);
    }
  }

  if (weights.length === 0) return null;
  const avgWeightKg =
    Math.round((weights.reduce((sum, w) => sum + w, 0) / weights.length) * 1000) / 1000;
  return {
    targetMl: Math.round(avgWeightKg * effectiveRateMlPerKg),
    minMl:
      minRateMlPerKg && minRateMlPerKg > 0 ? Math.round(avgWeightKg * minRateMlPerKg) : null,
    maxMl:
      maxRateMlPerKg && maxRateMlPerKg > 0 ? Math.round(avgWeightKg * maxRateMlPerKg) : null,
    avgWeightKg,
  };
}

interface GranularityControlsProps {
  granularity: RoutineChartGranularity;
  onGranularityChange: (next: RoutineChartGranularity) => void;
  dailySpan: DailySpanOption;
  onDailySpanChange: (next: DailySpanOption) => void;
  weeklySpan: WeeklySpanOption;
  onWeeklySpanChange: (next: WeeklySpanOption) => void;
  monthlySpan: MonthlySpanOption;
  onMonthlySpanChange: (next: MonthlySpanOption) => void;
}

const ChartControls: React.FC<GranularityControlsProps> = ({
  granularity,
  onGranularityChange,
  dailySpan,
  onDailySpanChange,
  weeklySpan,
  onWeeklySpanChange,
  monthlySpan,
  onMonthlySpanChange,
}) => {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {/* Granularity segmented control */}
      <div
        role="group"
        aria-label="Chart granularity"
        className="inline-flex items-center p-0.5 rounded-xl bg-stone-100 dark:bg-stone-800 border border-stone-200/70 dark:border-stone-700/70"
      >
        {GRANULARITY_OPTIONS.map((opt) => {
          const active = granularity === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => onGranularityChange(opt.value)}
              className={`px-2 py-1 text-[10px] font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                active
                  ? 'bg-white dark:bg-stone-900 text-stone-900 dark:text-white shadow-2xs'
                  : 'text-stone-500 dark:text-stone-400 hover:text-stone-800 dark:hover:text-stone-200'
              }`}
            >
              {opt.label}
            </button>
          );
        })}
      </div>

      {/* Span / expansion selector */}
      <div
        role="group"
        aria-label="Time window"
        className="inline-flex items-center p-0.5 rounded-xl bg-stone-100 dark:bg-stone-800 border border-stone-200/70 dark:border-stone-700/70"
      >
        {granularity === 'daily' &&
          DAILY_SPANS.map((opt) => {
            const active = dailySpan === opt.value;
            return (
              <button
                key={String(opt.value)}
                type="button"
                onClick={() => onDailySpanChange(opt.value)}
                className={`px-1.5 py-1 text-[10px] font-mono font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  active
                    ? 'bg-white dark:bg-stone-900 text-emerald-700 dark:text-emerald-400 shadow-2xs'
                    : 'text-stone-500 dark:text-stone-400 hover:text-stone-800 dark:hover:text-stone-200'
                }`}
              >
                {opt.label}
              </button>
            );
          })}

        {granularity === 'weekly' &&
          WEEKLY_SPANS.map((opt) => {
            const active = weeklySpan === opt.value;
            return (
              <button
                key={String(opt.value)}
                type="button"
                onClick={() => onWeeklySpanChange(opt.value)}
                className={`px-1.5 py-1 text-[10px] font-mono font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  active
                    ? 'bg-white dark:bg-stone-900 text-emerald-700 dark:text-emerald-400 shadow-2xs'
                    : 'text-stone-500 dark:text-stone-400 hover:text-stone-800 dark:hover:text-stone-200'
                }`}
              >
                {opt.label}
              </button>
            );
          })}

        {granularity === 'monthly' &&
          MONTHLY_SPANS.map((opt) => {
            const active = monthlySpan === opt.value;
            return (
              <button
                key={String(opt.value)}
                type="button"
                onClick={() => onMonthlySpanChange(opt.value)}
                className={`px-1.5 py-1 text-[10px] font-mono font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  active
                    ? 'bg-white dark:bg-stone-900 text-emerald-700 dark:text-emerald-400 shadow-2xs'
                    : 'text-stone-500 dark:text-stone-400 hover:text-stone-800 dark:hover:text-stone-200'
                }`}
              >
                {opt.label}
              </button>
            );
          })}
      </div>
    </div>
  );
};

interface SvgBoxPlotProps {
  periods: RoutinePeriodBoxPlotBucket[];
  getStats: (period: RoutinePeriodBoxPlotBucket) => BoxPlotStats | null;
  getSubLabel?: (period: RoutinePeriodBoxPlotBucket) => string | null;
  axisMax: number;
  unitLabel: string;
  accent: 'emerald' | 'sky';
  referenceLine?: { value: number; label: string; color?: 'emerald' | 'pink' } | null;
  referencePoints?: (number | null)[];
  minReferencePoints?: (number | null)[];
  maxReferencePoints?: (number | null)[];
  minReferenceLine?: number | null;
  maxReferenceLine?: number | null;
  activeKey: string | null;
  onHoverKey: (key: string | null) => void;
}

const SvgBoxPlot: React.FC<SvgBoxPlotProps> = ({
  periods,
  getStats,
  getSubLabel,
  axisMax,
  unitLabel,
  accent,
  referenceLine,
  referencePoints,
  minReferencePoints,
  maxReferencePoints,
  minReferenceLine,
  maxReferenceLine,
  activeKey,
  onHoverKey,
}) => {
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) {
      el.scrollLeft = el.scrollWidth;
    }
  }, [periods.length]);

  const svgHeight = 166;
  const padTop = 14;
  const padBottom = 36;
  const padLeft = 36;
  const padRight = 10;
  const plotHeight = svgHeight - padTop - padBottom;

  const slotWidth = periods.length <= 6 ? 68 : periods.length <= 10 ? 54 : 46;
  const minSvgWidth = Math.max(300, padLeft + padRight + periods.length * slotWidth);
  const plotWidth = minSvgWidth - padLeft - padRight;
  const colStep = periods.length > 0 ? plotWidth / periods.length : plotWidth;
  const boxWidth = Math.max(14, Math.min(26, colStep * 0.44));

  const yOf = (val: number) => {
    const clamped = Math.max(0, Math.min(axisMax, val));
    return padTop + plotHeight - (clamped / axisMax) * plotHeight;
  };

  const ticks = [0, Math.round(axisMax / 3), Math.round((axisMax * 2) / 3), axisMax];

  const boxFillClass =
    accent === 'emerald'
      ? 'fill-emerald-500/20 dark:fill-emerald-400/20'
      : 'fill-sky-500/20 dark:fill-sky-400/20';
  const strokeClass =
    accent === 'emerald'
      ? 'stroke-emerald-600 dark:stroke-emerald-400'
      : 'stroke-sky-600 dark:stroke-sky-400';
  const medianStrokeClass =
    accent === 'emerald'
      ? 'stroke-emerald-800 dark:stroke-emerald-200'
      : 'stroke-sky-800 dark:stroke-sky-200';
  const hoverFillClass =
    accent === 'emerald'
      ? 'fill-emerald-500/8 dark:fill-emerald-400/10'
      : 'fill-sky-500/8 dark:fill-sky-400/10';
  const subLabelFillClass =
    accent === 'emerald'
      ? 'fill-emerald-700/80 dark:fill-emerald-400/80'
      : 'fill-sky-700/80 dark:fill-sky-400/80';

  const buildRefSeries = (points?: (number | null)[]) => {
    if (!points || points.length === 0) return { coords: [] as { idx: number; cx: number; y: number; value: number }[], pathD: '' };
    const coords: { idx: number; cx: number; y: number; value: number }[] = [];
    for (let i = 0; i < periods.length; i++) {
      const val = points[i];
      if (val !== null && val !== undefined && val > 0) {
        coords.push({
          idx: i,
          cx: padLeft + i * colStep + colStep / 2,
          y: yOf(val),
          value: val,
        });
      }
    }
    if (coords.length === 0) return { coords, pathD: '' };
    if (coords.length === 1) {
      const p = coords[0];
      const half = Math.max(12, colStep * 0.36);
      return {
        coords,
        pathD: `M ${(p.cx - half).toFixed(1)} ${p.y.toFixed(1)} L ${(p.cx + half).toFixed(1)} ${p.y.toFixed(1)}`,
      };
    }
    return {
      coords,
      pathD: coords
        .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.cx.toFixed(1)} ${p.y.toFixed(1)}`)
        .join(' '),
    };
  };

  const { coords: referenceCoords, pathD: referencePathD } = useMemo(
    () => buildRefSeries(referencePoints),
    [referencePoints, periods.length, colStep, axisMax]
  );

  const { coords: minRefCoords, pathD: minRefPathD } = useMemo(
    () => buildRefSeries(minReferencePoints),
    [minReferencePoints, periods.length, colStep, axisMax]
  );

  const { coords: maxRefCoords, pathD: maxRefPathD } = useMemo(
    () => buildRefSeries(maxReferencePoints),
    [maxReferencePoints, periods.length, colStep, axisMax]
  );

  return (
    <div ref={scrollRef} className="w-full overflow-x-auto pb-1">
      <svg
        viewBox={`0 0 ${minSvgWidth} ${svgHeight}`}
        className="w-full h-[166px] select-none"
        style={{ minWidth: periods.length > 6 ? `${minSvgWidth}px` : undefined }}
        role="img"
        aria-label={`Box plot chart in ${unitLabel}`}
      >
        {/* Y-axis gridlines and tick labels */}
        {ticks.map((tick) => {
          const y = yOf(tick);
          return (
            <g key={tick}>
              <line
                x1={padLeft}
                x2={minSvgWidth - padRight}
                y1={y}
                y2={y}
                className="stroke-stone-200/80 dark:stroke-stone-800"
                strokeWidth={1}
              />
              <text
                x={padLeft - 6}
                y={y + 3}
                textAnchor="end"
                className="fill-stone-400 dark:fill-stone-500 text-[9px] font-mono tabular-nums"
              >
                {tick}
              </text>
            </g>
          );
        })}

        {/* Optional constant min/max pink dotted benchmark lines */}
        {!minRefPathD &&
          minReferenceLine &&
          minReferenceLine > 0 &&
          minReferenceLine <= axisMax && (
            <line
              x1={padLeft}
              x2={minSvgWidth - padRight}
              y1={yOf(minReferenceLine)}
              y2={yOf(minReferenceLine)}
              className="stroke-pink-500/75 dark:stroke-pink-400/75"
              strokeWidth={0.9}
              strokeDasharray="1.5 3"
              strokeLinecap="round"
            />
          )}
        {!maxRefPathD &&
          maxReferenceLine &&
          maxReferenceLine > 0 &&
          maxReferenceLine <= axisMax && (
            <line
              x1={padLeft}
              x2={minSvgWidth - padRight}
              y1={yOf(maxReferenceLine)}
              y2={yOf(maxReferenceLine)}
              className="stroke-pink-500/75 dark:stroke-pink-400/75"
              strokeWidth={0.9}
              strokeDasharray="1.5 3"
              strokeLinecap="round"
            />
          )}

        {/* Optional constant benchmark/target dashed line */}
        {!referencePathD &&
          referenceLine &&
          referenceLine.value > 0 &&
          referenceLine.value <= axisMax && (
            <g>
              <line
                x1={padLeft}
                x2={minSvgWidth - padRight}
                y1={yOf(referenceLine.value)}
                y2={yOf(referenceLine.value)}
                className={
                  referenceLine.color === 'pink'
                    ? 'stroke-pink-500/80 dark:stroke-pink-400/80'
                    : 'stroke-emerald-500/70 dark:stroke-emerald-400/60'
                }
                strokeWidth={1.35}
                strokeDasharray="4 3"
              />
            </g>
          )}

        {/* Box plots per period */}
        {periods.map((period, idx) => {
          const cx = padLeft + idx * colStep + colStep / 2;
          const stats = getStats(period);
          const isHovered = activeKey === period.key;

          return (
            <g
              key={period.key}
              className="cursor-pointer"
              onMouseEnter={() => onHoverKey(period.key)}
              onMouseLeave={() => onHoverKey(null)}
              onClick={() => onHoverKey(activeKey === period.key ? null : period.key)}
            >
              {/* Hover column backdrop */}
              <rect
                x={padLeft + idx * colStep + 2}
                y={padTop - 4}
                width={Math.max(0, colStep - 4)}
                height={plotHeight + 8}
                rx={6}
                className={isHovered ? hoverFillClass : 'fill-transparent'}
              />

              {stats ? (
                <>
                  {/* Vertical whisker min -> max */}
                  <line
                    x1={cx}
                    x2={cx}
                    y1={yOf(stats.max)}
                    y2={yOf(stats.min)}
                    className={strokeClass}
                    strokeWidth={1.5}
                  />
                  {/* Upper whisker cap */}
                  <line
                    x1={cx - boxWidth * 0.34}
                    x2={cx + boxWidth * 0.34}
                    y1={yOf(stats.max)}
                    y2={yOf(stats.max)}
                    className={strokeClass}
                    strokeWidth={1.5}
                    strokeLinecap="round"
                  />
                  {/* Lower whisker cap */}
                  <line
                    x1={cx - boxWidth * 0.34}
                    x2={cx + boxWidth * 0.34}
                    y1={yOf(stats.min)}
                    y2={yOf(stats.min)}
                    className={strokeClass}
                    strokeWidth={1.5}
                    strokeLinecap="round"
                  />

                  {/* IQR Box (Q1 to Q3) */}
                  {(() => {
                    const yQ3 = yOf(stats.q3);
                    const yQ1 = yOf(stats.q1);
                    const rawH = Math.abs(yQ1 - yQ3);
                    const boxH = Math.max(4, rawH);
                    const boxY = rawH < 4 ? yOf(stats.median) - boxH / 2 : yQ3;
                    return (
                      <rect
                        x={cx - boxWidth / 2}
                        y={boxY}
                        width={boxWidth}
                        height={boxH}
                        rx={3.5}
                        className={`${boxFillClass} ${strokeClass}`}
                        strokeWidth={1.5}
                      />
                    );
                  })()}

                  {/* Median line */}
                  <line
                    x1={cx - boxWidth / 2}
                    x2={cx + boxWidth / 2}
                    y1={yOf(stats.median)}
                    y2={yOf(stats.median)}
                    className={medianStrokeClass}
                    strokeWidth={2.5}
                    strokeLinecap="round"
                  />

                  {/* Mean marker */}
                  <circle
                    cx={cx}
                    cy={yOf(stats.mean)}
                    r={2.8}
                    className={`fill-white dark:fill-stone-900 ${medianStrokeClass}`}
                    strokeWidth={1.5}
                  />
                </>
              ) : (
                <line
                  x1={cx - 5}
                  x2={cx + 5}
                  y1={yOf(0) - 2}
                  y2={yOf(0) - 2}
                  className="stroke-stone-300 dark:stroke-stone-700"
                  strokeWidth={1.5}
                  strokeLinecap="round"
                />
              )}

              {/* X-axis period date label + week/month number below */}
              <text
                x={cx}
                y={svgHeight - 19}
                textAnchor="middle"
                className={`text-[9px] font-mono ${
                  isHovered
                    ? 'fill-stone-900 dark:fill-white font-bold'
                    : 'fill-stone-400 dark:fill-stone-500'
                }`}
              >
                {period.label}
              </text>
              {getSubLabel?.(period) && (
                <text
                  x={cx}
                  y={svgHeight - 7}
                  textAnchor="middle"
                  className={`text-[8.5px] font-mono font-semibold ${
                    isHovered ? 'fill-stone-800 dark:fill-stone-100' : subLabelFillClass
                  }`}
                >
                  {getSubLabel(period)}
                </text>
              )}
            </g>
          );
        })}

        {/* Dynamic pink dotted min & max recommended lines across periods */}
        {(minRefPathD || maxRefPathD) && (
          <g className="pointer-events-none">
            {minRefPathD && (
              <path
                d={minRefPathD}
                fill="none"
                className="stroke-pink-500/80 dark:stroke-pink-400/80"
                strokeWidth={0.95}
                strokeDasharray="1.5 3"
                strokeLinecap="round"
              />
            )}
            {maxRefPathD && (
              <path
                d={maxRefPathD}
                fill="none"
                className="stroke-pink-500/80 dark:stroke-pink-400/80"
                strokeWidth={0.95}
                strokeDasharray="1.5 3"
                strokeLinecap="round"
              />
            )}
            {minRefCoords.map((pt) => {
              const period = periods[pt.idx];
              const isHovered = period && activeKey === period.key;
              return (
                <circle
                  key={`min-ref-${pt.idx}`}
                  cx={pt.cx}
                  cy={pt.y}
                  r={isHovered ? 2 : 1.2}
                  className="fill-pink-500 dark:fill-pink-400 stroke-white dark:stroke-stone-900"
                  strokeWidth={0.6}
                />
              );
            })}
            {maxRefCoords.map((pt) => {
              const period = periods[pt.idx];
              const isHovered = period && activeKey === period.key;
              return (
                <circle
                  key={`max-ref-${pt.idx}`}
                  cx={pt.cx}
                  cy={pt.y}
                  r={isHovered ? 2 : 1.2}
                  className="fill-pink-500 dark:fill-pink-400 stroke-white dark:stroke-stone-900"
                  strokeWidth={0.6}
                />
              );
            })}
          </g>
        )}

        {/* Dynamic green dotted recommended line across periods (based on daily weights) */}
        {referencePathD && (
          <g className="pointer-events-none">
            <path
              d={referencePathD}
              fill="none"
              className="stroke-emerald-600 dark:stroke-emerald-400"
              strokeWidth={1.65}
              strokeDasharray="4 3"
            />
            {referenceCoords.map((pt) => {
              const period = periods[pt.idx];
              const isHovered = period && activeKey === period.key;
              return (
                <circle
                  key={`ref-${pt.idx}`}
                  cx={pt.cx}
                  cy={pt.y}
                  r={isHovered ? 3.2 : 2.2}
                  className="fill-emerald-600 dark:fill-emerald-400 stroke-white dark:stroke-stone-900"
                  strokeWidth={1}
                />
              );
            })}
          </g>
        )}
      </svg>
    </div>
  );
};

interface FeedingVolumeTrendChartProps {
  records: RoutineRecord[];
  estimatedTargetMl?: number | null;
  targetMinMl?: number | null;
  targetMaxMl?: number | null;
  minRateMlPerKg?: number | null;
  maxRateMlPerKg?: number | null;
  effectiveTargetMlPerKg?: number | null;
  focusDate?: string;
  birthDate?: string | null;
  resolveWeightForDate?: (dateStr: string) => ResolvedDailyWeight | null;
}

export const FeedingVolumeTrendChart: React.FC<FeedingVolumeTrendChartProps> = ({
  records,
  estimatedTargetMl = null,
  targetMinMl = null,
  targetMaxMl = null,
  minRateMlPerKg = null,
  maxRateMlPerKg = null,
  effectiveTargetMlPerKg = null,
  focusDate,
  birthDate = null,
  resolveWeightForDate,
}) => {
  const [granularity, setGranularity] = useState<RoutineChartGranularity>('daily');
  const [dailySpan, setDailySpan] = useState<DailySpanOption>(7);
  const [weeklySpan, setWeeklySpan] = useState<WeeklySpanOption>(4);
  const [monthlySpan, setMonthlySpan] = useState<MonthlySpanOption>(6);
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);
  const dailyScrollRef = useRef<HTMLDivElement | null>(null);

  const dailySeries = useMemo(
    () => (granularity === 'daily' ? buildDailyRoutineSeries(records, dailySpan, focusDate) : []),
    [records, granularity, dailySpan, focusDate]
  );

  const periodBuckets = useMemo(() => {
    if (granularity === 'weekly') {
      return buildWeeklyRoutineBoxPlots(records, weeklySpan, focusDate);
    }
    if (granularity === 'monthly') {
      return buildMonthlyRoutineBoxPlots(records, monthlySpan, focusDate);
    }
    return [];
  }, [records, granularity, weeklySpan, monthlySpan, focusDate]);

  useEffect(() => {
    setHoveredKey(null);
  }, [granularity, dailySpan, weeklySpan, monthlySpan]);

  useEffect(() => {
    if (granularity === 'daily' && dailyScrollRef.current) {
      dailyScrollRef.current.scrollLeft = dailyScrollRef.current.scrollWidth;
    }
  }, [granularity, dailySeries.length]);

  const dailyAvgMl = useMemo(() => {
    const active = dailySeries.filter((d) => d.totalMl > 0);
    if (active.length === 0) return 0;
    return Math.round(active.reduce((s, d) => s + d.totalMl, 0) / active.length);
  }, [dailySeries]);

  const dailyTargets = useMemo(() => {
    return dailySeries.map((bucket) => {
      if (!isMilkTargetEligibleOnDate(bucket.date, birthDate)) {
        return null;
      }
      if (resolveWeightForDate && effectiveTargetMlPerKg && effectiveTargetMlPerKg > 0) {
        const resolved = resolveWeightForDate(bucket.date);
        if (resolved && resolved.weightKg > 0) {
          return {
            targetMl: Math.round(resolved.weightKg * effectiveTargetMlPerKg),
            minMl:
              minRateMlPerKg && minRateMlPerKg > 0
                ? Math.round(resolved.weightKg * minRateMlPerKg)
                : null,
            maxMl:
              maxRateMlPerKg && maxRateMlPerKg > 0
                ? Math.round(resolved.weightKg * maxRateMlPerKg)
                : null,
            weightKg: resolved.weightKg,
            isExactWeight: resolved.isExact,
          };
        }
      }
      if (estimatedTargetMl && estimatedTargetMl > 0) {
        return {
          targetMl: estimatedTargetMl,
          minMl: targetMinMl && targetMinMl > 0 ? targetMinMl : null,
          maxMl: targetMaxMl && targetMaxMl > 0 ? targetMaxMl : null,
          weightKg: null,
          isExactWeight: false,
        };
      }
      return null;
    });
  }, [
    dailySeries,
    birthDate,
    resolveWeightForDate,
    effectiveTargetMlPerKg,
    minRateMlPerKg,
    maxRateMlPerKg,
    estimatedTargetMl,
    targetMinMl,
    targetMaxMl,
  ]);

  const periodTargets = useMemo(() => {
    if (granularity === 'daily') return [];
    return periodBuckets.map((period) => {
      const eligibleDates = getPeriodEligibleMilkDates(
        granularity,
        period.key,
        focusDate,
        birthDate
      );
      if (eligibleDates.length === 0) {
        return null;
      }
      if (resolveWeightForDate && effectiveTargetMlPerKg && effectiveTargetMlPerKg > 0) {
        const computed = computePeriodRecommendedMl(
          granularity,
          period.key,
          effectiveTargetMlPerKg,
          resolveWeightForDate,
          focusDate,
          birthDate,
          minRateMlPerKg,
          maxRateMlPerKg
        );
        if (computed) return computed;
      }
      if (estimatedTargetMl && estimatedTargetMl > 0) {
        return {
          targetMl: estimatedTargetMl,
          minMl: targetMinMl && targetMinMl > 0 ? targetMinMl : null,
          maxMl: targetMaxMl && targetMaxMl > 0 ? targetMaxMl : null,
          avgWeightKg: null as number | null,
        };
      }
      return null;
    });
  }, [
    granularity,
    periodBuckets,
    birthDate,
    resolveWeightForDate,
    effectiveTargetMlPerKg,
    minRateMlPerKg,
    maxRateMlPerKg,
    focusDate,
    estimatedTargetMl,
    targetMinMl,
    targetMaxMl,
  ]);

  const dailyAxisMax = useMemo(() => {
    const maxData = Math.max(0, ...dailySeries.map((d) => d.totalMl));
    const maxTarget = Math.max(
      0,
      ...dailyTargets.map((t) => Math.max(t?.targetMl ?? 0, t?.maxMl ?? 0))
    );
    return computeNiceAxisMax(Math.max(maxData, maxTarget), 200);
  }, [dailySeries, dailyTargets]);

  const boxAxisMax = useMemo(() => {
    const maxVal = Math.max(
      0,
      ...periodBuckets.map((p) => p.milkStats?.max ?? 0),
      ...periodTargets.map((t) => Math.max(t?.targetMl ?? 0, t?.maxMl ?? 0)),
      !birthDate ? Math.max(estimatedTargetMl ?? 0, targetMaxMl ?? 0) : 0
    );
    return computeNiceAxisMax(maxVal, 200);
  }, [periodBuckets, periodTargets, estimatedTargetMl, targetMaxMl, birthDate]);

  const buildDailyOverlayPath = (getValue: (idx: number) => number | null | undefined) => {
    const pts: { x: number; y: number; idx: number }[] = [];
    for (let i = 0; i < dailyTargets.length; i++) {
      const val = getValue(i);
      if (val === null || val === undefined || val <= 0) continue;
      const x = (i + 0.5) * 100;
      const clamped = Math.max(0, Math.min(dailyAxisMax, val));
      const y = 100 - (clamped / dailyAxisMax) * 100;
      pts.push({ x, y, idx: i });
    }
    if (pts.length === 0) return '';
    if (pts.length === 1) {
      const p = pts[0];
      return `M ${(p.idx * 100 + 8).toFixed(1)} ${p.y.toFixed(2)} L ${((p.idx + 1) * 100 - 8).toFixed(1)} ${p.y.toFixed(2)}`;
    }
    return pts
      .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(2)}`)
      .join(' ');
  };

  const dailyRecommendedPath = useMemo(
    () => buildDailyOverlayPath((i) => dailyTargets[i]?.targetMl),
    [dailyTargets, dailyAxisMax]
  );

  const dailyMinPath = useMemo(
    () => buildDailyOverlayPath((i) => dailyTargets[i]?.minMl),
    [dailyTargets, dailyAxisMax]
  );

  const dailyMaxPath = useMemo(
    () => buildDailyOverlayPath((i) => dailyTargets[i]?.maxMl),
    [dailyTargets, dailyAxisMax]
  );

  const hasMinMaxBounds = useMemo(() => {
    if (granularity === 'daily') {
      return Boolean(dailyMinPath || dailyMaxPath);
    }
    return periodTargets.some(
      (t) => (t?.minMl !== null && (t?.minMl ?? 0) > 0) || (t?.maxMl !== null && (t?.maxMl ?? 0) > 0)
    );
  }, [granularity, dailyMinPath, dailyMaxPath, periodTargets]);

  const legendTargetSummary = useMemo(() => {
    const vals =
      granularity === 'daily'
        ? dailyTargets.map((t) => t?.targetMl).filter((v): v is number => typeof v === 'number' && v > 0)
        : periodTargets.map((t) => t?.targetMl).filter((v): v is number => typeof v === 'number' && v > 0);
    if (vals.length === 0) return null;
    const minVal = Math.min(...vals);
    const maxVal = Math.max(...vals);
    if (minVal === maxVal) return `Rec: ${maxVal} mL/d`;
    return `Rec: ${minVal}–${maxVal} mL/d`;
  }, [granularity, dailyTargets, periodTargets]);

  const hoveredDailyIndex = useMemo(() => {
    if (granularity !== 'daily' || !hoveredKey) return -1;
    return dailySeries.findIndex((d) => d.date === hoveredKey);
  }, [granularity, hoveredKey, dailySeries]);

  const hoveredDaily: DailyRoutineBucket | null =
    hoveredDailyIndex >= 0 ? dailySeries[hoveredDailyIndex] : null;
  const hoveredDailyTarget = hoveredDailyIndex >= 0 ? dailyTargets[hoveredDailyIndex] : null;
  const hoveredDailyBadge = hoveredDaily ? getDayIndexLabel(hoveredDaily.date, birthDate) : null;

  const hoveredPeriodIndex = useMemo(() => {
    if (granularity === 'daily' || !hoveredKey) return -1;
    return periodBuckets.findIndex((p) => p.key === hoveredKey);
  }, [granularity, hoveredKey, periodBuckets]);

  const hoveredPeriod: RoutinePeriodBoxPlotBucket | null =
    hoveredPeriodIndex >= 0 ? periodBuckets[hoveredPeriodIndex] : null;
  const hoveredPeriodTarget = hoveredPeriodIndex >= 0 ? periodTargets[hoveredPeriodIndex] : null;
  const hoveredPeriodBadge = hoveredPeriod
    ? granularity === 'weekly'
      ? getWeekIndexLabel(hoveredPeriod.key, birthDate)
      : getMonthIndexLabel(hoveredPeriod.key, birthDate)
    : null;

  const titleLabel =
    granularity === 'daily'
      ? dailySpan === 'all'
        ? `Daily Volume (${dailySeries.length}d)`
        : `${dailySpan}-Day Volume Trend`
      : granularity === 'weekly'
        ? 'Weekly Volume Distribution'
        : 'Monthly Volume Distribution';

  const summaryRight = useMemo(() => {
    if (granularity === 'daily') {
      return `Avg ${dailyAvgMl} mL/d`;
    }
    const populated = periodBuckets.filter((p) => p.milkStats !== null);
    if (populated.length === 0) return 'No data';
    const avgMed = Math.round(
      populated.reduce((s, p) => s + (p.milkStats?.median ?? 0), 0) / populated.length
    );
    return `Med ~${avgMed} mL/d`;
  }, [granularity, dailyAvgMl, periodBuckets]);

  return (
    <div className="pt-3 border-t border-stone-100 dark:border-stone-800 space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-bold text-stone-700 dark:text-stone-200">
            {titleLabel}
          </span>
          <span className="text-[10px] font-mono tabular-nums text-stone-500 dark:text-stone-400">
            · {summaryRight}
          </span>
        </div>

        <ChartControls
          granularity={granularity}
          onGranularityChange={setGranularity}
          dailySpan={dailySpan}
          onDailySpanChange={setDailySpan}
          weeklySpan={weeklySpan}
          onWeeklySpanChange={setWeeklySpan}
          monthlySpan={monthlySpan}
          onMonthlySpanChange={setMonthlySpan}
        />
      </div>

      {/* Live readout strip */}
      <div className="min-h-[18px] text-[10px] font-mono tabular-nums text-stone-500 dark:text-stone-400 flex flex-wrap items-center gap-x-2 gap-y-0.5">
        {granularity === 'daily' ? (
          hoveredDaily ? (
            <>
              <span className="font-bold text-stone-800 dark:text-stone-100">
                {hoveredDaily.date}
                {hoveredDailyBadge ? ` (${hoveredDailyBadge.full})` : ''}
              </span>
              <span>·</span>
              <span className="font-semibold text-emerald-700 dark:text-emerald-400">
                {hoveredDaily.totalMl} mL
              </span>
              <span>
                (EBM {hoveredDaily.ebmMl} / Formula {hoveredDaily.formulaMl})
              </span>
              <span>·</span>
              <span>
                {hoveredDaily.feedCount} feed{hoveredDaily.feedCount === 1 ? '' : 's'}
              </span>
              {hoveredDailyTarget && (
                <>
                  <span>·</span>
                  <span className="text-emerald-700 dark:text-emerald-400">
                    Rec. {hoveredDailyTarget.targetMl} mL
                    {hoveredDailyTarget.weightKg !== null
                      ? ` (${UnitConverter.formatKgValue(hoveredDailyTarget.weightKg)} kg)`
                      : ''}
                  </span>
                  {hoveredDailyTarget.minMl !== null && hoveredDailyTarget.maxMl !== null && (
                    <span className="text-pink-600 dark:text-pink-400">
                      [{hoveredDailyTarget.minMl}–{hoveredDailyTarget.maxMl}]
                    </span>
                  )}
                </>
              )}
            </>
          ) : (
            <span>Hover or tap a day for exact EBM/Formula &amp; daily weight target</span>
          )
        ) : hoveredPeriod ? (
          hoveredPeriod.milkStats ? (
            <>
              <span className="font-bold text-stone-800 dark:text-stone-100">
                {hoveredPeriod.rangeLabel}
                {hoveredPeriodBadge ? ` (${hoveredPeriodBadge.full})` : ''}
              </span>
              <span>·</span>
              <span className="font-semibold text-emerald-700 dark:text-emerald-400">
                Med {formatNum(hoveredPeriod.milkStats.median)} mL
              </span>
              <span>
                IQR {formatNum(hoveredPeriod.milkStats.q1)}–{formatNum(hoveredPeriod.milkStats.q3)}
              </span>
              <span>
                Min {formatNum(hoveredPeriod.milkStats.min)} / Max{' '}
                {formatNum(hoveredPeriod.milkStats.max)}
              </span>
              <span>(n={hoveredPeriod.milkStats.count}d)</span>
              {hoveredPeriodTarget && (
                <>
                  <span>·</span>
                  <span className="text-emerald-700 dark:text-emerald-400">
                    Rec. {hoveredPeriodTarget.targetMl} mL/d
                    {hoveredPeriodTarget.avgWeightKg !== null
                      ? ` (${UnitConverter.formatKgValue(hoveredPeriodTarget.avgWeightKg)} kg)`
                      : ''}
                  </span>
                  {hoveredPeriodTarget.minMl !== null && hoveredPeriodTarget.maxMl !== null && (
                    <span className="text-pink-600 dark:text-pink-400">
                      [{hoveredPeriodTarget.minMl}–{hoveredPeriodTarget.maxMl}]
                    </span>
                  )}
                </>
              )}
            </>
          ) : (
            <>
              <span className="font-bold text-stone-800 dark:text-stone-100">
                {hoveredPeriod.rangeLabel}
                {hoveredPeriodBadge ? ` (${hoveredPeriodBadge.full})` : ''}
              </span>
              <span>· No feeding volume logged</span>
              {hoveredPeriodTarget && (
                <>
                  <span>·</span>
                  <span className="text-emerald-700 dark:text-emerald-400">
                    Rec. {hoveredPeriodTarget.targetMl} mL/d
                  </span>
                  {hoveredPeriodTarget.minMl !== null && hoveredPeriodTarget.maxMl !== null && (
                    <span className="text-pink-600 dark:text-pink-400">
                      [{hoveredPeriodTarget.minMl}–{hoveredPeriodTarget.maxMl}]
                    </span>
                  )}
                </>
              )}
            </>
          )
        ) : (
          <span>Box plot of daily mL/day · Hover or tap a period for quartiles</span>
        )}
      </div>

      {/* Chart body */}
      {granularity === 'daily' ? (
        <div ref={dailyScrollRef} className="w-full overflow-x-auto pb-1">
          <div
            className="relative flex items-end justify-between"
            style={{
              minWidth: dailySeries.length > 9 ? `${dailySeries.length * 38}px` : undefined,
            }}
          >
            {/* Dynamic pink dotted min/max & green dotted recommended lines based on daily weight */}
            {(dailyMinPath || dailyMaxPath || dailyRecommendedPath) && (
              <svg
                viewBox={`0 0 ${Math.max(1, dailySeries.length) * 100} 100`}
                preserveAspectRatio="none"
                className="pointer-events-none absolute left-0 right-0 top-4 h-24 w-full z-20 overflow-visible"
                aria-hidden="true"
              >
                {dailyMinPath && (
                  <path
                    d={dailyMinPath}
                    fill="none"
                    className="stroke-pink-500/80 dark:stroke-pink-400/80"
                    strokeWidth={0.95}
                    strokeDasharray="1.5 3"
                    strokeLinecap="round"
                    vectorEffect="non-scaling-stroke"
                  />
                )}
                {dailyMaxPath && (
                  <path
                    d={dailyMaxPath}
                    fill="none"
                    className="stroke-pink-500/80 dark:stroke-pink-400/80"
                    strokeWidth={0.95}
                    strokeDasharray="1.5 3"
                    strokeLinecap="round"
                    vectorEffect="non-scaling-stroke"
                  />
                )}
                {dailyRecommendedPath && (
                  <path
                    d={dailyRecommendedPath}
                    fill="none"
                    className="stroke-emerald-600 dark:stroke-emerald-400"
                    strokeWidth={1.75}
                    strokeDasharray="4 3"
                    vectorEffect="non-scaling-stroke"
                  />
                )}
              </svg>
            )}

            {dailySeries.map((bucket, idx) => {
              const ebmHeight = Math.round((bucket.ebmMl / dailyAxisMax) * 100);
              const formulaHeight = Math.round((bucket.formulaMl / dailyAxisMax) * 100);
              const dayLabel = bucket.date.slice(5);
              const dayBadge = getDayIndexLabel(bucket.date, birthDate);
              const dayTarget = dailyTargets[idx];
              const targetBottomPct =
                dayTarget && dayTarget.targetMl > 0
                  ? Math.min(100, Math.max(0, (dayTarget.targetMl / dailyAxisMax) * 100))
                  : null;
              const isSelected = hoveredKey === bucket.date;
              const showTopValue = dailySeries.length <= 14 || isSelected;
              const tooltipRec = dayTarget
                ? ` · Rec. ${dayTarget.targetMl} mL${
                    dayTarget.minMl !== null && dayTarget.maxMl !== null
                      ? ` (Min–Max ${dayTarget.minMl}–${dayTarget.maxMl} mL)`
                      : ''
                  }${
                    dayTarget.weightKg !== null
                      ? ` · ${UnitConverter.formatKgValue(dayTarget.weightKg)} kg`
                      : ''
                  }`
                : '';
              return (
                <div
                  key={bucket.date}
                  onMouseEnter={() => setHoveredKey(bucket.date)}
                  onMouseLeave={() => setHoveredKey(null)}
                  onClick={() =>
                    setHoveredKey(hoveredKey === bucket.date ? null : bucket.date)
                  }
                  className={`relative z-10 flex-1 min-w-[30px] flex flex-col items-center rounded-lg px-0.5 transition-colors cursor-pointer ${
                    isSelected ? 'bg-emerald-50/70 dark:bg-emerald-950/30' : ''
                  }`}
                  title={`${bucket.date}${dayBadge ? ` (${dayBadge.full})` : ''}: ${bucket.totalMl} mL (EBM ${bucket.ebmMl} / Formula ${bucket.formulaMl})${tooltipRec}`}
                >
                  <span className="text-[8.5px] font-mono tabular-nums font-semibold text-stone-500 dark:text-stone-400 leading-none h-3 mb-1 flex items-end">
                    {showTopValue && bucket.totalMl > 0 ? bucket.totalMl : ''}
                  </span>
                  <div className="relative w-full max-w-[22px] h-24">
                    <div className="w-full h-full flex flex-col justify-end bg-stone-100 dark:bg-stone-800 rounded-lg overflow-hidden">
                      {formulaHeight > 0 && (
                        <div
                          className="w-full bg-amber-400 dark:bg-amber-500 transition-all"
                          style={{ height: `${formulaHeight}%` }}
                        />
                      )}
                      {ebmHeight > 0 && (
                        <div
                          className="w-full bg-emerald-500 dark:bg-emerald-400 transition-all"
                          style={{ height: `${ebmHeight}%` }}
                        />
                      )}
                    </div>
                    {targetBottomPct !== null && (
                      <span
                        className={`pointer-events-none absolute left-1/2 -translate-x-1/2 translate-y-1/2 rounded-full bg-emerald-600 dark:bg-emerald-400 ring-1 ring-white dark:ring-stone-900 z-30 ${
                          isSelected ? 'w-2 h-2' : 'w-1.5 h-1.5'
                        }`}
                        style={{ bottom: `${targetBottomPct}%` }}
                      />
                    )}
                  </div>
                  <div className="mt-1 flex flex-col items-center leading-tight">
                    <span
                      className={`text-[9px] font-mono tabular-nums ${
                        isSelected
                          ? 'text-stone-900 dark:text-white font-bold'
                          : 'text-stone-400 dark:text-stone-500'
                      }`}
                    >
                      {dayLabel}
                    </span>
                    <span
                      className={`text-[8.5px] font-mono tabular-nums font-semibold ${
                        isSelected
                          ? 'text-emerald-700 dark:text-emerald-300'
                          : 'text-emerald-700/75 dark:text-emerald-400/75'
                      }`}
                    >
                      {dayBadge ? dayBadge.short : '—'}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <SvgBoxPlot
          periods={periodBuckets}
          getStats={(p) => p.milkStats}
          getSubLabel={(p) =>
            (granularity === 'weekly'
              ? getWeekIndexLabel(p.key, birthDate)
              : getMonthIndexLabel(p.key, birthDate)
            )?.short ?? null
          }
          axisMax={boxAxisMax}
          unitLabel="mL per day"
          accent="emerald"
          referencePoints={periodTargets.map((t) => t?.targetMl ?? null)}
          minReferencePoints={periodTargets.map((t) => t?.minMl ?? null)}
          maxReferencePoints={periodTargets.map((t) => t?.maxMl ?? null)}
          referenceLine={
            !birthDate && estimatedTargetMl
              ? { value: estimatedTargetMl, label: `${estimatedTargetMl} mL` }
              : null
          }
          minReferenceLine={!birthDate ? targetMinMl : null}
          maxReferenceLine={!birthDate ? targetMaxMl : null}
          activeKey={hoveredKey}
          onHoverKey={setHoveredKey}
        />
      )}

      {/* Legend */}
      <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] text-stone-500 dark:text-stone-400">
        {granularity === 'daily' ? (
          <div className="flex flex-wrap items-center gap-3">
            <span className="inline-flex items-center gap-1">
              <span className="w-2 h-2 rounded-xs bg-emerald-500 dark:bg-emerald-400" />
              EBM
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="w-2 h-2 rounded-xs bg-amber-400 dark:bg-amber-500" />
              Formula
            </span>
            {legendTargetSummary && (
              <span className="inline-flex items-center gap-1">
                <span className="w-3.5 border-t-[1.5px] border-dashed border-emerald-600 dark:border-emerald-400" />
                Daily rec. (by wt)
              </span>
            )}
            {hasMinMaxBounds && (
              <span className="inline-flex items-center gap-1">
                <span className="w-3.5 border-t border-dotted border-pink-500 dark:border-pink-400" />
                Min–Max
              </span>
            )}
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <span className="inline-flex items-center gap-1">
              <span className="w-2.5 h-2 rounded-xs bg-emerald-500/25 border border-emerald-600 dark:border-emerald-400" />
              IQR (Q1–Q3)
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="w-2.5 h-0.5 bg-emerald-800 dark:bg-emerald-200 rounded-full" />
              Median
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="w-2 h-2 rounded-full border border-emerald-800 dark:border-emerald-200 bg-white dark:bg-stone-900" />
              Mean
            </span>
            {legendTargetSummary && (
              <span className="inline-flex items-center gap-1">
                <span className="w-3.5 border-t-[1.5px] border-dashed border-emerald-600 dark:border-emerald-400" />
                Rec. (by wt)
              </span>
            )}
            {hasMinMaxBounds && (
              <span className="inline-flex items-center gap-1">
                <span className="w-3.5 border-t border-dotted border-pink-500 dark:border-pink-400" />
                Min–Max
              </span>
            )}
          </div>
        )}
        {legendTargetSummary && (
          <span className="font-mono tabular-nums">{legendTargetSummary}</span>
        )}
      </div>
    </div>
  );
};

interface DiaperOutputTrendChartProps {
  records: RoutineRecord[];
  focusDate?: string;
  birthDate?: string | null;
}

export const DiaperOutputTrendChart: React.FC<DiaperOutputTrendChartProps> = ({
  records,
  focusDate,
  birthDate = null,
}) => {
  const [granularity, setGranularity] = useState<RoutineChartGranularity>('daily');
  const [dailySpan, setDailySpan] = useState<DailySpanOption>(7);
  const [weeklySpan, setWeeklySpan] = useState<WeeklySpanOption>(4);
  const [monthlySpan, setMonthlySpan] = useState<MonthlySpanOption>(6);
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);
  const dailyScrollRef = useRef<HTMLDivElement | null>(null);

  const dailySeries = useMemo(
    () => (granularity === 'daily' ? buildDailyRoutineSeries(records, dailySpan, focusDate) : []),
    [records, granularity, dailySpan, focusDate]
  );

  const periodBuckets = useMemo(() => {
    if (granularity === 'weekly') {
      return buildWeeklyRoutineBoxPlots(records, weeklySpan, focusDate);
    }
    if (granularity === 'monthly') {
      return buildMonthlyRoutineBoxPlots(records, monthlySpan, focusDate);
    }
    return [];
  }, [records, granularity, weeklySpan, monthlySpan, focusDate]);

  useEffect(() => {
    setHoveredKey(null);
  }, [granularity, dailySpan, weeklySpan, monthlySpan]);

  useEffect(() => {
    if (granularity === 'daily' && dailyScrollRef.current) {
      dailyScrollRef.current.scrollLeft = dailyScrollRef.current.scrollWidth;
    }
  }, [granularity, dailySeries.length]);

  const dailyAvgDiapers = useMemo(() => {
    const active = dailySeries.filter((d) => d.totalDiapers > 0);
    if (active.length === 0) return 0;
    return Math.round((active.reduce((s, d) => s + d.totalDiapers, 0) / active.length) * 10) / 10;
  }, [dailySeries]);

  const dailyAxisMax = useMemo(() => {
    const maxData = Math.max(0, ...dailySeries.map((d) => d.totalDiapers));
    return computeNiceAxisMax(Math.max(maxData, 6), 8);
  }, [dailySeries]);

  const boxAxisMax = useMemo(() => {
    const maxVal = Math.max(0, ...periodBuckets.map((p) => p.diaperStats?.max ?? 0), 6);
    return computeNiceAxisMax(maxVal, 8);
  }, [periodBuckets]);

  const hoveredDaily: DailyRoutineBucket | null = useMemo(() => {
    if (granularity !== 'daily' || !hoveredKey) return null;
    return dailySeries.find((d) => d.date === hoveredKey) ?? null;
  }, [granularity, hoveredKey, dailySeries]);

  const hoveredPeriod: RoutinePeriodBoxPlotBucket | null = useMemo(() => {
    if (granularity === 'daily' || !hoveredKey) return null;
    return periodBuckets.find((p) => p.key === hoveredKey) ?? null;
  }, [granularity, hoveredKey, periodBuckets]);

  const hoveredDailyBadge = hoveredDaily ? getDayIndexLabel(hoveredDaily.date, birthDate) : null;
  const hoveredPeriodBadge = hoveredPeriod
    ? granularity === 'weekly'
      ? getWeekIndexLabel(hoveredPeriod.key, birthDate)
      : getMonthIndexLabel(hoveredPeriod.key, birthDate)
    : null;

  const titleLabel =
    granularity === 'daily'
      ? dailySpan === 'all'
        ? `Daily Diaper Output (${dailySeries.length}d)`
        : `${dailySpan}-Day Diaper Output`
      : granularity === 'weekly'
        ? 'Weekly Diaper Distribution'
        : 'Monthly Diaper Distribution';

  const summaryRight = useMemo(() => {
    if (granularity === 'daily') {
      return `Avg ${dailyAvgDiapers}/d`;
    }
    const populated = periodBuckets.filter((p) => p.diaperStats !== null);
    if (populated.length === 0) return 'No data';
    const avgMed =
      Math.round(
        (populated.reduce((s, p) => s + (p.diaperStats?.median ?? 0), 0) / populated.length) * 10
      ) / 10;
    return `Med ~${avgMed}/d`;
  }, [granularity, dailyAvgDiapers, periodBuckets]);

  return (
    <div className="flex flex-col justify-between h-full space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-stone-700 dark:text-stone-200">
            {titleLabel}
          </span>
          <span className="text-[10px] font-mono tabular-nums text-stone-500 dark:text-stone-400">
            · {summaryRight}
          </span>
        </div>

        <ChartControls
          granularity={granularity}
          onGranularityChange={setGranularity}
          dailySpan={dailySpan}
          onDailySpanChange={setDailySpan}
          weeklySpan={weeklySpan}
          onWeeklySpanChange={setWeeklySpan}
          monthlySpan={monthlySpan}
          onMonthlySpanChange={setMonthlySpan}
        />
      </div>

      {/* Live readout strip */}
      <div className="min-h-[18px] text-[10px] font-mono tabular-nums text-stone-500 dark:text-stone-400 flex flex-wrap items-center gap-x-2 gap-y-0.5">
        {granularity === 'daily' ? (
          hoveredDaily ? (
            <>
              <span className="font-bold text-stone-800 dark:text-stone-100">
                {hoveredDaily.date}
                {hoveredDailyBadge ? ` (${hoveredDailyBadge.full})` : ''}
              </span>
              <span>·</span>
              <span className="font-semibold text-sky-700 dark:text-sky-400">
                {hoveredDaily.totalDiapers} change{hoveredDaily.totalDiapers === 1 ? '' : 's'}
              </span>
              <span>·</span>
              <span
                className={`font-semibold ${
                  hoveredDaily.wetDiapers + hoveredDaily.mixedDiapers >= 6
                    ? 'text-emerald-700 dark:text-emerald-400'
                    : 'text-amber-700 dark:text-amber-400'
                }`}
              >
                {hoveredDaily.wetDiapers + hoveredDaily.mixedDiapers}/6 wet+mixed
              </span>
              <span>
                (Wet {hoveredDaily.wetDiapers}, Mixed {hoveredDaily.mixedDiapers}, Dirty{' '}
                {hoveredDaily.dirtyDiapers})
              </span>
            </>
          ) : (
            <span>Hover or tap a day for Wet / Mixed / Dirty &amp; hydration counts</span>
          )
        ) : hoveredPeriod ? (
          hoveredPeriod.diaperStats ? (
            <>
              <span className="font-bold text-stone-800 dark:text-stone-100">
                {hoveredPeriod.rangeLabel}
                {hoveredPeriodBadge ? ` (${hoveredPeriodBadge.full})` : ''}
              </span>
              <span>·</span>
              <span className="font-semibold text-sky-700 dark:text-sky-400">
                Med {formatNum(hoveredPeriod.diaperStats.median)}/d
              </span>
              {hoveredPeriod.avgWetPerDay !== null && (
                <>
                  <span>·</span>
                  <span
                    className={`font-semibold ${
                      hoveredPeriod.avgWetPerDay >= 6
                        ? 'text-emerald-700 dark:text-emerald-400'
                        : 'text-amber-700 dark:text-amber-400'
                    }`}
                  >
                    Avg {formatNum(hoveredPeriod.avgWetPerDay)} wet+mixed/d
                  </span>
                </>
              )}
              <span>
                IQR {formatNum(hoveredPeriod.diaperStats.q1)}–
                {formatNum(hoveredPeriod.diaperStats.q3)}
              </span>
              <span>
                Min {formatNum(hoveredPeriod.diaperStats.min)} / Max{' '}
                {formatNum(hoveredPeriod.diaperStats.max)}
              </span>
              <span>(n={hoveredPeriod.diaperStats.count}d)</span>
            </>
          ) : (
            <>
              <span className="font-bold text-stone-800 dark:text-stone-100">
                {hoveredPeriod.rangeLabel}
                {hoveredPeriodBadge ? ` (${hoveredPeriodBadge.full})` : ''}
              </span>
              <span>· No diaper changes logged</span>
            </>
          )
        ) : (
          <span>Box plot of daily diaper changes · Hover or tap a period for quartiles</span>
        )}
      </div>

      {/* Chart body */}
      {granularity === 'daily' ? (
        <div ref={dailyScrollRef} className="w-full overflow-x-auto pb-1">
          <div
            className="relative flex items-end justify-between"
            style={{
              minWidth: dailySeries.length > 9 ? `${dailySeries.length * 38}px` : undefined,
            }}
          >
            {/* 6-diaper pediatric hydration reference line (pixel-aligned to h-24 plot zone) */}
            <div
              className="pointer-events-none absolute left-0 right-0 border-t border-dashed border-pink-500/80 dark:border-pink-400/80 z-20"
              style={{
                top: `${16 + (1 - Math.min(1, 6 / dailyAxisMax)) * 96}px`,
              }}
              title="Pediatric hydration benchmark: ≥6 wet + mixed diapers/day"
            />

            {dailySeries.map((bucket) => {
              const wetHeight = Math.round((bucket.wetDiapers / dailyAxisMax) * 100);
              const mixedHeight = Math.round((bucket.mixedDiapers / dailyAxisMax) * 100);
              const dirtyHeight = Math.round((bucket.dirtyDiapers / dailyAxisMax) * 100);
              const otherDiapers = Math.max(
                0,
                bucket.totalDiapers -
                  (bucket.wetDiapers + bucket.mixedDiapers + bucket.dirtyDiapers)
              );
              const otherHeight = Math.round((otherDiapers / dailyAxisMax) * 100);
              const dayLabel = bucket.date.slice(5);
              const dayBadge = getDayIndexLabel(bucket.date, birthDate);
              const isSelected = hoveredKey === bucket.date;
              const showTopValue = dailySeries.length <= 14 || isSelected;
              const effectiveWet = bucket.wetDiapers + bucket.mixedDiapers;
              return (
                <div
                  key={bucket.date}
                  onMouseEnter={() => setHoveredKey(bucket.date)}
                  onMouseLeave={() => setHoveredKey(null)}
                  onClick={() =>
                    setHoveredKey(hoveredKey === bucket.date ? null : bucket.date)
                  }
                  className={`relative z-10 flex-1 min-w-[30px] flex flex-col items-center rounded-lg px-0.5 transition-colors cursor-pointer ${
                    isSelected ? 'bg-sky-50/70 dark:bg-sky-950/30' : ''
                  }`}
                  title={`${bucket.date}${dayBadge ? ` (${dayBadge.full})` : ''}: ${bucket.totalDiapers} changes (${effectiveWet}/6 wet+mixed — Wet ${bucket.wetDiapers}, Mixed ${bucket.mixedDiapers}, Dirty ${bucket.dirtyDiapers})`}
                >
                  <span className="text-[9px] font-mono tabular-nums font-semibold text-stone-500 dark:text-stone-400 leading-none h-3 mb-1 flex items-end">
                    {showTopValue && bucket.totalDiapers > 0 ? bucket.totalDiapers : ''}
                  </span>
                  <div className="w-full max-w-[22px] h-24 flex flex-col justify-end bg-stone-100 dark:bg-stone-800 rounded-lg overflow-hidden">
                    {otherHeight > 0 && (
                      <div
                        className="w-full bg-stone-400 dark:bg-stone-500 transition-all"
                        style={{ height: `${otherHeight}%` }}
                      />
                    )}
                    {dirtyHeight > 0 && (
                      <div
                        className="w-full bg-amber-400 dark:bg-amber-500 transition-all"
                        style={{ height: `${dirtyHeight}%` }}
                      />
                    )}
                    {mixedHeight > 0 && (
                      <div
                        className="w-full bg-emerald-500 dark:bg-emerald-400 transition-all"
                        style={{ height: `${mixedHeight}%` }}
                      />
                    )}
                    {wetHeight > 0 && (
                      <div
                        className="w-full bg-sky-500 dark:bg-sky-400 transition-all"
                        style={{ height: `${wetHeight}%` }}
                      />
                    )}
                  </div>
                  <div className="mt-1 flex flex-col items-center leading-tight">
                    <span
                      className={`text-[9px] font-mono tabular-nums ${
                        isSelected
                          ? 'text-stone-900 dark:text-white font-bold'
                          : 'text-stone-400 dark:text-stone-500'
                      }`}
                    >
                      {dayLabel}
                    </span>
                    <span
                      className={`text-[8.5px] font-mono tabular-nums font-semibold ${
                        isSelected
                          ? 'text-sky-700 dark:text-sky-300'
                          : 'text-sky-700/75 dark:text-sky-400/75'
                      }`}
                    >
                      {dayBadge ? dayBadge.short : '—'}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <SvgBoxPlot
          periods={periodBuckets}
          getStats={(p) => p.diaperStats}
          getSubLabel={(p) =>
            (granularity === 'weekly'
              ? getWeekIndexLabel(p.key, birthDate)
              : getMonthIndexLabel(p.key, birthDate)
            )?.short ?? null
          }
          axisMax={boxAxisMax}
          unitLabel="diapers per day"
          accent="sky"
          referenceLine={{ value: 6, label: '6/day', color: 'pink' }}
          activeKey={hoveredKey}
          onHoverKey={setHoveredKey}
        />
      )}

      {/* Legend */}
      <div className="pt-2 border-t border-stone-100 dark:border-stone-800 flex flex-wrap items-center justify-between gap-2 text-[10px] text-stone-500 dark:text-stone-400">
        {granularity === 'daily' ? (
          <div className="flex items-center gap-2.5">
            <span className="inline-flex items-center gap-1">
              <span className="w-2 h-2 rounded-xs bg-sky-500 dark:bg-sky-400" />
              Wet
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="w-2 h-2 rounded-xs bg-emerald-500 dark:bg-emerald-400" />
              Mixed
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="w-2 h-2 rounded-xs bg-amber-400 dark:bg-amber-500" />
              Dirty
            </span>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="inline-flex items-center gap-1">
              <span className="w-2.5 h-2 rounded-xs bg-sky-500/25 border border-sky-600 dark:border-sky-400" />
              IQR (Q1–Q3)
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="w-2.5 h-0.5 bg-sky-800 dark:bg-sky-200 rounded-full" />
              Median
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="w-2 h-2 rounded-full border border-sky-800 dark:border-sky-200 bg-white dark:bg-stone-900" />
              Mean
            </span>
          </div>
        )}
        <span className="inline-flex items-center gap-1.5">
          <span className="w-3.5 border-t-[1.5px] border-dashed border-pink-500 dark:border-pink-400" />
          <span>Benchmark: ≥6 wet + mixed/day</span>
        </span>
      </div>
    </div>
  );
};

interface RoutineSummaryAndChartsGridProps {
  records: RoutineRecord[];
  routineInsights: RoutineInterpretation;
  profile?: ChildProfile;
  growthRecords?: GrowthRecord[];
  babyMeasurements?: BabyMeasurement[];
}

export const RoutineSummaryAndChartsGrid: React.FC<RoutineSummaryAndChartsGridProps> = ({
  records,
  routineInsights,
  profile,
  growthRecords = [],
  babyMeasurements = [],
}) => {
  const focusDate = routineInsights.todayBucket.date;
  const birthDate =
    profile?.type === 'baby' && profile.dateOfEvent ? profile.dateOfEvent.slice(0, 10) : null;

  const resolveWeightForDate = useMemo(
    () => buildDailyWeightResolver(growthRecords, babyMeasurements, profile),
    [growthRecords, babyMeasurements, profile]
  );
  const wetPlusMixed =
    routineInsights.todayBucket.wetDiapers + routineInsights.todayBucket.mixedDiapers;
  const totalMl = routineInsights.todayBucket.totalMl;
  const ebmMl = routineInsights.todayBucket.ebmMl;
  const formulaMl = routineInsights.todayBucket.formulaMl;
  const targetMl = routineInsights.estimatedTargetMl;
  const gapMl = targetMl !== null && targetMl > 0 ? targetMl - totalMl : null;
  const progressScaleMax =
    targetMl !== null && targetMl > 0 ? Math.max(targetMl, totalMl) : Math.max(1, totalMl);
  const ebmBarPct =
    targetMl !== null && targetMl > 0
      ? Math.min(100, (ebmMl / progressScaleMax) * 100)
      : routineInsights.ebmSharePct;
  const formulaBarPct =
    targetMl !== null && targetMl > 0
      ? Math.min(Math.max(0, 100 - ebmBarPct), (formulaMl / progressScaleMax) * 100)
      : routineInsights.formulaSharePct;
  const targetMarkerPct =
    targetMl !== null && targetMl > 0 && totalMl > targetMl
      ? Math.round((targetMl / progressScaleMax) * 100)
      : null;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3.5">
      {/* Milk Intake Summary Card */}
      <div className="bg-white dark:bg-stone-900 rounded-3xl border border-stone-200 dark:border-stone-800 p-5 shadow-xs flex flex-col justify-between transition-colors">
        <div>
          <div className="flex items-center justify-between gap-2 text-xs font-bold text-stone-700 dark:text-stone-200">
            <span className="flex items-center gap-2">
              <Droplets className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
              <span>Milk Intake ({routineInsights.activeDateLabel})</span>
            </span>
            {routineInsights.targetProgressPct !== null && (
              <span className="text-[11px] font-mono tabular-nums font-bold text-emerald-700 dark:text-emerald-400">
                {routineInsights.targetProgressPct}% of target
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-baseline justify-between gap-2 mt-2">
            <div className="text-3xl font-black font-mono tabular-nums text-stone-900 dark:text-white">
              {totalMl}{' '}
              <span className="text-base font-bold font-sans text-stone-400">mL</span>
            </div>
            {targetMl !== null && targetMl > 0 && (
              <div className="text-xs font-mono tabular-nums text-stone-500 dark:text-stone-400">
                Rec.{' '}
                <strong className="text-stone-800 dark:text-stone-200">{targetMl} mL</strong>
              </div>
            )}
          </div>

          <div className="text-[11px] text-stone-500 dark:text-stone-400 mt-1 tabular-nums">
            EBM:{' '}
            <strong className="font-mono text-emerald-700 dark:text-emerald-400">
              {ebmMl} mL
            </strong>
            {' · '}
            Formula:{' '}
            <strong className="font-mono text-amber-700 dark:text-amber-400">
              {formulaMl} mL
            </strong>
          </div>

          {routineInsights.recommendedFeedMl !== null &&
            routineInsights.perFeedMinMl !== null &&
            routineInsights.perFeedMaxMl !== null && (
              <div className="text-[11px] text-stone-500 dark:text-stone-400 mt-2 tabular-nums">
                Per-feed target:{' '}
                <strong className="font-mono text-stone-800 dark:text-stone-200">
                  {routineInsights.recommendedFeedMl} mL
                </strong>{' '}
                <span className="text-stone-400">
                  ({routineInsights.perFeedMinMl}–{routineInsights.perFeedMaxMl} mL)
                </span>
              </div>
            )}
        </div>

        {/* Intake vs Recommended Gap Progress Bar */}
        <div className="mt-4 pt-3 border-t border-stone-100 dark:border-stone-800 space-y-2">
          <div className="flex items-center justify-between gap-2 text-[11px] font-mono tabular-nums">
            <span className="font-sans font-semibold text-stone-600 dark:text-stone-300">
              {targetMl !== null && targetMl > 0 ? 'Intake vs Recommended' : 'Milk Composition'}
            </span>
            {gapMl !== null ? (
              <span
                className={`font-bold ${
                  gapMl > 0
                    ? 'text-amber-700 dark:text-amber-400'
                    : 'text-emerald-700 dark:text-emerald-400'
                }`}
              >
                {gapMl > 0
                  ? `${gapMl} mL remaining`
                  : gapMl === 0
                    ? 'Target reached'
                    : `+${Math.abs(gapMl)} mL above target`}
              </span>
            ) : (
              <span className="text-[10px] font-sans text-stone-400 dark:text-stone-500">
                Log weight for target gap
              </span>
            )}
          </div>

          <div
            className="relative w-full h-3 bg-stone-100 dark:bg-stone-800 rounded-full overflow-hidden flex"
            role="progressbar"
            aria-label="Current milk intake against recommended daily target"
            aria-valuenow={totalMl}
            aria-valuemin={0}
            aria-valuemax={targetMl ?? Math.max(1, totalMl)}
          >
            {totalMl > 0 && (
              <>
                {ebmBarPct > 0 && (
                  <div
                    className="h-full bg-emerald-500 dark:bg-emerald-400 transition-all"
                    style={{ width: `${ebmBarPct}%` }}
                    title={`EBM: ${ebmMl} mL (${routineInsights.ebmSharePct}%)`}
                  />
                )}
                {formulaBarPct > 0 && (
                  <div
                    className="h-full bg-amber-400 dark:bg-amber-500 transition-all"
                    style={{ width: `${formulaBarPct}%` }}
                    title={`Formula: ${formulaMl} mL (${routineInsights.formulaSharePct}%)`}
                  />
                )}
              </>
            )}

            {/* Recommended target reference line when current intake exceeds target */}
            {targetMarkerPct !== null && (
              <div
                className="pointer-events-none absolute inset-y-0 w-0.5 bg-stone-900/75 dark:bg-white/85"
                style={{ left: `${targetMarkerPct}%` }}
                title={`Recommended target: ${targetMl} mL`}
              />
            )}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] font-mono tabular-nums text-stone-500 dark:text-stone-400">
            <div className="flex items-center gap-2.5">
              <span className="inline-flex items-center gap-1">
                <span className="w-2 h-2 rounded-xs bg-emerald-500 dark:bg-emerald-400" />
                EBM {routineInsights.ebmSharePct}%
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="w-2 h-2 rounded-xs bg-amber-400 dark:bg-amber-500" />
                Formula {routineInsights.formulaSharePct}%
              </span>
              {gapMl !== null && gapMl > 0 && (
                <span className="inline-flex items-center gap-1">
                  <span className="w-2 h-2 rounded-xs bg-stone-200 dark:bg-stone-700" />
                  Gap {gapMl} mL
                </span>
              )}
            </div>
            {routineInsights.targetMinMl && routineInsights.targetMaxMl && (
              <span>
                Range {routineInsights.targetMinMl}–{routineInsights.targetMaxMl} mL
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Feeding Rhythm & Interactive Volume Trend Card */}
      <div className="bg-white dark:bg-stone-900 rounded-3xl border border-stone-200 dark:border-stone-800 p-5 shadow-xs flex flex-col justify-between gap-3 transition-colors">
        <div>
          <div className="flex items-center justify-between gap-2 text-xs font-bold text-stone-700 dark:text-stone-200">
            <span className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-sky-600 dark:text-sky-400 shrink-0" />
              <span>Feeding Rhythm</span>
            </span>
            <span className="text-[10px] font-normal text-stone-500 dark:text-stone-400 truncate max-w-[190px]">
              Last:{' '}
              <strong className="font-mono font-semibold text-stone-700 dark:text-stone-200">
                {routineInsights.lastFeedLabel ?? 'None yet'}
              </strong>
            </span>
          </div>
          <div className="flex flex-wrap items-baseline justify-between gap-2 mt-2">
            <div className="text-3xl font-black font-mono tabular-nums text-stone-900 dark:text-white">
              {routineInsights.todayBucket.feedCount}{' '}
              <span className="text-base font-bold font-sans text-stone-400">
                feed{routineInsights.todayBucket.feedCount === 1 ? '' : 's'}
              </span>
            </div>
            <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-stone-500 dark:text-stone-400 tabular-nums">
              <span>
                Avg:{' '}
                <strong className="font-mono text-stone-800 dark:text-stone-200">
                  {routineInsights.avgMlPerFeed ? `${routineInsights.avgMlPerFeed} mL` : '—'}
                </strong>
              </span>
              <span>
                Dur:{' '}
                <strong className="font-mono text-stone-800 dark:text-stone-200">
                  {routineInsights.todayBucket.avgDurationMin !== null
                    ? `${routineInsights.todayBucket.avgDurationMin} min`
                    : '—'}
                </strong>
              </span>
            </div>
          </div>
          {routineInsights.recommendedFeedMl !== null &&
            routineInsights.perFeedMinMl !== null &&
            routineInsights.perFeedMaxMl !== null && (
              <div className="text-[11px] text-stone-500 dark:text-stone-400 mt-1 tabular-nums">
                Rec. target:{' '}
                <strong className="font-mono text-emerald-700 dark:text-emerald-400">
                  {routineInsights.recommendedFeedMl} mL
                </strong>{' '}
                <span className="font-mono text-stone-400">
                  ({routineInsights.perFeedMinMl}–{routineInsights.perFeedMaxMl})
                </span>
              </div>
            )}
        </div>

        <FeedingVolumeTrendChart
          records={records}
          estimatedTargetMl={routineInsights.estimatedTargetMl}
          targetMinMl={routineInsights.targetMinMl}
          targetMaxMl={routineInsights.targetMaxMl}
          minRateMlPerKg={routineInsights.minRateMlPerKg}
          maxRateMlPerKg={routineInsights.maxRateMlPerKg}
          effectiveTargetMlPerKg={routineInsights.effectiveTargetMlPerKg}
          focusDate={focusDate}
          birthDate={birthDate}
          resolveWeightForDate={resolveWeightForDate}
        />
      </div>

      {/* Diaper Output Summary & Interactive Trend Chart */}
      <div className="lg:col-span-2 bg-white dark:bg-stone-900 rounded-3xl border border-stone-200 dark:border-stone-800 shadow-xs overflow-hidden transition-colors">
        <div className="grid grid-cols-1 lg:grid-cols-12 divide-y lg:divide-y-0 lg:divide-x divide-stone-100 dark:divide-stone-800 h-full">
          {/* Diaper Output Summary */}
          <div className="lg:col-span-4 p-5 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between gap-2 text-xs font-bold text-stone-700 dark:text-stone-200">
                <span className="flex items-center gap-2">
                  <Baby className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
                  <span>Diaper Output ({routineInsights.activeDateLabel})</span>
                </span>
                <span
                  className={`text-[11px] font-mono tabular-nums font-bold ${
                    wetPlusMixed >= 6
                      ? 'text-emerald-700 dark:text-emerald-400'
                      : 'text-stone-500 dark:text-stone-400'
                  }`}
                  title="Counts both Wet and Mixed diapers toward the ≥6/day hydration benchmark"
                >
                  {wetPlusMixed}/6 wet+mixed
                </span>
              </div>
              <div className="text-3xl font-black font-mono tabular-nums text-stone-900 dark:text-white mt-2">
                {routineInsights.todayBucket.totalDiapers}{' '}
                <span className="text-base font-bold font-sans text-stone-400">changes</span>
              </div>
              <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 mt-2 text-[11px] font-medium text-stone-600 dark:text-stone-300 tabular-nums">
                <span>
                  Wet:{' '}
                  <strong className="font-mono text-sky-700 dark:text-sky-400">
                    {routineInsights.todayBucket.wetDiapers}
                  </strong>
                </span>
                <span aria-hidden="true" className="text-stone-300 dark:text-stone-600">
                  ·
                </span>
                <span>
                  Mixed:{' '}
                  <strong className="font-mono text-emerald-700 dark:text-emerald-400">
                    {routineInsights.todayBucket.mixedDiapers}
                  </strong>
                </span>
                <span aria-hidden="true" className="text-stone-300 dark:text-stone-600">
                  ·
                </span>
                <span>
                  Dirty:{' '}
                  <strong className="font-mono text-amber-700 dark:text-amber-400">
                    {routineInsights.todayBucket.dirtyDiapers}
                  </strong>
                </span>
              </div>
            </div>

            <div className="mt-4 pt-2.5 border-t border-stone-100 dark:border-stone-800 text-[10px] text-stone-500 dark:text-stone-400">
              Pediatric hydration benchmark: ≥6 wet + mixed diapers/day
            </div>
          </div>

          {/* Diaper Output Interactive Chart */}
          <div className="lg:col-span-8 p-5">
            <DiaperOutputTrendChart
              records={records}
              focusDate={focusDate}
              birthDate={birthDate}
            />
          </div>
        </div>
      </div>
    </div>
  );
};
