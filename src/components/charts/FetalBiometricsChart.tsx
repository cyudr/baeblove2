import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import {
  FETAL_BIOMETRIC_STANDARDS,
  FetalBiometricRef,
  getFetalBiometricRef,
} from '../../data/fetalStandards';
import { UnitConverter } from '../../data/growthStandards';
import { FetalMeasurement, ChildProfile, UnitSystem } from '../../types';
import { useApp } from '../../context/AppContext';
import {
  computeAutoZoomRange,
  computeNiceAxisScale,
  buildNiceTicksWithStep,
  formatCompactNumber,
} from '../../utils/chartZoom';
import { parseCalendarDateUTC } from '../../utils/ageCalculator';
import { Info, BookOpen } from 'lucide-react';

interface FetalBiometricsChartProps {
  profile: ChildProfile;
  measurements: FetalMeasurement[];
  unitSystem: UnitSystem;
  onOpenFormulaModal?: () => void;
}

type FetalMetricKey = 'efw' | 'bpd' | 'hc' | 'ac' | 'fl';
type FetalZoomMode = 'auto' | 'full';

function formatGestationalWeeksLabel(totalWeeks: number): string {
  const wholeWeeks = Math.floor(totalWeeks + 1e-6);
  const remDays = Math.round((totalWeeks - wholeWeeks) * 7);
  if (remDays === 7) return `${wholeWeeks + 1}w 0d`;
  return `${wholeWeeks}w ${remDays}d`;
}

export const FetalBiometricsChart: React.FC<FetalBiometricsChartProps> = ({
  profile,
  measurements,
  unitSystem,
  onOpenFormulaModal,
}) => {
  const { formulaSettings, theme } = useApp();
  const isDark = theme === 'dark';
  const [selectedMetric, setSelectedMetric] = useState<FetalMetricKey>('efw');
  const [zoomMode, setZoomMode] = useState<FetalZoomMode>('auto');
  const [customWeekRange, setCustomWeekRange] = useState<[number, number] | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const currentWeekRangeRef = useRef<[number, number]>([12, 40]);
  const pinchStateRef = useRef<{
    initialDistance: number;
    initialMidRatio: number;
    initialMinWeek: number;
    initialMaxWeek: number;
  } | null>(null);
  const suppressScrubUntilLiftRef = useRef(false);
  const [hoveredPoint, setHoveredPoint] = useState<{
    id: string;
    weekLabel: string;
    value: number;
    date: string;
    notes?: string;
    x: number;
    y: number;
    ref5: number;
    ref50: number;
    ref95: number;
  } | null>(null);

  // Scrubber tracking state across gestation weeks 12-40
  const [scrubberState, setScrubberState] = useState<{
    week: number;
    svgX: number;
    ref5: number;
    ref50: number;
    ref95: number;
    nearestMeasurement?: {
      id: string;
      weekLabel: string;
      val: number;
      date: string;
      notes?: string;
      x: number;
      y: number;
    };
  } | null>(null);

  const metricConfig = {
    efw: {
      name: 'Estimated Fetal Weight (EFW)',
      unit: unitSystem === 'imperial' ? 'oz' : 'g',
      keyP5: 'efwP5' as const,
      keyP50: 'efwP50' as const,
      keyP95: 'efwP95' as const,
      toDisplayY: (val: number) => (unitSystem === 'imperial' ? val * 0.035274 : val),
      formatVal: (val: number) => UnitConverter.formatFetalWeight(val, unitSystem),
      getMeasurementVal: (m: FetalMeasurement) => m.efwGrams,
    },
    bpd: {
      name: 'Biparietal Diameter (BPD)',
      unit: unitSystem === 'imperial' ? 'in' : 'mm',
      keyP5: 'bpdP5' as const,
      keyP50: 'bpdP50' as const,
      keyP95: 'bpdP95' as const,
      toDisplayY: (val: number) => (unitSystem === 'imperial' ? val / 25.4 : val),
      formatVal: (val: number) =>
        unitSystem === 'imperial' ? `${(val / 25.4).toFixed(2)} in` : `${val} mm`,
      getMeasurementVal: (m: FetalMeasurement) => m.bpdMm,
    },
    hc: {
      name: 'Head Circumference (HC)',
      unit: unitSystem === 'imperial' ? 'in' : 'mm',
      keyP5: 'hcP5' as const,
      keyP50: 'hcP50' as const,
      keyP95: 'hcP95' as const,
      toDisplayY: (val: number) => (unitSystem === 'imperial' ? val / 25.4 : val),
      formatVal: (val: number) =>
        unitSystem === 'imperial' ? `${(val / 25.4).toFixed(2)} in` : `${val} mm`,
      getMeasurementVal: (m: FetalMeasurement) => m.hcMm,
    },
    ac: {
      name: 'Abdominal Circumference (AC)',
      unit: unitSystem === 'imperial' ? 'in' : 'mm',
      keyP5: 'acP5' as const,
      keyP50: 'acP50' as const,
      keyP95: 'acP95' as const,
      toDisplayY: (val: number) => (unitSystem === 'imperial' ? val / 25.4 : val),
      formatVal: (val: number) =>
        unitSystem === 'imperial' ? `${(val / 25.4).toFixed(2)} in` : `${val} mm`,
      getMeasurementVal: (m: FetalMeasurement) => m.acMm,
    },
    fl: {
      name: 'Femur Length (FL)',
      unit: unitSystem === 'imperial' ? 'in' : 'mm',
      keyP5: 'flP5' as const,
      keyP50: 'flP50' as const,
      keyP95: 'flP95' as const,
      toDisplayY: (val: number) => (unitSystem === 'imperial' ? val / 25.4 : val),
      formatVal: (val: number) =>
        unitSystem === 'imperial' ? `${(val / 25.4).toFixed(2)} in` : `${val} mm`,
      getMeasurementVal: (m: FetalMeasurement) => m.flMm,
    },
  };

  const currentCfg = metricConfig[selectedMetric];

  // SVG dimensions
  const width = 800;
  const height = 420;
  const padding = { top: 35, right: 38, bottom: 48, left: 66 };

  const domainMinWeek = 12;
  const domainMaxWeek = 40;

  // Derive exact fractional gestational weeks (from recorded weeks+days, or fallback from due date -> scan date)
  const enrichedMeasurements = useMemo(() => {
    const dueUtc = parseCalendarDateUTC(profile.dateOfEvent);
    return measurements.map((m) => {
      let totalWeeks = m.gestationalWeeks + (m.gestationalDays || 0) / 7;
      if ((!Number.isFinite(totalWeeks) || totalWeeks <= 0) && dueUtc !== null) {
        const scanUtc = parseCalendarDateUTC(m.date);
        if (scanUtc !== null) {
          const daysUntilDue = Math.round((dueUtc - scanUtc) / 86_400_000);
          const gestDays = Math.max(0, Math.min(294, 280 - daysUntilDue));
          totalWeeks = gestDays / 7;
        }
      }
      const weekLabel = formatGestationalWeeksLabel(totalWeeks);
      return {
        ...m,
        totalWeeks,
        weekLabel,
      };
    });
  }, [measurements, profile.dateOfEvent]);

  // Compute preset gestational week range (Auto = 200% of current available data time range)
  const [presetMinWeek, presetMaxWeek] = useMemo<[number, number]>(() => {
    if (zoomMode === 'full') {
      return [domainMinWeek, domainMaxWeek];
    }

    const metricWeeks = enrichedMeasurements
      .filter((m) => {
        const val = currentCfg.getMeasurementVal(m);
        return val !== undefined && val > 0;
      })
      .map((m) => m.totalWeeks);

    const sourceWeeks =
      metricWeeks.length > 0 ? metricWeeks : enrichedMeasurements.map((m) => m.totalWeeks);

    return computeAutoZoomRange(sourceWeeks, {
      domainMin: domainMinWeek,
      domainMax: domainMaxWeek,
      minSpan: 2,
      emptyRange: [domainMinWeek, domainMaxWeek],
      singlePointAnchorAtOrigin: false,
      singlePointFallbackSpan: 6,
    });
  }, [zoomMode, enrichedMeasurements, currentCfg]);

  const [minWeek, maxWeek] = customWeekRange ?? [presetMinWeek, presetMaxWeek];
  currentWeekRangeRef.current = [minWeek, maxWeek];

  const weekSpan = Math.max(0.0001, maxWeek - minWeek);
  const MIN_PINCH_SPAN_WEEKS = 2;

  const clampWeekRange = useCallback(
    (startW: number, endW: number): [number, number] => {
      const fullSpan = domainMaxWeek - domainMinWeek;
      const span = Math.max(MIN_PINCH_SPAN_WEEKS, Math.min(fullSpan, endW - startW));
      let minW = startW;
      let maxW = startW + span;
      if (minW < domainMinWeek) {
        minW = domainMinWeek;
        maxW = domainMinWeek + span;
      }
      if (maxW > domainMaxWeek) {
        maxW = domainMaxWeek;
        minW = Math.max(domainMinWeek, domainMaxWeek - span);
      }
      return [Number(minW.toFixed(3)), Number(maxW.toFixed(3))];
    },
    []
  );

  // Native non-passive touch & trackpad pinch-zoom listeners on the SVG
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;

    const getPlotRatioFromClientX = (clientX: number): number => {
      const rect = svg.getBoundingClientRect();
      if (rect.width <= 0) return 0.5;
      const svgX = ((clientX - rect.left) / rect.width) * width;
      const usableW = width - padding.left - padding.right;
      return Math.max(0, Math.min(1, (svgX - padding.left) / usableW));
    };

    const getTouchMetrics = (touches: TouchList) => {
      const t0 = touches[0];
      const t1 = touches[1];
      const dist = Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY);
      const midClientX = (t0.clientX + t1.clientX) / 2;
      return { dist, midRatio: getPlotRatioFromClientX(midClientX) };
    };

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        e.preventDefault();
        const { dist, midRatio } = getTouchMetrics(e.touches);
        const [curMin, curMax] = currentWeekRangeRef.current;
        pinchStateRef.current = {
          initialDistance: Math.max(10, dist),
          initialMidRatio: midRatio,
          initialMinWeek: curMin,
          initialMaxWeek: curMax,
        };
        suppressScrubUntilLiftRef.current = true;
        setScrubberState(null);
        setHoveredPoint(null);
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        e.preventDefault();
        if (!pinchStateRef.current) {
          const { dist, midRatio } = getTouchMetrics(e.touches);
          const [curMin, curMax] = currentWeekRangeRef.current;
          pinchStateRef.current = {
            initialDistance: Math.max(10, dist),
            initialMidRatio: midRatio,
            initialMinWeek: curMin,
            initialMaxWeek: curMax,
          };
          suppressScrubUntilLiftRef.current = true;
          setScrubberState(null);
          setHoveredPoint(null);
          return;
        }
        const { dist, midRatio } = getTouchMetrics(e.touches);
        const { initialDistance, initialMidRatio, initialMinWeek, initialMaxWeek } =
          pinchStateRef.current;
        const scale = Math.max(0.15, Math.min(8, dist / initialDistance));
        const initialSpan = Math.max(MIN_PINCH_SPAN_WEEKS, initialMaxWeek - initialMinWeek);
        const fullSpan = domainMaxWeek - domainMinWeek;
        const newSpan = Math.max(
          MIN_PINCH_SPAN_WEEKS,
          Math.min(fullSpan, initialSpan / scale)
        );
        const anchorWeek = initialMinWeek + initialMidRatio * initialSpan;
        const newMin = anchorWeek - midRatio * newSpan;
        const newMax = newMin + newSpan;
        setCustomWeekRange(clampWeekRange(newMin, newMax));
      }
    };

    const onTouchEnd = (e: TouchEvent) => {
      if (e.touches.length < 2) {
        pinchStateRef.current = null;
      }
      if (e.touches.length === 0) {
        suppressScrubUntilLiftRef.current = false;
      }
    };

    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const [curMin, curMax] = currentWeekRangeRef.current;
      const curSpan = Math.max(MIN_PINCH_SPAN_WEEKS, curMax - curMin);
      const ratio = getPlotRatioFromClientX(e.clientX);
      const zoomFactor = Math.exp(e.deltaY * 0.006);
      const fullSpan = domainMaxWeek - domainMinWeek;
      const newSpan = Math.max(
        MIN_PINCH_SPAN_WEEKS,
        Math.min(fullSpan, curSpan * zoomFactor)
      );
      const anchorWeek = curMin + ratio * curSpan;
      const newMin = anchorWeek - ratio * newSpan;
      setCustomWeekRange(clampWeekRange(newMin, newMin + newSpan));
    };

    svg.addEventListener('touchstart', onTouchStart, { passive: false });
    svg.addEventListener('touchmove', onTouchMove, { passive: false });
    svg.addEventListener('touchend', onTouchEnd);
    svg.addEventListener('touchcancel', onTouchEnd);
    svg.addEventListener('wheel', onWheel, { passive: false });

    return () => {
      svg.removeEventListener('touchstart', onTouchStart);
      svg.removeEventListener('touchmove', onTouchMove);
      svg.removeEventListener('touchend', onTouchEnd);
      svg.removeEventListener('touchcancel', onTouchEnd);
      svg.removeEventListener('wheel', onWheel);
    };
  }, [clampWeekRange, padding.left, padding.right, width]);

  // Smooth interpolated reference curve across [minWeek, maxWeek]
  const refCurve = useMemo<FetalBiometricRef[]>(() => {
    const sampleWeeks = new Set<number>([minWeek, maxWeek]);
    FETAL_BIOMETRIC_STANDARDS.forEach((pt) => {
      if (pt.week > minWeek && pt.week < maxWeek) {
        sampleWeeks.add(pt.week);
      }
    });
    const minSteps = 28;
    if (sampleWeeks.size < minSteps) {
      for (let i = 1; i < minSteps; i++) {
        sampleWeeks.add(minWeek + (weekSpan * i) / minSteps);
      }
    }
    return Array.from(sampleWeeks)
      .sort((a, b) => a - b)
      .map((w) => getFetalBiometricRef(w));
  }, [minWeek, maxWeek, weekSpan]);

  // Compute exact, aligned Y-axis scale in active display units (g/oz or mm/in)
  const yScale = useMemo(() => {
    const visibleDisplayValues: number[] = [];
    refCurve.forEach((s) => {
      visibleDisplayValues.push(
        currentCfg.toDisplayY(s[currentCfg.keyP5]),
        currentCfg.toDisplayY(s[currentCfg.keyP95])
      );
    });

    enrichedMeasurements.forEach((m) => {
      if (m.totalWeeks < minWeek - 1e-6 || m.totalWeeks > maxWeek + 1e-6) return;
      const val = currentCfg.getMeasurementVal(m);
      if (val && val > 0) visibleDisplayValues.push(currentCfg.toDisplayY(val));
    });

    if (visibleDisplayValues.length === 0) {
      return computeNiceAxisScale(0, 100, { targetTicks: 6, clampMinZero: true });
    }

    const rawMin = Math.min(...visibleDisplayValues);
    const rawMax = Math.max(...visibleDisplayValues);
    const minSpan =
      selectedMetric === 'efw'
        ? unitSystem === 'imperial'
          ? 2
          : 20
        : unitSystem === 'imperial'
        ? 0.5
        : 5;

    return computeNiceAxisScale(rawMin, rawMax, {
      targetTicks: 6,
      paddingRatio: 0.08,
      clampMinZero: true,
      minSpan,
    });
  }, [refCurve, currentCfg, enrichedMeasurements, minWeek, maxWeek, selectedMetric, unitSystem]);

  const scaleX = useCallback(
    (week: number) => {
      const usableW = width - padding.left - padding.right;
      return padding.left + ((week - minWeek) / weekSpan) * usableW;
    },
    [minWeek, weekSpan, width, padding.left, padding.right]
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
    (metricVal: number) => scaleYDisplay(currentCfg.toDisplayY(metricVal)),
    [scaleYDisplay, currentCfg]
  );

  // Valid measurements with exact X and Y pixel coordinates inside [minWeek, maxWeek]
  const validMeasurements = useMemo(() => {
    return enrichedMeasurements
      .map((m) => ({
        measurement: m,
        val: currentCfg.getMeasurementVal(m),
      }))
      .filter(
        (
          item
        ): item is {
          measurement: (typeof enrichedMeasurements)[number];
          val: number;
        } =>
          item.val !== undefined &&
          item.val > 0 &&
          item.measurement.totalWeeks >= minWeek - 1e-6 &&
          item.measurement.totalWeeks <= maxWeek + 1e-6
      )
      .sort((a, b) => a.measurement.totalWeeks - b.measurement.totalWeeks)
      .map(({ measurement: m, val }) => {
        const ref = getFetalBiometricRef(m.totalWeeks);
        return {
          ...m,
          val,
          x: scaleX(m.totalWeeks),
          y: scaleY(val),
          ref5: ref[currentCfg.keyP5],
          ref50: ref[currentCfg.keyP50],
          ref95: ref[currentCfg.keyP95],
        };
      });
  }, [enrichedMeasurements, currentCfg, minWeek, maxWeek, scaleX, scaleY]);

  const updateScrubberBySvgX = (svgX: number) => {
    const usableW = width - padding.left - padding.right;
    if (svgX < padding.left || svgX > width - padding.right) {
      setScrubberState(null);
      return;
    }
    const ratio = (svgX - padding.left) / usableW;
    const rawWeek = minWeek + ratio * weekSpan;
    // Snap to exact gestational days (1/7 week) when zoomed in
    const snapStep = weekSpan <= 10 ? 1 / 7 : weekSpan <= 20 ? 0.5 : 1;
    const scrubbedWeek = Math.max(
      minWeek,
      Math.min(maxWeek, Number((Math.round(rawWeek / snapStep) * snapStep).toFixed(4)))
    );
    const ref = getFetalBiometricRef(scrubbedWeek);
    if (!ref) return;

    const tolerance = Math.max(0.25, weekSpan * 0.04);
    let nearest: (typeof validMeasurements)[number] | undefined;
    let bestDist = Infinity;
    for (const m of validMeasurements) {
      const dist = Math.abs(m.totalWeeks - scrubbedWeek);
      if (dist <= tolerance && dist < bestDist) {
        bestDist = dist;
        nearest = m;
      }
    }

    setScrubberState({
      week: scrubbedWeek,
      svgX: scaleX(scrubbedWeek),
      ref5: ref[currentCfg.keyP5],
      ref50: ref[currentCfg.keyP50],
      ref95: ref[currentCfg.keyP95],
      nearestMeasurement: nearest
        ? {
            id: nearest.id,
            weekLabel: nearest.weekLabel,
            val: nearest.val,
            date: nearest.date,
            notes: nearest.notes,
            x: nearest.x,
            y: nearest.y,
          }
        : undefined,
    });
  };

  const handleSvgMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const svg = e.currentTarget;
    const rect = svg.getBoundingClientRect();
    if (rect.width <= 0) return;
    const clientX = e.clientX - rect.left;
    const svgX = (clientX / rect.width) * width;
    updateScrubberBySvgX(svgX);
  };

  const handleSvgTouchMove = (e: React.TouchEvent<SVGSVGElement>) => {
    if (e.touches.length !== 1 || pinchStateRef.current || suppressScrubUntilLiftRef.current) {
      return;
    }
    const touch = e.touches[0];
    const svg = e.currentTarget;
    const rect = svg.getBoundingClientRect();
    if (rect.width <= 0) return;
    const clientX = touch.clientX - rect.left;
    const svgX = (clientX / rect.width) * width;
    updateScrubberBySvgX(svgX);
  };

  // Build SVG paths with sub-pixel precision
  const makeRefPath = (
    key:
      | 'efwP5'
      | 'efwP50'
      | 'efwP95'
      | 'bpdP5'
      | 'bpdP50'
      | 'bpdP95'
      | 'hcP5'
      | 'hcP50'
      | 'hcP95'
      | 'acP5'
      | 'acP50'
      | 'acP95'
      | 'flP5'
      | 'flP50'
      | 'flP95'
  ) => {
    return refCurve
      .map((pt, i) => {
        const x = scaleX(pt.week);
        const y = scaleY(pt[key]);
        return `${i === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`;
      })
      .join(' ');
  };

  const makeAreaBand = () => {
    if (refCurve.length === 0) return '';
    const topPts = refCurve.map(
      (pt) => `${scaleX(pt.week).toFixed(2)},${scaleY(pt[currentCfg.keyP95]).toFixed(2)}`
    );
    const bottomPts = [...refCurve]
      .reverse()
      .map(
        (pt) => `${scaleX(pt.week).toFixed(2)},${scaleY(pt[currentCfg.keyP5]).toFixed(2)}`
      );
    return `M ${topPts.join(' L ')} L ${bottomPts.join(' L ')} Z`;
  };

  const userPath = useMemo(() => {
    if (validMeasurements.length < 2) return '';
    return validMeasurements
      .map((m, i) => `${i === 0 ? 'M' : 'L'} ${m.x.toFixed(2)} ${m.y.toFixed(2)}`)
      .join(' ');
  }, [validMeasurements]);

  const latest = validMeasurements[validMeasurements.length - 1];

  const weekTickSpec = useMemo(
    () => buildNiceTicksWithStep(minWeek, maxWeek, [0.5, 1, 2, 4], 8),
    [minWeek, maxWeek]
  );

  return (
    <div className="bg-white dark:bg-stone-900 rounded-2xl md:rounded-3xl border border-stone-200 dark:border-stone-800 p-4 md:p-6 shadow-xs transition-colors">
      {/* Header & Metric Picker */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-4 border-b border-stone-100 dark:border-stone-800">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-bold text-stone-900 dark:text-white">
              Ultrasound Biometrics & Fetal Growth
            </h3>
            <span className="text-xs text-stone-500 dark:text-stone-400">
              {formatCompactNumber(minWeek, 1)}–{formatCompactNumber(maxWeek, 1)}w
              {customWeekRange ? ' · Pinched' : zoomMode === 'auto' ? ' · Auto' : ''}
            </span>
            <span className="text-xs text-amber-900 dark:text-amber-300 font-semibold bg-amber-100 dark:bg-amber-950/80 px-2 py-0.5 rounded-lg border border-amber-200/60 dark:border-amber-800/60">
              Formula: {formulaSettings.fetalEfwFormula.toUpperCase()}
            </span>
          </div>
          <p className="text-xs text-stone-500 dark:text-stone-400 mt-1">
            Reference bands (5th–95th percentile) for fetal anatomical dimensions across gestational weeks.
          </p>
        </div>

        {/* Metric & Zoom Segmented Controls */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex flex-wrap p-1 bg-stone-100 dark:bg-stone-800 rounded-xl border border-stone-200/60 dark:border-stone-700/60">
            <button
              onClick={() => setSelectedMetric('efw')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${
                selectedMetric === 'efw'
                  ? 'bg-white dark:bg-stone-900 text-stone-900 dark:text-white shadow-2xs font-bold'
                  : 'text-stone-600 dark:text-stone-400 hover:text-stone-900 dark:hover:text-white'
              }`}
            >
              Weight (EFW)
            </button>
            <button
              onClick={() => setSelectedMetric('bpd')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${
                selectedMetric === 'bpd'
                  ? 'bg-white dark:bg-stone-900 text-stone-900 dark:text-white shadow-2xs font-bold'
                  : 'text-stone-600 dark:text-stone-400 hover:text-stone-900 dark:hover:text-white'
              }`}
            >
              BPD (Head)
            </button>
            <button
              onClick={() => setSelectedMetric('hc')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${
                selectedMetric === 'hc'
                  ? 'bg-white dark:bg-stone-900 text-stone-900 dark:text-white shadow-2xs font-bold'
                  : 'text-stone-600 dark:text-stone-400 hover:text-stone-900 dark:hover:text-white'
              }`}
            >
              HC (Circumference)
            </button>
            <button
              onClick={() => setSelectedMetric('ac')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${
                selectedMetric === 'ac'
                  ? 'bg-white dark:bg-stone-900 text-stone-900 dark:text-white shadow-2xs font-bold'
                  : 'text-stone-600 dark:text-stone-400 hover:text-stone-900 dark:hover:text-white'
              }`}
            >
              AC (Abdomen)
            </button>
            <button
              onClick={() => setSelectedMetric('fl')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${
                selectedMetric === 'fl'
                  ? 'bg-white dark:bg-stone-900 text-stone-900 dark:text-white shadow-2xs font-bold'
                  : 'text-stone-600 dark:text-stone-400 hover:text-stone-900 dark:hover:text-white'
              }`}
            >
              FL (Femur)
            </button>
          </div>

          <div className="inline-flex p-1 bg-stone-100 dark:bg-stone-800 rounded-xl border border-stone-200/60 dark:border-stone-700/60">
            <button
              onClick={() => {
                setZoomMode('auto');
                setCustomWeekRange(null);
              }}
              title="Auto-zoom to 200% of current available data time range"
              className={`px-2.5 py-1.5 text-xs font-semibold rounded-lg transition-colors ${
                !customWeekRange && zoomMode === 'auto'
                  ? 'bg-white dark:bg-stone-900 text-stone-900 dark:text-white shadow-2xs font-bold'
                  : 'text-stone-600 dark:text-stone-400 hover:text-stone-900 dark:hover:text-white'
              }`}
            >
              Auto
            </button>
            <button
              onClick={() => {
                setZoomMode('full');
                setCustomWeekRange(null);
              }}
              className={`px-2.5 py-1.5 text-xs font-semibold rounded-lg transition-colors ${
                !customWeekRange && zoomMode === 'full'
                  ? 'bg-white dark:bg-stone-900 text-stone-900 dark:text-white shadow-2xs font-bold'
                  : 'text-stone-600 dark:text-stone-400 hover:text-stone-900 dark:hover:text-white'
              }`}
            >
              Full
            </button>
          </div>

          {customWeekRange && (
            <button
              type="button"
              onClick={() => setCustomWeekRange(null)}
              className="px-2.5 py-1.5 rounded-xl border border-amber-200 dark:border-amber-800/70 bg-amber-50 dark:bg-amber-950/50 text-xs font-semibold text-amber-900 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/50 transition-colors cursor-pointer"
            >
              Reset Zoom
            </button>
          )}

          {onOpenFormulaModal && (
            <button
              type="button"
              onClick={onOpenFormulaModal}
              title="View / change clinical formula and mathematical sources"
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
          hoveredPoint || scrubberState
            ? 'bg-amber-50/90 dark:bg-amber-950/40 border-amber-300 dark:border-amber-800 text-stone-800 dark:text-stone-200'
            : 'bg-stone-50 dark:bg-stone-800/60 border-stone-200/60 dark:border-stone-700/60 text-stone-700 dark:text-stone-300'
        }`}
      >
        {hoveredPoint ? (
          <>
            {/* Row 1: Selected scan + Latest reset */}
            <div className="h-[18px] flex items-center justify-between gap-2 min-w-0 leading-none">
              <span className="font-bold text-amber-950 dark:text-amber-200 truncate">
                Scan: <strong>{hoveredPoint.weekLabel}</strong>
              </span>
              {latest && (
                <button
                  type="button"
                  onClick={() => {
                    setScrubberState(null);
                    setHoveredPoint(null);
                  }}
                  className="text-[10px] font-semibold text-amber-900 dark:text-amber-300 hover:underline cursor-pointer whitespace-nowrap shrink-0"
                >
                  Latest
                </button>
              )}
            </div>

            {/* Row 2: Logged value + Date */}
            <div className="h-[18px] flex items-center justify-between gap-2 min-w-0 leading-none">
              <span className="inline-flex items-center px-1.5 py-0.5 rounded-md bg-amber-700 text-white font-bold text-[10px] font-mono tabular-nums whitespace-nowrap truncate">
                Logged: {currentCfg.formatVal(hoveredPoint.value)}
              </span>
              <span className="text-[10px] font-mono tabular-nums text-stone-500 dark:text-stone-400 shrink-0 whitespace-nowrap">
                {hoveredPoint.date}
              </span>
            </div>

            {/* Row 3: Median & Band */}
            <div className="h-[18px] flex items-center gap-2 min-w-0 text-[11px] leading-none font-mono tabular-nums">
              <span className="shrink-0">
                <span className="font-sans text-stone-600 dark:text-stone-400">Median: </span>
                <strong className="text-stone-900 dark:text-white">{currentCfg.formatVal(hoveredPoint.ref50)}</strong>
              </span>
              <span aria-hidden="true" className="text-stone-300 dark:text-stone-600 shrink-0">|</span>
              <span className="text-stone-600 dark:text-stone-400 truncate">
                <span className="font-sans">Band: </span>
                {currentCfg.formatVal(hoveredPoint.ref5)}–{currentCfg.formatVal(hoveredPoint.ref95)}
              </span>
            </div>
          </>
        ) : scrubberState ? (
          <>
            {/* Row 1: Inspecting week + Latest reset */}
            <div className="h-[18px] flex items-center justify-between gap-2 min-w-0 leading-none">
              <span className="font-bold text-amber-950 dark:text-amber-200 truncate">
                Inspecting: <strong>{formatGestationalWeeksLabel(scrubberState.week)}</strong>
              </span>
              {latest && (
                <button
                  type="button"
                  onClick={() => {
                    setScrubberState(null);
                    setHoveredPoint(null);
                  }}
                  className="text-[10px] font-semibold text-amber-900 dark:text-amber-300 hover:underline cursor-pointer whitespace-nowrap shrink-0"
                >
                  Latest
                </button>
              )}
            </div>

            {/* Row 2: Logged scan */}
            <div className="h-[18px] flex items-center justify-between gap-2 min-w-0 leading-none">
              {scrubberState.nearestMeasurement ? (
                <>
                  <span className="inline-flex items-center px-1.5 py-0.5 rounded-md bg-amber-700 text-white font-bold text-[10px] font-mono tabular-nums whitespace-nowrap truncate">
                    Logged: {currentCfg.formatVal(scrubberState.nearestMeasurement.val)}
                  </span>
                  <span className="text-[10px] font-mono tabular-nums text-stone-500 dark:text-stone-400 shrink-0 whitespace-nowrap">
                    {scrubberState.nearestMeasurement.date}
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
                <strong className="text-stone-900 dark:text-white">{currentCfg.formatVal(scrubberState.ref50)}</strong>
              </span>
              <span aria-hidden="true" className="text-stone-300 dark:text-stone-600 shrink-0">|</span>
              <span className="text-stone-600 dark:text-stone-400 truncate">
                <span className="font-sans">Band: </span>
                {currentCfg.formatVal(scrubberState.ref5)}–{currentCfg.formatVal(scrubberState.ref95)}
              </span>
            </div>
          </>
        ) : latest ? (
          <>
            {/* Row 1: Latest Scan value */}
            <div className="h-[18px] flex items-center justify-between gap-2 min-w-0 leading-none">
              <div className="flex items-center gap-1.5 min-w-0 truncate">
                <span className="font-bold text-stone-900 dark:text-white shrink-0">Latest Scan:</span>
                <span className="font-mono tabular-nums font-bold text-amber-900 dark:text-amber-400 shrink-0">
                  {currentCfg.formatVal(latest.val)}
                </span>
              </div>
              <span className="hidden sm:inline text-[10px] text-stone-400 dark:text-stone-500 shrink-0 whitespace-nowrap">
                Pinch to zoom · Drag or tap to inspect
              </span>
            </div>

            {/* Row 2: Gestational Age & Median */}
            <div className="h-[18px] flex items-center justify-between gap-2 min-w-0 leading-none text-[11px]">
              <span className="truncate">
                Age: <strong className="text-stone-900 dark:text-white">{latest.weekLabel}</strong>
              </span>
              <span className="text-stone-600 dark:text-stone-400 font-mono tabular-nums shrink-0 whitespace-nowrap">
                <span className="font-sans">Median: </span>
                <strong className="text-stone-800 dark:text-stone-200">{currentCfg.formatVal(latest.ref50)}</strong>
              </span>
            </div>

            {/* Row 3: Date */}
            <div className="h-[18px] flex items-center gap-2 min-w-0 text-[11px] leading-none font-mono tabular-nums text-stone-500 dark:text-stone-400">
              <span className="truncate">Date: {latest.date}</span>
            </div>
          </>
        ) : (
          <>
            <div className="h-[18px] flex items-center font-bold text-stone-800 dark:text-stone-200 leading-none truncate">
              Hadlock Fetal Biometrics Reference
            </div>
            <div className="h-[18px] flex items-center text-[11px] text-stone-500 dark:text-stone-400 leading-none truncate">
              No ultrasound scans logged yet
            </div>
            <div className="h-[18px] flex items-center text-[11px] text-stone-500 dark:text-stone-400 leading-none truncate">
              Pinch to zoom · Drag or touch along the chart to inspect median and band values
            </div>
          </>
        )}
      </div>

      {/* SVG Canvas */}
      <div className="relative mt-4 w-full overflow-hidden select-none">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${width} ${height}`}
          className="w-full h-auto cursor-crosshair touch-pan-y"
          style={{ maxHeight: '420px' }}
          onMouseMove={handleSvgMouseMove}
          onMouseLeave={() => {
            setHoveredPoint(null);
          }}
          onTouchStart={(e) => {
            if (e.touches.length !== 1) return;
            setHoveredPoint(null);
            handleSvgTouchMove(e);
          }}
          onTouchMove={(e) => {
            if (e.touches.length !== 1) return;
            setHoveredPoint(null);
            handleSvgTouchMove(e);
          }}
        >
          <defs>
            <linearGradient id="fetalBandGrad" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor={isDark ? '#78350f' : '#fef3c7'} stopOpacity={isDark ? '0.45' : '0.8'} />
              <stop offset="100%" stopColor={isDark ? '#78350f' : '#fef3c7'} stopOpacity={isDark ? '0.18' : '0.3'} />
            </linearGradient>
            <clipPath id="fetalPlotAreaClip">
              <rect
                x={padding.left}
                y={padding.top}
                width={width - padding.left - padding.right}
                height={height - padding.top - padding.bottom}
              />
            </clipPath>
          </defs>

          {/* Exact Y-axis Grid lines & Ticks (1:1 aligned in display unit) */}
          {yScale.ticks.map((tickVal, i) => {
            const y = scaleYDisplay(tickVal);
            return (
              <g key={`y-${i}`}>
                <line
                  x1={padding.left}
                  y1={y}
                  x2={width - padding.right}
                  y2={y}
                  stroke={isDark ? '#292524' : '#f0f0ef'}
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
                  {tickVal.toFixed(yScale.decimals)} {currentCfg.unit}
                </text>
              </g>
            );
          })}

          {/* Exact X-axis Grid lines & Ticks */}
          {weekTickSpec.ticks.map((wk) => {
            const x = scaleX(wk);
            return (
              <g key={`wk-${wk}`}>
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
                  {formatCompactNumber(wk, weekTickSpec.decimals)}w
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

          {/* Reference Band (5th to 95th Percentile) */}
          <g clipPath="url(#fetalPlotAreaClip)">
            <path d={makeAreaBand()} fill="url(#fetalBandGrad)" />

            <path
              d={makeRefPath(currentCfg.keyP95)}
              fill="none"
              stroke={isDark ? '#d97706' : '#f59e0b'}
              strokeWidth="1"
              strokeDasharray="2 3"
            />
            <path
              d={makeRefPath(currentCfg.keyP50)}
              fill="none"
              stroke={isDark ? '#f59e0b' : '#d97706'}
              strokeWidth="2"
            />
            <path
              d={makeRefPath(currentCfg.keyP5)}
              fill="none"
              stroke={isDark ? '#d97706' : '#f59e0b'}
              strokeWidth="1"
              strokeDasharray="2 3"
            />
          </g>

          {refCurve.length > 0 && (
            <>
              <text
                x={width - padding.right + 4}
                y={scaleY(refCurve[refCurve.length - 1][currentCfg.keyP95]) + 3}
                className="text-[9px] fill-amber-700 dark:fill-amber-400 font-sans font-medium"
              >
                95th
              </text>
              <text
                x={width - padding.right + 4}
                y={scaleY(refCurve[refCurve.length - 1][currentCfg.keyP50]) + 3}
                className="text-[9px] fill-amber-900 dark:fill-amber-300 font-sans font-semibold"
              >
                50th
              </text>
              <text
                x={width - padding.right + 4}
                y={scaleY(refCurve[refCurve.length - 1][currentCfg.keyP5]) + 3}
                className="text-[9px] fill-amber-700 dark:fill-amber-400 font-sans font-medium"
              >
                5th
              </text>
            </>
          )}

          {/* User Logged Line */}
          {userPath && (
            <path
              d={userPath}
              fill="none"
              stroke={isDark ? '#fbbf24' : '#b45309'}
              strokeWidth="2.5"
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
                stroke={isDark ? '#fbbf24' : '#b45309'}
                strokeWidth="1"
                strokeDasharray="3 3"
                opacity="0.7"
              />
              <line
                x1={hoveredPoint.x}
                y1={hoveredPoint.y}
                x2={hoveredPoint.x}
                y2={height - padding.bottom}
                stroke={isDark ? '#fbbf24' : '#b45309'}
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
                    weekLabel: m.weekLabel,
                    value: m.val,
                    date: m.date,
                    notes: m.notes,
                    x: m.x,
                    y: m.y,
                    ref5: m.ref5,
                    ref50: m.ref50,
                    ref95: m.ref95,
                  })
                }
                onMouseLeave={() => setHoveredPoint(null)}
                onClick={() =>
                  setHoveredPoint({
                    id: m.id,
                    weekLabel: m.weekLabel,
                    value: m.val,
                    date: m.date,
                    notes: m.notes,
                    x: m.x,
                    y: m.y,
                    ref5: m.ref5,
                    ref50: m.ref50,
                    ref95: m.ref95,
                  })
                }
              >
                <circle
                  cx={m.x}
                  cy={m.y}
                  r={isHovered ? 9 : 6}
                  fill={isDark ? '#fbbf24' : '#b45309'}
                  opacity={isHovered ? 0.28 : 0.18}
                />
                <circle
                  cx={m.x}
                  cy={m.y}
                  r={isHovered ? 5.5 : 4}
                  fill={isDark ? '#fbbf24' : '#b45309'}
                  stroke={isDark ? '#1c1917' : '#ffffff'}
                  strokeWidth="2"
                />
              </g>
            );
          })}

          {/* Real-time Vertical Guideline when scrubbing */}
          {scrubberState && !hoveredPoint && (
            <g className="pointer-events-none">
              <line
                x1={scrubberState.svgX}
                y1={padding.top}
                x2={scrubberState.svgX}
                y2={height - padding.bottom}
                stroke={isDark ? '#fbbf24' : '#d97706'}
                strokeWidth="1.5"
                strokeDasharray="4 3"
              />
            </g>
          )}

          {/* Axis label */}
          <text
            x={(padding.left + width - padding.right) / 2}
            y={height - 10}
            textAnchor="middle"
            className="text-[11px] fill-stone-500 dark:fill-stone-400 font-sans font-medium"
          >
            Gestational Age (Weeks)
          </text>
        </svg>
      </div>

      {/* Footer */}
      <div className="mt-4 pt-3.5 border-t border-stone-100 dark:border-stone-800 flex flex-wrap items-center justify-between text-xs text-stone-500 dark:text-stone-400 gap-y-2">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-0.5 bg-amber-600 dark:bg-amber-400 rounded-full"></span>
            <span className="w-2 h-2 rounded-full bg-amber-600 dark:bg-amber-400 border border-white dark:border-stone-900"></span>
            <span className="text-stone-700 dark:text-stone-200 font-semibold">{profile.name} Ultrasounds</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-0.5 bg-amber-600 dark:bg-amber-400 rounded-full"></span>
            <span className="text-stone-600 dark:text-stone-300">Hadlock 50th %</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-2 bg-amber-100 dark:bg-amber-950/80 rounded-xs border border-amber-200/60 dark:border-amber-800/60"></span>
            <span className="text-stone-600 dark:text-stone-300">5th – 95th % Normal Range</span>
          </div>
        </div>

        <div className="flex items-center gap-1 text-[11px] text-stone-400 dark:text-stone-500">
          <Info className="w-3.5 h-3.5" />
          <span>Hadlock ultrasound regression curves</span>
        </div>
      </div>
    </div>
  );
};
