export interface AutoZoomOptions {
  domainMin: number;
  domainMax: number;
  minSpan: number;
  emptyRange: [number, number];
  /**
   * When only a single timestamp exists (dataSpan === 0):
   * - If true (e.g., baby age anchored at birth 0), scales to [domainMin, point * 2] so the point sits centered at 50%.
   * - If false (e.g., gestational weeks), centers a window of width `singlePointFallbackSpan` around the point.
   */
  singlePointAnchorAtOrigin?: boolean;
  singlePointFallbackSpan?: number;
}

export interface NiceAxisScale {
  min: number;
  max: number;
  step: number;
  decimals: number;
  ticks: number[];
}

/**
 * Computes an auto-zoomed [min, max] axis range equal to 200% of the time range
 * of the currently available data, clamped cleanly within [domainMin, domainMax].
 */
export function computeAutoZoomRange(
  rawValues: number[],
  options: AutoZoomOptions
): [number, number] {
  const {
    domainMin,
    domainMax,
    minSpan,
    emptyRange,
    singlePointAnchorAtOrigin = false,
    singlePointFallbackSpan = minSpan,
  } = options;

  const values = rawValues
    .filter((v) => Number.isFinite(v))
    .map((v) => Math.max(domainMin, Math.min(domainMax, v)));

  if (values.length === 0) {
    return emptyRange;
  }

  const minVal = Math.min(...values);
  const maxVal = Math.max(...values);
  const dataSpan = maxVal - minVal;
  const maxPossibleSpan = domainMax - domainMin;

  if (dataSpan <= 1e-6) {
    if (singlePointAnchorAtOrigin) {
      const spanFromOrigin = maxVal - domainMin;
      if (spanFromOrigin > 1e-6) {
        const targetMax = Math.min(
          domainMax,
          domainMin + Math.max(minSpan, spanFromOrigin * 2)
        );
        return [domainMin, targetMax];
      }
      return [
        domainMin,
        Math.min(domainMax, domainMin + Math.max(minSpan, singlePointFallbackSpan)),
      ];
    }

    const span = Math.min(maxPossibleSpan, Math.max(minSpan, singlePointFallbackSpan));
    let start = minVal - span / 2;
    let end = minVal + span / 2;
    if (start < domainMin) {
      start = domainMin;
      end = Math.min(domainMax, domainMin + span);
    }
    if (end > domainMax) {
      end = domainMax;
      start = Math.max(domainMin, domainMax - span);
    }
    return [start, end];
  }

  // 200% of the available data's time range
  const targetSpan = Math.min(maxPossibleSpan, Math.max(minSpan, dataSpan * 2));
  const pad = (targetSpan - dataSpan) / 2;

  let start = minVal - pad;
  let end = maxVal + pad;

  if (start < domainMin) {
    start = domainMin;
    end = Math.min(domainMax, domainMin + targetSpan);
  }
  if (end > domainMax) {
    end = domainMax;
    start = Math.max(domainMin, domainMax - targetSpan);
  }

  // Ensure every available point stays within the visible bounds
  start = Math.min(start, minVal);
  end = Math.max(end, maxVal);

  return [start, end];
}

/**
 * Counts the exact decimal places needed to display a tick step without rounding error.
 */
export function getStepDecimals(step: number): number {
  if (!Number.isFinite(step) || step <= 0) return 0;
  const normalized = Number(step.toPrecision(6)).toString();
  if (normalized.includes('e-')) {
    const exp = Number(normalized.split('e-')[1]);
    return Number.isFinite(exp) ? Math.min(4, exp) : 2;
  }
  const dotIdx = normalized.indexOf('.');
  return dotIdx === -1 ? 0 : Math.min(4, normalized.length - dotIdx - 1);
}

/**
 * Computes exact, aligned axis bounds [min, max] and round tick marks using the 1-2-2.5-5
 * step sequence so every gridline matches its printed tick label with zero rounding drift.
 */
export function computeNiceAxisScale(
  rawMin: number,
  rawMax: number,
  options?: {
    targetTicks?: number;
    paddingRatio?: number;
    clampMinZero?: boolean;
    minSpan?: number;
  }
): NiceAxisScale {
  const targetTicks = Math.max(3, options?.targetTicks ?? 6);
  const paddingRatio = options?.paddingRatio ?? 0.08;
  const clampMinZero = options?.clampMinZero ?? true;
  const minSpan = options?.minSpan ?? 0.2;

  if (!Number.isFinite(rawMin) || !Number.isFinite(rawMax)) {
    return { min: 0, max: 10, step: 2, decimals: 0, ticks: [0, 2, 4, 6, 8, 10] };
  }

  let lo = Math.min(rawMin, rawMax);
  let hi = Math.max(rawMin, rawMax);
  const rawSpan = Math.max(minSpan, hi - lo);
  const pad = rawSpan * paddingRatio;

  lo = lo - pad;
  hi = hi + pad;
  if (clampMinZero && lo < 0) {
    lo = 0;
  }
  if (hi - lo < minSpan) {
    hi = lo + minSpan;
  }

  const roughStep = (hi - lo) / (targetTicks - 1);
  const magnitude = Math.pow(10, Math.floor(Math.log10(roughStep)));
  const niceMultipliers = [1, 2, 2.5, 5, 10];

  let step = niceMultipliers[niceMultipliers.length - 1] * magnitude;
  for (const mult of niceMultipliers) {
    const candidate = mult * magnitude;
    const minCandidate = Math.floor((lo + 1e-9) / candidate) * candidate;
    const clampedMin = clampMinZero ? Math.max(0, minCandidate) : minCandidate;
    const maxCandidate = Math.ceil((hi - 1e-9) / candidate) * candidate;
    const tickCount = Math.round((maxCandidate - clampedMin) / candidate) + 1;
    if (tickCount <= targetTicks + 1) {
      step = candidate;
      break;
    }
  }

  const axisMinRaw = Math.floor((lo + 1e-9) / step) * step;
  const axisMin = Number((clampMinZero ? Math.max(0, axisMinRaw) : axisMinRaw).toFixed(6));
  const axisMax = Number((Math.ceil((hi - 1e-9) / step) * step).toFixed(6));
  const safeMax = axisMax > axisMin ? axisMax : Number((axisMin + step).toFixed(6));
  const decimals = getStepDecimals(step);

  const ticks: number[] = [];
  const maxIterations = 25;
  for (let i = 0; i <= maxIterations; i++) {
    const val = Number((axisMin + i * step).toFixed(6));
    if (val > safeMax + step * 1e-4) break;
    ticks.push(val);
  }

  return {
    min: ticks[0] ?? axisMin,
    max: ticks[ticks.length - 1] ?? safeMax,
    step,
    decimals,
    ticks,
  };
}

/**
 * Generates clean, evenly spaced axis ticks strictly inside [min, max] along with the chosen step.
 */
export function buildNiceTicksWithStep(
  min: number,
  max: number,
  candidateSteps: number[],
  maxTicks = 8
): { ticks: number[]; step: number; decimals: number } {
  const span = max - min;
  if (span <= 0) {
    return { ticks: [Number(min.toFixed(4))], step: 1, decimals: 0 };
  }

  const chosenStep =
    candidateSteps.find((step) => span / step <= maxTicks) ??
    candidateSteps[candidateSteps.length - 1];

  const firstTick = Math.ceil((min - 1e-9) / chosenStep) * chosenStep;
  const ticks: number[] = [];

  for (let val = firstTick; val <= max + 1e-9; val += chosenStep) {
    const clean = Number(val.toFixed(6));
    if (clean >= min - 1e-6 && clean <= max + 1e-6) {
      ticks.push(clean);
    }
  }

  if (ticks.length < 2) {
    return {
      ticks: [Number(min.toFixed(2)), Number(max.toFixed(2))],
      step: chosenStep,
      decimals: 2,
    };
  }

  return {
    ticks,
    step: chosenStep,
    decimals: getStepDecimals(chosenStep),
  };
}

/**
 * Generates clean, evenly spaced axis ticks strictly inside [min, max].
 */
export function buildNiceTicks(
  min: number,
  max: number,
  candidateSteps: number[],
  maxTicks = 8
): number[] {
  return buildNiceTicksWithStep(min, max, candidateSteps, maxTicks).ticks;
}

export function formatCompactNumber(val: number, maxDecimals = 1): string {
  const fixed = val.toFixed(maxDecimals);
  return fixed.replace(/\.0+$/, '').replace(/(\.\d*[1-9])0+$/, '$1');
}
