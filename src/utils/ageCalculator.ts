import { formatCompactNumber } from './chartZoom';

export const DAYS_PER_WEEK = 7;
export const DAYS_PER_MONTH = 30.4375; // 365.25 / 12 (WHO clinical average month)
export const DAYS_PER_YEAR = 365.25;
export const WEEKS_PER_MONTH = DAYS_PER_MONTH / DAYS_PER_WEEK; // 4.3482142857...

export type AgeAxisUnit = 'days' | 'weeks' | 'months' | 'years';
export type AgeAxisScaleMode = 'auto' | AgeAxisUnit;

export interface ExactAge {
  totalDays: number;
  rawDays: number;
  exactWeeks: number;
  exactMonths: number;
  exactYears: number;
  calendarYears: number;
  calendarMonths: number;
  calendarDays: number;
  wholeWeeks: number;
  remainingWeekDays: number;
}

/**
 * Parses a calendar date string (YYYY-MM-DD or ISO timestamp) into a timezone-independent
 * UTC midnight timestamp so day differences never drift across timezones or DST boundaries.
 */
export function parseCalendarDateUTC(dateStr?: string | null): number | null {
  if (!dateStr) return null;
  const trimmed = dateStr.trim();
  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})/.exec(trimmed);
  if (isoMatch) {
    const year = Number(isoMatch[1]);
    const month = Number(isoMatch[2]);
    const day = Number(isoMatch[3]);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return Date.UTC(year, month - 1, day);
    }
  }
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return null;
  return Date.UTC(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
}

/**
 * Returns today's local calendar date as YYYY-MM-DD.
 */
export function getLocalTodayDateStr(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Computes calendar-accurate age (years, months, days) and exact continuous age
 * (days, weeks, months, years) between birthDateStr and recordDateStr.
 */
export function computeExactAgeFromBirth(
  birthDateStr?: string | null,
  recordDateStr?: string | null
): ExactAge | null {
  const birthUtc = parseCalendarDateUTC(birthDateStr);
  const recordUtc = parseCalendarDateUTC(recordDateStr ?? getLocalTodayDateStr());
  if (birthUtc === null || recordUtc === null) return null;

  const rawDays = Math.round((recordUtc - birthUtc) / 86_400_000);
  const totalDays = Math.max(0, rawDays);

  const birthDate = new Date(birthUtc);
  const recDate = new Date(Math.max(birthUtc, recordUtc));

  let years = recDate.getUTCFullYear() - birthDate.getUTCFullYear();
  let months = recDate.getUTCMonth() - birthDate.getUTCMonth();
  let days = recDate.getUTCDate() - birthDate.getUTCDate();

  if (days < 0) {
    // Days in the month immediately preceding recDate's month
    const prevMonthLastDay = new Date(
      Date.UTC(recDate.getUTCFullYear(), recDate.getUTCMonth(), 0)
    ).getUTCDate();
    days += prevMonthLastDay;
    months -= 1;
  }
  if (months < 0) {
    months += 12;
    years -= 1;
  }
  if (years < 0) {
    years = 0;
    months = 0;
    days = 0;
  }

  return {
    totalDays,
    rawDays,
    exactWeeks: totalDays / DAYS_PER_WEEK,
    exactMonths: totalDays / DAYS_PER_MONTH,
    exactYears: totalDays / DAYS_PER_YEAR,
    calendarYears: years,
    calendarMonths: months,
    calendarDays: days,
    wholeWeeks: Math.floor(totalDays / DAYS_PER_WEEK),
    remainingWeekDays: totalDays % DAYS_PER_WEEK,
  };
}

/**
 * Converts a continuous age in days to the target axis unit.
 */
export function daysToAgeUnit(days: number, unit: AgeAxisUnit): number {
  switch (unit) {
    case 'days':
      return days;
    case 'weeks':
      return days / DAYS_PER_WEEK;
    case 'months':
      return days / DAYS_PER_MONTH;
    case 'years':
      return days / DAYS_PER_YEAR;
  }
}

/**
 * Converts a value in the given age unit back to exact days.
 */
export function ageUnitToDays(value: number, unit: AgeAxisUnit): number {
  switch (unit) {
    case 'days':
      return value;
    case 'weeks':
      return value * DAYS_PER_WEEK;
    case 'months':
      return value * DAYS_PER_MONTH;
    case 'years':
      return value * DAYS_PER_YEAR;
  }
}

/**
 * Automatically selects the most readable age axis unit (days / weeks / months / years)
 * based on the visible time range and maximum age of retrieved data.
 */
export function selectAutoAgeUnit(maxDays: number, spanDays?: number): AgeAxisUnit {
  const safeMax = Math.max(0, maxDays);
  const safeSpan = spanDays !== undefined ? Math.max(0, spanDays) : safeMax;

  if (safeMax <= 35 || (safeSpan <= 24 && safeMax <= 56)) {
    return 'days';
  }
  if (safeMax <= 140 || (safeSpan <= 84 && safeMax <= 210)) {
    return 'weeks';
  }
  if (safeMax <= DAYS_PER_YEAR * 2) {
    return 'months';
  }
  return 'years';
}

/**
 * Formats an X-axis tick value in the given unit with exact non-misleading precision.
 */
export function formatAgeAxisTick(valueInUnit: number, unit: AgeAxisUnit, decimals = 1): string {
  const numStr = formatCompactNumber(valueInUnit, decimals);
  switch (unit) {
    case 'days':
      return `${numStr}d`;
    case 'weeks':
      return `${numStr}w`;
    case 'months':
      return `${numStr}m`;
    case 'years':
      return `${numStr}y`;
  }
}

export function getAgeAxisLabel(unit: AgeAxisUnit): string {
  switch (unit) {
    case 'days':
      return 'Age (Days)';
    case 'weeks':
      return 'Age (Weeks)';
    case 'months':
      return 'Age (Months)';
    case 'years':
      return 'Age (Years)';
  }
}

/**
 * Formats an age from exact days automatically into days, weeks, months, or years.
 * When `birthDateStr` and `recordDateStr` are provided, uses exact calendar year/month/day breakdown.
 */
export function formatAdaptiveAgeFromDays(
  totalDays: number,
  options?: {
    birthDateStr?: string | null;
    recordDateStr?: string | null;
    forcedUnit?: AgeAxisUnit;
    compact?: boolean;
  }
): string {
  const safeDays = Math.max(0, totalDays);
  const compact = options?.compact ?? false;
  const forcedUnit = options?.forcedUnit;

  if (forcedUnit === 'days') {
    const d = formatCompactNumber(safeDays, Number.isInteger(safeDays) ? 0 : 1);
    return compact ? `${d}d` : `${d} ${Number(d) === 1 ? 'day' : 'days'}`;
  }
  if (forcedUnit === 'weeks') {
    const w = formatCompactNumber(safeDays / DAYS_PER_WEEK, 1);
    return compact ? `${w}w` : `Week ${w}`;
  }
  if (forcedUnit === 'months') {
    const m = formatCompactNumber(safeDays / DAYS_PER_MONTH, 2);
    return compact ? `${m}m` : `${m} mo`;
  }
  if (forcedUnit === 'years') {
    const y = formatCompactNumber(safeDays / DAYS_PER_YEAR, 2);
    return compact ? `${y}y` : `${y} yr`;
  }

  // Adaptive auto-unit selection based on magnitude of age
  const exactCal =
    options?.birthDateStr && options?.recordDateStr
      ? computeExactAgeFromBirth(options.birthDateStr, options.recordDateStr)
      : null;

  if (safeDays < 0.5) {
    return compact ? '0d' : 'Day 0 (Birth)';
  }

  // Under 4 weeks (1 – 27 days) -> Days
  if (safeDays < 28) {
    const d = Number.isInteger(safeDays) ? String(safeDays) : formatCompactNumber(safeDays, 1);
    return compact ? `${d}d` : `${d} ${Number(d) === 1 ? 'day' : 'days'}`;
  }

  // 4 weeks to ~16 weeks (28 – 111 days) -> Weeks + Days
  if (safeDays < 112) {
    const wholeWeeks = Math.floor(safeDays / DAYS_PER_WEEK);
    const remDays = Math.round(safeDays - wholeWeeks * DAYS_PER_WEEK);
    if (remDays === 7) {
      return compact ? `${wholeWeeks + 1}w` : `${wholeWeeks + 1} wks`;
    }
    if (remDays === 0) {
      return compact ? `${wholeWeeks}w` : `${wholeWeeks} wks`;
    }
    return compact ? `${wholeWeeks}w ${remDays}d` : `${wholeWeeks}w ${remDays}d`;
  }

  // ~4 months to < 2 years -> Months (+ days when exact calendar dates known)
  if (safeDays < DAYS_PER_YEAR * 2) {
    if (exactCal) {
      const totalCalMonths = exactCal.calendarYears * 12 + exactCal.calendarMonths;
      if (exactCal.calendarDays === 0) {
        return compact ? `${totalCalMonths}m` : `${totalCalMonths} mo`;
      }
      return compact
        ? `${totalCalMonths}m ${exactCal.calendarDays}d`
        : `${totalCalMonths}m ${exactCal.calendarDays}d`;
    }
    const mo = formatCompactNumber(safeDays / DAYS_PER_MONTH, 1);
    return compact ? `${mo}m` : `${mo} mo`;
  }

  // 2+ years -> Years + Months
  if (exactCal) {
    if (exactCal.calendarMonths === 0) {
      return compact
        ? `${exactCal.calendarYears}y`
        : `${exactCal.calendarYears} ${exactCal.calendarYears === 1 ? 'yr' : 'yrs'}`;
    }
    return compact
      ? `${exactCal.calendarYears}y ${exactCal.calendarMonths}m`
      : `${exactCal.calendarYears}y ${exactCal.calendarMonths}m`;
  }
  const yr = formatCompactNumber(safeDays / DAYS_PER_YEAR, 2);
  return compact ? `${yr}y` : `${yr} yrs`;
}

/**
 * Convenience wrapper to compute and format adaptive age directly from birthday and record date.
 */
export function formatAgeFromBirthDate(
  birthDateStr?: string | null,
  recordDateStr?: string | null,
  compact = false
): string | null {
  const exact = computeExactAgeFromBirth(birthDateStr, recordDateStr);
  if (!exact) return null;
  return formatAdaptiveAgeFromDays(exact.totalDays, {
    birthDateStr,
    recordDateStr,
    compact,
  });
}
