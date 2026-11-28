import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Baby, Clock, Droplets, Timer } from 'lucide-react';
import type { BabyMeasurement, ChildProfile, GrowthRecord, RoutineRecord } from '../../types';
import { UnitConverter } from '../../data/growthStandards';
import { parseCalendarDateUTC } from '../../utils/ageCalculator';
import {
  buildDailyRoutineIntervalSeries,
  buildDailyRoutineIntervalSummary,
  buildDailyRoutineSeries,
  buildDailyWeightResolver,
  buildMonthlyRoutineBoxPlots,
  buildMonthlyRoutineIntervalBoxPlots,
  buildWeeklyRoutineBoxPlots,
  buildWeeklyRoutineIntervalBoxPlots,
  DEFAULT_MILK_FORMULA,
  isMilkTargetEligibleOnDate,
  type BoxPlotStats,
  type DailyRoutineBucket,
  type DailyRoutineIntervalBucket,
  type DailySpanOption,
  type MonthlySpanOption,
  type PeriodRoutineIntervalBucket,
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

function computeNiceHoursAxisMax(rawMax: number): number {
  const safe = Math.max(3, rawMax);
  if (safe <= 6) return 6;
  if (safe <= 9) return 9;
  if (safe <= 12) return 12;
  if (safe <= 15) return 15;
  if (safe <= 18) return 18;
  return 24;
}

function formatHoursHm(hours: number): string {
  const totalMin = Math.max(0, Math.round(hours * 60));
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h > 0 && m > 0) return `${h}h ${m}m`;
  if (h > 0) return `${h}h`;
  return `${m}m`;
}

function computeLoggedFeedBoundariesMl(
  feedEntries: DailyRoutineBucket['feedEntries'] | undefined,
  totalMl: number
): number[] {
  if (!feedEntries || feedEntries.length < 2 || totalMl <= 0) return [];
  const boundaries: number[] = [];
  let cumulative = 0;
  for (let i = 0; i < feedEntries.length - 1; i++) {
    const vol = Math.max(0, feedEntries[i].totalMl);
    if (vol <= 0) continue;
    cumulative += vol;
    if (cumulative > 0 && cumulative < totalMl - 0.5) {
      boundaries.push(cumulative);
    }
  }
  return boundaries;
}

function computeProjectedFeedPlan(
  currentTotalMl: number,
  targetMl: number | null,
  recommendedFeedMl: number | null
): { projectedEndMl: number; boundariesMl: number[]; projectedFeedCount: number } {
  if (
    targetMl === null ||
    !Number.isFinite(targetMl) ||
    targetMl <= currentTotalMl + 1 ||
    recommendedFeedMl === null ||
    !Number.isFinite(recommendedFeedMl) ||
    recommendedFeedMl <= 0
  ) {
    return { projectedEndMl: currentTotalMl, boundariesMl: [], projectedFeedCount: 0 };
  }

  const step = Math.max(10, recommendedFeedMl);
  const boundariesMl: number[] = [];
  let cursor = Math.max(0, currentTotalMl);
  let count = 0;

  while (cursor < targetMl - 0.5 && count < 24) {
    const remaining = targetMl - cursor;
    // Absorb a small final remainder (<= 20% over one feed) so projected dividers stay clean
    if (remaining <= step * 1.2) {
      cursor = targetMl;
      count += 1;
      break;
    }
    cursor += step;
    boundariesMl.push(cursor);
    count += 1;
  }

  return { projectedEndMl: targetMl, boundariesMl, projectedFeedCount: count };
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
  onSelectKey: (key: string) => void;
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
  onSelectKey,
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
              onPointerEnter={(e) => {
                if (e.pointerType === 'mouse') onHoverKey(period.key);
              }}
              onPointerLeave={(e) => {
                if (e.pointerType === 'mouse') onHoverKey(null);
              }}
              onClick={() => onSelectKey(period.key)}
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
  recommendedFeedMl?: number | null;
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
  recommendedFeedMl = null,
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
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const activeKey = hoveredKey ?? selectedKey;
  const dailyScrollRef = useRef<HTMLDivElement | null>(null);

  const handleToggleSelectKey = (key: string) => {
    setSelectedKey((prev) => {
      const next = prev === key ? null : key;
      if (next === null) {
        setHoveredKey((h) => (h === key ? null : h));
      }
      return next;
    });
  };

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
    setSelectedKey(null);
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
    if (granularity !== 'daily' || !activeKey) return -1;
    return dailySeries.findIndex((d) => d.date === activeKey);
  }, [granularity, activeKey, dailySeries]);

  const hoveredDaily: DailyRoutineBucket | null =
    hoveredDailyIndex >= 0 ? dailySeries[hoveredDailyIndex] : null;
  const hoveredDailyTarget = hoveredDailyIndex >= 0 ? dailyTargets[hoveredDailyIndex] : null;
  const hoveredDailyBadge = hoveredDaily ? getDayIndexLabel(hoveredDaily.date, birthDate) : null;
  const hoveredDailyProjection = useMemo(() => {
    if (!hoveredDaily || !hoveredDailyTarget || hoveredDaily.date !== focusDate) {
      return null;
    }
    const plan = computeProjectedFeedPlan(
      hoveredDaily.totalMl,
      hoveredDailyTarget.targetMl,
      recommendedFeedMl
    );
    return plan.projectedFeedCount > 0 ? plan : null;
  }, [hoveredDaily, hoveredDailyTarget, focusDate, recommendedFeedMl]);

  const hasDailyProjectedBar = useMemo(() => {
    if (granularity !== 'daily' || !focusDate || !recommendedFeedMl || recommendedFeedMl <= 0) {
      return false;
    }
    const focusIdx = dailySeries.findIndex((d) => d.date === focusDate);
    if (focusIdx < 0) return false;
    const focusBucket = dailySeries[focusIdx];
    const focusTarget = dailyTargets[focusIdx];
    return Boolean(focusTarget && focusTarget.targetMl > focusBucket.totalMl + 1);
  }, [granularity, focusDate, recommendedFeedMl, dailySeries, dailyTargets]);

  const hoveredPeriodIndex = useMemo(() => {
    if (granularity === 'daily' || !activeKey) return -1;
    return periodBuckets.findIndex((p) => p.key === activeKey);
  }, [granularity, activeKey, periodBuckets]);

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
                {hoveredDailyProjection
                  ? ` (+${hoveredDailyProjection.projectedFeedCount} proj.)`
                  : ''}
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
              const safeAxisMax = Math.max(1, dailyAxisMax);
              const ebmHeightPct = Math.min(100, Math.max(0, (bucket.ebmMl / safeAxisMax) * 100));
              const formulaHeightPct = Math.min(
                Math.max(0, 100 - ebmHeightPct),
                Math.max(0, (bucket.formulaMl / safeAxisMax) * 100)
              );
              const totalLoggedPct = Math.min(100, ebmHeightPct + formulaHeightPct);
              const loggedDividerBoundaries = computeLoggedFeedBoundariesMl(
                bucket.feedEntries,
                bucket.totalMl
              );

              const dayLabel = bucket.date.slice(5);
              const dayBadge = getDayIndexLabel(bucket.date, birthDate);
              const dayTarget = dailyTargets[idx];
              const isFocusDay = Boolean(focusDate && bucket.date === focusDate);
              const projectedPlan =
                isFocusDay && dayTarget
                  ? computeProjectedFeedPlan(bucket.totalMl, dayTarget.targetMl, recommendedFeedMl)
                  : { projectedEndMl: bucket.totalMl, boundariesMl: [], projectedFeedCount: 0 };
              const projectedTopPct =
                projectedPlan.projectedFeedCount > 0
                  ? Math.min(100, (projectedPlan.projectedEndMl / safeAxisMax) * 100)
                  : totalLoggedPct;
              const projectedHeightPct = Math.max(0, projectedTopPct - totalLoggedPct);

              const targetBottomPct =
                dayTarget && dayTarget.targetMl > 0
                  ? Math.min(100, Math.max(0, (dayTarget.targetMl / safeAxisMax) * 100))
                  : null;
              const isSelected = activeKey === bucket.date;
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
                  }${
                    projectedPlan.projectedFeedCount > 0
                      ? ` · +${projectedPlan.projectedFeedCount} proj. feed${
                          projectedPlan.projectedFeedCount === 1 ? '' : 's'
                        }`
                      : ''
                  }`
                : '';
              return (
                <div
                  key={bucket.date}
                  onPointerEnter={(e) => {
                    if (e.pointerType === 'mouse') setHoveredKey(bucket.date);
                  }}
                  onPointerLeave={(e) => {
                    if (e.pointerType === 'mouse') setHoveredKey(null);
                  }}
                  onClick={() => handleToggleSelectKey(bucket.date)}
                  className={`relative z-10 flex-1 min-w-[30px] flex flex-col items-center rounded-lg px-0.5 transition-colors cursor-pointer ${
                    isSelected ? 'bg-emerald-50/70 dark:bg-emerald-950/30' : ''
                  }`}
                  title={`${bucket.date}${dayBadge ? ` (${dayBadge.full})` : ''}: ${bucket.totalMl} mL (EBM ${bucket.ebmMl} / Formula ${bucket.formulaMl})${tooltipRec}`}
                >
                  <span className="text-[8.5px] font-mono tabular-nums font-semibold text-stone-500 dark:text-stone-400 leading-none h-3 mb-1 flex items-end">
                    {showTopValue && bucket.totalMl > 0 ? bucket.totalMl : ''}
                  </span>
                  <div className="relative w-full max-w-[22px] h-24">
                    <div className="relative w-full h-full flex flex-col justify-end bg-stone-100 dark:bg-stone-800 rounded-lg overflow-hidden">
                      {/* Projected remaining feeds bar segment on active day */}
                      {projectedHeightPct > 0.4 && (
                        <div
                          className="pointer-events-none absolute inset-x-0 bg-emerald-500/12 dark:bg-emerald-400/12 border-t border-x border-dashed border-emerald-500/40 dark:border-emerald-400/40 rounded-t-[4px]"
                          style={{
                            bottom: `${totalLoggedPct}%`,
                            height: `${projectedHeightPct}%`,
                          }}
                        />
                      )}

                      {formulaHeightPct > 0 && (
                        <div
                          className="w-full bg-amber-400 dark:bg-amber-500 transition-all"
                          style={{ height: `${formulaHeightPct}%` }}
                        />
                      )}
                      {ebmHeightPct > 0 && (
                        <div
                          className="w-full bg-emerald-500 dark:bg-emerald-400 transition-all"
                          style={{ height: `${ebmHeightPct}%` }}
                        />
                      )}

                      {/* Subtle horizontal dividers separating individual logged feeds */}
                      {loggedDividerBoundaries.map((cumMl, dIdx) => {
                        const bottomPct = Math.min(99.5, (cumMl / safeAxisMax) * 100);
                        return (
                          <div
                            key={`logged-div-${dIdx}`}
                            className="pointer-events-none absolute inset-x-0 h-[1px] bg-white/55 dark:bg-stone-950/45 z-10"
                            style={{ bottom: `${bottomPct}%` }}
                          />
                        );
                      })}

                      {/* Subtle horizontal dashed dividers separating projected remaining feeds */}
                      {projectedPlan.boundariesMl.map((cumMl, pIdx) => {
                        const bottomPct = Math.min(99.5, (cumMl / safeAxisMax) * 100);
                        return (
                          <div
                            key={`proj-div-${pIdx}`}
                            className="pointer-events-none absolute inset-x-0 border-t border-dashed border-emerald-600/35 dark:border-emerald-300/35 z-10"
                            style={{ bottom: `${bottomPct}%` }}
                          />
                        );
                      })}
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
          activeKey={activeKey}
          onHoverKey={setHoveredKey}
          onSelectKey={handleToggleSelectKey}
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
            {hasDailyProjectedBar && (
              <span className="inline-flex items-center gap-1">
                <span className="w-2 h-2 rounded-xs bg-emerald-500/15 border border-dashed border-emerald-500/60 dark:border-emerald-400/60" />
                Projected
              </span>
            )}
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
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const activeKey = hoveredKey ?? selectedKey;
  const dailyScrollRef = useRef<HTMLDivElement | null>(null);

  const handleToggleSelectKey = (key: string) => {
    setSelectedKey((prev) => {
      const next = prev === key ? null : key;
      if (next === null) {
        setHoveredKey((h) => (h === key ? null : h));
      }
      return next;
    });
  };

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
    setSelectedKey(null);
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
    if (granularity !== 'daily' || !activeKey) return null;
    return dailySeries.find((d) => d.date === activeKey) ?? null;
  }, [granularity, activeKey, dailySeries]);

  const hoveredPeriod: RoutinePeriodBoxPlotBucket | null = useMemo(() => {
    if (granularity === 'daily' || !activeKey) return null;
    return periodBuckets.find((p) => p.key === activeKey) ?? null;
  }, [granularity, activeKey, periodBuckets]);

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
              const isSelected = activeKey === bucket.date;
              const effectiveWet = bucket.wetDiapers + bucket.mixedDiapers;
              return (
                <div
                  key={bucket.date}
                  onPointerEnter={(e) => {
                    if (e.pointerType === 'mouse') setHoveredKey(bucket.date);
                  }}
                  onPointerLeave={(e) => {
                    if (e.pointerType === 'mouse') setHoveredKey(null);
                  }}
                  onClick={() => handleToggleSelectKey(bucket.date)}
                  className={`relative z-10 flex-1 min-w-[30px] flex flex-col items-center rounded-lg px-0.5 transition-colors cursor-pointer ${
                    isSelected ? 'bg-sky-50/70 dark:bg-sky-950/30' : ''
                  }`}
                  title={`${bucket.date}${dayBadge ? ` (${dayBadge.full})` : ''}: ${bucket.totalDiapers} changes (${effectiveWet}/6 wet+mixed — Wet ${bucket.wetDiapers}, Mixed ${bucket.mixedDiapers}, Dirty ${bucket.dirtyDiapers})`}
                >
                  <span
                    className={`text-[9.5px] font-mono tabular-nums font-semibold leading-none h-3 mb-1 flex items-end ${
                      isSelected
                        ? 'text-stone-900 dark:text-white font-bold'
                        : 'text-stone-600 dark:text-stone-300'
                    }`}
                  >
                    {bucket.totalDiapers > 0 ? bucket.totalDiapers : ''}
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
          activeKey={activeKey}
          onHoverKey={setHoveredKey}
          onSelectKey={handleToggleSelectKey}
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

interface RoutineIntervalTrendChartProps {
  records: RoutineRecord[];
  focusDate?: string;
  birthDate?: string | null;
  targetFeedCadenceHours?: number | null;
}

export const RoutineIntervalTrendChart: React.FC<RoutineIntervalTrendChartProps> = ({
  records,
  focusDate,
  birthDate = null,
  targetFeedCadenceHours = null,
}) => {
  const [granularity, setGranularity] = useState<RoutineChartGranularity>('daily');
  const [dailySpan, setDailySpan] = useState<DailySpanOption>(7);
  const [weeklySpan, setWeeklySpan] = useState<WeeklySpanOption>(4);
  const [monthlySpan, setMonthlySpan] = useState<MonthlySpanOption>(6);
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [showFeeds, setShowFeeds] = useState(true);
  const [showDiapers, setShowDiapers] = useState(true);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const activeKey = hoveredKey ?? selectedKey;

  const handleToggleSelectKey = (key: string) => {
    setSelectedKey((prev) => {
      const next = prev === key ? null : key;
      if (next === null) {
        setHoveredKey((h) => (h === key ? null : h));
      }
      return next;
    });
  };

  const dailySeries = useMemo(
    () =>
      granularity === 'daily'
        ? buildDailyRoutineIntervalSeries(records, dailySpan, focusDate)
        : [],
    [records, granularity, dailySpan, focusDate]
  );

  const periodBuckets = useMemo(() => {
    if (granularity === 'weekly') {
      return buildWeeklyRoutineIntervalBoxPlots(records, weeklySpan, focusDate);
    }
    if (granularity === 'monthly') {
      return buildMonthlyRoutineIntervalBoxPlots(records, monthlySpan, focusDate);
    }
    return [];
  }, [records, granularity, weeklySpan, monthlySpan, focusDate]);

  useEffect(() => {
    setHoveredKey(null);
    setSelectedKey(null);
  }, [granularity, dailySpan, weeklySpan, monthlySpan]);

  const itemCount = granularity === 'daily' ? dailySeries.length : periodBuckets.length;

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollLeft = scrollRef.current.scrollWidth;
    }
  }, [granularity, itemCount]);

  const axisMaxHours = useMemo(() => {
    const vals: number[] = [];
    if (targetFeedCadenceHours && targetFeedCadenceHours > 0 && showFeeds) {
      vals.push(targetFeedCadenceHours);
    }
    if (granularity === 'daily') {
      for (const b of dailySeries) {
        if (showFeeds && b.feedStats) vals.push(b.feedStats.max);
        if (showDiapers && b.diaperStats) vals.push(b.diaperStats.max);
      }
    } else {
      for (const p of periodBuckets) {
        if (showFeeds && p.feedStats) vals.push(p.feedStats.max);
        if (showDiapers && p.diaperStats) vals.push(p.diaperStats.max);
      }
    }
    const rawMax = vals.length > 0 ? Math.max(...vals) : 6;
    return computeNiceHoursAxisMax(rawMax);
  }, [granularity, dailySeries, periodBuckets, targetFeedCadenceHours, showFeeds, showDiapers]);

  const summaryRight = useMemo(() => {
    if (granularity === 'daily') {
      const feedAll = dailySeries.flatMap((d) => d.feedIntervalsHours);
      const diaperAll = dailySeries.flatMap((d) => d.diaperIntervalsHours);
      const parts: string[] = [];
      if (feedAll.length > 0) {
        const avg = feedAll.reduce((s, v) => s + v, 0) / feedAll.length;
        parts.push(`Feed ~${formatHoursHm(avg)}`);
      }
      if (diaperAll.length > 0) {
        const avg = diaperAll.reduce((s, v) => s + v, 0) / diaperAll.length;
        parts.push(`Diaper ~${formatHoursHm(avg)}`);
      }
      return parts.length > 0 ? parts.join(' · ') : 'No intervals yet';
    }
    const feedMeds = periodBuckets
      .map((p) => p.feedStats?.median)
      .filter((v): v is number => typeof v === 'number');
    const diaperMeds = periodBuckets
      .map((p) => p.diaperStats?.median)
      .filter((v): v is number => typeof v === 'number');
    const parts: string[] = [];
    if (feedMeds.length > 0) {
      const avgMed = feedMeds.reduce((s, v) => s + v, 0) / feedMeds.length;
      parts.push(`Feed med ~${formatHoursHm(avgMed)}`);
    }
    if (diaperMeds.length > 0) {
      const avgMed = diaperMeds.reduce((s, v) => s + v, 0) / diaperMeds.length;
      parts.push(`Diaper med ~${formatHoursHm(avgMed)}`);
    }
    return parts.length > 0 ? parts.join(' · ') : 'No intervals yet';
  }, [granularity, dailySeries, periodBuckets]);

  const hoveredDaily: DailyRoutineIntervalBucket | null = useMemo(() => {
    if (granularity !== 'daily' || !activeKey) return null;
    return dailySeries.find((d) => d.date === activeKey) ?? null;
  }, [granularity, activeKey, dailySeries]);

  const hoveredPeriod: PeriodRoutineIntervalBucket | null = useMemo(() => {
    if (granularity === 'daily' || !activeKey) return null;
    return periodBuckets.find((p) => p.key === activeKey) ?? null;
  }, [granularity, activeKey, periodBuckets]);

  const hoveredDailyBadge = hoveredDaily ? getDayIndexLabel(hoveredDaily.date, birthDate) : null;
  const hoveredPeriodBadge = hoveredPeriod
    ? granularity === 'weekly'
      ? getWeekIndexLabel(hoveredPeriod.key, birthDate)
      : getMonthIndexLabel(hoveredPeriod.key, birthDate)
    : null;

  const titleLabel =
    granularity === 'daily'
      ? dailySpan === 'all'
        ? `Daily Intervals (${dailySeries.length}d)`
        : `${dailySpan}-Day Interval Rhythm`
      : granularity === 'weekly'
        ? 'Weekly Interval Distribution'
        : 'Monthly Interval Distribution';

  // Shared SVG geometry
  const svgHeight = 172;
  const padTop = 14;
  const padBottom = 36;
  const padLeft = 36;
  const padRight = 10;
  const plotHeight = svgHeight - padTop - padBottom;

  const slotWidth =
    granularity === 'daily'
      ? dailySeries.length <= 7
        ? 58
        : dailySeries.length <= 14
          ? 44
          : 38
      : periodBuckets.length <= 6
        ? 72
        : periodBuckets.length <= 10
          ? 58
          : 50;

  const minSvgWidth = Math.max(300, padLeft + padRight + Math.max(1, itemCount) * slotWidth);
  const plotWidth = minSvgWidth - padLeft - padRight;
  const colStep = itemCount > 0 ? plotWidth / itemCount : plotWidth;

  const yOf = (hours: number) => {
    const clamped = Math.max(0, Math.min(axisMaxHours, hours));
    return padTop + plotHeight - (clamped / axisMaxHours) * plotHeight;
  };

  const hourTicks = [0, axisMaxHours / 3, (axisMaxHours * 2) / 3, axisMaxHours];

  // Build daily polylines for feed & diaper average intervals
  const dailyOffset = showFeeds && showDiapers ? Math.min(5, colStep * 0.1) : 0;

  const dailyFeedPathD = useMemo(() => {
    if (granularity !== 'daily' || !showFeeds) return '';
    const pts: { x: number; y: number }[] = [];
    dailySeries.forEach((b, idx) => {
      if (!b.feedStats) return;
      const cx = padLeft + idx * colStep + colStep / 2 - dailyOffset;
      pts.push({ x: cx, y: yOf(b.feedStats.mean) });
    });
    if (pts.length < 2) return '';
    return pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
  }, [granularity, showFeeds, dailySeries, colStep, dailyOffset, axisMaxHours]);

  const dailyDiaperPathD = useMemo(() => {
    if (granularity !== 'daily' || !showDiapers) return '';
    const pts: { x: number; y: number }[] = [];
    dailySeries.forEach((b, idx) => {
      if (!b.diaperStats) return;
      const cx = padLeft + idx * colStep + colStep / 2 + dailyOffset;
      pts.push({ x: cx, y: yOf(b.diaperStats.mean) });
    });
    if (pts.length < 2) return '';
    return pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
  }, [granularity, showDiapers, dailySeries, colStep, dailyOffset, axisMaxHours]);

  const toggleSeries = (series: 'feed' | 'diaper') => {
    if (series === 'feed') {
      if (showFeeds && !showDiapers) return;
      setShowFeeds((v) => !v);
    } else {
      if (showDiapers && !showFeeds) return;
      setShowDiapers((v) => !v);
    }
  };

  const renderMiniBoxPlot = (
    cx: number,
    stats: BoxPlotStats,
    boxW: number,
    accent: 'emerald' | 'sky'
  ) => {
    const fillClass =
      accent === 'emerald'
        ? 'fill-emerald-500/22 dark:fill-emerald-400/22'
        : 'fill-sky-500/22 dark:fill-sky-400/22';
    const strokeClass =
      accent === 'emerald'
        ? 'stroke-emerald-600 dark:stroke-emerald-400'
        : 'stroke-sky-600 dark:stroke-sky-400';
    const medianClass =
      accent === 'emerald'
        ? 'stroke-emerald-800 dark:stroke-emerald-200'
        : 'stroke-sky-800 dark:stroke-sky-200';
    const yQ3 = yOf(stats.q3);
    const yQ1 = yOf(stats.q1);
    const rawH = Math.abs(yQ1 - yQ3);
    const boxH = Math.max(4, rawH);
    const boxY = rawH < 4 ? yOf(stats.median) - boxH / 2 : yQ3;

    return (
      <g>
        <line
          x1={cx}
          x2={cx}
          y1={yOf(stats.max)}
          y2={yOf(stats.min)}
          className={strokeClass}
          strokeWidth={1.35}
        />
        <line
          x1={cx - boxW * 0.34}
          x2={cx + boxW * 0.34}
          y1={yOf(stats.max)}
          y2={yOf(stats.max)}
          className={strokeClass}
          strokeWidth={1.35}
          strokeLinecap="round"
        />
        <line
          x1={cx - boxW * 0.34}
          x2={cx + boxW * 0.34}
          y1={yOf(stats.min)}
          y2={yOf(stats.min)}
          className={strokeClass}
          strokeWidth={1.35}
          strokeLinecap="round"
        />
        <rect
          x={cx - boxW / 2}
          y={boxY}
          width={boxW}
          height={boxH}
          rx={3}
          className={`${fillClass} ${strokeClass}`}
          strokeWidth={1.35}
        />
        <line
          x1={cx - boxW / 2}
          x2={cx + boxW / 2}
          y1={yOf(stats.median)}
          y2={yOf(stats.median)}
          className={medianClass}
          strokeWidth={2.2}
          strokeLinecap="round"
        />
        <circle
          cx={cx}
          cy={yOf(stats.mean)}
          r={2.4}
          className={`fill-white dark:fill-stone-900 ${medianClass}`}
          strokeWidth={1.3}
        />
      </g>
    );
  };

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
              {hoveredDaily.feedStats ? (
                <span className="font-semibold text-emerald-700 dark:text-emerald-400">
                  Feed {formatHoursHm(hoveredDaily.feedStats.mean)}{' '}
                  <span className="font-normal text-stone-500 dark:text-stone-400">
                    ({formatNum(hoveredDaily.feedStats.min)}–{formatNum(hoveredDaily.feedStats.max)}h, n={hoveredDaily.feedStats.count})
                  </span>
                </span>
              ) : (
                <span>Feed —</span>
              )}
              <span>·</span>
              {hoveredDaily.diaperStats ? (
                <span className="font-semibold text-sky-700 dark:text-sky-400">
                  Diaper {formatHoursHm(hoveredDaily.diaperStats.mean)}{' '}
                  <span className="font-normal text-stone-500 dark:text-stone-400">
                    ({formatNum(hoveredDaily.diaperStats.min)}–{formatNum(hoveredDaily.diaperStats.max)}h, n={hoveredDaily.diaperStats.count})
                  </span>
                </span>
              ) : (
                <span>Diaper —</span>
              )}
            </>
          ) : (
            <span>
              Hover or tap a day for feeding &amp; diaper interval averages and min–max range
            </span>
          )
        ) : hoveredPeriod ? (
          <>
            <span className="font-bold text-stone-800 dark:text-stone-100">
              {hoveredPeriod.rangeLabel}
              {hoveredPeriodBadge ? ` (${hoveredPeriodBadge.full})` : ''}
            </span>
            <span>·</span>
            {hoveredPeriod.feedStats ? (
              <span className="font-semibold text-emerald-700 dark:text-emerald-400">
                Feed med {formatHoursHm(hoveredPeriod.feedStats.median)}{' '}
                <span className="font-normal text-stone-500 dark:text-stone-400">
                  (IQR {formatNum(hoveredPeriod.feedStats.q1)}–{formatNum(hoveredPeriod.feedStats.q3)}h, n={hoveredPeriod.feedStats.count})
                </span>
              </span>
            ) : (
              <span>Feed —</span>
            )}
            <span>·</span>
            {hoveredPeriod.diaperStats ? (
              <span className="font-semibold text-sky-700 dark:text-sky-400">
                Diaper med {formatHoursHm(hoveredPeriod.diaperStats.median)}{' '}
                <span className="font-normal text-stone-500 dark:text-stone-400">
                  (IQR {formatNum(hoveredPeriod.diaperStats.q1)}–{formatNum(hoveredPeriod.diaperStats.q3)}h, n={hoveredPeriod.diaperStats.count})
                </span>
              </span>
            ) : (
              <span>Diaper —</span>
            )}
          </>
        ) : (
          <span>
            Paired box plots of feeding &amp; diaper intervals · Hover or tap a period for quartiles
          </span>
        )}
      </div>

      {/* Unified Interactive SVG Canvas (Daily dual-line + range, Weekly/Monthly paired box plots) */}
      <div ref={scrollRef} className="w-full overflow-x-auto pb-1">
        <svg
          viewBox={`0 0 ${minSvgWidth} ${svgHeight}`}
          className="w-full h-[172px] select-none"
          style={{
            minWidth:
              (granularity === 'daily' && dailySeries.length > 8) ||
              (granularity !== 'daily' && periodBuckets.length > 6)
                ? `${minSvgWidth}px`
                : undefined,
          }}
          role="img"
          aria-label="Feeding and diaper time interval trend chart in hours"
        >
          {/* Y-axis gridlines & hour labels */}
          {hourTicks.map((tick) => {
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
                  {formatNum(tick)}h
                </text>
              </g>
            );
          })}

          {/* Optional target feed cadence reference line */}
          {showFeeds &&
            targetFeedCadenceHours &&
            targetFeedCadenceHours > 0 &&
            targetFeedCadenceHours <= axisMaxHours && (
              <line
                x1={padLeft}
                x2={minSvgWidth - padRight}
                y1={yOf(targetFeedCadenceHours)}
                y2={yOf(targetFeedCadenceHours)}
                className="stroke-pink-500/80 dark:stroke-pink-400/80"
                strokeWidth={1.25}
                strokeDasharray="4 3"
              />
            )}

          {granularity === 'daily' ? (
            <>
              {/* Interactive day columns & range whiskers */}
              {dailySeries.map((bucket, idx) => {
                const cx = padLeft + idx * colStep + colStep / 2;
                const isSelected = activeKey === bucket.date;
                const dayLabel = bucket.date.slice(5);
                const dayBadge = getDayIndexLabel(bucket.date, birthDate);
                const feedX = cx - dailyOffset;
                const diaperX = cx + dailyOffset;

                return (
                  <g
                    key={bucket.date}
                    className="cursor-pointer"
                    onPointerEnter={(e) => {
                      if (e.pointerType === 'mouse') setHoveredKey(bucket.date);
                    }}
                    onPointerLeave={(e) => {
                      if (e.pointerType === 'mouse') setHoveredKey(null);
                    }}
                    onClick={() => handleToggleSelectKey(bucket.date)}
                  >
                    <rect
                      x={padLeft + idx * colStep + 2}
                      y={padTop - 4}
                      width={Math.max(0, colStep - 4)}
                      height={plotHeight + 8}
                      rx={6}
                      className={
                        isSelected
                          ? 'fill-stone-900/5 dark:fill-white/8'
                          : 'fill-transparent'
                      }
                    />

                    {/* Subtle min–max range bar for Feeding interval */}
                    {showFeeds && bucket.feedStats && bucket.feedStats.max > bucket.feedStats.min && (
                      <line
                        x1={feedX}
                        x2={feedX}
                        y1={yOf(bucket.feedStats.max)}
                        y2={yOf(bucket.feedStats.min)}
                        className="stroke-emerald-500/40 dark:stroke-emerald-400/40"
                        strokeWidth={2.5}
                        strokeLinecap="round"
                      />
                    )}

                    {/* Subtle min–max range bar for Diaper interval */}
                    {showDiapers &&
                      bucket.diaperStats &&
                      bucket.diaperStats.max > bucket.diaperStats.min && (
                        <line
                          x1={diaperX}
                          x2={diaperX}
                          y1={yOf(bucket.diaperStats.max)}
                          y2={yOf(bucket.diaperStats.min)}
                          className="stroke-sky-500/40 dark:stroke-sky-400/40"
                          strokeWidth={2.5}
                          strokeLinecap="round"
                        />
                      )}

                    {/* X-axis date + day index badge */}
                    <text
                      x={cx}
                      y={svgHeight - 19}
                      textAnchor="middle"
                      className={`text-[9px] font-mono ${
                        isSelected
                          ? 'fill-stone-900 dark:fill-white font-bold'
                          : 'fill-stone-400 dark:fill-stone-500'
                      }`}
                    >
                      {dayLabel}
                    </text>
                    <text
                      x={cx}
                      y={svgHeight - 7}
                      textAnchor="middle"
                      className={`text-[8.5px] font-mono font-semibold ${
                        isSelected
                          ? 'fill-stone-800 dark:fill-stone-100'
                          : 'fill-emerald-700/75 dark:fill-emerald-400/75'
                      }`}
                    >
                      {dayBadge ? dayBadge.short : '—'}
                    </text>
                  </g>
                );
              })}

              {/* Connected trend lines */}
              {dailyFeedPathD && (
                <path
                  d={dailyFeedPathD}
                  fill="none"
                  className="pointer-events-none stroke-emerald-600 dark:stroke-emerald-400"
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              )}
              {dailyDiaperPathD && (
                <path
                  d={dailyDiaperPathD}
                  fill="none"
                  className="pointer-events-none stroke-sky-600 dark:stroke-sky-400"
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              )}

              {/* Daily average interval markers */}
              {dailySeries.map((bucket, idx) => {
                const cx = padLeft + idx * colStep + colStep / 2;
                const isSelected = activeKey === bucket.date;
                const feedX = cx - dailyOffset;
                const diaperX = cx + dailyOffset;
                return (
                  <g key={`dots-${bucket.date}`} className="pointer-events-none">
                    {showFeeds && bucket.feedStats && (
                      <circle
                        cx={feedX}
                        cy={yOf(bucket.feedStats.mean)}
                        r={isSelected ? 4.4 : 3.1}
                        className="fill-emerald-600 dark:fill-emerald-400 stroke-white dark:stroke-stone-900"
                        strokeWidth={1.5}
                      />
                    )}
                    {showDiapers && bucket.diaperStats && (
                      <circle
                        cx={diaperX}
                        cy={yOf(bucket.diaperStats.mean)}
                        r={isSelected ? 4.4 : 3.1}
                        className="fill-sky-600 dark:fill-sky-400 stroke-white dark:stroke-stone-900"
                        strokeWidth={1.5}
                      />
                    )}
                  </g>
                );
              })}
            </>
          ) : (
            /* Weekly & Monthly paired side-by-side box plots */
            periodBuckets.map((period, idx) => {
              const cx = padLeft + idx * colStep + colStep / 2;
              const isSelected = activeKey === period.key;
              const subBadge =
                granularity === 'weekly'
                  ? getWeekIndexLabel(period.key, birthDate)?.short
                  : getMonthIndexLabel(period.key, birthDate)?.short;
              const bothShown = showFeeds && showDiapers;
              const pairBoxW = bothShown
                ? Math.max(10, Math.min(18, colStep * 0.28))
                : Math.max(14, Math.min(24, colStep * 0.42));
              const pairOffset = bothShown ? pairBoxW * 0.62 : 0;

              return (
                <g
                  key={period.key}
                  className="cursor-pointer"
                  onPointerEnter={(e) => {
                    if (e.pointerType === 'mouse') setHoveredKey(period.key);
                  }}
                  onPointerLeave={(e) => {
                    if (e.pointerType === 'mouse') setHoveredKey(null);
                  }}
                  onClick={() => handleToggleSelectKey(period.key)}
                >
                  <rect
                    x={padLeft + idx * colStep + 2}
                    y={padTop - 4}
                    width={Math.max(0, colStep - 4)}
                    height={plotHeight + 8}
                    rx={6}
                    className={
                      isSelected
                        ? 'fill-stone-900/5 dark:fill-white/8'
                        : 'fill-transparent'
                    }
                  />

                  {showFeeds && period.feedStats ? (
                    renderMiniBoxPlot(cx - pairOffset, period.feedStats, pairBoxW, 'emerald')
                  ) : showFeeds && !showDiapers ? (
                    <line
                      x1={cx - 5}
                      x2={cx + 5}
                      y1={yOf(0) - 2}
                      y2={yOf(0) - 2}
                      className="stroke-stone-300 dark:stroke-stone-700"
                      strokeWidth={1.5}
                      strokeLinecap="round"
                    />
                  ) : null}

                  {showDiapers && period.diaperStats ? (
                    renderMiniBoxPlot(cx + pairOffset, period.diaperStats, pairBoxW, 'sky')
                  ) : showDiapers && !showFeeds ? (
                    <line
                      x1={cx - 5}
                      x2={cx + 5}
                      y1={yOf(0) - 2}
                      y2={yOf(0) - 2}
                      className="stroke-stone-300 dark:stroke-stone-700"
                      strokeWidth={1.5}
                      strokeLinecap="round"
                    />
                  ) : null}

                  {bothShown && !period.feedStats && !period.diaperStats && (
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

                  <text
                    x={cx}
                    y={svgHeight - 19}
                    textAnchor="middle"
                    className={`text-[9px] font-mono ${
                      isSelected
                        ? 'fill-stone-900 dark:fill-white font-bold'
                        : 'fill-stone-400 dark:fill-stone-500'
                    }`}
                  >
                    {period.label}
                  </text>
                  {subBadge && (
                    <text
                      x={cx}
                      y={svgHeight - 7}
                      textAnchor="middle"
                      className={`text-[8.5px] font-mono font-semibold ${
                        isSelected
                          ? 'fill-stone-800 dark:fill-stone-100'
                          : 'fill-emerald-700/75 dark:fill-emerald-400/75'
                      }`}
                    >
                      {subBadge}
                    </text>
                  )}
                </g>
              );
            })
          )}
        </svg>
      </div>

      {/* Interactive Legend */}
      <div className="pt-2 border-t border-stone-100 dark:border-stone-800 flex flex-wrap items-center justify-between gap-2 text-[10px] text-stone-500 dark:text-stone-400">
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => toggleSeries('feed')}
            className={`inline-flex items-center gap-1.5 cursor-pointer transition-opacity ${
              showFeeds ? 'opacity-100 font-semibold text-stone-700 dark:text-stone-200' : 'opacity-40'
            }`}
            title="Toggle feeding interval series"
          >
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 dark:bg-emerald-400" />
            <span>Feed interval</span>
          </button>
          <button
            type="button"
            onClick={() => toggleSeries('diaper')}
            className={`inline-flex items-center gap-1.5 cursor-pointer transition-opacity ${
              showDiapers ? 'opacity-100 font-semibold text-stone-700 dark:text-stone-200' : 'opacity-40'
            }`}
            title="Toggle diaper interval series"
          >
            <span className="w-2.5 h-2.5 rounded-full bg-sky-500 dark:bg-sky-400" />
            <span>Diaper interval</span>
          </button>
          <span className="text-stone-400 dark:text-stone-500">
            {granularity === 'daily' ? 'Dots = avg · Bars = min–max' : 'Boxes = IQR · Line = med · Dot = avg'}
          </span>
        </div>

        {targetFeedCadenceHours && targetFeedCadenceHours > 0 && (
          <span className="inline-flex items-center gap-1.5 font-mono tabular-nums">
            <span className="w-3.5 border-t-[1.5px] border-dashed border-pink-500 dark:border-pink-400" />
            <span>Target feed cadence: {formatHoursHm(targetFeedCadenceHours)}</span>
          </span>
        )}
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
  feedsPerDay?: number;
}

export const RoutineSummaryAndChartsGrid: React.FC<RoutineSummaryAndChartsGridProps> = ({
  records,
  routineInsights,
  profile,
  growthRecords = [],
  babyMeasurements = [],
  feedsPerDay = DEFAULT_MILK_FORMULA.feedsPerDay,
}) => {
  const focusDate = routineInsights.todayBucket.date;
  const birthDate =
    profile?.type === 'baby' && profile.dateOfEvent ? profile.dateOfEvent.slice(0, 10) : null;

  const resolveWeightForDate = useMemo(
    () => buildDailyWeightResolver(growthRecords, babyMeasurements, profile),
    [growthRecords, babyMeasurements, profile]
  );

  const intervalSummary = useMemo(
    () => buildDailyRoutineIntervalSummary(records),
    [records]
  );

  const focusIntervalBucket = intervalSummary.dailyMap.get(focusDate) ?? null;
  const recentSevenDayIntervals = useMemo(
    () => buildDailyRoutineIntervalSeries(records, 7, focusDate),
    [records, focusDate]
  );

  const recentFeedAvgHours = useMemo(() => {
    const all = recentSevenDayIntervals.flatMap((d) => d.feedIntervalsHours);
    if (all.length === 0) return null;
    return all.reduce((s, v) => s + v, 0) / all.length;
  }, [recentSevenDayIntervals]);

  const recentDiaperAvgHours = useMemo(() => {
    const all = recentSevenDayIntervals.flatMap((d) => d.diaperIntervalsHours);
    if (all.length === 0) return null;
    return all.reduce((s, v) => s + v, 0) / all.length;
  }, [recentSevenDayIntervals]);

  const targetFeedCadenceHours =
    Number.isFinite(feedsPerDay) && feedsPerDay > 0 ? 24 / feedsPerDay : null;
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

  const loggedBarBoundariesMl = useMemo(
    () => computeLoggedFeedBoundariesMl(routineInsights.todayBucket.feedEntries, totalMl),
    [routineInsights.todayBucket.feedEntries, totalMl]
  );

  const projectedBarPlan = useMemo(
    () => computeProjectedFeedPlan(totalMl, targetMl, routineInsights.recommendedFeedMl),
    [totalMl, targetMl, routineInsights.recommendedFeedMl]
  );

  const loggedFillTotalPct = Math.min(100, ebmBarPct + formulaBarPct);
  const projectedBarWidthPct =
    projectedBarPlan.projectedFeedCount > 0 && targetMl !== null && targetMl > 0
      ? Math.max(0, Math.min(100, (projectedBarPlan.projectedEndMl / progressScaleMax) * 100) - loggedFillTotalPct)
      : 0;

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

            {/* Subtle projected remaining feeds region */}
            {projectedBarWidthPct > 0 && (
              <div
                className="h-full bg-emerald-500/10 dark:bg-emerald-400/12 transition-all"
                style={{ width: `${projectedBarWidthPct}%` }}
                title={`Projected: ~${projectedBarPlan.projectedFeedCount} remaining feed${
                  projectedBarPlan.projectedFeedCount === 1 ? '' : 's'
                } (${gapMl} mL to target)`}
              />
            )}

            {/* Subtle vertical dividers separating individual logged feeds */}
            {loggedBarBoundariesMl.map((cumMl, idx) => {
              const leftPct = Math.min(99.5, (cumMl / progressScaleMax) * 100);
              return (
                <div
                  key={`bar-logged-div-${idx}`}
                  className="pointer-events-none absolute inset-y-0 w-[1px] bg-white/60 dark:bg-stone-950/50 z-10"
                  style={{ left: `${leftPct}%` }}
                />
              );
            })}

            {/* Subtle vertical dashed dividers separating projected remaining feeds */}
            {projectedBarPlan.boundariesMl.map((cumMl, idx) => {
              const leftPct = Math.min(99.5, (cumMl / progressScaleMax) * 100);
              return (
                <div
                  key={`bar-proj-div-${idx}`}
                  className="pointer-events-none absolute inset-y-0 border-l border-dashed border-emerald-600/35 dark:border-emerald-300/35 z-10"
                  style={{ left: `${leftPct}%` }}
                />
              );
            })}

            {/* Recommended target reference line when current intake exceeds target */}
            {targetMarkerPct !== null && (
              <div
                className="pointer-events-none absolute inset-y-0 w-0.5 bg-stone-900/75 dark:bg-white/85 z-20"
                style={{ left: `${targetMarkerPct}%` }}
                title={`Recommended target: ${targetMl} mL`}
              />
            )}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] font-mono tabular-nums text-stone-500 dark:text-stone-400">
            <div className="flex flex-wrap items-center gap-2.5">
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
                  <span className="w-2 h-2 rounded-xs bg-emerald-500/15 border border-dashed border-emerald-500/60 dark:border-emerald-400/60" />
                  Gap {gapMl} mL
                  {projectedBarPlan.projectedFeedCount > 0
                    ? ` (~${projectedBarPlan.projectedFeedCount} proj.)`
                    : ''}
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
          recommendedFeedMl={routineInsights.recommendedFeedMl}
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

      {/* Feeding & Diaper Time Interval Summary & Interactive Trend Chart */}
      <div className="lg:col-span-2 bg-white dark:bg-stone-900 rounded-3xl border border-stone-200 dark:border-stone-800 shadow-xs overflow-hidden transition-colors">
        <div className="grid grid-cols-1 lg:grid-cols-12 divide-y lg:divide-y-0 lg:divide-x divide-stone-100 dark:divide-stone-800 h-full">
          {/* Time Interval Summary */}
          <div className="lg:col-span-4 p-5 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between gap-2 text-xs font-bold text-stone-700 dark:text-stone-200">
                <span className="flex items-center gap-2">
                  <Timer className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                  <span>Time Intervals ({routineInsights.activeDateLabel})</span>
                </span>
                {targetFeedCadenceHours !== null && (
                  <span className="text-[11px] font-mono tabular-nums font-bold text-pink-600 dark:text-pink-400">
                    ~{formatHoursHm(targetFeedCadenceHours)} target
                  </span>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3 mt-3">
                {/* Feeding Interval KPI */}
                <div className="rounded-2xl bg-emerald-50/60 dark:bg-emerald-950/25 border border-emerald-200/70 dark:border-emerald-900/50 p-3">
                  <div className="text-[10px] font-bold uppercase tracking-wide text-emerald-800 dark:text-emerald-300">
                    Feed Gap
                  </div>
                  <div className="text-xl font-black font-mono tabular-nums text-stone-900 dark:text-white mt-1">
                    {focusIntervalBucket?.feedStats
                      ? formatHoursHm(focusIntervalBucket.feedStats.mean)
                      : recentFeedAvgHours !== null
                        ? formatHoursHm(recentFeedAvgHours)
                        : '—'}
                  </div>
                  <div className="text-[10px] font-mono tabular-nums text-stone-500 dark:text-stone-400 mt-1">
                    {focusIntervalBucket?.feedStats
                      ? `${formatNum(focusIntervalBucket.feedStats.min)}–${formatNum(focusIntervalBucket.feedStats.max)}h (${focusIntervalBucket.feedStats.count})`
                      : recentFeedAvgHours !== null
                        ? '7D avg'
                        : 'Need ≥2 feeds'}
                  </div>
                </div>

                {/* Diaper Interval KPI */}
                <div className="rounded-2xl bg-sky-50/60 dark:bg-sky-950/25 border border-sky-200/70 dark:border-sky-900/50 p-3">
                  <div className="text-[10px] font-bold uppercase tracking-wide text-sky-800 dark:text-sky-300">
                    Diaper Gap
                  </div>
                  <div className="text-xl font-black font-mono tabular-nums text-stone-900 dark:text-white mt-1">
                    {focusIntervalBucket?.diaperStats
                      ? formatHoursHm(focusIntervalBucket.diaperStats.mean)
                      : recentDiaperAvgHours !== null
                        ? formatHoursHm(recentDiaperAvgHours)
                        : '—'}
                  </div>
                  <div className="text-[10px] font-mono tabular-nums text-stone-500 dark:text-stone-400 mt-1">
                    {focusIntervalBucket?.diaperStats
                      ? `${formatNum(focusIntervalBucket.diaperStats.min)}–${formatNum(focusIntervalBucket.diaperStats.max)}h (${focusIntervalBucket.diaperStats.count})`
                      : recentDiaperAvgHours !== null
                        ? '7D avg'
                        : 'Need ≥2 logs'}
                  </div>
                </div>
              </div>

              {(intervalSummary.latestFeedIntervalHours !== null ||
                intervalSummary.latestDiaperIntervalHours !== null) && (
                <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 mt-2.5 text-[11px] font-medium text-stone-600 dark:text-stone-300 tabular-nums">
                  {intervalSummary.latestFeedIntervalHours !== null && (
                    <span>
                      Last feed gap:{' '}
                      <strong className="font-mono text-emerald-700 dark:text-emerald-400">
                        {formatHoursHm(intervalSummary.latestFeedIntervalHours)}
                      </strong>
                    </span>
                  )}
                  {intervalSummary.latestFeedIntervalHours !== null &&
                    intervalSummary.latestDiaperIntervalHours !== null && (
                      <span aria-hidden="true" className="text-stone-300 dark:text-stone-600">
                        ·
                      </span>
                    )}
                  {intervalSummary.latestDiaperIntervalHours !== null && (
                    <span>
                      Last diaper gap:{' '}
                      <strong className="font-mono text-sky-700 dark:text-sky-400">
                        {formatHoursHm(intervalSummary.latestDiaperIntervalHours)}
                      </strong>
                    </span>
                  )}
                </div>
              )}
            </div>

            <div className="mt-4 pt-2.5 border-t border-stone-100 dark:border-stone-800 text-[10px] text-stone-500 dark:text-stone-400">
              Feed sessions clustered within 45 min · Compares feeding vs. diaper spacing over time
            </div>
          </div>

          {/* Feeding & Diaper Time Interval Interactive Chart */}
          <div className="lg:col-span-8 p-5">
            <RoutineIntervalTrendChart
              records={records}
              focusDate={focusDate}
              birthDate={birthDate}
              targetFeedCadenceHours={targetFeedCadenceHours}
            />
          </div>
        </div>
      </div>
    </div>
  );
};
