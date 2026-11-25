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
 * Generates clean, evenly spaced axis ticks strictly inside [min, max].
 */
export function buildNiceTicks(
  min: number,
  max: number,
  candidateSteps: number[],
  maxTicks = 8
): number[] {
  const span = max - min;
  if (span <= 0) return [min];

  const chosenStep =
    candidateSteps.find((step) => span / step <= maxTicks) ??
    candidateSteps[candidateSteps.length - 1];

  const firstTick = Math.ceil((min - 1e-9) / chosenStep) * chosenStep;
  const ticks: number[] = [];

  for (let val = firstTick; val <= max + 1e-9; val += chosenStep) {
    const clean = Number(val.toFixed(4));
    if (clean >= min - 1e-6 && clean <= max + 1e-6) {
      ticks.push(clean);
    }
  }

  if (ticks.length < 2) {
    return [Number(min.toFixed(2)), Number(max.toFixed(2))];
  }

  return ticks;
}

export function formatCompactNumber(val: number, maxDecimals = 1): string {
  const fixed = val.toFixed(maxDecimals);
  return fixed.replace(/\.0+$/, '').replace(/(\.\d*[1-9])0+$/, '$1');
}
