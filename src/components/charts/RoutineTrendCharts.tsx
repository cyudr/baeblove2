import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Baby, Clock, Droplets } from 'lucide-react';
import type { RoutineRecord } from '../../types';
import {
  buildDailyRoutineSeries,
  buildMonthlyRoutineBoxPlots,
  buildWeeklyRoutineBoxPlots,
  type BoxPlotStats,
  type DailyRoutineBucket,
  type DailySpanOption,
  type MonthlySpanOption,
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
  axisMax: number;
  unitLabel: string;
  accent: 'emerald' | 'sky';
  referenceLine?: { value: number; label: string } | null;
  activeKey: string | null;
  onHoverKey: (key: string | null) => void;
}

const SvgBoxPlot: React.FC<SvgBoxPlotProps> = ({
  periods,
  getStats,
  axisMax,
  unitLabel,
  accent,
  referenceLine,
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

  const svgHeight = 152;
  const padTop = 14;
  const padBottom = 26;
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

  return (
    <div ref={scrollRef} className="w-full overflow-x-auto pb-1">
      <svg
        viewBox={`0 0 ${minSvgWidth} ${svgHeight}`}
        className="w-full h-[152px] select-none"
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

        {/* Optional benchmark/target dashed line */}
        {referenceLine && referenceLine.value > 0 && referenceLine.value <= axisMax && (
          <g>
            <line
              x1={padLeft}
              x2={minSvgWidth - padRight}
              y1={yOf(referenceLine.value)}
              y2={yOf(referenceLine.value)}
              className="stroke-emerald-500/70 dark:stroke-emerald-400/60"
              strokeWidth={1.25}
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

              {/* X-axis period label */}
              <text
                x={cx}
                y={svgHeight - 7}
                textAnchor="middle"
                className={`text-[9px] font-mono ${
                  isHovered
                    ? 'fill-stone-900 dark:fill-white font-bold'
                    : 'fill-stone-400 dark:fill-stone-500'
                }`}
              >
                {period.label}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
};

interface FeedingVolumeTrendChartProps {
  records: RoutineRecord[];
  estimatedTargetMl?: number | null;
  focusDate?: string;
}

export const FeedingVolumeTrendChart: React.FC<FeedingVolumeTrendChartProps> = ({
  records,
  estimatedTargetMl = null,
  focusDate,
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

  const dailyAxisMax = useMemo(() => {
    const maxData = Math.max(0, ...dailySeries.map((d) => d.totalMl));
    const maxWithTarget = Math.max(maxData, estimatedTargetMl ?? 0);
    return computeNiceAxisMax(maxWithTarget, 200);
  }, [dailySeries, estimatedTargetMl]);

  const boxAxisMax = useMemo(() => {
    const maxVal = Math.max(
      0,
      ...periodBuckets.map((p) => p.milkStats?.max ?? 0),
      estimatedTargetMl ?? 0
    );
    return computeNiceAxisMax(maxVal, 200);
  }, [periodBuckets, estimatedTargetMl]);

  const hoveredDaily: DailyRoutineBucket | null = useMemo(() => {
    if (granularity !== 'daily' || !hoveredKey) return null;
    return dailySeries.find((d) => d.date === hoveredKey) ?? null;
  }, [granularity, hoveredKey, dailySeries]);

  const hoveredPeriod: RoutinePeriodBoxPlotBucket | null = useMemo(() => {
    if (granularity === 'daily' || !hoveredKey) return null;
    return periodBuckets.find((p) => p.key === hoveredKey) ?? null;
  }, [granularity, hoveredKey, periodBuckets]);

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
            </>
          ) : (
            <span>Hover or tap a day for exact EBM/Formula breakdown</span>
          )
        ) : hoveredPeriod ? (
          hoveredPeriod.milkStats ? (
            <>
              <span className="font-bold text-stone-800 dark:text-stone-100">
                {hoveredPeriod.rangeLabel}
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
            </>
          ) : (
            <>
              <span className="font-bold text-stone-800 dark:text-stone-100">
                {hoveredPeriod.rangeLabel}
              </span>
              <span>· No feeding volume logged</span>
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
            className="relative flex items-end justify-between gap-1.5 h-32 pt-4"
            style={{
              minWidth: dailySeries.length > 9 ? `${dailySeries.length * 36}px` : undefined,
            }}
          >
            {/* Target reference line */}
            {estimatedTargetMl && estimatedTargetMl > 0 && estimatedTargetMl <= dailyAxisMax && (
              <div
                className="pointer-events-none absolute left-0 right-0 border-t border-dashed border-emerald-500/60 dark:border-emerald-400/50"
                style={{
                  bottom: `calc(${Math.round((estimatedTargetMl / dailyAxisMax) * 100)}% * 0.72 + 16px)`,
                }}
                title={`Daily milk target: ${estimatedTargetMl} mL`}
              />
            )}

            {dailySeries.map((bucket) => {
              const ebmHeight = Math.round((bucket.ebmMl / dailyAxisMax) * 100);
              const formulaHeight = Math.round((bucket.formulaMl / dailyAxisMax) * 100);
              const dayLabel = bucket.date.slice(5);
              const isSelected = hoveredKey === bucket.date;
              const showTopValue = dailySeries.length <= 14 || isSelected;
              return (
                <div
                  key={bucket.date}
                  onMouseEnter={() => setHoveredKey(bucket.date)}
                  onMouseLeave={() => setHoveredKey(null)}
                  onClick={() =>
                    setHoveredKey(hoveredKey === bucket.date ? null : bucket.date)
                  }
                  className={`relative z-10 flex-1 min-w-[28px] flex flex-col items-center gap-1 h-full justify-end rounded-lg px-0.5 transition-colors cursor-pointer ${
                    isSelected ? 'bg-emerald-50/70 dark:bg-emerald-950/30' : ''
                  }`}
                  title={`${bucket.date}: ${bucket.totalMl} mL (EBM ${bucket.ebmMl} / Formula ${bucket.formulaMl})`}
                >
                  <span className="text-[8.5px] font-mono tabular-nums font-semibold text-stone-500 dark:text-stone-400 leading-none h-2.5">
                    {showTopValue && bucket.totalMl > 0 ? bucket.totalMl : ''}
                  </span>
                  <div className="w-full max-w-[22px] flex-1 flex flex-col justify-end bg-stone-100 dark:bg-stone-800 rounded-lg overflow-hidden">
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
                  <span
                    className={`text-[9px] font-mono tabular-nums ${
                      isSelected
                        ? 'text-stone-900 dark:text-white font-bold'
                        : 'text-stone-400 dark:text-stone-500'
                    }`}
                  >
                    {dayLabel}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <SvgBoxPlot
          periods={periodBuckets}
          getStats={(p) => p.milkStats}
          axisMax={boxAxisMax}
          unitLabel="mL per day"
          accent="emerald"
          referenceLine={
            estimatedTargetMl ? { value: estimatedTargetMl, label: `${estimatedTargetMl} mL` } : null
          }
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
          </div>
        )}
        {estimatedTargetMl && estimatedTargetMl > 0 && (
          <span className="font-mono tabular-nums">Target: {estimatedTargetMl} mL/d</span>
        )}
      </div>
    </div>
  );
};

interface DiaperOutputTrendChartProps {
  records: RoutineRecord[];
  focusDate?: string;
}

export const DiaperOutputTrendChart: React.FC<DiaperOutputTrendChartProps> = ({
  records,
  focusDate,
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
              </span>
              <span>·</span>
              <span className="font-semibold text-sky-700 dark:text-sky-400">
                {hoveredDaily.totalDiapers} change{hoveredDaily.totalDiapers === 1 ? '' : 's'}
              </span>
              <span>
                (Wet {hoveredDaily.wetDiapers}, Mixed {hoveredDaily.mixedDiapers}, Dirty{' '}
                {hoveredDaily.dirtyDiapers})
              </span>
            </>
          ) : (
            <span>Hover or tap a day for Wet / Mixed / Dirty counts</span>
          )
        ) : hoveredPeriod ? (
          hoveredPeriod.diaperStats ? (
            <>
              <span className="font-bold text-stone-800 dark:text-stone-100">
                {hoveredPeriod.rangeLabel}
              </span>
              <span>·</span>
              <span className="font-semibold text-sky-700 dark:text-sky-400">
                Med {formatNum(hoveredPeriod.diaperStats.median)}/d
              </span>
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
            className="relative flex items-end justify-between gap-1.5 h-32 pt-4"
            style={{
              minWidth: dailySeries.length > 9 ? `${dailySeries.length * 36}px` : undefined,
            }}
          >
            {/* 6-diaper pediatric hydration reference line */}
            <div
              className="pointer-events-none absolute left-0 right-0 border-t border-dashed border-emerald-500/70 dark:border-emerald-500/60"
              style={{
                bottom: `calc(${Math.round((6 / dailyAxisMax) * 100)}% * 0.72 + 16px)`,
              }}
              title="Pediatric hydration benchmark: 6 wet diapers/day"
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
              const isSelected = hoveredKey === bucket.date;
              const showTopValue = dailySeries.length <= 14 || isSelected;
              return (
                <div
                  key={bucket.date}
                  onMouseEnter={() => setHoveredKey(bucket.date)}
                  onMouseLeave={() => setHoveredKey(null)}
                  onClick={() =>
                    setHoveredKey(hoveredKey === bucket.date ? null : bucket.date)
                  }
                  className={`relative z-10 flex-1 min-w-[28px] flex flex-col items-center gap-1 h-full justify-end rounded-lg px-0.5 transition-colors cursor-pointer ${
                    isSelected ? 'bg-sky-50/70 dark:bg-sky-950/30' : ''
                  }`}
                  title={`${bucket.date}: ${bucket.totalDiapers} changes (Wet ${bucket.wetDiapers}, Mixed ${bucket.mixedDiapers}, Dirty ${bucket.dirtyDiapers})`}
                >
                  <span className="text-[9px] font-mono tabular-nums font-semibold text-stone-500 dark:text-stone-400 leading-none h-2.5">
                    {showTopValue && bucket.totalDiapers > 0 ? bucket.totalDiapers : ''}
                  </span>
                  <div className="w-full max-w-[22px] flex-1 flex flex-col justify-end bg-stone-100 dark:bg-stone-800 rounded-lg overflow-hidden">
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
                  <span
                    className={`text-[9px] font-mono tabular-nums ${
                      isSelected
                        ? 'text-stone-900 dark:text-white font-bold'
                        : 'text-stone-400 dark:text-stone-500'
                    }`}
                  >
                    {dayLabel}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <SvgBoxPlot
          periods={periodBuckets}
          getStats={(p) => p.diaperStats}
          axisMax={boxAxisMax}
          unitLabel="diapers per day"
          accent="sky"
          referenceLine={{ value: 6, label: '6/day' }}
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
        <span>Benchmark: ≥6 wet/day</span>
      </div>
    </div>
  );
};

interface RoutineSummaryAndChartsGridProps {
  records: RoutineRecord[];
  routineInsights: RoutineInterpretation;
}

export const RoutineSummaryAndChartsGrid: React.FC<RoutineSummaryAndChartsGridProps> = ({
  records,
  routineInsights,
}) => {
  const focusDate = routineInsights.todayBucket.date;
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
          focusDate={focusDate}
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
                >
                  {wetPlusMixed}/6 wet
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
              Pediatric hydration benchmark: ≥6 wet diapers/day
            </div>
          </div>

          {/* Diaper Output Interactive Chart */}
          <div className="lg:col-span-8 p-5">
            <DiaperOutputTrendChart records={records} focusDate={focusDate} />
          </div>
        </div>
      </div>
    </div>
  );
};
