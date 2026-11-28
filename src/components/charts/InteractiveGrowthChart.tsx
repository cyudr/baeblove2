import React, { useState, useMemo, useCallback, useEffect } from 'react';
import {
  MetricType,
  WHODataPoint,
  getWHOCurve,
  calculatePercentile,
  UnitConverter,
} from '../../data/growthStandards';
import { BabyMeasurement, ChildProfile, UnitSystem } from '../../types';
import { useApp } from '../../context/AppContext';
import {
  computeAutoZoomRange,
  computeNiceAxisScale,
  buildNiceTicksWithStep,
  formatCompactNumber,
} from '../../utils/chartZoom';
import {
  AgeAxisScaleMode,
  AgeAxisUnit,
  DAYS_PER_MONTH,
  DAYS_PER_WEEK,
  ageUnitToDays,
  computeExactAgeFromBirth,
  daysToAgeUnit,
  formatAdaptiveAgeFromDays,
  formatAgeAxisTick,
  getAgeAxisLabel,
  selectAutoAgeUnit,
} from '../../utils/ageCalculator';
import { Info, TrendingUp, Sliders, BookOpen, Calendar } from 'lucide-react';

type GrowthZoomMode = 'auto' | 12 | 24 | 36;

const DOMAIN_MAX_MONTHS = 36;
const DOMAIN_MAX_DAYS = DOMAIN_MAX_MONTHS * DAYS_PER_MONTH;

function interpolateWHOPoint(rawCurve: WHODataPoint[], month: number): WHODataPoint {
  if (rawCurve.length === 0) {
    return { month, L: 0, M: 0, S: 0, p3: 0, p15: 0, p50: 0, p85: 0, p97: 0 };
  }
  const minM = rawCurve[0].month;
  const maxM = rawCurve[rawCurve.length - 1].month;
  const clamped = Math.max(minM, Math.min(maxM, month));

  let low = rawCurve[0];
  let high = rawCurve[rawCurve.length - 1];
  for (let i = 0; i < rawCurve.length - 1; i++) {
    if (clamped >= rawCurve[i].month && clamped <= rawCurve[i + 1].month) {
      low = rawCurve[i];
      high = rawCurve[i + 1];
      break;
    }
  }

  const span = high.month - low.month;
  const t = span > 0 ? (clamped - low.month) / span : 0;
  const lerp = (a: number, b: number) => a + (b - a) * t;

  return {
    month: clamped,
    L: lerp(low.L, high.L),
    M: lerp(low.M, high.M),
    S: lerp(low.S, high.S),
    p3: lerp(low.p3, high.p3),
    p15: lerp(low.p15, high.p15),
    p50: lerp(low.p50, high.p50),
    p85: lerp(low.p85, high.p85),
    p97: lerp(low.p97, high.p97),
  };
}

function weightFromWHOLMS(pt: WHODataPoint, zScore: number): number {
  const { L, M, S } = pt;
  if (!Number.isFinite(M) || M <= 0) return 0;
  if (Math.abs(L) < 1e-4) {
    return M * Math.exp(S * zScore);
  }
  const base = Math.max(0.05, 1 + L * S * zScore);
  return M * Math.pow(base, 1 / L);
}

interface WeightProjectionPoint {
  day: number;
  val: number;
  low: number;
  high: number;
  se: number;
}

interface WeightProjectionResult {
  startDay: number;
  endDay: number;
  slopeGramsPerDay: number;
  residualSeKg: number;
  points: WeightProjectionPoint[];
  evaluateAtDay: (day: number) => WeightProjectionPoint | null;
}

interface InteractiveGrowthChartProps {
  profile: ChildProfile;
  measurements: BabyMeasurement[];
  unitSystem: UnitSystem;
  onOpenFormulaModal?: () => void;
}

export const InteractiveGrowthChart: React.FC<InteractiveGrowthChartProps> = ({
  profile,
  measurements,
  unitSystem,
  onOpenFormulaModal,
}) => {
  const { theme } = useApp();
  const isDark = theme === 'dark';
  const [metric, setMetric] = useState<MetricType>('weight');
  const [zoomMode, setZoomMode] = useState<GrowthZoomMode>('auto');
  const [timeScaleMode, setTimeScaleMode] = useState<AgeAxisScaleMode>('auto');
  const [showBands, setShowBands] = useState<boolean>(true);
  const [showProjection, setShowProjection] = useState<boolean>(true);
  const [hoveredPoint, setHoveredPoint] = useState<{
    id: string;
    exactDays: number;
    ageLabel: string;
    value: number;
    percentile: number;
    zScore: number;
    date: string;
    notes?: string;
    x: number;
    y: number;
  } | null>(null);

  // Interactive scrubber state tracking continuously across exact age in days
  const [scrubberState, setScrubberState] = useState<{
    days: number;
    svgX: number;
    p3: number;
    p15: number;
    p50: number;
    p85: number;
    p97: number;
    nearestMeasurement?: {
      id: string;
      exactDays: number;
      ageLabel: string;
      val: number;
      percentile: number;
      zScore: number;
      date: string;
      notes?: string;
      x: number;
      y: number;
    };
    projected?: {
      val: number;
      low: number;
      high: number;
      se: number;
      percentile: number;
    };
  } | null>(null);

  const rawCurve = useMemo(() => {
    return getWHOCurve(metric, profile.gender);
  }, [metric, profile.gender]);

  // Recalculate exact age (days / months) for every retrieved measurement taking reference from birthday
  const enrichedMeasurements = useMemo(() => {
    return measurements.map((m) => {
      const exact = computeExactAgeFromBirth(profile.dateOfEvent, m.date);
      const exactDays = exact
        ? exact.totalDays
        : m.ageInDays !== undefined && Number.isFinite(m.ageInDays)
        ? Math.max(0, m.ageInDays)
        : Math.max(0, m.ageInMonths * DAYS_PER_MONTH);
      const exactMonths = exactDays / DAYS_PER_MONTH;
      const ageLabel = formatAdaptiveAgeFromDays(exactDays, {
        birthDateStr: profile.dateOfEvent,
        recordDateStr: m.date,
      });
      return {
        ...m,
        exactDays,
        exactMonths,
        ageLabel,
      };
    });
  }, [measurements, profile.dateOfEvent]);

  // Compute visible X-axis range in exact days (Auto = 200% of current available data time range)
  const [xMinDays, xMaxDays] = useMemo<[number, number]>(() => {
    if (zoomMode !== 'auto') {
      return [0, zoomMode * DAYS_PER_MONTH];
    }

    const metricDays = enrichedMeasurements
      .filter((m) => {
        if (metric === 'weight') return m.weightKg !== undefined;
        if (metric === 'length') return m.lengthCm !== undefined;
        if (metric === 'headCircumference') return m.headCircumferenceCm !== undefined;
        return false;
      })
      .map((m) => m.exactDays);

    const sourceDays =
      metricDays.length > 0 ? metricDays : enrichedMeasurements.map((m) => m.exactDays);

    return computeAutoZoomRange(sourceDays, {
      domainMin: 0,
      domainMax: DOMAIN_MAX_DAYS,
      minSpan: 2,
      emptyRange: [0, 12 * DAYS_PER_MONTH],
      singlePointAnchorAtOrigin: true,
      singlePointFallbackSpan: 7,
    });
  }, [zoomMode, enrichedMeasurements, metric]);

  const xSpanDays = Math.max(0.0001, xMaxDays - xMinDays);

  // Auto-select Days / Weeks / Months / Years based on the visible/retrieved age range
  const effectiveUnit = useMemo<AgeAxisUnit>(() => {
    if (timeScaleMode !== 'auto') return timeScaleMode;
    return selectAutoAgeUnit(xMaxDays, xSpanDays);
  }, [timeScaleMode, xMaxDays, xSpanDays]);

  // Build smooth interpolated WHO reference curve spanning exactly [xMinDays, xMaxDays]
  const curve = useMemo<Array<WHODataPoint & { day: number }>>(() => {
    if (rawCurve.length === 0) return [];
    const xMinMonths = xMinDays / DAYS_PER_MONTH;
    const xMaxMonths = xMaxDays / DAYS_PER_MONTH;
    const sampleDays = new Set<number>([xMinDays, xMaxDays]);

    rawCurve.forEach((pt) => {
      if (pt.month > xMinMonths && pt.month < xMaxMonths) {
        sampleDays.add(pt.month * DAYS_PER_MONTH);
      }
    });

    const minSteps = 28;
    if (sampleDays.size < minSteps) {
      for (let i = 1; i < minSteps; i++) {
        sampleDays.add(xMinDays + (xSpanDays * i) / minSteps);
      }
    }

    return Array.from(sampleDays)
      .sort((a, b) => a - b)
      .map((day) => ({
        ...interpolateWHOPoint(rawCurve, day / DAYS_PER_MONTH),
        day,
      }));
  }, [rawCurve, xMinDays, xMaxDays, xSpanDays]);

  // SVG dimensions & coordinate padding
  const width = 800;
  const height = 450;
  const padding = { top: 35, right: 38, bottom: 48, left: 62 };

  // Convert underlying metric value (kg or cm) into the active Y-axis display unit
  const toDisplayY = useCallback(
    (metricVal: number): number => {
      if (metric === 'weight') {
        return unitSystem === 'imperial' ? metricVal * 2.20462 : metricVal;
      }
      return unitSystem === 'imperial' ? metricVal / 2.54 : metricVal;
    },
    [metric, unitSystem]
  );

  const yUnitSuffix = useMemo(() => {
    if (metric === 'weight') return unitSystem === 'imperial' ? 'lb' : 'kg';
    return unitSystem === 'imperial' ? 'in' : 'cm';
  }, [metric, unitSystem]);

  // Compute weight projection line and ±1 SE standard error zone when viewing weight
  const weightProjection = useMemo<WeightProjectionResult | null>(() => {
    if (metric !== 'weight' || rawCurve.length === 0) return null;

    // Group weights by day bucket (0.25d precision) so same-day duplicates don't skew regression
    const byDay = new Map<number, { day: number; sum: number; count: number }>();
    for (const m of enrichedMeasurements) {
      if (typeof m.weightKg !== 'number' || !Number.isFinite(m.weightKg) || m.weightKg <= 0) {
        continue;
      }
      const key = Math.round(m.exactDays * 4) / 4;
      const existing = byDay.get(key);
      if (existing) {
        existing.sum += m.weightKg;
        existing.count += 1;
      } else {
        byDay.set(key, { day: m.exactDays, sum: m.weightKg, count: 1 });
      }
    }

    const obs = Array.from(byDay.values())
      .map((b) => ({ day: b.day, weightKg: b.sum / b.count }))
      .sort((a, b) => a.day - b.day);

    if (obs.length < 2) return null;

    const lastObs = obs[obs.length - 1];
    const totalObsSpan = lastObs.day - obs[0].day;
    if (totalObsSpan < 0.5) return null;

    // Use recent 90-day window when >= 3 points exist in it, otherwise full history
    const recentObs = obs.filter((p) => lastObs.day - p.day <= 90);
    const fitObs = recentObs.length >= 3 ? recentObs : obs;
    const n = fitObs.length;
    const fitSpan = Math.max(0.5, fitObs[n - 1].day - fitObs[0].day);

    // Recency-weighted linear regression (WLS)
    const tauWeight = Math.max(14, fitSpan * 0.45);
    const weights = fitObs.map((p) => Math.exp(-(lastObs.day - p.day) / tauWeight));
    const sumW = weights.reduce((s, w) => s + w, 0);
    const meanD = fitObs.reduce((s, p, i) => s + weights[i] * p.day, 0) / sumW;
    const meanY = fitObs.reduce((s, p, i) => s + weights[i] * p.weightKg, 0) / sumW;

    let sddW = 0;
    let sdyW = 0;
    for (let i = 0; i < n; i++) {
      const dd = fitObs[i].day - meanD;
      sddW += weights[i] * dd * dd;
      sdyW += weights[i] * dd * (fitObs[i].weightKg - meanY);
    }

    if (sddW <= 1e-6) return null;
    const beta1 = sdyW / sddW; // kg/day
    const beta0 = meanY - beta1 * meanD;

    // Empirical residual standard error
    let residualSeKg: number;
    if (n >= 3) {
      let rssW = 0;
      for (let i = 0; i < n; i++) {
        const pred = beta0 + beta1 * fitObs[i].day;
        const err = fitObs[i].weightKg - pred;
        rssW += weights[i] * err * err;
      }
      const rawSe = Math.sqrt((rssW / sumW) * (n / (n - 2)));
      const minFloor = Math.max(0.035, 0.012 * lastObs.weightKg);
      const maxCap = Math.max(0.35, 0.12 * lastObs.weightKg);
      residualSeKg = Math.max(minFloor, Math.min(maxCap, rawSe));
    } else {
      residualSeKg = Math.max(0.05, 0.015 * lastObs.weightKg);
    }

    // Unweighted Sxx for forecast leverage SE cone
    const meanDUnw = fitObs.reduce((s, p) => s + p.day, 0) / n;
    const sxxUnw = fitObs.reduce((s, p) => s + (p.day - meanDUnw) * (p.day - meanDUnw), 0);

    const startDay = lastObs.day;
    const startWeight = lastObs.weightKg;
    const maxForwardDays = Math.max(14, Math.min(180, Math.max(totalObsSpan * 1.5, 35)));
    const endDay = Math.min(xMaxDays, DOMAIN_MAX_DAYS, startDay + maxForwardDays);
    if (endDay <= startDay + 0.5) return null;

    // Anchor to baby's current WHO LMS Z-score channel so multi-month projections curve realistically
    const startZ = calculatePercentile(
      startWeight,
      startDay / DAYS_PER_MONTH,
      'weight',
      profile.gender
    ).zScore;
    const whoStartPt = interpolateWHOPoint(rawCurve, startDay / DAYS_PER_MONTH);
    const whoNextPt = interpolateWHOPoint(rawCurve, (startDay + 1) / DAYS_PER_MONTH);
    const whoAtStart = weightFromWHOLMS(whoStartPt, startZ);
    const whoSlopeStart = Math.max(0, weightFromWHOLMS(whoNextPt, startZ) - whoAtStart);

    // Guard local slope against extreme outliers while preserving actual child velocity
    const clampedSlope = Math.max(whoSlopeStart * 0.2, Math.min(0.085, beta1));
    const excessSlope = clampedSlope - whoSlopeStart;
    const decayTau = 45; // days over which excess velocity blends smoothly back to WHO channel

    const evaluateAtDay = (day: number): WeightProjectionPoint | null => {
      if (day < startDay - 1e-6 || day > endDay + 1e-6) return null;
      const deltaD = Math.max(0, day - startDay);
      const whoPt = interpolateWHOPoint(rawCurve, day / DAYS_PER_MONTH);
      const whoDelta = weightFromWHOLMS(whoPt, startZ) - whoAtStart;
      const excessDelta = excessSlope * decayTau * (1 - Math.exp(-deltaD / decayTau));
      const val = Math.max(0.2, startWeight + whoDelta + excessDelta);

      const leverageTerm = (deltaD * deltaD) / Math.max(sxxUnw, 16);
      const processTerm = deltaD / Math.max(14, fitSpan);
      const se = deltaD <= 1e-6 ? 0 : residualSeKg * Math.sqrt(leverageTerm + processTerm);

      return {
        day,
        val,
        low: Math.max(0.2, val - se),
        high: val + se,
        se,
      };
    };

    const steps = 28;
    const points: WeightProjectionPoint[] = [];
    for (let i = 0; i <= steps; i++) {
      const d = startDay + ((endDay - startDay) * i) / steps;
      const pt = evaluateAtDay(d);
      if (pt) points.push(pt);
    }

    return {
      startDay,
      endDay,
      slopeGramsPerDay: Math.round(clampedSlope * 1000),
      residualSeKg,
      points,
      evaluateAtDay,
    };
  }, [metric, rawCurve, enrichedMeasurements, xMaxDays, profile.gender]);

  // Compute exact, round Y-axis scale in display units so gridlines & tick labels match 100%
  const yScale = useMemo(() => {
    const visibleDisplayValues: number[] = [];

    if (showBands) {
      curve.forEach((d) => {
        visibleDisplayValues.push(toDisplayY(d.p3), toDisplayY(d.p97));
      });
    }

    if (metric === 'weight' && showProjection && weightProjection) {
      weightProjection.points.forEach((pt) => {
        if (pt.day >= xMinDays - 1e-6 && pt.day <= xMaxDays + 1e-6) {
          visibleDisplayValues.push(toDisplayY(pt.low), toDisplayY(pt.high));
        }
      });
    }

    enrichedMeasurements.forEach((m) => {
      if (m.exactDays < xMinDays - 1e-6 || m.exactDays > xMaxDays + 1e-6) return;
      const val =
        metric === 'weight'
          ? m.weightKg
          : metric === 'length'
          ? m.lengthCm
          : m.headCircumferenceCm;
      if (val !== undefined && Number.isFinite(val)) {
        visibleDisplayValues.push(toDisplayY(val));
      }
    });

    // If bands are hidden and there are no points in view, fall back to WHO median range
    if (visibleDisplayValues.length === 0 && curve.length > 0) {
      curve.forEach((d) => {
        visibleDisplayValues.push(toDisplayY(d.p3), toDisplayY(d.p97));
      });
    }

    if (visibleDisplayValues.length === 0) {
      return computeNiceAxisScale(0, 10, { targetTicks: 6, clampMinZero: true });
    }

    const rawMin = Math.min(...visibleDisplayValues);
    const rawMax = Math.max(...visibleDisplayValues);
    const minSpan =
      metric === 'weight'
        ? unitSystem === 'imperial'
          ? 1
          : 0.4
        : unitSystem === 'imperial'
        ? 1
        : 2;

    return computeNiceAxisScale(rawMin, rawMax, {
      targetTicks: 6,
      paddingRatio: 0.08,
      clampMinZero: true,
      minSpan,
    });
  }, [
    curve,
    enrichedMeasurements,
    metric,
    xMinDays,
    xMaxDays,
    showBands,
    showProjection,
    weightProjection,
    toDisplayY,
    unitSystem,
  ]);

  const scaleX = useCallback(
    (day: number) => {
      const usableW = width - padding.left - padding.right;
      return padding.left + ((day - xMinDays) / xSpanDays) * usableW;
    },
    [xMinDays, xSpanDays, width, padding.left, padding.right]
  );

  const scaleYDisplay = useCallback(
    (displayVal: number) => {
      const usableH = height - padding.top - padding.bottom;
      const norm = (displayVal - yScale.min) / Math.max(0.0001, yScale.max - yScale.min);
      return height - padding.bottom - norm * usableH;
    },
    [yScale.min, yScale.max, height, padding.top, padding.bottom]
  );

  const scaleY = useCallback(
    (metricVal: number) => scaleYDisplay(toDisplayY(metricVal)),
    [scaleYDisplay, toDisplayY]
  );

  // Convert for imperial display if needed
  const displayValue = useCallback(
    (metricVal: number) => {
      if (metric === 'weight') {
        return UnitConverter.formatWeight(metricVal, unitSystem);
      }
      return UnitConverter.formatLength(metricVal, unitSystem);
    },
    [metric, unitSystem]
  );

  // Build SVG path strings for percentile curves with sub-pixel precision
  const makePath = (key: keyof WHODataPoint) => {
    return curve
      .map((pt, i) => {
        const x = scaleX(pt.day);
        const y = scaleY(pt[key] as number);
        return `${i === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`;
      })
      .join(' ');
  };

  // Build area band between two percentile lines (e.g. p3 to p97)
  const makeAreaBand = (keyLow: keyof WHODataPoint, keyHigh: keyof WHODataPoint) => {
    if (curve.length === 0) return '';
    const topPoints = curve.map(
      (pt) => `${scaleX(pt.day).toFixed(2)},${scaleY(pt[keyHigh] as number).toFixed(2)}`
    );
    const bottomPoints = [...curve]
      .reverse()
      .map((pt) => `${scaleX(pt.day).toFixed(2)},${scaleY(pt[keyLow] as number).toFixed(2)}`);
    return `M ${topPoints.join(' L ')} L ${bottomPoints.join(' L ')} Z`;
  };

  // Filter and sort user measurements within the visible [xMinDays, xMaxDays] range
  const validMeasurements = useMemo(() => {
    return enrichedMeasurements
      .filter((m) => {
        if (m.exactDays < xMinDays - 1e-6 || m.exactDays > xMaxDays + 1e-6) return false;
        if (metric === 'weight') return m.weightKg !== undefined;
        if (metric === 'length') return m.lengthCm !== undefined;
        if (metric === 'headCircumference') return m.headCircumferenceCm !== undefined;
        return false;
      })
      .sort((a, b) => a.exactDays - b.exactDays)
      .map((m) => {
        const rawVal =
          metric === 'weight'
            ? m.weightKg!
            : metric === 'length'
            ? m.lengthCm!
            : m.headCircumferenceCm!;
        const { percentile, zScore } = calculatePercentile(
          rawVal,
          m.exactMonths,
          metric,
          profile.gender
        );
        return {
          ...m,
          val: rawVal,
          percentile,
          zScore,
          x: scaleX(m.exactDays),
          y: scaleY(rawVal),
        };
      });
  }, [enrichedMeasurements, xMinDays, xMaxDays, metric, profile.gender, scaleX, scaleY]);

  // Connect user measurement points with a precise polyline
  const userPath = useMemo(() => {
    if (validMeasurements.length < 2) return '';
    return validMeasurements
      .map((m, i) => `${i === 0 ? 'M' : 'L'} ${m.x.toFixed(2)} ${m.y.toFixed(2)}`)
      .join(' ');
  }, [validMeasurements]);

  // SVG paths for weight projection center line and ±1 SE standard error zone
  const projectionPaths = useMemo(() => {
    if (metric !== 'weight' || !showProjection || !weightProjection) return null;
    const pts = weightProjection.points;
    if (pts.length < 2) return null;

    const centerPath = pts
      .map((p, i) => `${i === 0 ? 'M' : 'L'} ${scaleX(p.day).toFixed(2)} ${scaleY(p.val).toFixed(2)}`)
      .join(' ');
    const upperPath = pts
      .map((p, i) => `${i === 0 ? 'M' : 'L'} ${scaleX(p.day).toFixed(2)} ${scaleY(p.high).toFixed(2)}`)
      .join(' ');
    const lowerPath = pts
      .map((p, i) => `${i === 0 ? 'M' : 'L'} ${scaleX(p.day).toFixed(2)} ${scaleY(p.low).toFixed(2)}`)
      .join(' ');

    const upperCoords = pts.map((p) => `${scaleX(p.day).toFixed(2)},${scaleY(p.high).toFixed(2)}`);
    const lowerCoords = [...pts]
      .reverse()
      .map((p) => `${scaleX(p.day).toFixed(2)},${scaleY(p.low).toFixed(2)}`);
    const seZonePath = `M ${upperCoords.join(' L ')} L ${lowerCoords.join(' L ')} Z`;

    const lastPt = pts[pts.length - 1];
    return {
      centerPath,
      upperPath,
      lowerPath,
      seZonePath,
      endX: scaleX(lastPt.day),
      endY: scaleY(lastPt.val),
      endVal: lastPt.val,
    };
  }, [metric, showProjection, weightProjection, scaleX, scaleY]);

  // Latest measurement stats
  const latest = validMeasurements[validMeasurements.length - 1];

  // Dynamic X-axis ticks aligned precisely to the active unit (days / weeks / months / years)
  const xTickSpec = useMemo(() => {
    const minInUnit = daysToAgeUnit(xMinDays, effectiveUnit);
    const maxInUnit = daysToAgeUnit(xMaxDays, effectiveUnit);
    const candidateSteps: Record<AgeAxisUnit, number[]> = {
      days: [1, 2, 3, 5, 7, 10, 14, 15, 20, 30, 60, 90, 180],
      weeks: [0.5, 1, 2, 3, 4, 6, 8, 12, 16, 24, 26],
      months: [0.1, 0.25, 0.5, 1, 2, 3, 4, 6],
      years: [0.1, 0.25, 0.5, 1],
    };
    return buildNiceTicksWithStep(minInUnit, maxInUnit, candidateSteps[effectiveUnit], 8);
  }, [xMinDays, xMaxDays, effectiveUnit]);

  const updateScrubberBySvgX = (svgX: number) => {
    const usableW = width - padding.left - padding.right;
    if (svgX < padding.left || svgX > width - padding.right) {
      setScrubberState(null);
      return;
    }
    const ratio = (svgX - padding.left) / usableW;
    const rawDays = xMinDays + ratio * xSpanDays;
    // Snap cleanly in days for high precision
    const snapDays =
      xSpanDays <= 21
        ? 0.5
        : xSpanDays <= 120
        ? 1
        : xSpanDays <= 400
        ? DAYS_PER_WEEK / 2
        : DAYS_PER_WEEK;
    const scrubbedDays = Math.max(
      xMinDays,
      Math.min(xMaxDays, Number((Math.round(rawDays / snapDays) * snapDays).toFixed(2)))
    );
    const curvePt = interpolateWHOPoint(rawCurve, scrubbedDays / DAYS_PER_MONTH);

    // Find closest measurement within proportional tolerance
    const toleranceDays = Math.max(0.6, xSpanDays * 0.04);
    let nearest: (typeof validMeasurements)[number] | undefined;
    let bestDist = Infinity;
    for (const m of validMeasurements) {
      const dist = Math.abs(m.exactDays - scrubbedDays);
      if (dist <= toleranceDays && dist < bestDist) {
        bestDist = dist;
        nearest = m;
      }
    }

    let projected:
      | {
          val: number;
          low: number;
          high: number;
          se: number;
          percentile: number;
        }
      | undefined;
    if (
      metric === 'weight' &&
      showProjection &&
      weightProjection &&
      scrubbedDays > weightProjection.startDay + 1e-4 &&
      scrubbedDays <= weightProjection.endDay + 1e-4
    ) {
      const projPt = weightProjection.evaluateAtDay(scrubbedDays);
      if (projPt) {
        const { percentile } = calculatePercentile(
          projPt.val,
          scrubbedDays / DAYS_PER_MONTH,
          'weight',
          profile.gender
        );
        projected = {
          val: projPt.val,
          low: projPt.low,
          high: projPt.high,
          se: projPt.se,
          percentile,
        };
      }
    }

    setScrubberState({
      days: scrubbedDays,
      svgX: scaleX(scrubbedDays),
      p3: curvePt.p3,
      p15: curvePt.p15,
      p50: curvePt.p50,
      p85: curvePt.p85,
      p97: curvePt.p97,
      nearestMeasurement: nearest
        ? {
            id: nearest.id,
            exactDays: nearest.exactDays,
            ageLabel: nearest.ageLabel,
            val: nearest.val,
            percentile: nearest.percentile,
            zScore: nearest.zScore,
            date: nearest.date,
            notes: nearest.notes,
            x: nearest.x,
            y: nearest.y,
          }
        : undefined,
      projected,
    });
  };

  const handleSvgMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const svg = e.currentTarget;
    const rect = svg.getBoundingClientRect();
    const clientX = e.clientX - rect.left;
    const svgX = (clientX / rect.width) * width;
    updateScrubberBySvgX(svgX);
  };

  const handleSvgTouch = (e: React.TouchEvent<SVGSVGElement>) => {
    if (e.touches.length === 0) return;
    setHoveredPoint(null);
    const touch = e.touches[0];
    const svg = e.currentTarget;
    const rect = svg.getBoundingClientRect();
    const clientX = touch.clientX - rect.left;
    const svgX = (clientX / rect.width) * width;
    updateScrubberBySvgX(svgX);
  };

  useEffect(() => {
    setScrubberState(null);
    setHoveredPoint(null);
  }, [metric, zoomMode, timeScaleMode, profile.id]);

  const rangeSummaryLabel = useMemo(() => {
    const minU = daysToAgeUnit(xMinDays, effectiveUnit);
    const maxU = daysToAgeUnit(xMaxDays, effectiveUnit);
    const dec = effectiveUnit === 'days' ? 0 : effectiveUnit === 'years' ? 2 : 1;
    return `${formatAgeAxisTick(minU, effectiveUnit, dec)}–${formatAgeAxisTick(maxU, effectiveUnit, dec)}`;
  }, [xMinDays, xMaxDays, effectiveUnit]);

  const scrubberAgeLabel = useMemo(() => {
    if (!scrubberState) return '';
    return formatAdaptiveAgeFromDays(scrubberState.days, {
      forcedUnit: timeScaleMode === 'auto' ? undefined : timeScaleMode,
    });
  }, [scrubberState, timeScaleMode]);

  return (
    <div className="bg-white dark:bg-stone-900 rounded-2xl md:rounded-3xl border border-stone-200 dark:border-stone-800 p-4 md:p-6 shadow-xs transition-colors">
      {/* Header controls & segmented buttons */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-4 border-b border-stone-100 dark:border-stone-800">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-bold text-stone-900 dark:text-white">
              WHO Growth Standards & Percentiles
            </h3>
            <span className="text-xs text-stone-500 dark:text-stone-400">
              {profile.gender === 'boy' ? 'Boys' : 'Girls'} · {rangeSummaryLabel}
              {zoomMode === 'auto' ? ' · Auto' : ''}
            </span>
            <span className="text-xs text-emerald-900 dark:text-emerald-300 font-semibold bg-emerald-100 dark:bg-emerald-950/80 px-2 py-0.5 rounded-lg border border-emerald-200/60 dark:border-emerald-800/60">
              WHO LMS Standard (2006)
            </span>
          </div>
          <p className="text-xs text-stone-500 dark:text-stone-400 mt-1">
            Age calculated from birthday ({profile.dateOfEvent}) against WHO Multicentre child growth references.
          </p>
        </div>

        {/* Metric Segmented Control & Age Scale */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Age unit selector: Auto / Days / Weeks / Months / Years */}
          <div className="inline-flex p-0.5 bg-stone-100 dark:bg-stone-800 rounded-xl border border-stone-200/60 dark:border-stone-700/60">
            {(
              [
                { id: 'auto', label: 'Auto' },
                { id: 'days', label: 'Days' },
                { id: 'weeks', label: 'Weeks' },
                { id: 'months', label: 'Months' },
                { id: 'years', label: 'Years' },
              ] as const
            ).map((opt) => (
              <button
                key={opt.id}
                onClick={() => setTimeScaleMode(opt.id)}
                title={
                  opt.id === 'auto'
                    ? `Automatically picks Days/Weeks/Months/Years (currently ${effectiveUnit})`
                    : `Show X-axis in ${opt.label}`
                }
                className={`px-2 py-1 text-xs font-semibold rounded-lg transition-colors flex items-center gap-1 ${
                  timeScaleMode === opt.id
                    ? 'bg-white dark:bg-stone-900 text-stone-900 dark:text-white shadow-2xs font-bold'
                    : 'text-stone-600 dark:text-stone-400 hover:text-stone-900 dark:hover:text-white'
                }`}
              >
                {opt.id === 'auto' && <Calendar className="w-3 h-3" />}
                <span>{opt.label}</span>
              </button>
            ))}
          </div>

          <div className="inline-flex p-1 bg-stone-100 dark:bg-stone-800 rounded-xl border border-stone-200/60 dark:border-stone-700/60">
            <button
              onClick={() => setMetric('weight')}
              className={`px-3 py-1 text-xs font-semibold rounded-lg transition-colors ${
                metric === 'weight'
                  ? 'bg-white dark:bg-stone-900 text-stone-900 dark:text-white shadow-2xs font-bold'
                  : 'text-stone-600 dark:text-stone-400 hover:text-stone-900 dark:hover:text-white'
              }`}
            >
              Weight
            </button>
            <button
              onClick={() => setMetric('length')}
              className={`px-3 py-1 text-xs font-semibold rounded-lg transition-colors ${
                metric === 'length'
                  ? 'bg-white dark:bg-stone-900 text-stone-900 dark:text-white shadow-2xs font-bold'
                  : 'text-stone-600 dark:text-stone-400 hover:text-stone-900 dark:hover:text-white'
              }`}
            >
              Length / Height
            </button>
            <button
              onClick={() => setMetric('headCircumference')}
              className={`px-3 py-1 text-xs font-semibold rounded-lg transition-colors ${
                metric === 'headCircumference'
                  ? 'bg-white dark:bg-stone-900 text-stone-900 dark:text-white shadow-2xs font-bold'
                  : 'text-stone-600 dark:text-stone-400 hover:text-stone-900 dark:hover:text-white'
              }`}
            >
              Head Circ.
            </button>
          </div>

          {/* Age range filter */}
          <div className="inline-flex p-1 bg-stone-100 dark:bg-stone-800 rounded-xl border border-stone-200/60 dark:border-stone-700/60">
            <button
              onClick={() => setZoomMode('auto')}
              title="Auto-zoom to 200% of current available data time range"
              className={`px-2.5 py-1 text-xs font-semibold rounded-lg transition-colors ${
                zoomMode === 'auto'
                  ? 'bg-white dark:bg-stone-900 text-stone-900 dark:text-white shadow-2xs font-bold'
                  : 'text-stone-600 dark:text-stone-400 hover:text-stone-900 dark:hover:text-white'
              }`}
            >
              Auto
            </button>
            <button
              onClick={() => setZoomMode(12)}
              className={`px-2.5 py-1 text-xs font-semibold rounded-lg transition-colors ${
                zoomMode === 12
                  ? 'bg-white dark:bg-stone-900 text-stone-900 dark:text-white shadow-2xs font-bold'
                  : 'text-stone-600 dark:text-stone-400 hover:text-stone-900 dark:hover:text-white'
              }`}
            >
              1 Year
            </button>
            <button
              onClick={() => setZoomMode(24)}
              className={`px-2.5 py-1 text-xs font-semibold rounded-lg transition-colors ${
                zoomMode === 24
                  ? 'bg-white dark:bg-stone-900 text-stone-900 dark:text-white shadow-2xs font-bold'
                  : 'text-stone-600 dark:text-stone-400 hover:text-stone-900 dark:hover:text-white'
              }`}
            >
              2 Years
            </button>
            <button
              onClick={() => setZoomMode(36)}
              className={`px-2.5 py-1 text-xs font-semibold rounded-lg transition-colors ${
                zoomMode === 36
                  ? 'bg-white dark:bg-stone-900 text-stone-900 dark:text-white shadow-2xs font-bold'
                  : 'text-stone-600 dark:text-stone-400 hover:text-stone-900 dark:hover:text-white'
              }`}
            >
              3 Years
            </button>
          </div>

          {/* Toggle percentile bands */}
          <button
            onClick={() => setShowBands(!showBands)}
            title="Toggle percentile zones"
            className={`p-1.5 text-xs rounded-xl border flex items-center gap-1.5 transition-colors cursor-pointer shadow-2xs ${
              showBands
                ? 'bg-emerald-50 dark:bg-emerald-950/60 border-emerald-300 dark:border-emerald-800 text-emerald-900 dark:text-emerald-300 font-semibold'
                : 'bg-white dark:bg-stone-900 border-stone-200 dark:border-stone-700 text-stone-400 dark:text-stone-500 hover:text-stone-700 dark:hover:text-stone-300'
            }`}
          >
            <Sliders className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Bands</span>
          </button>

          {/* Toggle weight projection & ±1 SE zone */}
          {metric === 'weight' && weightProjection && (
            <button
              type="button"
              onClick={() => setShowProjection((prev) => !prev)}
              title={`Toggle weight projection line & ±1 SE standard error zone (~${weightProjection.slopeGramsPerDay >= 0 ? '+' : ''}${weightProjection.slopeGramsPerDay} g/day)`}
              className={`p-1.5 text-xs rounded-xl border flex items-center gap-1.5 transition-colors cursor-pointer shadow-2xs ${
                showProjection
                  ? 'bg-indigo-50 dark:bg-indigo-950/60 border-indigo-300 dark:border-indigo-800 text-indigo-900 dark:text-indigo-300 font-semibold'
                  : 'bg-white dark:bg-stone-900 border-stone-200 dark:border-stone-700 text-stone-400 dark:text-stone-500 hover:text-stone-700 dark:hover:text-stone-300'
              }`}
            >
              <TrendingUp className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Projection</span>
            </button>
          )}

          {onOpenFormulaModal && (
            <button
              type="button"
              onClick={onOpenFormulaModal}
              title="View WHO 2006 LMS mathematical formulas and peer-reviewed sources"
              className="px-3 py-1.5 rounded-xl border border-stone-200 dark:border-stone-700 bg-stone-50 dark:bg-stone-800 hover:bg-stone-100 dark:hover:bg-stone-700 text-xs font-semibold text-stone-700 dark:text-stone-200 hover:text-amber-900 dark:hover:text-amber-300 transition-colors flex items-center gap-1.5 cursor-pointer shadow-2xs"
            >
              <BookOpen className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
              <span>Formula Math</span>
            </button>
          )}
        </div>
      </div>

      {/* Static-Height 3-Row Scrubber / Latest measurement summary strip (zero layout shift) */}
      <div
        className={`mt-3 h-[76px] px-3.5 py-2 rounded-xl flex flex-col justify-between border text-xs overflow-hidden transition-colors ${
          scrubberState
            ? 'bg-emerald-50/80 dark:bg-emerald-950/40 border-emerald-300 dark:border-emerald-800 text-stone-800 dark:text-stone-200'
            : 'bg-stone-50 dark:bg-stone-800/60 border-stone-200/60 dark:border-stone-700/60 text-stone-700 dark:text-stone-300'
        }`}
      >
        {scrubberState ? (
          <>
            {/* Row 1: Inspecting Age + Latest reset */}
            <div className="h-[18px] flex items-center justify-between gap-2 min-w-0 leading-none">
              <span className="font-bold text-emerald-950 dark:text-emerald-200 truncate">
                Inspecting Age: {scrubberAgeLabel}
              </span>
              {latest && (
                <button
                  type="button"
                  onClick={() => {
                    setScrubberState(null);
                    setHoveredPoint(null);
                  }}
                  className="text-[10px] font-semibold text-emerald-800 dark:text-emerald-300 hover:underline cursor-pointer whitespace-nowrap shrink-0"
                >
                  Latest
                </button>
              )}
            </div>

            {/* Row 2: Logged measurement or Weight Projection */}
            <div className="h-[18px] flex items-center justify-between gap-2 min-w-0 leading-none">
              {scrubberState.nearestMeasurement ? (
                <>
                  <span className="inline-flex items-center px-1.5 py-0.5 rounded-md bg-emerald-600 text-white font-bold text-[10px] font-mono tabular-nums whitespace-nowrap truncate">
                    Logged: {displayValue(scrubberState.nearestMeasurement.val)} ({scrubberState.nearestMeasurement.percentile}%)
                  </span>
                  <span className="text-[10px] font-mono tabular-nums text-stone-500 dark:text-stone-400 shrink-0 whitespace-nowrap">
                    {scrubberState.nearestMeasurement.date}
                  </span>
                </>
              ) : scrubberState.projected ? (
                <>
                  <span className="inline-flex items-center px-1.5 py-0.5 rounded-md bg-indigo-600 text-white font-bold text-[10px] font-mono tabular-nums whitespace-nowrap truncate">
                    Projected: {displayValue(scrubberState.projected.val)} ({scrubberState.projected.percentile}%)
                  </span>
                  <span className="text-[10px] font-mono tabular-nums text-indigo-700 dark:text-indigo-300 shrink-0 whitespace-nowrap">
                    ±SE: {displayValue(scrubberState.projected.low)}–{displayValue(scrubberState.projected.high)}
                  </span>
                </>
              ) : (
                <span className="text-[11px] text-stone-500 dark:text-stone-400 truncate">
                  Logged: —
                </span>
              )}
            </div>

            {/* Row 3: Median & Band */}
            <div className="h-[18px] flex items-center gap-2 min-w-0 text-[11px] leading-none font-mono tabular-nums">
              <span className="shrink-0">
                <span className="font-sans text-stone-600 dark:text-stone-400">Median: </span>
                <strong className="text-stone-900 dark:text-white">{displayValue(scrubberState.p50)}</strong>
              </span>
              <span aria-hidden="true" className="text-stone-300 dark:text-stone-600 shrink-0">|</span>
              <span className="text-stone-600 dark:text-stone-400 truncate">
                <span className="font-sans">Band: </span>
                {displayValue(scrubberState.p3)}–{displayValue(scrubberState.p97)}
              </span>
            </div>
          </>
        ) : latest ? (
          <>
            {/* Row 1: Latest value */}
            <div className="h-[18px] flex items-center justify-between gap-2 min-w-0 leading-none">
              <div className="flex items-center gap-1.5 min-w-0 truncate">
                <span className="font-bold text-stone-900 dark:text-white shrink-0">Latest:</span>
                <span className="font-mono tabular-nums font-bold text-stone-900 dark:text-white shrink-0">
                  {displayValue(latest.val)}
                </span>
              </div>
              <span className="hidden sm:inline text-[10px] text-stone-400 dark:text-stone-500 shrink-0 whitespace-nowrap">
                Hover or touch chart to inspect
              </span>
            </div>

            {/* Row 2: Age & Percentile */}
            <div className="h-[18px] flex items-center justify-between gap-2 min-w-0 leading-none">
              <span className="truncate text-[11px]">
                Age: <strong className="text-stone-900 dark:text-white">{latest.ageLabel}</strong>
              </span>
              <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-800 dark:text-emerald-400 shrink-0 whitespace-nowrap">
                <TrendingUp className="w-3.5 h-3.5" />
                <span>{latest.percentile}th %ile</span>
              </span>
            </div>

            {/* Row 3: Date & Z-score */}
            <div className="h-[18px] flex items-center gap-2 min-w-0 text-[11px] leading-none font-mono tabular-nums text-stone-500 dark:text-stone-400">
              <span className="truncate">Date: {latest.date}</span>
              <span aria-hidden="true" className="text-stone-300 dark:text-stone-600 shrink-0">|</span>
              <span className="shrink-0">
                Z-score: {latest.zScore > 0 ? `+${latest.zScore}` : latest.zScore}
              </span>
            </div>
          </>
        ) : (
          <>
            <div className="h-[18px] flex items-center font-bold text-stone-800 dark:text-stone-200 leading-none truncate">
              WHO Growth Reference Curve
            </div>
            <div className="h-[18px] flex items-center text-[11px] text-stone-500 dark:text-stone-400 leading-none truncate">
              No measurements logged yet
            </div>
            <div className="h-[18px] flex items-center text-[11px] text-stone-500 dark:text-stone-400 leading-none truncate">
              Hover or touch along the chart to inspect median and band values
            </div>
          </>
        )}
      </div>

      {/* SVG Interactive Canvas */}
      <div className="relative mt-4 w-full overflow-hidden select-none">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="w-full h-auto cursor-crosshair touch-pan-y"
          style={{ maxHeight: '420px' }}
          onMouseMove={handleSvgMouseMove}
          onMouseLeave={() => {
            setHoveredPoint(null);
          }}
          onTouchStart={handleSvgTouch}
          onTouchMove={handleSvgTouch}
        >
          <defs>
            {/* Soft gradient for 15th-85th percentile band */}
            <linearGradient id="bandInnerGrad" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor={isDark ? '#064e3b' : '#dcfce7'} stopOpacity={isDark ? '0.55' : '0.75'} />
              <stop offset="100%" stopColor={isDark ? '#064e3b' : '#dcfce7'} stopOpacity={isDark ? '0.22' : '0.35'} />
            </linearGradient>
            {/* Softer outer gradient for 3rd-97th */}
            <linearGradient id="bandOuterGrad" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor={isDark ? '#292524' : '#f4f4f5'} stopOpacity={isDark ? '0.75' : '0.8'} />
              <stop offset="100%" stopColor={isDark ? '#292524' : '#f4f4f5'} stopOpacity={isDark ? '0.35' : '0.4'} />
            </linearGradient>
            {/* Soft gradient for ±1 SE weight projection standard error zone */}
            <linearGradient id="projSeGrad" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor={isDark ? '#818cf8' : '#6366f1'} stopOpacity={isDark ? '0.26' : '0.22'} />
              <stop offset="100%" stopColor={isDark ? '#818cf8' : '#6366f1'} stopOpacity={isDark ? '0.12' : '0.10'} />
            </linearGradient>
            <clipPath id="whoPlotAreaClip">
              <rect
                x={padding.left}
                y={padding.top}
                width={width - padding.left - padding.right}
                height={height - padding.top - padding.bottom}
              />
            </clipPath>
          </defs>

          {/* Exact Y-axis Grid Lines & Ticks (1:1 aligned in display unit) */}
          {yScale.ticks.map((tickVal, i) => {
            const y = scaleYDisplay(tickVal);
            return (
              <g key={`y-${i}`}>
                <line
                  x1={padding.left}
                  y1={y}
                  x2={width - padding.right}
                  y2={y}
                  stroke={isDark ? '#292524' : '#e7e5e4'}
                  strokeDasharray="3 3"
                  strokeWidth="1"
                />
                <line
                  x1={padding.left - 4}
                  y1={y}
                  x2={padding.left}
                  y2={y}
                  stroke={isDark ? '#57534e' : '#a8a29e'}
                  strokeWidth="1"
                />
                <text
                  x={padding.left - 8}
                  y={y + 3.5}
                  textAnchor="end"
                  className="text-[10px] fill-stone-500 dark:fill-stone-400 font-mono"
                >
                  {tickVal.toFixed(yScale.decimals)} {yUnitSuffix}
                </text>
              </g>
            );
          })}

          {/* Exact X-axis Grid Lines & Ticks (1:1 aligned to Days / Weeks / Months / Years) */}
          {xTickSpec.ticks.map((tickVal) => {
            const tickDay = ageUnitToDays(tickVal, effectiveUnit);
            const x = scaleX(tickDay);
            return (
              <g key={`x-${tickVal}`}>
                <line
                  x1={x}
                  y1={padding.top}
                  x2={x}
                  y2={height - padding.bottom}
                  stroke={isDark ? '#292524' : '#f5f5f4'}
                  strokeWidth="1"
                />
                <line
                  x1={x}
                  y1={height - padding.bottom}
                  x2={x}
                  y2={height - padding.bottom + 4}
                  stroke={isDark ? '#57534e' : '#a8a29e'}
                  strokeWidth="1"
                />
                <text
                  x={x}
                  y={height - padding.bottom + 18}
                  textAnchor="middle"
                  className="text-[10px] fill-stone-500 dark:fill-stone-400 font-mono"
                >
                  {formatAgeAxisTick(tickVal, effectiveUnit, xTickSpec.decimals)}
                </text>
              </g>
            );
          })}

          {/* Crisp X and Y axis baseline rules */}
          <line
            x1={padding.left}
            y1={padding.top}
            x2={padding.left}
            y2={height - padding.bottom}
            stroke={isDark ? '#44403c' : '#d6d3d1'}
            strokeWidth="1"
          />
          <line
            x1={padding.left}
            y1={height - padding.bottom}
            x2={width - padding.right}
            y2={height - padding.bottom}
            stroke={isDark ? '#44403c' : '#d6d3d1'}
            strokeWidth="1"
          />

          {/* Percentile Bands (3rd-97th and 15th-85th) */}
          {showBands && curve.length > 0 && (
            <>
              <g clipPath="url(#whoPlotAreaClip)">
                <path
                  d={makeAreaBand('p3', 'p97')}
                  fill="url(#bandOuterGrad)"
                  opacity="0.8"
                />
                <path
                  d={makeAreaBand('p15', 'p85')}
                  fill="url(#bandInnerGrad)"
                />
                <path
                  d={makePath('p97')}
                  fill="none"
                  stroke={isDark ? '#78716c' : '#a8a29e'}
                  strokeWidth="1"
                  strokeDasharray="2 3"
                />
                <path
                  d={makePath('p85')}
                  fill="none"
                  stroke={isDark ? '#059669' : '#86efac'}
                  strokeWidth="1"
                />
                <path
                  d={makePath('p50')}
                  fill="none"
                  stroke={isDark ? '#34d399' : '#15803d'}
                  strokeWidth="2"
                />
                <path
                  d={makePath('p15')}
                  fill="none"
                  stroke={isDark ? '#059669' : '#86efac'}
                  strokeWidth="1"
                />
                <path
                  d={makePath('p3')}
                  fill="none"
                  stroke={isDark ? '#78716c' : '#a8a29e'}
                  strokeWidth="1"
                  strokeDasharray="2 3"
                />
              </g>

              {/* End of curve labels (97th, 50th, 3rd) */}
              <text
                x={width - padding.right + 4}
                y={scaleY(curve[curve.length - 1].p97) + 3}
                className="text-[9px] fill-stone-400 dark:fill-stone-400 font-sans font-medium"
              >
                97th
              </text>
              <text
                x={width - padding.right + 4}
                y={scaleY(curve[curve.length - 1].p50) + 3}
                className="text-[9px] fill-emerald-800 dark:fill-emerald-400 font-sans font-semibold"
              >
                50th
              </text>
              <text
                x={width - padding.right + 4}
                y={scaleY(curve[curve.length - 1].p3) + 3}
                className="text-[9px] fill-stone-400 dark:fill-stone-400 font-sans font-medium"
              >
                3rd
              </text>
            </>
          )}

          {/* Weight Projection Line & ±1 SE Standard Error Zone */}
          {projectionPaths && (
            <g clipPath="url(#whoPlotAreaClip)" className="pointer-events-none">
              <path d={projectionPaths.seZonePath} fill="url(#projSeGrad)" />
              <path
                d={projectionPaths.upperPath}
                fill="none"
                stroke={isDark ? '#818cf8' : '#6366f1'}
                strokeWidth="1"
                strokeDasharray="2 3"
                opacity="0.65"
              />
              <path
                d={projectionPaths.lowerPath}
                fill="none"
                stroke={isDark ? '#818cf8' : '#6366f1'}
                strokeWidth="1"
                strokeDasharray="2 3"
                opacity="0.65"
              />
              <path
                d={projectionPaths.centerPath}
                fill="none"
                stroke={isDark ? '#818cf8' : '#4f46e5'}
                strokeWidth="2"
                strokeDasharray="6 4"
                strokeLinecap="round"
              />
              <circle
                cx={projectionPaths.endX}
                cy={projectionPaths.endY}
                r="3.2"
                fill={isDark ? '#1c1917' : '#ffffff'}
                stroke={isDark ? '#818cf8' : '#4f46e5'}
                strokeWidth="2"
              />
            </g>
          )}

          {/* User Logged Measurements Polyline */}
          {userPath && (
            <path
              d={userPath}
              fill="none"
              stroke={isDark ? '#2dd4bf' : '#0f766e'}
              strokeWidth="2.75"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}

          {/* Hover Point Precision Crosshair Guides to X and Y axes */}
          {hoveredPoint && (
            <g className="pointer-events-none">
              <line
                x1={padding.left}
                y1={hoveredPoint.y}
                x2={hoveredPoint.x}
                y2={hoveredPoint.y}
                stroke={isDark ? '#2dd4bf' : '#0f766e'}
                strokeWidth="1"
                strokeDasharray="3 3"
                opacity="0.7"
              />
              <line
                x1={hoveredPoint.x}
                y1={hoveredPoint.y}
                x2={hoveredPoint.x}
                y2={height - padding.bottom}
                stroke={isDark ? '#2dd4bf' : '#0f766e'}
                strokeWidth="1"
                strokeDasharray="3 3"
                opacity="0.7"
              />
            </g>
          )}

          {/* User Data Points */}
          {validMeasurements.map((m) => {
            const isHovered = hoveredPoint?.id === m.id;
            return (
              <g
                key={m.id}
                className="cursor-pointer"
                onMouseEnter={() =>
                  setHoveredPoint({
                    id: m.id,
                    exactDays: m.exactDays,
                    ageLabel: m.ageLabel,
                    value: m.val,
                    percentile: m.percentile,
                    zScore: m.zScore,
                    date: m.date,
                    notes: m.notes,
                    x: m.x,
                    y: m.y,
                  })
                }
                onMouseLeave={() => setHoveredPoint(null)}
                onClick={() =>
                  setHoveredPoint({
                    id: m.id,
                    exactDays: m.exactDays,
                    ageLabel: m.ageLabel,
                    value: m.val,
                    percentile: m.percentile,
                    zScore: m.zScore,
                    date: m.date,
                    notes: m.notes,
                    x: m.x,
                    y: m.y,
                  })
                }
              >
                {/* Subtle halo */}
                <circle
                  cx={m.x}
                  cy={m.y}
                  r={isHovered ? 8 : 6}
                  fill={isDark ? '#2dd4bf' : '#0f766e'}
                  opacity={isHovered ? 0.25 : 0.16}
                />
                {/* Solid core */}
                <circle
                  cx={m.x}
                  cy={m.y}
                  r={isHovered ? 5 : 4}
                  fill={isDark ? '#2dd4bf' : '#0f766e'}
                  stroke={isDark ? '#1c1917' : '#ffffff'}
                  strokeWidth="2"
                />
              </g>
            );
          })}

          {/* Real-time Vertical Guideline and Interactive Tooltip when scrubbing */}
          {scrubberState && !hoveredPoint && (
            <g className="pointer-events-none">
              <line
                x1={scrubberState.svgX}
                y1={padding.top}
                x2={scrubberState.svgX}
                y2={height - padding.bottom}
                stroke="#10b981"
                strokeWidth="1.5"
                strokeDasharray="4 3"
              />

              {/* Floating Rich Tooltip */}
              <g
                transform={`translate(${
                  scrubberState.svgX > width - 195
                    ? scrubberState.svgX - 188
                    : scrubberState.svgX + 12
                }, ${
                  scaleY(scrubberState.p50) < 110
                    ? Math.min(height - padding.bottom - 85, scaleY(scrubberState.p50) + 12)
                    : Math.max(padding.top + 4, scaleY(scrubberState.p50) - 80)
                })`}
                className="drop-shadow-lg"
              >
                <rect
                  width="178"
                  height={
                    scrubberState.nearestMeasurement || scrubberState.projected ? 78 : 60
                  }
                  rx="10"
                  fill="#18181b"
                  opacity="0.96"
                  stroke="#3f3f46"
                  strokeWidth="0.75"
                />
                <text
                  x="10"
                  y="16"
                  className="text-[10px] font-bold fill-emerald-400 font-sans tracking-wide uppercase"
                >
                  Age: {scrubberAgeLabel}
                </text>
                <text
                  x="10"
                  y="30"
                  className="text-[11px] font-extrabold fill-white font-sans"
                >
                  Median (50th): {displayValue(scrubberState.p50)}
                </text>
                <text
                  x="10"
                  y="44"
                  className="text-[9px] fill-stone-300 font-sans"
                >
                  Normal Range: {displayValue(scrubberState.p3)} – {displayValue(scrubberState.p97)}
                </text>
                {scrubberState.nearestMeasurement ? (
                  <>
                    <line x1="8" y1="50" x2="170" y2="50" stroke="#3f3f46" strokeWidth="0.75" />
                    <text
                      x="10"
                      y="62"
                      className="text-[10px] font-bold fill-teal-300 font-sans"
                    >
                      Measured: {displayValue(scrubberState.nearestMeasurement.val)} ({scrubberState.nearestMeasurement.percentile}th %)
                    </text>
                    <text
                      x="10"
                      y="73"
                      className="text-[8px] fill-stone-400 font-sans"
                    >
                      {scrubberState.nearestMeasurement.date} · {scrubberState.nearestMeasurement.ageLabel} · Z: {scrubberState.nearestMeasurement.zScore}
                    </text>
                  </>
                ) : scrubberState.projected ? (
                  <>
                    <line x1="8" y1="50" x2="170" y2="50" stroke="#3f3f46" strokeWidth="0.75" />
                    <text
                      x="10"
                      y="62"
                      className="text-[10px] font-bold fill-indigo-300 font-sans"
                    >
                      Projected: {displayValue(scrubberState.projected.val)} ({scrubberState.projected.percentile}th %)
                    </text>
                    <text
                      x="10"
                      y="73"
                      className="text-[8px] fill-stone-400 font-sans"
                    >
                      ±1 SE: {displayValue(scrubberState.projected.low)} – {displayValue(scrubberState.projected.high)}
                    </text>
                  </>
                ) : null}
              </g>
            </g>
          )}

          {/* Active Hover / Tap Tooltip in SVG */}
          {hoveredPoint && (
            <g
              transform={`translate(${
                hoveredPoint.x > width - 175
                  ? hoveredPoint.x - 168
                  : hoveredPoint.x + 12
              }, ${
                hoveredPoint.y < 85 ? hoveredPoint.y + 10 : hoveredPoint.y - 72
              })`}
              className="pointer-events-none drop-shadow-md"
            >
              <rect
                width="160"
                height="64"
                rx="8"
                fill="#1c1917"
                opacity="0.95"
                stroke="#3f3f46"
                strokeWidth="0.75"
              />
              <text
                x="10"
                y="18"
                className="text-[11px] font-semibold fill-white font-sans"
              >
                {displayValue(hoveredPoint.value)}
              </text>
              <text
                x="10"
                y="34"
                className="text-[10px] fill-stone-300 font-sans"
              >
                {hoveredPoint.percentile}th Percentile (Z: {hoveredPoint.zScore})
              </text>
              <text
                x="10"
                y="50"
                className="text-[9px] fill-emerald-300 font-sans"
              >
                {hoveredPoint.date} · {hoveredPoint.ageLabel}
              </text>
            </g>
          )}

          {/* Axis Label */}
          <text
            x={(padding.left + width - padding.right) / 2}
            y={height - 10}
            textAnchor="middle"
            className="text-[11px] fill-stone-500 dark:fill-stone-400 font-sans font-medium"
          >
            {getAgeAxisLabel(effectiveUnit)}
            {effectiveUnit !== 'days' && xSpanDays <= 35
              ? ` · ${formatCompactNumber(xSpanDays, 0)}d span`
              : ''}
          </text>
        </svg>
      </div>

      {/* Legend & Guide footer */}
      <div className="mt-4 pt-3.5 border-t border-stone-100 dark:border-stone-800 flex flex-wrap items-center justify-between text-xs text-stone-500 dark:text-stone-400 gap-y-2">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-0.5 bg-teal-600 dark:bg-teal-400 rounded-full"></span>
            <span className="w-2 h-2 rounded-full bg-teal-600 dark:bg-teal-400 border border-white dark:border-stone-900"></span>
            <span className="text-stone-700 dark:text-stone-200 font-semibold">{profile.name}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-0.5 bg-emerald-600 dark:bg-emerald-400 rounded-full"></span>
            <span className="text-stone-600 dark:text-stone-300">WHO 50th % (Median)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-2 bg-emerald-100 dark:bg-emerald-950/80 rounded-xs border border-emerald-200/60 dark:border-emerald-800/60"></span>
            <span className="text-stone-600 dark:text-stone-300">15th – 85th % (Typical)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-2 bg-stone-100 dark:bg-stone-800 rounded-xs border border-stone-200 dark:border-stone-700"></span>
            <span className="text-stone-600 dark:text-stone-300">3rd – 97th %</span>
          </div>
          {projectionPaths && (
            <>
              <div className="flex items-center gap-1.5">
                <span className="w-3.5 border-t-2 border-dashed border-indigo-600 dark:border-indigo-400"></span>
                <span className="text-stone-600 dark:text-stone-300">Weight Projection</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-3 h-2 bg-indigo-500/20 rounded-xs border border-dotted border-indigo-500/70 dark:border-indigo-400/70"></span>
                <span className="text-stone-600 dark:text-stone-300">±1 SE Zone</span>
              </div>
            </>
          )}
        </div>

        <div className="flex items-center gap-1 text-[11px] text-stone-400 dark:text-stone-500">
          <Info className="w-3.5 h-3.5" />
          <span>Tap any data point for exact percentile</span>
        </div>
      </div>
    </div>
  );
};
