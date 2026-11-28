import { calculatePercentile, UnitConverter } from '../data/growthStandards';
import { getProfileNumericId } from '../lib/entriesStorage';
import {
  computeExactAgeFromBirth,
  DAYS_PER_MONTH,
  DAYS_PER_WEEK,
  parseCalendarDateUTC,
} from './ageCalculator';
import type { BabyMeasurement, ChildProfile, GrowthRecord, NoteRecord, RoutineRecord } from '../types';

export function doesRecordMatchProfile(
  record: { profile_id?: string | number | null; name?: string | null } | null | undefined,
  profile: ChildProfile | undefined
): boolean {
  if (!profile) return true;
  if (!record) return false;

  const recordProfileId =
    record.profile_id !== null && record.profile_id !== undefined
      ? String(record.profile_id).trim()
      : '';
  if (recordProfileId) {
    const profileIdTrimmed = profile.id.trim();
    if (recordProfileId === profileIdTrimmed) return true;
    const numericProfileId = String(getProfileNumericId(profileIdTrimmed));
    if (recordProfileId === numericProfileId) return true;
    if (profileIdTrimmed === `profile-${recordProfileId}`) return true;
    const strippedRecord = recordProfileId.replace(/^profile-/i, '');
    const strippedProfile = profileIdTrimmed.replace(/^profile-/i, '');
    if (strippedRecord && strippedRecord === strippedProfile) return true;
    return false;
  }

  // Fallback for legacy rows created before profile_id was added
  const legacyName = (record.name ?? '').trim().toLowerCase();
  if (!legacyName) return false;
  const fullName = profile.name.trim().toLowerCase();
  const firstName = fullName.split(/\s+/)[0];
  return legacyName === fullName || (firstName.length > 0 && legacyName === firstName);
}

export function doesNoteMatchProfile(
  note: Pick<NoteRecord, 'profile_id'> | null | undefined,
  profile: ChildProfile | undefined
): boolean {
  if (!profile) return true;
  if (!note) return false;
  if (note.profile_id === null || note.profile_id === undefined) return true;
  return Number(note.profile_id) === getProfileNumericId(profile.id);
}

export function getGrowthRecordDate(record: GrowthRecord): string {
  if (record.date && /^\d{4}-\d{2}-\d{2}/.test(record.date)) {
    return record.date.slice(0, 10);
  }
  return record.created_at.slice(0, 10);
}

export function mergeProfileGrowthMeasurements(
  profile: ChildProfile | undefined,
  babyMeasurements: BabyMeasurement[],
  growthRecords: GrowthRecord[]
): BabyMeasurement[] {
  if (!profile || profile.type !== 'baby') return babyMeasurements;

  // Recalculate exact age from birthday for all retrieved baby measurements when date is valid
  const merged: BabyMeasurement[] = babyMeasurements.map((m) => {
    const exact = computeExactAgeFromBirth(profile.dateOfEvent, m.date);
    if (!exact) {
      return {
        ...m,
        ageInDays: m.ageInDays ?? m.ageInMonths * DAYS_PER_MONTH,
      };
    }
    return {
      ...m,
      ageInDays: exact.totalDays,
      ageInMonths: exact.exactMonths,
      ageInWeeks: exact.exactWeeks,
    };
  });

  const matchingGrowth = growthRecords
    .filter((g) => {
      if (g.daily_weight === null && g.daily_length === null) return false;
      return doesRecordMatchProfile(g, profile);
    })
    .sort((a, b) => {
      const aKey = `${getGrowthRecordDate(a)}T${a.time ?? a.created_at.slice(11, 19)}`;
      const bKey = `${getGrowthRecordDate(b)}T${b.time ?? b.created_at.slice(11, 19)}`;
      return aKey.localeCompare(bKey);
    });

  for (const g of matchingGrowth) {
    const dateStr = getGrowthRecordDate(g);
    const alreadyExists = merged.some(
      (m) =>
        m.date === dateStr &&
        (g.daily_weight === null || m.weightKg === g.daily_weight) &&
        (g.daily_length === null || m.lengthCm === g.daily_length)
    );
    if (alreadyExists) continue;

    const exact = computeExactAgeFromBirth(profile.dateOfEvent, dateStr);
    const totalDays = exact ? exact.totalDays : 0;

    merged.push({
      id: `supabase-growth-${g.id}`,
      profileId: profile.id,
      date: dateStr,
      ageInDays: totalDays,
      ageInMonths: totalDays / DAYS_PER_MONTH,
      ageInWeeks: totalDays / DAYS_PER_WEEK,
      weightKg: g.daily_weight ?? undefined,
      lengthCm: g.daily_length ?? undefined,
      notes: g.remark ?? undefined,
    });
  }

  // If no length data exists in checkups or daily growth logs, include the profile's birth length
  const hasAnyLength = merged.some(
    (m) => typeof m.lengthCm === 'number' && Number.isFinite(m.lengthCm) && m.lengthCm > 0
  );
  if (
    !hasAnyLength &&
    typeof profile.birthLengthCm === 'number' &&
    Number.isFinite(profile.birthLengthCm) &&
    profile.birthLengthCm > 0
  ) {
    const birthDateStr = profile.dateOfEvent?.slice(0, 10) || '';
    const existingBirthIdx = merged.findIndex(
      (m) => (m.ageInDays ?? m.ageInMonths * DAYS_PER_MONTH) === 0 || (birthDateStr && m.date === birthDateStr)
    );
    if (existingBirthIdx >= 0) {
      merged[existingBirthIdx] = {
        ...merged[existingBirthIdx],
        lengthCm: profile.birthLengthCm,
      };
    } else if (birthDateStr) {
      merged.push({
        id: `profile-birth-length-${profile.id}`,
        profileId: profile.id,
        date: birthDateStr,
        ageInDays: 0,
        ageInMonths: 0,
        ageInWeeks: 0,
        lengthCm: profile.birthLengthCm,
        notes: 'Birth length (from profile)',
      });
    }
  }

  return merged.sort((a, b) => {
    const aDays = a.ageInDays ?? a.ageInMonths * DAYS_PER_MONTH;
    const bDays = b.ageInDays ?? b.ageInMonths * DAYS_PER_MONTH;
    if (aDays !== bDays) return aDays - bDays;
    return a.date.localeCompare(b.date);
  });
}

export type TempSeverity = 'low' | 'normal' | 'elevated' | 'fever';

export interface TempClassification {
  severity: TempSeverity;
  label: string;
  guidance: string;
  fahrenheit: number;
}

export function classifyTemperature(tempC: number): TempClassification {
  const f = Math.round(((tempC * 9) / 5 + 32) * 10) / 10;

  if (tempC < 36.0) {
    return {
      severity: 'low',
      label: 'Low Temp',
      guidance: 'Below normal infant range (36.0–37.4°C). Re-check temperature and ensure warm layering.',
      fahrenheit: f,
    };
  }
  if (tempC <= 37.4) {
    return {
      severity: 'normal',
      label: 'Normal',
      guidance: 'Within healthy infant baseline temperature range (36.0–37.4°C).',
      fahrenheit: f,
    };
  }
  if (tempC < 38.0) {
    return {
      severity: 'elevated',
      label: 'Mildly Elevated',
      guidance: 'Borderline elevation (37.5–37.9°C). Re-check in 30–60 minutes and keep baby comfortably hydrated.',
      fahrenheit: f,
    };
  }
  return {
    severity: 'fever',
    label: 'Fever',
    guidance: 'Temperature ≥ 38.0°C (100.4°F). Contact your pediatrician promptly, especially for infants under 3 months.',
    fahrenheit: f,
  };
}

export interface GrowthInterpretation {
  totalRecords: number;
  latestWeightKg: number | null;
  latestWeightDate: string | null;
  weightDeltaGrams: number | null;
  weightVelocityGramsPerDay: number | null;
  weightPercentile: number | null;
  latestLengthCm: number | null;
  latestLengthDate: string | null;
  lengthDeltaCm: number | null;
  lengthPercentile: number | null;
  lengthIsFromBirth: boolean;
  latestTempC: number | null;
  latestTempDate: string | null;
  tempClass: TempClassification | null;
  minTempC: number | null;
  maxTempC: number | null;
  feverEpisodes: number;
  insights: string[];
}

function getProfileAgeMonths(profile: ChildProfile | undefined, referenceIso?: string): number | null {
  if (!profile || profile.type !== 'baby') return null;
  const exact = computeExactAgeFromBirth(profile.dateOfEvent, referenceIso);
  return exact ? exact.exactMonths : null;
}

export function interpretGrowthTable(
  records: GrowthRecord[],
  profile?: ChildProfile
): GrowthInterpretation {
  // Sort chronological ascending by recorded date & time (falling back to created_at)
  const sorted = [...records].sort((a, b) => {
    const aKey = `${getGrowthRecordDate(a)}T${a.time ?? a.created_at.slice(11, 19)}`;
    const bKey = `${getGrowthRecordDate(b)}T${b.time ?? b.created_at.slice(11, 19)}`;
    return aKey.localeCompare(bKey);
  });

  const weightRows = sorted.filter((r) => r.daily_weight !== null && r.daily_weight > 0);
  const lengthRows = sorted.filter((r) => r.daily_length !== null && r.daily_length > 0);
  const tempRows = sorted.filter((r) => r.temperature !== null && r.temperature > 0);

  const latestWeightRow = weightRows[weightRows.length - 1];
  const prevWeightRow = weightRows.length >= 2 ? weightRows[weightRows.length - 2] : undefined;

  const latestWeightKg = latestWeightRow?.daily_weight ?? null;
  const latestWeightDate = latestWeightRow ? getGrowthRecordDate(latestWeightRow) : null;
  let weightDeltaGrams: number | null = null;
  let weightVelocityGramsPerDay: number | null = null;

  if (latestWeightRow && prevWeightRow && latestWeightRow.daily_weight !== null && prevWeightRow.daily_weight !== null) {
    weightDeltaGrams = Math.round((latestWeightRow.daily_weight - prevWeightRow.daily_weight) * 1000);
    const latestMs = new Date(`${getGrowthRecordDate(latestWeightRow)}T12:00:00`).getTime();
    const prevMs = new Date(`${getGrowthRecordDate(prevWeightRow)}T12:00:00`).getTime();
    const daysBetween = (latestMs - prevMs) / (1000 * 60 * 60 * 24);
    if (daysBetween >= 0.5) {
      weightVelocityGramsPerDay = Math.round(weightDeltaGrams / daysBetween);
    }
  }

  const ageMonthsForWeight = latestWeightRow
    ? getProfileAgeMonths(profile, `${getGrowthRecordDate(latestWeightRow)}T12:00:00`)
    : null;
  const weightPercentile =
    latestWeightKg !== null && ageMonthsForWeight !== null && profile?.type === 'baby'
      ? calculatePercentile(latestWeightKg, ageMonthsForWeight, 'weight', profile.gender).percentile
      : null;

  const latestLengthRow = lengthRows[lengthRows.length - 1];
  const prevLengthRow = lengthRows.length >= 2 ? lengthRows[lengthRows.length - 2] : undefined;
  const profileBirthLength =
    profile?.type === 'baby' &&
    typeof profile.birthLengthCm === 'number' &&
    Number.isFinite(profile.birthLengthCm) &&
    profile.birthLengthCm > 0
      ? profile.birthLengthCm
      : null;

  const lengthIsFromBirth = !latestLengthRow && profileBirthLength !== null;
  const latestLengthCm = latestLengthRow?.daily_length ?? profileBirthLength ?? null;
  const latestLengthDate = latestLengthRow
    ? getGrowthRecordDate(latestLengthRow)
    : lengthIsFromBirth && profile?.dateOfEvent
      ? profile.dateOfEvent.slice(0, 10)
      : null;
  const lengthDeltaCm =
    latestLengthRow && prevLengthRow && latestLengthRow.daily_length !== null && prevLengthRow.daily_length !== null
      ? Math.round((latestLengthRow.daily_length - prevLengthRow.daily_length) * 10) / 10
      : latestLengthRow && latestLengthRow.daily_length !== null && profileBirthLength !== null
        ? Math.round((latestLengthRow.daily_length - profileBirthLength) * 10) / 10
        : null;

  const ageMonthsForLength = latestLengthRow
    ? getProfileAgeMonths(profile, `${getGrowthRecordDate(latestLengthRow)}T12:00:00`)
    : lengthIsFromBirth
      ? 0
      : null;
  const lengthPercentile =
    latestLengthCm !== null && ageMonthsForLength !== null && profile?.type === 'baby'
      ? calculatePercentile(latestLengthCm, ageMonthsForLength, 'length', profile.gender).percentile
      : null;

  const latestTempRow = tempRows[tempRows.length - 1];
  const latestTempC = latestTempRow?.temperature ?? null;
  const latestTempDate = latestTempRow ? getGrowthRecordDate(latestTempRow) : null;
  const tempClass = latestTempC !== null ? classifyTemperature(latestTempC) : null;

  const tempValues = tempRows.map((r) => r.temperature as number);
  const minTempC = tempValues.length > 0 ? Math.min(...tempValues) : null;
  const maxTempC = tempValues.length > 0 ? Math.max(...tempValues) : null;
  const feverEpisodes = tempValues.filter((t) => t >= 38.0).length;

  const insights: string[] = [];

  if (latestWeightKg !== null) {
    const pctText = weightPercentile !== null ? ` (~${weightPercentile}th WHO percentile)` : '';
    if (weightDeltaGrams !== null) {
      const sign = weightDeltaGrams >= 0 ? '+' : '';
      const velText =
        weightVelocityGramsPerDay !== null
          ? ` (${weightVelocityGramsPerDay >= 0 ? '+' : ''}${weightVelocityGramsPerDay} g/day)`
          : '';
      insights.push(
        `Latest daily weight is ${UnitConverter.formatKgValue(latestWeightKg)} kg${pctText}, changing ${sign}${weightDeltaGrams} g since the prior entry${velText}.`
      );
    } else {
      insights.push(`Latest daily weight is ${UnitConverter.formatKgValue(latestWeightKg)} kg${pctText}.`);
    }
  }

  if (latestLengthCm !== null) {
    const pctText = lengthPercentile !== null ? ` (~${lengthPercentile}th WHO percentile)` : '';
    if (lengthIsFromBirth) {
      insights.push(
        `Birth length is ${latestLengthCm.toFixed(1)} cm${pctText} (used until a newer length measurement is logged).`
      );
    } else {
      const deltaText =
        lengthDeltaCm !== null
          ? ` (${lengthDeltaCm >= 0 ? '+' : ''}${lengthDeltaCm} cm from previous)`
          : '';
      insights.push(`Latest recorded length is ${latestLengthCm.toFixed(1)} cm${pctText}${deltaText}.`);
    }
  }

  if (latestTempC !== null && tempClass) {
    insights.push(
      `Latest temperature is ${latestTempC.toFixed(1)}°C (${tempClass.fahrenheit}°F) — ${tempClass.label}. ${tempClass.guidance}`
    );
  }

  if (insights.length === 0) {
    insights.push(
      profile?.type === 'fetal'
        ? 'Log ultrasound scans or daily maternal/fetal check-ins to generate fetal growth trend interpretations.'
        : 'Log daily weight, length, or temperature entries to generate trend and WHO percentile interpretations.'
    );
  }

  return {
    totalRecords: records.length,
    latestWeightKg,
    latestWeightDate,
    weightDeltaGrams,
    weightVelocityGramsPerDay,
    weightPercentile,
    latestLengthCm,
    latestLengthDate,
    lengthDeltaCm,
    lengthPercentile,
    lengthIsFromBirth,
    latestTempC,
    latestTempDate,
    tempClass,
    minTempC,
    maxTempC,
    feverEpisodes,
    insights,
  };
}

export interface DailyFeedEntry {
  sortKey: string;
  time: string;
  ebmMl: number;
  formulaMl: number;
  totalMl: number;
}

export interface DailyRoutineBucket {
  date: string;
  ebmMl: number;
  formulaMl: number;
  totalMl: number;
  feedCount: number;
  feedEntries: DailyFeedEntry[];
  totalDurationMin: number;
  avgDurationMin: number | null;
  wetDiapers: number;
  dirtyDiapers: number;
  mixedDiapers: number;
  totalDiapers: number;
}

export interface MilkFormulaConfig {
  minMlPerKg: number;
  maxMlPerKg: number;
  feedsPerDay: number;
  targetRangePct: number;
}

export const DEFAULT_MILK_FORMULA: MilkFormulaConfig = {
  minMlPerKg: 150,
  maxMlPerKg: 200,
  feedsPerDay: 6,
  targetRangePct: 80,
};

export const MIN_MILK_TARGET_AGE_DAYS = 6;

export function getAgeDaysOnDate(
  dateStr: string,
  birthDate?: string | null
): number | null {
  if (!birthDate) return null;
  const dateUtc = parseCalendarDateUTC(dateStr);
  const birthUtc = parseCalendarDateUTC(birthDate);
  if (dateUtc === null || birthUtc === null) return null;
  return Math.round((dateUtc - birthUtc) / 86_400_000);
}

export function isMilkTargetEligibleOnDate(
  dateStr: string,
  birthDate?: string | null
): boolean {
  const ageDays = getAgeDaysOnDate(dateStr, birthDate);
  if (ageDays === null) return true;
  return ageDays >= MIN_MILK_TARGET_AGE_DAYS;
}

export interface RoutineInterpretation {
  activeDateLabel: string;
  isToday: boolean;
  todayBucket: DailyRoutineBucket;
  sevenDayAvgMl: number | null;
  ebmSharePct: number;
  formulaSharePct: number;
  avgMlPerFeed: number | null;
  milkTargetEligible: boolean;
  focusAgeDays: number | null;
  minRateMlPerKg: number;
  maxRateMlPerKg: number;
  effectiveTargetMlPerKg: number | null;
  estimatedTargetMl: number | null;
  targetMinMl: number | null;
  targetMaxMl: number | null;
  perFeedMinMl: number | null;
  perFeedMaxMl: number | null;
  recommendedFeedMl: number | null;
  targetProgressPct: number | null;
  lastFeedLabel: string | null;
  dailySeries: DailyRoutineBucket[];
  insights: string[];
}

export type RoutineChartGranularity = 'daily' | 'weekly' | 'monthly';
export type DailySpanOption = 7 | 14 | 30 | 'all';
export type WeeklySpanOption = 4 | 8 | 12 | 'all';
export type MonthlySpanOption = 3 | 6 | 12 | 'all';

export interface BoxPlotStats {
  count: number;
  min: number;
  q1: number;
  median: number;
  q3: number;
  max: number;
  mean: number;
  total: number;
}

export interface RoutinePeriodBoxPlotBucket {
  key: string;
  label: string;
  rangeLabel: string;
  daysWithFeeds: number;
  daysWithDiapers: number;
  milkStats: BoxPlotStats | null;
  diaperStats: BoxPlotStats | null;
  ebmTotalMl: number;
  formulaTotalMl: number;
  avgFeedsPerDay: number | null;
  wetTotal: number;
  mixedTotal: number;
  dirtyTotal: number;
  avgWetPerDay: number | null;
}

export function getRoutineRecordDate(record: RoutineRecord): string {
  if (record.date && /^\d{4}-\d{2}-\d{2}/.test(record.date)) {
    return record.date.slice(0, 10);
  }
  return record.created_at.slice(0, 10);
}

export const STOOL_TYPE_OPTIONS = [
  { code: 'M', label: 'M - Meconium' },
  { code: 'G', label: 'G - Greenish' },
  { code: 'GY', label: 'GY - Greenish Yellow' },
  { code: 'Y', label: 'Y - Yellow' },
] as const;

export const FEEDING_METHOD_OPTIONS = [
  { value: 'bottle', label: 'Bottle' },
  { value: 'latch', label: 'Latch' },
  { value: 'cup', label: 'Cup' },
  { value: 'stringe', label: 'Stringe' },
] as const;

export type FeedingMethodValue = (typeof FEEDING_METHOD_OPTIONS)[number]['value'];

export function normalizeFeedingMethod(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  const trimmed = raw.trim();
  if (!trimmed) return '';
  const lower = trimmed.toLowerCase();
  if (lower === 'bottle' || lower.includes('bottle')) return 'bottle';
  if (
    lower === 'latch' ||
    lower.includes('latch') ||
    lower === 'breast' ||
    lower === 'breastfeed' ||
    lower === 'breastfeeding' ||
    lower === 'nursing' ||
    lower === 'direct'
  ) {
    return 'latch';
  }
  if (lower === 'cup' || lower.includes('cup')) return 'cup';
  if (lower === 'stringe' || lower === 'syringe' || lower.includes('stringe') || lower.includes('syringe')) {
    return 'stringe';
  }
  return trimmed;
}

export function formatFeedingMethodLabel(raw: string | null | undefined): string {
  if (!raw || !raw.trim()) return '';
  const normalized = normalizeFeedingMethod(raw);
  const found = FEEDING_METHOD_OPTIONS.find((opt) => opt.value === normalized);
  if (found) return found.label;
  return raw.trim();
}

function parsePositiveMetric(value: number | string | null | undefined): number {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value > 0 ? value : 0;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return 0;
    const n = Number(trimmed);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }
  return 0;
}

/**
 * Auto-detect default feeding method from feeding inputs:
 * - EBM (mL) or Formula (mL) detected -> "bottle"
 * - Only Feed Duration (min) detected -> "latch"
 * - Otherwise -> ""
 */
export function detectDefaultFeedingMethod(params: {
  ebmMl?: number | string | null;
  formulaMl?: number | string | null;
  feedDurationMin?: number | string | null;
}): FeedingMethodValue | '' {
  const hasEbm = parsePositiveMetric(params.ebmMl) > 0;
  const hasFormula = parsePositiveMetric(params.formulaMl) > 0;
  const hasDuration = parsePositiveMetric(params.feedDurationMin) > 0;

  if (hasEbm || hasFormula) return 'bottle';
  if (hasDuration) return 'latch';
  return '';
}

export function normalizeRoutineTimeHHMM(raw: string | null | undefined): string {
  if (!raw) return '';
  const trimmed = raw.trim();
  const match = trimmed.match(/^(\d{1,2}):(\d{2})/);
  if (!match) return '';
  const hh = Number(match[1]);
  const mm = Number(match[2]);
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return '';
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

export const DEFAULT_DIAPER_LOAD = 'x1';

export type StoolTypeCode = (typeof STOOL_TYPE_OPTIONS)[number]['code'];

export interface ParsedStoolValue {
  type: StoolTypeCode | '';
  custom: string;
}

export function parseStoolValue(raw: string | null | undefined): ParsedStoolValue {
  if (!raw || !raw.trim()) {
    return { type: '', custom: '' };
  }
  const trimmed = raw.trim();
  const lower = trimmed.toLowerCase();

  let type: StoolTypeCode | '' = '';
  if (
    /\bgy\b/i.test(trimmed) ||
    lower.includes('greenish yellow') ||
    lower.includes('green-yellow') ||
    lower.includes('green yellow')
  ) {
    type = 'GY';
  } else if (/\bm\b/i.test(trimmed) || lower.includes('meconium')) {
    type = 'M';
  } else if (/\bg\b/i.test(trimmed) || lower.includes('greenish') || /\bgreen\b/i.test(lower)) {
    type = 'G';
  } else if (/\by\b/i.test(trimmed) || lower.includes('yellow')) {
    type = 'Y';
  }

  if (type) {
    return { type, custom: '' };
  }

  const strippedCount = trimmed.replace(/\b(?:\d+\s*x|x\s*\d+)\b/gi, '').trim();
  return { type: '', custom: strippedCount || trimmed };
}

export function normalizeStoolValue(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  const trimmed = raw.trim();
  if (!trimmed) return '';
  const parsed = parseStoolValue(trimmed);
  return parsed.type || parsed.custom;
}

export function parseDiaperLoadCount(raw: unknown, fallback = 1): number {
  if (typeof raw === 'number' && Number.isFinite(raw) && raw >= 1) {
    return Math.round(raw);
  }
  if (typeof raw !== 'string') return fallback;
  const trimmed = raw.trim();
  if (!trimmed) return fallback;
  const match = trimmed.match(/(?:^|\b)(?:x\s*(\d+)|(\d+)\s*x|(\d+))(?:\b|$)/i);
  if (!match) return fallback;
  const parsed = Number(match[1] || match[2] || match[3]);
  return Number.isFinite(parsed) && parsed >= 1 ? Math.round(parsed) : fallback;
}

export function formatDiaperLoad(count: number): string {
  const safe = Number.isFinite(count) && count >= 1 ? Math.round(count) : 1;
  return `x${safe}`;
}

export function getDiaperLoadBadgeClass(raw: unknown): string {
  const count = parseDiaperLoadCount(raw, 1);
  if (count <= 1) {
    return 'text-emerald-700 dark:text-emerald-300 [text-shadow:0_0_10px_rgba(16,185,129,0.55)] dark:[text-shadow:0_0_12px_rgba(52,211,153,0.75)]';
  }
  if (count === 2) {
    return 'text-sky-700 dark:text-sky-300 [text-shadow:0_0_10px_rgba(14,165,233,0.6)] dark:[text-shadow:0_0_12px_rgba(56,189,248,0.8)]';
  }
  if (count === 3) {
    return 'text-amber-700 dark:text-amber-300 [text-shadow:0_0_10px_rgba(245,158,11,0.65)] dark:[text-shadow:0_0_12px_rgba(251,191,36,0.85)]';
  }
  if (count === 4) {
    return 'text-orange-700 dark:text-orange-300 [text-shadow:0_0_10px_rgba(249,115,22,0.65)] dark:[text-shadow:0_0_12px_rgba(251,146,60,0.85)]';
  }
  return 'text-rose-700 dark:text-rose-300 [text-shadow:0_0_10px_rgba(244,63,94,0.65)] dark:[text-shadow:0_0_12px_rgba(251,113,133,0.85)]';
}

export function getFeedingMethodBadgeClass(raw: string | null | undefined): string {
  const normalized = normalizeFeedingMethod(raw);
  switch (normalized) {
    case 'bottle':
      return 'text-sky-700 dark:text-sky-300 [text-shadow:0_0_10px_rgba(14,165,233,0.6)] dark:[text-shadow:0_0_12px_rgba(56,189,248,0.8)]';
    case 'latch':
      return 'text-rose-700 dark:text-rose-300 [text-shadow:0_0_10px_rgba(244,63,94,0.6)] dark:[text-shadow:0_0_12px_rgba(251,113,133,0.8)]';
    case 'cup':
      return 'text-violet-700 dark:text-violet-300 [text-shadow:0_0_10px_rgba(139,92,246,0.6)] dark:[text-shadow:0_0_12px_rgba(167,139,250,0.85)]';
    case 'stringe':
      return 'text-teal-700 dark:text-teal-300 [text-shadow:0_0_10px_rgba(20,184,166,0.6)] dark:[text-shadow:0_0_12px_rgba(45,212,191,0.8)]';
    default:
      return 'text-indigo-700 dark:text-indigo-300 [text-shadow:0_0_10px_rgba(99,102,241,0.6)] dark:[text-shadow:0_0_12px_rgba(129,140,248,0.8)]';
  }
}

export function getDiaperBadgeClass(diaper: string | null | undefined): string {
  const kind = classifyDiaperValue(diaper ?? null);
  switch (kind) {
    case 'wet':
      return 'text-blue-700 dark:text-blue-300 [text-shadow:0_0_10px_rgba(59,130,246,0.6)] dark:[text-shadow:0_0_12px_rgba(96,165,250,0.85)]';
    case 'dirty':
      return 'text-amber-700 dark:text-amber-300 [text-shadow:0_0_10px_rgba(245,158,11,0.65)] dark:[text-shadow:0_0_12px_rgba(251,191,36,0.85)]';
    case 'mixed':
      return 'text-purple-700 dark:text-purple-300 [text-shadow:0_0_10px_rgba(168,85,247,0.6)] dark:[text-shadow:0_0_12px_rgba(192,132,252,0.85)]';
    default:
      return 'text-stone-600 dark:text-stone-300 [text-shadow:0_0_8px_rgba(120,113,108,0.35)] dark:[text-shadow:0_0_10px_rgba(168,162,158,0.45)]';
  }
}

export function getStoolBadgeClass(raw: string | null | undefined): string {
  const parsed = parseStoolValue(raw);
  switch (parsed.type) {
    case 'M':
      return 'text-zinc-800 dark:text-zinc-200 [text-shadow:0_0_10px_rgba(63,63,70,0.55)] dark:[text-shadow:0_0_12px_rgba(212,212,216,0.65)]';
    case 'G':
      return 'text-green-700 dark:text-green-300 [text-shadow:0_0_10px_rgba(34,197,94,0.6)] dark:[text-shadow:0_0_12px_rgba(74,222,128,0.8)]';
    case 'GY':
      return 'text-lime-700 dark:text-lime-300 [text-shadow:0_0_10px_rgba(132,204,22,0.65)] dark:[text-shadow:0_0_12px_rgba(163,230,53,0.85)]';
    case 'Y':
      return 'text-yellow-700 dark:text-yellow-300 [text-shadow:0_0_10px_rgba(234,179,8,0.7)] dark:[text-shadow:0_0_12px_rgba(250,204,21,0.85)]';
    default:
      return 'text-orange-700 dark:text-orange-300 [text-shadow:0_0_10px_rgba(249,115,22,0.6)] dark:[text-shadow:0_0_12px_rgba(251,146,60,0.8)]';
  }
}

export function normalizeDiaperLoad(raw: unknown, fallback = ''): string {
  if (typeof raw === 'number' && Number.isFinite(raw) && raw >= 1) {
    return formatDiaperLoad(raw);
  }
  if (typeof raw !== 'string' || !raw.trim()) return fallback;
  const match = raw.trim().match(/(?:^|\b)(?:x\s*(\d+)|(\d+)\s*x|(\d+))(?:\b|$)/i);
  if (!match) return fallback;
  const parsed = Number(match[1] || match[2] || match[3]);
  return Number.isFinite(parsed) && parsed >= 1 ? formatDiaperLoad(parsed) : fallback;
}

export function extractDiaperLoadFromText(raw: unknown): string {
  if (typeof raw !== 'string' || !raw.trim()) return '';
  const match = raw.trim().match(/\b(?:x\s*(\d+)|(\d+)\s*x)\b/i);
  if (!match) return '';
  const parsed = Number(match[1] || match[2]);
  return Number.isFinite(parsed) && parsed >= 1 ? formatDiaperLoad(parsed) : '';
}

export function classifyDiaperValue(diaper: string | null): 'wet' | 'dirty' | 'mixed' | 'other' | null {
  if (!diaper) return null;
  const val = diaper.trim().toLowerCase();
  if (!val || val === 'none' || val === '-' || val === 'dry') return 'other';

  const hasWet = /\b(wet|pee|urine|u|w)\b/.test(val) || val.includes('wet') || val.includes('pee');
  const hasDirty =
    /\b(dirty|poop|poo|stool|bm|soiled|d|p)\b/.test(val) ||
    val.includes('poop') ||
    val.includes('dirty') ||
    val.includes('stool');
  const isMixed = val.includes('mix') || val.includes('both') || (hasWet && hasDirty);

  if (isMixed) return 'mixed';
  if (hasWet) return 'wet';
  if (hasDirty) return 'dirty';
  return 'other';
}

function emptyBucket(date: string): DailyRoutineBucket {
  return {
    date,
    ebmMl: 0,
    formulaMl: 0,
    totalMl: 0,
    feedCount: 0,
    feedEntries: [],
    totalDurationMin: 0,
    avgDurationMin: null,
    wetDiapers: 0,
    dirtyDiapers: 0,
    mixedDiapers: 0,
    totalDiapers: 0,
  };
}

function formatLocalDateYMD(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function parseLocalDateYMD(ymd: string): Date {
  const [y, m, d] = ymd.split('-').map((n) => parseInt(n, 10));
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) {
    return new Date();
  }
  return new Date(y, m - 1, d, 12, 0, 0, 0);
}

export function buildDailyRoutineBucketMap(records: RoutineRecord[]): Map<string, DailyRoutineBucket> {
  const bucketMap = new Map<string, DailyRoutineBucket>();

  for (const r of records) {
    const dateKey = getRoutineRecordDate(r);
    const bucket = bucketMap.get(dateKey) ?? emptyBucket(dateKey);

    const ebm = Math.max(0, r.emb_mL ?? 0);
    const formula = Math.max(0, r.formula_mL ?? 0);
    const duration = Math.max(0, r.feed_duration_min ?? 0);

    const feedTotal = ebm + formula;
    bucket.ebmMl += ebm;
    bucket.formulaMl += formula;
    bucket.totalMl += feedTotal;

    if (feedTotal > 0 || duration > 0) {
      bucket.feedCount += 1;
    }
    if (feedTotal > 0) {
      const normalizedTime = normalizeRoutineTimeHHMM(r.time);
      const fallbackTime = r.created_at ? r.created_at.slice(11, 16) : '';
      const timeLabel = normalizedTime || fallbackTime;
      bucket.feedEntries.push({
        sortKey: `${timeLabel || '99:99'}|${r.created_at || ''}|${String(r.id).padStart(10, '0')}`,
        time: timeLabel,
        ebmMl: ebm,
        formulaMl: formula,
        totalMl: feedTotal,
      });
    }
    if (duration > 0) {
      bucket.totalDurationMin += duration;
    }

    const diaperKind = classifyDiaperValue(r.diaper);
    const hasStool = Boolean(r.stool && r.stool.trim().length > 0);
    if (diaperKind === 'wet') {
      if (hasStool) {
        bucket.mixedDiapers += 1;
      } else {
        bucket.wetDiapers += 1;
      }
      bucket.totalDiapers += 1;
    } else if (diaperKind === 'dirty') {
      bucket.dirtyDiapers += 1;
      bucket.totalDiapers += 1;
    } else if (diaperKind === 'mixed') {
      bucket.mixedDiapers += 1;
      bucket.totalDiapers += 1;
    } else if (r.diaper && r.diaper.trim().length > 0 && r.diaper.trim().toLowerCase() !== 'dry') {
      bucket.totalDiapers += 1;
    } else if (hasStool) {
      bucket.dirtyDiapers += 1;
      bucket.totalDiapers += 1;
    }

    bucketMap.set(dateKey, bucket);
  }

  for (const bucket of bucketMap.values()) {
    bucket.feedEntries.sort((a, b) => a.sortKey.localeCompare(b.sortKey));
    bucket.avgDurationMin =
      bucket.feedCount > 0 && bucket.totalDurationMin > 0
        ? Math.round(bucket.totalDurationMin / bucket.feedCount)
        : null;
  }

  return bucketMap;
}

function interpolateQuantile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0];
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  const frac = idx - lo;
  return sorted[lo] + (sorted[hi] - sorted[lo]) * frac;
}

export function computeBoxPlotStats(values: number[]): BoxPlotStats | null {
  const valid = values.filter((v) => Number.isFinite(v));
  if (valid.length === 0) return null;
  const sorted = [...valid].sort((a, b) => a - b);
  const total = sorted.reduce((sum, v) => sum + v, 0);
  const round1 = (n: number) => Math.round(n * 10) / 10;
  return {
    count: sorted.length,
    min: round1(sorted[0]),
    q1: round1(interpolateQuantile(sorted, 0.25)),
    median: round1(interpolateQuantile(sorted, 0.5)),
    q3: round1(interpolateQuantile(sorted, 0.75)),
    max: round1(sorted[sorted.length - 1]),
    mean: round1(total / sorted.length),
    total: round1(total),
  };
}

function resolveRoutineFocusDate(bucketMap: Map<string, DailyRoutineBucket>, explicitFocus?: string): string {
  if (explicitFocus) return explicitFocus;
  const todayStr = formatLocalDateYMD(new Date());
  if (bucketMap.has(todayStr)) return todayStr;
  const allDatesDesc = Array.from(bucketMap.keys()).sort((a, b) => b.localeCompare(a));
  return allDatesDesc[0] ?? todayStr;
}

export function buildDailyRoutineSeries(
  records: RoutineRecord[],
  span: DailySpanOption = 7,
  focusDate?: string
): DailyRoutineBucket[] {
  const bucketMap = buildDailyRoutineBucketMap(records);
  const endDateStr = resolveRoutineFocusDate(bucketMap, focusDate);
  const endDate = parseLocalDateYMD(endDateStr);

  let totalDays: number;
  if (span === 'all') {
    const allDatesAsc = Array.from(bucketMap.keys()).sort((a, b) => a.localeCompare(b));
    if (allDatesAsc.length === 0) {
      totalDays = 7;
    } else {
      const startDate = parseLocalDateYMD(allDatesAsc[0]);
      const diff = Math.round((endDate.getTime() - startDate.getTime()) / 86_400_000) + 1;
      totalDays = Math.max(7, Math.min(365, diff));
    }
  } else {
    totalDays = Math.max(1, span);
  }

  const series: DailyRoutineBucket[] = [];
  for (let i = totalDays - 1; i >= 0; i--) {
    const d = new Date(endDate);
    d.setDate(d.getDate() - i);
    const key = formatLocalDateYMD(d);
    series.push(bucketMap.get(key) ?? emptyBucket(key));
  }
  return series;
}

const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const FULL_MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

function getMondayOfWeek(date: Date): Date {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12, 0, 0, 0);
  const day = d.getDay(); // 0 = Sun, 1 = Mon, ...
  const diffToMonday = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diffToMonday);
  return d;
}

export function buildWeeklyRoutineBoxPlots(
  records: RoutineRecord[],
  span: WeeklySpanOption = 4,
  focusDate?: string
): RoutinePeriodBoxPlotBucket[] {
  const bucketMap = buildDailyRoutineBucketMap(records);
  const endDateStr = resolveRoutineFocusDate(bucketMap, focusDate);
  const endMonday = getMondayOfWeek(parseLocalDateYMD(endDateStr));

  let weekCount: number;
  if (span === 'all') {
    const allDatesAsc = Array.from(bucketMap.keys()).sort((a, b) => a.localeCompare(b));
    if (allDatesAsc.length === 0) {
      weekCount = 4;
    } else {
      const startMonday = getMondayOfWeek(parseLocalDateYMD(allDatesAsc[0]));
      const diffWeeks = Math.round((endMonday.getTime() - startMonday.getTime()) / (7 * 86_400_000)) + 1;
      weekCount = Math.max(4, Math.min(52, diffWeeks));
    }
  } else {
    weekCount = Math.max(1, span);
  }

  const periods: RoutinePeriodBoxPlotBucket[] = [];

  for (let w = weekCount - 1; w >= 0; w--) {
    const start = new Date(endMonday);
    start.setDate(start.getDate() - w * 7);
    const end = new Date(start);
    end.setDate(end.getDate() + 6);

    const milkDailyValues: number[] = [];
    const diaperDailyValues: number[] = [];
    const feedCounts: number[] = [];
    const wetDailyValues: number[] = [];
    let ebmTotalMl = 0;
    let formulaTotalMl = 0;
    let wetTotal = 0;
    let mixedTotal = 0;
    let dirtyTotal = 0;

    for (let dayIdx = 0; dayIdx < 7; dayIdx++) {
      const d = new Date(start);
      d.setDate(d.getDate() + dayIdx);
      const bucket = bucketMap.get(formatLocalDateYMD(d));
      if (!bucket) continue;

      if (bucket.totalMl > 0) {
        milkDailyValues.push(bucket.totalMl);
        ebmTotalMl += bucket.ebmMl;
        formulaTotalMl += bucket.formulaMl;
      }
      if (bucket.feedCount > 0) {
        feedCounts.push(bucket.feedCount);
      }
      if (bucket.totalDiapers > 0) {
        diaperDailyValues.push(bucket.totalDiapers);
        wetTotal += bucket.wetDiapers;
        mixedTotal += bucket.mixedDiapers;
        dirtyTotal += bucket.dirtyDiapers;
        wetDailyValues.push(bucket.wetDiapers + bucket.mixedDiapers);
      }
    }

    const startLabel = `${SHORT_MONTHS[start.getMonth()]} ${start.getDate()}`;
    const endLabel = `${SHORT_MONTHS[end.getMonth()]} ${end.getDate()}, ${end.getFullYear()}`;
    const key = formatLocalDateYMD(start);

    periods.push({
      key,
      label: startLabel,
      rangeLabel: `${startLabel} – ${endLabel}`,
      daysWithFeeds: milkDailyValues.length,
      daysWithDiapers: diaperDailyValues.length,
      milkStats: computeBoxPlotStats(milkDailyValues),
      diaperStats: computeBoxPlotStats(diaperDailyValues),
      ebmTotalMl,
      formulaTotalMl,
      avgFeedsPerDay:
        feedCounts.length > 0
          ? Math.round((feedCounts.reduce((s, n) => s + n, 0) / feedCounts.length) * 10) / 10
          : null,
      wetTotal,
      mixedTotal,
      dirtyTotal,
      avgWetPerDay:
        wetDailyValues.length > 0
          ? Math.round((wetDailyValues.reduce((s, n) => s + n, 0) / wetDailyValues.length) * 10) / 10
          : null,
    });
  }

  return periods;
}

export function buildMonthlyRoutineBoxPlots(
  records: RoutineRecord[],
  span: MonthlySpanOption = 6,
  focusDate?: string
): RoutinePeriodBoxPlotBucket[] {
  const bucketMap = buildDailyRoutineBucketMap(records);
  const endDateStr = resolveRoutineFocusDate(bucketMap, focusDate);
  const endDate = parseLocalDateYMD(endDateStr);
  const endYear = endDate.getFullYear();
  const endMonth = endDate.getMonth();

  let monthCount: number;
  if (span === 'all') {
    const allDatesAsc = Array.from(bucketMap.keys()).sort((a, b) => a.localeCompare(b));
    if (allDatesAsc.length === 0) {
      monthCount = 3;
    } else {
      const startDate = parseLocalDateYMD(allDatesAsc[0]);
      const diffMonths =
        (endYear - startDate.getFullYear()) * 12 + (endMonth - startDate.getMonth()) + 1;
      monthCount = Math.max(3, Math.min(24, diffMonths));
    }
  } else {
    monthCount = Math.max(1, span);
  }

  const bucketsByMonth = new Map<string, DailyRoutineBucket[]>();
  for (const [dateKey, bucket] of bucketMap.entries()) {
    const ym = dateKey.slice(0, 7);
    const list = bucketsByMonth.get(ym) ?? [];
    list.push(bucket);
    bucketsByMonth.set(ym, list);
  }

  const startAnchor = new Date(endYear, endMonth - (monthCount - 1), 1, 12, 0, 0, 0);
  const spansMultipleYears = startAnchor.getFullYear() !== endYear;

  const periods: RoutinePeriodBoxPlotBucket[] = [];

  for (let m = monthCount - 1; m >= 0; m--) {
    const monthDate = new Date(endYear, endMonth - m, 1, 12, 0, 0, 0);
    const y = monthDate.getFullYear();
    const mo = monthDate.getMonth();
    const key = `${y}-${String(mo + 1).padStart(2, '0')}`;
    const monthBuckets = bucketsByMonth.get(key) ?? [];

    const milkDailyValues: number[] = [];
    const diaperDailyValues: number[] = [];
    const feedCounts: number[] = [];
    const wetDailyValues: number[] = [];
    let ebmTotalMl = 0;
    let formulaTotalMl = 0;
    let wetTotal = 0;
    let mixedTotal = 0;
    let dirtyTotal = 0;

    for (const bucket of monthBuckets) {
      if (bucket.totalMl > 0) {
        milkDailyValues.push(bucket.totalMl);
        ebmTotalMl += bucket.ebmMl;
        formulaTotalMl += bucket.formulaMl;
      }
      if (bucket.feedCount > 0) {
        feedCounts.push(bucket.feedCount);
      }
      if (bucket.totalDiapers > 0) {
        diaperDailyValues.push(bucket.totalDiapers);
        wetTotal += bucket.wetDiapers;
        mixedTotal += bucket.mixedDiapers;
        dirtyTotal += bucket.dirtyDiapers;
        wetDailyValues.push(bucket.wetDiapers + bucket.mixedDiapers);
      }
    }

    const label = spansMultipleYears
      ? `${SHORT_MONTHS[mo]} '${String(y).slice(-2)}`
      : SHORT_MONTHS[mo];

    periods.push({
      key,
      label,
      rangeLabel: `${FULL_MONTHS[mo]} ${y}`,
      daysWithFeeds: milkDailyValues.length,
      daysWithDiapers: diaperDailyValues.length,
      milkStats: computeBoxPlotStats(milkDailyValues),
      diaperStats: computeBoxPlotStats(diaperDailyValues),
      ebmTotalMl,
      formulaTotalMl,
      avgFeedsPerDay:
        feedCounts.length > 0
          ? Math.round((feedCounts.reduce((s, n) => s + n, 0) / feedCounts.length) * 10) / 10
          : null,
      wetTotal,
      mixedTotal,
      dirtyTotal,
      avgWetPerDay:
        wetDailyValues.length > 0
          ? Math.round((wetDailyValues.reduce((s, n) => s + n, 0) / wetDailyValues.length) * 10) / 10
          : null,
    });
  }

  return periods;
}

export interface ResolvedDailyWeight {
  weightKg: number;
  isExact: boolean;
}

/**
 * Builds a date-indexed weight resolver for a profile by combining daily `growth`
 * logs, pediatric `babyMeasurements`, and birth weight.
 * - Exact date match -> returns that day's logged weight (`isExact: true`)
 * - Between two weigh-ins -> linearly interpolates by calendar days
 * - After latest weigh-in -> carries forward latest weight
 * - Before earliest weigh-in (on or after birth date) -> uses earliest weight
 */
export function buildDailyWeightResolver(
  growthRecords: GrowthRecord[] = [],
  babyMeasurements: BabyMeasurement[] = [],
  profile?: ChildProfile
): (dateStr: string) => ResolvedDailyWeight | null {
  const byDate = new Map<string, { weightKg: number; priority: number; createdAt: string }>();

  const birthDate =
    profile?.type === 'baby' && profile.dateOfEvent
      ? profile.dateOfEvent.slice(0, 10)
      : null;

  if (birthDate && profile?.birthWeightKg && profile.birthWeightKg > 0) {
    byDate.set(birthDate, { weightKg: profile.birthWeightKg, priority: 1, createdAt: '' });
  }

  for (const m of babyMeasurements) {
    if (typeof m.weightKg !== 'number' || m.weightKg <= 0) continue;
    const d = m.date?.slice(0, 10);
    if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(d)) continue;
    const existing = byDate.get(d);
    if (!existing || existing.priority <= 2) {
      byDate.set(d, { weightKg: m.weightKg, priority: 2, createdAt: '' });
    }
  }

  const scopedGrowth = profile
    ? growthRecords.filter((g) => doesRecordMatchProfile(g, profile))
    : growthRecords;

  for (const g of scopedGrowth) {
    if (g.daily_weight === null || g.daily_weight <= 0) continue;
    const d = getGrowthRecordDate(g);
    if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(d)) continue;
    const existing = byDate.get(d);
    const sortStamp = `${g.time ?? ''}T${g.created_at ?? ''}`;
    if (
      !existing ||
      existing.priority < 3 ||
      (existing.priority === 3 && sortStamp >= existing.createdAt)
    ) {
      byDate.set(d, {
        weightKg: g.daily_weight,
        priority: 3,
        createdAt: sortStamp,
      });
    }
  }

  const timeline = Array.from(byDate.entries())
    .map(([date, info]) => ({
      date,
      utc: parseLocalDateYMD(date).getTime(),
      weightKg: info.weightKg,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));

  if (timeline.length === 0) {
    return () => null;
  }

  const exactMap = new Map(timeline.map((p) => [p.date, p.weightKg]));

  return (dateStr: string): ResolvedDailyWeight | null => {
    const clean = dateStr.slice(0, 10);
    const exact = exactMap.get(clean);
    if (exact !== undefined) {
      return { weightKg: exact, isExact: true };
    }

    if (birthDate && clean < birthDate) {
      return null;
    }

    const targetUtc = parseLocalDateYMD(clean).getTime();

    if (targetUtc < timeline[0].utc) {
      return { weightKg: timeline[0].weightKg, isExact: false };
    }

    const last = timeline[timeline.length - 1];
    if (targetUtc > last.utc) {
      return { weightKg: last.weightKg, isExact: false };
    }

    for (let i = 0; i < timeline.length - 1; i++) {
      const prev = timeline[i];
      const next = timeline[i + 1];
      if (targetUtc >= prev.utc && targetUtc <= next.utc) {
        const span = next.utc - prev.utc;
        if (span <= 0) return { weightKg: next.weightKg, isExact: false };
        const t = (targetUtc - prev.utc) / span;
        const interp = prev.weightKg + (next.weightKg - prev.weightKg) * t;
        return { weightKg: Math.round(interp * 1000) / 1000, isExact: false };
      }
    }

    return { weightKg: last.weightKg, isExact: false };
  };
}

export function interpretRoutineTable(
  records: RoutineRecord[],
  latestWeightKg: number | null,
  formulaConfig: MilkFormulaConfig = DEFAULT_MILK_FORMULA,
  birthDate?: string | null
): RoutineInterpretation {
  const todayStr = formatLocalDateYMD(new Date());
  const bucketMap = buildDailyRoutineBucketMap(records);

  const allDatesDesc = Array.from(bucketMap.keys()).sort((a, b) => b.localeCompare(a));
  const hasToday = bucketMap.has(todayStr);
  const focusDate = hasToday ? todayStr : allDatesDesc[0] ?? todayStr;
  const todayBucket = bucketMap.get(focusDate) ?? emptyBucket(focusDate);

  const focusAgeDays = getAgeDaysOnDate(focusDate, birthDate);
  const milkTargetEligible =
    focusAgeDays === null || focusAgeDays >= MIN_MILK_TARGET_AGE_DAYS;

  // Build 7-day series ending on focusDate
  const dailySeries = buildDailyRoutineSeries(records, 7, focusDate);

  const daysWithFeeds = dailySeries.filter((d) => d.totalMl > 0);
  const sevenDayAvgMl =
    daysWithFeeds.length > 0
      ? Math.round(daysWithFeeds.reduce((sum, d) => sum + d.totalMl, 0) / daysWithFeeds.length)
      : null;

  const ebmSharePct =
    todayBucket.totalMl > 0 ? Math.round((todayBucket.ebmMl / todayBucket.totalMl) * 100) : 0;
  const formulaSharePct =
    todayBucket.totalMl > 0 ? 100 - ebmSharePct : 0;
  const avgMlPerFeed =
    todayBucket.feedCount > 0 && todayBucket.totalMl > 0
      ? Math.round(todayBucket.totalMl / todayBucket.feedCount)
      : null;

  // Weight-based milk intake formula: x to y mL/kg/day (defaults 150–200), target at z% in [x, y] (default 80%)
  // Applies from Day 6 onwards only.
  const rawMin = Number.isFinite(formulaConfig.minMlPerKg) && formulaConfig.minMlPerKg > 0
    ? formulaConfig.minMlPerKg
    : DEFAULT_MILK_FORMULA.minMlPerKg;
  const rawMax = Number.isFinite(formulaConfig.maxMlPerKg) && formulaConfig.maxMlPerKg > 0
    ? formulaConfig.maxMlPerKg
    : DEFAULT_MILK_FORMULA.maxMlPerKg;
  const lowRate = Math.min(rawMin, rawMax);
  const highRate = Math.max(rawMin, rawMax);
  const feedsPerDay =
    Number.isFinite(formulaConfig.feedsPerDay) && formulaConfig.feedsPerDay > 0
      ? formulaConfig.feedsPerDay
      : DEFAULT_MILK_FORMULA.feedsPerDay;
  const clampedZ = Number.isFinite(formulaConfig.targetRangePct)
    ? Math.min(100, Math.max(0, formulaConfig.targetRangePct))
    : DEFAULT_MILK_FORMULA.targetRangePct;

  const hasValidWeight = latestWeightKg !== null && Number.isFinite(latestWeightKg) && latestWeightKg > 0;
  const effectiveTargetMlPerKg =
    Math.round((lowRate + (clampedZ / 100) * (highRate - lowRate)) * 10) / 10;

  const canComputeMilkTargets = hasValidWeight && milkTargetEligible;
  const targetMinMl = canComputeMilkTargets ? Math.round((latestWeightKg as number) * lowRate) : null;
  const targetMaxMl = canComputeMilkTargets ? Math.round((latestWeightKg as number) * highRate) : null;
  const estimatedTargetMl = canComputeMilkTargets
    ? Math.round((latestWeightKg as number) * (lowRate + (clampedZ / 100) * (highRate - lowRate)))
    : null;

  const perFeedMinMl = targetMinMl !== null ? Math.round(targetMinMl / feedsPerDay) : null;
  const perFeedMaxMl = targetMaxMl !== null ? Math.round(targetMaxMl / feedsPerDay) : null;
  const recommendedFeedMl =
    estimatedTargetMl !== null ? Math.round(estimatedTargetMl / feedsPerDay) : null;

  const targetProgressPct =
    estimatedTargetMl && estimatedTargetMl > 0
      ? Math.min(200, Math.round((todayBucket.totalMl / estimatedTargetMl) * 100))
      : null;

  // Latest feeding timestamp label
  const feedRecords = records.filter(
    (r) => (r.emb_mL ?? 0) > 0 || (r.formula_mL ?? 0) > 0 || (r.feed_duration_min ?? 0) > 0
  );
  let lastFeedLabel: string | null = null;
  if (feedRecords.length > 0) {
    const latestFeed = [...feedRecords].sort((a, b) => {
      const aKey = `${getRoutineRecordDate(a)}T${a.time || a.created_at.slice(11, 19)}`;
      const bKey = `${getRoutineRecordDate(b)}T${b.time || b.created_at.slice(11, 19)}`;
      return bKey.localeCompare(aKey);
    })[0];
    const vol = (latestFeed.emb_mL ?? 0) + (latestFeed.formula_mL ?? 0);
    const timeDisplay = latestFeed.time ? latestFeed.time.slice(0, 5) : latestFeed.created_at.slice(11, 16);
    lastFeedLabel = `${getRoutineRecordDate(latestFeed)} · ${timeDisplay}${vol > 0 ? ` (${vol} mL)` : ''}`;
  }

  const insights: string[] = [];
  const effectiveWetCount = todayBucket.wetDiapers + todayBucket.mixedDiapers;

  if (todayBucket.totalMl > 0) {
    const dayPrefix = hasToday ? 'Today' : `On ${focusDate}`;
    const splitText =
      todayBucket.ebmMl > 0 && todayBucket.formulaMl > 0
        ? ` (${ebmSharePct}% EBM, ${formulaSharePct}% Formula)`
        : todayBucket.ebmMl > 0
          ? ' (100% EBM)'
          : ' (100% Formula)';
    insights.push(
      `${dayPrefix}'s total milk intake is ${todayBucket.totalMl} mL across ${todayBucket.feedCount} feed${todayBucket.feedCount === 1 ? '' : 's'}${splitText}${avgMlPerFeed ? `, averaging ${avgMlPerFeed} mL/feed` : ''}.`
    );

    if (estimatedTargetMl && targetMinMl && targetMaxMl && recommendedFeedMl && perFeedMinMl && perFeedMaxMl) {
      if (todayBucket.totalMl >= targetMinMl && todayBucket.totalMl <= targetMaxMl) {
        insights.push(
          `Intake is within your ${lowRate}–${highRate} mL/kg daily range (${targetMinMl}–${targetMaxMl} mL/day; ${clampedZ}% target is ${estimatedTargetMl} mL/day or ~${recommendedFeedMl} mL/feed across ${feedsPerDay} feeds for ${latestWeightKg !== null ? UnitConverter.formatKgValue(latestWeightKg) : '—'} kg).`
        );
      } else if (todayBucket.totalMl < targetMinMl) {
        insights.push(
          `Currently at ${targetProgressPct}% of your ${estimatedTargetMl} mL daily target (${clampedZ}% of ${targetMinMl}–${targetMaxMl} mL/day; recommended ~${recommendedFeedMl} mL/feed, range ${perFeedMinMl}–${perFeedMaxMl} mL/feed).`
        );
      } else {
        insights.push(
          `Intake exceeds your ${targetMaxMl} mL daily upper range (${highRate} mL/kg) — common during growth spurts.`
        );
      }
    }
  } else if (estimatedTargetMl && targetMinMl && targetMaxMl && recommendedFeedMl && perFeedMinMl && perFeedMaxMl) {
    insights.push(
      `Based on ${latestWeightKg !== null ? UnitConverter.formatKgValue(latestWeightKg) : '—'} kg at ${lowRate}–${highRate} mL/kg/day (${clampedZ}% target = ${effectiveTargetMlPerKg} mL/kg), daily target is ${estimatedTargetMl} mL (${targetMinMl}–${targetMaxMl} mL) and recommended feed target is ${recommendedFeedMl} mL/feed (${perFeedMinMl}–${perFeedMaxMl} mL across ${feedsPerDay} feeds/day).`
    );
  }

  if (!milkTargetEligible && focusAgeDays !== null && focusAgeDays >= 0) {
    insights.push(
      `Weight-based recommended milk intake targets start from Day ${MIN_MILK_TARGET_AGE_DAYS} onwards (currently Day ${focusAgeDays}).`
    );
  }

  if (todayBucket.totalDiapers > 0) {
    const hydrationNote =
      effectiveWetCount >= 6
        ? `Healthy hydration output (${effectiveWetCount}/6 wet + mixed diapers).`
        : `Hydration output is ${effectiveWetCount}/6 wet + mixed diapers — continue monitoring toward the ≥6 wet + mixed/day benchmark.`;
    insights.push(
      `${hasToday ? 'Today' : focusDate}: ${todayBucket.totalDiapers} diaper change${todayBucket.totalDiapers === 1 ? '' : 's'} logged (${todayBucket.wetDiapers} wet, ${todayBucket.dirtyDiapers} dirty, ${todayBucket.mixedDiapers} mixed). ${hydrationNote}`
    );
  }

  if (todayBucket.avgDurationMin !== null) {
    insights.push(
      `Average feeding session duration is ${todayBucket.avgDurationMin} min (total ${todayBucket.totalDurationMin} min).`
    );
  }

  if (insights.length === 0) {
    insights.push('Log EBM, Formula, feeding duration, or diaper changes to see daily intake totals, EBM/Formula ratio, and hydration insights.');
  }

  return {
    activeDateLabel: hasToday ? 'Today' : focusDate,
    isToday: hasToday,
    todayBucket,
    sevenDayAvgMl,
    ebmSharePct,
    formulaSharePct,
    avgMlPerFeed,
    milkTargetEligible,
    focusAgeDays,
    minRateMlPerKg: lowRate,
    maxRateMlPerKg: highRate,
    effectiveTargetMlPerKg,
    estimatedTargetMl,
    targetMinMl,
    targetMaxMl,
    perFeedMinMl,
    perFeedMaxMl,
    recommendedFeedMl,
    targetProgressPct,
    lastFeedLabel,
    dailySeries,
    insights,
  };
}

export interface NextFeedRecommendation {
  recommendedTime: string;
  recommendedDate: string;
  isToday: boolean;
  isTomorrow: boolean;
  isDue: boolean;
  intervalMin: number;
  intervalLabel: string;
  rhythmIntervalMin: number;
  rhythmIntervalLabel: string;
  cadenceIntervalMin: number;
  cadenceIntervalLabel: string;
  baselineIntervalMin: number;
  baselineIntervalLabel: string;
  feedsPerDayUsed: number;
  todayFeedCount: number;
  remainingFeedsCount: number;
  gapAdjustmentMin: number;
  dailyGapMl: number | null;
  sampleCount: number;
  rhythmSource: 'time-of-day' | 'recent-median' | 'formula-cadence';
  lastFeedTime: string;
  lastFeedDate: string;
  lastFeedIsToday: boolean;
  lastFeedMl: number;
  lastFeedDurationMin: number;
  elapsedSinceLastMin: number | null;
  elapsedSinceLastLabel: string | null;
  recommendedMl: number | null;
}

function parseRoutineRecordLocalTimestamp(record: RoutineRecord): number | null {
  const dateStr = getRoutineRecordDate(record);
  const dateParts = dateStr.split('-').map((n) => parseInt(n, 10));
  if (dateParts.length !== 3 || dateParts.some((n) => !Number.isFinite(n))) {
    return null;
  }
  const [y, m, d] = dateParts;

  let hhmm = normalizeRoutineTimeHHMM(record.time);
  if (!hhmm && record.created_at) {
    const createdDate = new Date(record.created_at);
    if (!Number.isNaN(createdDate.getTime())) {
      hhmm = `${String(createdDate.getHours()).padStart(2, '0')}:${String(
        createdDate.getMinutes()
      ).padStart(2, '0')}`;
    } else {
      hhmm = normalizeRoutineTimeHHMM(record.created_at.slice(11, 16));
    }
  }
  if (!hhmm) return null;

  const [hh, mm] = hhmm.split(':').map((n) => parseInt(n, 10));
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;

  const dt = new Date(y, m - 1, d, hh, mm, 0, 0);
  const ms = dt.getTime();
  return Number.isFinite(ms) ? ms : null;
}

function formatDurationHm(totalMinutes: number): string {
  const safe = Math.max(0, Math.round(totalMinutes));
  const h = Math.floor(safe / 60);
  const m = safe % 60;
  if (h > 0 && m > 0) return `${h}h ${m}m`;
  if (h > 0) return `${h}h`;
  return `${m}m`;
}

function circularHourDistance(a: number, b: number): number {
  const diff = Math.abs(a - b) % 24;
  return Math.min(diff, 24 - diff);
}

export interface NextFeedTargetGapContext {
  dailyTargetMl?: number | null;
  todayTotalMl?: number | null;
}

/**
 * Predicts the next feeding time from the baby's past feeding rhythm, configured target feed count
 * (feedsPerDay that the per-feed volume target is derived from), latest feed, and current feed target gap,
 * paired with the existing calculated per-feed recommended milk volume (mL).
 * - Clusters split/top-up logs within 45 min into a single feed session (start-to-start).
 * - Uses valid inter-feed gaps (45 min to 10 hours) from recent history (14-day window, up to 30 gaps).
 * - Blends observed rhythm (time-of-day matched or recent median) with the configured feedsPerDay cadence
 *   (24h / feedsPerDay) so timing and per-feed mL target stay aligned with the chosen daily feed count.
 * - Adjusts timing gently using today's remaining feed count (feedsPerDay - todayFeedCount),
 *   remaining daily volume gap (dailyTargetMl - todayTotalMl), and last feed volume vs recommendedFeedMl.
 */
export function computeNextFeedRecommendation(
  records: RoutineRecord[],
  recommendedFeedMl: number | null,
  feedsPerDay: number = DEFAULT_MILK_FORMULA.feedsPerDay,
  now: Date = new Date(),
  targetGapContext?: NextFeedTargetGapContext
): NextFeedRecommendation | null {
  const feedEvents: Array<{ ts: number; volMl: number; durationMin: number }> = [];

  for (const r of records) {
    const volMl = Math.max(0, r.emb_mL ?? 0) + Math.max(0, r.formula_mL ?? 0);
    const durationMin = Math.max(0, r.feed_duration_min ?? 0);
    const isFeed = volMl > 0 || durationMin > 0;
    if (!isFeed) continue;
    const ts = parseRoutineRecordLocalTimestamp(r);
    if (ts !== null) {
      feedEvents.push({ ts, volMl, durationMin });
    }
  }

  if (feedEvents.length === 0) return null;

  feedEvents.sort((a, b) => a.ts - b.ts);

  // Cluster feeds within 45 minutes into one session anchored at session start time
  const CLUSTER_GAP_MS = 45 * 60_000;
  const sessions: Array<{ startMs: number; totalMl: number; totalDurationMin: number }> = [];
  let prevRawTs = feedEvents[0].ts;
  sessions.push({
    startMs: feedEvents[0].ts,
    totalMl: feedEvents[0].volMl,
    totalDurationMin: feedEvents[0].durationMin,
  });

  for (let i = 1; i < feedEvents.length; i++) {
    const ev = feedEvents[i];
    if (ev.ts - prevRawTs >= CLUSTER_GAP_MS) {
      sessions.push({
        startMs: ev.ts,
        totalMl: ev.volMl,
        totalDurationMin: ev.durationMin,
      });
    } else {
      const current = sessions[sessions.length - 1];
      current.totalMl += ev.volMl;
      current.totalDurationMin += ev.durationMin;
    }
    prevRawTs = ev.ts;
  }

  const latestSession = sessions[sessions.length - 1];
  const latestSessionMs = latestSession.startMs;
  const latestSessionDate = new Date(latestSessionMs);

  // Extract valid inter-feed intervals (45 min .. 10 hours)
  const MIN_INTERVAL_MIN = 45;
  const MAX_INTERVAL_MIN = 600;
  const allIntervals: Array<{ startHour: number; diffMin: number; endMs: number }> = [];

  for (let i = 1; i < sessions.length; i++) {
    const diffMin = (sessions[i].startMs - sessions[i - 1].startMs) / 60_000;
    if (diffMin >= MIN_INTERVAL_MIN && diffMin <= MAX_INTERVAL_MIN) {
      const startDate = new Date(sessions[i - 1].startMs);
      const startHour = startDate.getHours() + startDate.getMinutes() / 60;
      allIntervals.push({ startHour, diffMin, endMs: sessions[i].startMs });
    }
  }

  const fourteenDaysMs = 14 * 86_400_000;
  const recentWindow = allIntervals.filter((iv) => latestSessionMs - iv.endMs <= fourteenDaysMs);
  const activePool = (recentWindow.length >= 3 ? recentWindow : allIntervals).slice(-30);

  const safeFeedsPerDay =
    Number.isFinite(feedsPerDay) && feedsPerDay > 0
      ? feedsPerDay
      : DEFAULT_MILK_FORMULA.feedsPerDay;

  const rawCadenceMin = Math.max(
    MIN_INTERVAL_MIN,
    Math.min(MAX_INTERVAL_MIN, (24 / safeFeedsPerDay) * 60)
  );
  const cadenceIntervalMin = Math.max(MIN_INTERVAL_MIN, Math.round(rawCadenceMin / 5) * 5);

  let rawRhythmMin: number;
  let sampleCount: number;
  let rhythmSource: NextFeedRecommendation['rhythmSource'];

  if (activePool.length > 0) {
    const allSorted = activePool.map((iv) => iv.diffMin).sort((a, b) => a - b);
    const overallMedian = interpolateQuantile(allSorted, 0.5);

    const lastHour = latestSessionDate.getHours() + latestSessionDate.getMinutes() / 60;
    const sameWindow = activePool.filter(
      (iv) => circularHourDistance(iv.startHour, lastHour) <= 3
    );

    if (sameWindow.length >= 3) {
      const todSorted = sameWindow.map((iv) => iv.diffMin).sort((a, b) => a - b);
      const todMedian = interpolateQuantile(todSorted, 0.5);
      rawRhythmMin = todMedian * 0.75 + overallMedian * 0.25;
      sampleCount = sameWindow.length;
      rhythmSource = 'time-of-day';
    } else {
      rawRhythmMin = overallMedian;
      sampleCount = activePool.length;
      rhythmSource = 'recent-median';
    }
  } else {
    rawRhythmMin = rawCadenceMin;
    sampleCount = 0;
    rhythmSource = 'formula-cadence';
  }

  const rhythmIntervalMin = Math.max(MIN_INTERVAL_MIN, Math.round(rawRhythmMin / 5) * 5);

  // Blend observed past rhythm with the configured feed-count cadence (24h / feedsPerDay)
  // so that next-feed timing always reflects the feed count used for per-feed target volume.
  const rhythmWeight = activePool.length >= 3 ? 0.65 : activePool.length > 0 ? 0.5 : 0;
  const rawBaselineMin = rhythmWeight * rawRhythmMin + (1 - rhythmWeight) * rawCadenceMin;
  const baselineIntervalMin = Math.max(MIN_INTERVAL_MIN, Math.round(rawBaselineMin / 5) * 5);

  const todayStr = formatLocalDateYMD(now);
  const lastFeedDate = formatLocalDateYMD(latestSessionDate);
  const lastFeedIsToday = lastFeedDate === todayStr;

  const todayFeedCount = sessions.filter(
    (s) => formatLocalDateYMD(new Date(s.startMs)) === todayStr
  ).length;
  const remainingFeedsCount = Math.max(0, Number((safeFeedsPerDay - todayFeedCount).toFixed(1)));

  // Compute today's total milk directly from records if not provided
  const dailyTargetMl =
    targetGapContext?.dailyTargetMl && targetGapContext.dailyTargetMl > 0
      ? targetGapContext.dailyTargetMl
      : null;

  let todayTotalMl =
    typeof targetGapContext?.todayTotalMl === 'number' && Number.isFinite(targetGapContext.todayTotalMl)
      ? targetGapContext.todayTotalMl
      : null;

  if (todayTotalMl === null && dailyTargetMl !== null) {
    let sum = 0;
    for (const r of records) {
      if (getRoutineRecordDate(r) === todayStr) {
        sum += Math.max(0, r.emb_mL ?? 0) + Math.max(0, r.formula_mL ?? 0);
      }
    }
    todayTotalMl = sum;
  }

  const dailyGapMl =
    dailyTargetMl !== null && todayTotalMl !== null ? dailyTargetMl - todayTotalMl : null;

  // Factor remaining feed count (feedsPerDay - todayFeedCount) & feed target gap into next feed timing:
  // 1) Pace remaining feeds today against remaining time until end of day
  // 2) Last feed volume deviation vs per-feed target (derived from dailyTarget / feedsPerDay)
  let rawDailyGapAdjMin = 0;
  if (lastFeedIsToday) {
    const endOfDayMs = new Date(
      latestSessionDate.getFullYear(),
      latestSessionDate.getMonth(),
      latestSessionDate.getDate(),
      23,
      59,
      0,
      0
    ).getTime();
    const remainingDayMin = Math.max(0, (endOfDayMs - latestSessionMs) / 60_000);

    if (dailyGapMl !== null && recommendedFeedMl !== null && recommendedFeedMl > 0) {
      if (dailyGapMl > 0 && remainingDayMin > 30) {
        const remainingFeedsByGap = Math.max(0.5, dailyGapMl / recommendedFeedMl);
        const effectiveRemainingFeeds =
          remainingFeedsCount > 0
            ? Math.max(0.5, (remainingFeedsByGap + remainingFeedsCount) / 2)
            : remainingFeedsByGap;
        const targetPaceIntervalMin = remainingDayMin / effectiveRemainingFeeds;

        if (targetPaceIntervalMin < baselineIntervalMin) {
          const diff = targetPaceIntervalMin - baselineIntervalMin;
          rawDailyGapAdjMin = Math.max(-45, diff * 0.45);
        } else if (targetPaceIntervalMin > baselineIntervalMin && remainingFeedsCount <= 1.5) {
          const diff = targetPaceIntervalMin - baselineIntervalMin;
          rawDailyGapAdjMin = Math.min(20, diff * 0.25);
        }
      } else if (dailyGapMl <= 0) {
        const surplusFeeds = Math.abs(dailyGapMl) / recommendedFeedMl;
        const countMetBonus = remainingFeedsCount <= 0 ? 5 : 0;
        rawDailyGapAdjMin = Math.min(25, 10 + surplusFeeds * 15 + countMetBonus);
      }
    } else if (remainingFeedsCount > 0 && remainingDayMin > 30) {
      const targetPaceIntervalMin = remainingDayMin / Math.max(0.5, remainingFeedsCount);
      if (targetPaceIntervalMin < baselineIntervalMin) {
        const diff = targetPaceIntervalMin - baselineIntervalMin;
        rawDailyGapAdjMin = Math.max(-35, diff * 0.35);
      }
    }
  }

  let rawLastFeedAdjMin = 0;
  if (
    latestSession.totalMl > 0 &&
    recommendedFeedMl !== null &&
    recommendedFeedMl > 0
  ) {
    const perFeedRatio = (latestSession.totalMl - recommendedFeedMl) / recommendedFeedMl;
    rawLastFeedAdjMin = Math.max(
      -30,
      Math.min(25, perFeedRatio * baselineIntervalMin * 0.25)
    );
  }

  const combinedRawAdj = Math.max(-50, Math.min(30, rawDailyGapAdjMin + rawLastFeedAdjMin));
  const minSafeInterval = Math.min(baselineIntervalMin, Math.max(MIN_INTERVAL_MIN, 90));
  const adjustedIntervalMin = Math.max(
    minSafeInterval,
    Math.min(MAX_INTERVAL_MIN, Math.round((baselineIntervalMin + combinedRawAdj) / 5) * 5)
  );
  const gapAdjustmentMin = adjustedIntervalMin - baselineIntervalMin;

  const nextFeedMs = latestSessionMs + adjustedIntervalMin * 60_000;
  const nextFeedDateObj = new Date(nextFeedMs);

  const formatHHMM = (d: Date) =>
    `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

  const recommendedDate = formatLocalDateYMD(nextFeedDateObj);
  const recommendedTime = formatHHMM(nextFeedDateObj);
  const lastFeedTime = formatHHMM(latestSessionDate);

  const tomorrowDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 12, 0, 0, 0);
  const tomorrowStr = formatLocalDateYMD(tomorrowDate);

  const isToday = recommendedDate === todayStr;
  const isTomorrow = recommendedDate === tomorrowStr;
  const isDue = now.getTime() >= nextFeedMs && now.getTime() - latestSessionMs <= 24 * 3_600_000;

  const rawElapsedMin = Math.floor((now.getTime() - latestSessionMs) / 60_000);
  const elapsedSinceLastMin =
    rawElapsedMin >= 0 && rawElapsedMin <= 48 * 60 ? rawElapsedMin : null;
  const elapsedSinceLastLabel =
    elapsedSinceLastMin !== null
      ? elapsedSinceLastMin < 1
        ? 'just now'
        : `${formatDurationHm(elapsedSinceLastMin)} ago`
      : null;

  return {
    recommendedTime,
    recommendedDate,
    isToday,
    isTomorrow,
    isDue,
    intervalMin: adjustedIntervalMin,
    intervalLabel: formatDurationHm(adjustedIntervalMin),
    rhythmIntervalMin,
    rhythmIntervalLabel: formatDurationHm(rhythmIntervalMin),
    cadenceIntervalMin,
    cadenceIntervalLabel: formatDurationHm(cadenceIntervalMin),
    baselineIntervalMin,
    baselineIntervalLabel: formatDurationHm(baselineIntervalMin),
    feedsPerDayUsed: safeFeedsPerDay,
    todayFeedCount,
    remainingFeedsCount,
    gapAdjustmentMin,
    dailyGapMl,
    sampleCount,
    rhythmSource,
    lastFeedTime,
    lastFeedDate,
    lastFeedIsToday,
    lastFeedMl: latestSession.totalMl,
    lastFeedDurationMin: latestSession.totalDurationMin,
    elapsedSinceLastMin,
    elapsedSinceLastLabel,
    recommendedMl: recommendedFeedMl,
  };
}

export interface DailyRoutineIntervalBucket {
  date: string;
  feedIntervalsHours: number[];
  diaperIntervalsHours: number[];
  feedStats: BoxPlotStats | null;
  diaperStats: BoxPlotStats | null;
}

export interface PeriodRoutineIntervalBucket {
  key: string;
  label: string;
  rangeLabel: string;
  daysWithFeedIntervals: number;
  daysWithDiaperIntervals: number;
  feedStats: BoxPlotStats | null;
  diaperStats: BoxPlotStats | null;
}

export interface RoutineIntervalSummary {
  dailyMap: Map<string, DailyRoutineIntervalBucket>;
  latestFeedIntervalHours: number | null;
  latestDiaperIntervalHours: number | null;
}

function isDiaperChangeRecord(r: RoutineRecord): boolean {
  const diaperKind = classifyDiaperValue(r.diaper);
  const hasStool = Boolean(r.stool && r.stool.trim().length > 0);
  if (diaperKind === 'wet' || diaperKind === 'dirty' || diaperKind === 'mixed') {
    return true;
  }
  if (r.diaper && r.diaper.trim().length > 0 && r.diaper.trim().toLowerCase() !== 'dry') {
    return true;
  }
  return hasStool;
}

function emptyIntervalBucket(date: string): DailyRoutineIntervalBucket {
  return {
    date,
    feedIntervalsHours: [],
    diaperIntervalsHours: [],
    feedStats: null,
    diaperStats: null,
  };
}

/**
 * Extracts consecutive time intervals (in hours) between feeding sessions and between diaper
 * changes, bucketed by the local calendar date on which each interval completes.
 * - Feeding sessions cluster split/top-up entries within 45 min (matching next-feed rhythm)
 *   and keep intervals between 45 min and 18 hours.
 * - Diaper changes ignore sub-5-minute duplicate timestamps and keep intervals up to 24 hours.
 */
export function buildDailyRoutineIntervalSummary(records: RoutineRecord[]): RoutineIntervalSummary {
  const feedTimestamps: number[] = [];
  const diaperTimestamps: number[] = [];

  for (const r of records) {
    const ts = parseRoutineRecordLocalTimestamp(r);
    if (ts === null) continue;

    const isFeed =
      (r.emb_mL ?? 0) > 0 || (r.formula_mL ?? 0) > 0 || (r.feed_duration_min ?? 0) > 0;
    if (isFeed) {
      feedTimestamps.push(ts);
    }
    if (isDiaperChangeRecord(r)) {
      diaperTimestamps.push(ts);
    }
  }

  feedTimestamps.sort((a, b) => a - b);
  diaperTimestamps.sort((a, b) => a - b);

  const dailyMap = new Map<string, DailyRoutineIntervalBucket>();
  const ensureBucket = (dateKey: string): DailyRoutineIntervalBucket => {
    let bucket = dailyMap.get(dateKey);
    if (!bucket) {
      bucket = emptyIntervalBucket(dateKey);
      dailyMap.set(dateKey, bucket);
    }
    return bucket;
  };

  // Cluster feeds within 45 min into sessions anchored at session start
  const FEED_CLUSTER_GAP_MS = 45 * 60_000;
  const FEED_MIN_INTERVAL_MIN = 45;
  const FEED_MAX_INTERVAL_MIN = 18 * 60;
  let latestFeedIntervalHours: number | null = null;

  if (feedTimestamps.length >= 2) {
    const feedSessions: number[] = [feedTimestamps[0]];
    let prevRawTs = feedTimestamps[0];
    for (let i = 1; i < feedTimestamps.length; i++) {
      const ts = feedTimestamps[i];
      if (ts - prevRawTs >= FEED_CLUSTER_GAP_MS) {
        feedSessions.push(ts);
      }
      prevRawTs = ts;
    }

    for (let i = 1; i < feedSessions.length; i++) {
      const diffMin = (feedSessions[i] - feedSessions[i - 1]) / 60_000;
      if (diffMin >= FEED_MIN_INTERVAL_MIN && diffMin <= FEED_MAX_INTERVAL_MIN) {
        const hours = Math.round((diffMin / 60) * 100) / 100;
        const dateKey = formatLocalDateYMD(new Date(feedSessions[i]));
        ensureBucket(dateKey).feedIntervalsHours.push(hours);
        latestFeedIntervalHours = hours;
      }
    }
  }

  // Diaper intervals: ignore near-duplicate (<5 min) timestamps, allow up to 24h
  const DIAPER_CLUSTER_GAP_MS = 5 * 60_000;
  const DIAPER_MIN_INTERVAL_MIN = 5;
  const DIAPER_MAX_INTERVAL_MIN = 24 * 60;
  let latestDiaperIntervalHours: number | null = null;

  if (diaperTimestamps.length >= 2) {
    const diaperSessions: number[] = [diaperTimestamps[0]];
    let prevRawTs = diaperTimestamps[0];
    for (let i = 1; i < diaperTimestamps.length; i++) {
      const ts = diaperTimestamps[i];
      if (ts - prevRawTs >= DIAPER_CLUSTER_GAP_MS) {
        diaperSessions.push(ts);
      }
      prevRawTs = ts;
    }

    for (let i = 1; i < diaperSessions.length; i++) {
      const diffMin = (diaperSessions[i] - diaperSessions[i - 1]) / 60_000;
      if (diffMin >= DIAPER_MIN_INTERVAL_MIN && diffMin <= DIAPER_MAX_INTERVAL_MIN) {
        const hours = Math.round((diffMin / 60) * 100) / 100;
        const dateKey = formatLocalDateYMD(new Date(diaperSessions[i]));
        ensureBucket(dateKey).diaperIntervalsHours.push(hours);
        latestDiaperIntervalHours = hours;
      }
    }
  }

  for (const bucket of dailyMap.values()) {
    bucket.feedStats = computeBoxPlotStats(bucket.feedIntervalsHours);
    bucket.diaperStats = computeBoxPlotStats(bucket.diaperIntervalsHours);
  }

  return {
    dailyMap,
    latestFeedIntervalHours,
    latestDiaperIntervalHours,
  };
}

export function buildDailyRoutineIntervalSeries(
  records: RoutineRecord[],
  span: DailySpanOption = 7,
  focusDate?: string
): DailyRoutineIntervalBucket[] {
  const routineBucketMap = buildDailyRoutineBucketMap(records);
  const { dailyMap } = buildDailyRoutineIntervalSummary(records);
  const endDateStr = resolveRoutineFocusDate(routineBucketMap, focusDate);
  const endDate = parseLocalDateYMD(endDateStr);

  let totalDays: number;
  if (span === 'all') {
    const allDatesAsc = Array.from(
      new Set([...routineBucketMap.keys(), ...dailyMap.keys()])
    ).sort((a, b) => a.localeCompare(b));
    if (allDatesAsc.length === 0) {
      totalDays = 7;
    } else {
      const startDate = parseLocalDateYMD(allDatesAsc[0]);
      const diff = Math.round((endDate.getTime() - startDate.getTime()) / 86_400_000) + 1;
      totalDays = Math.max(7, Math.min(365, diff));
    }
  } else {
    totalDays = Math.max(1, span);
  }

  const series: DailyRoutineIntervalBucket[] = [];
  for (let i = totalDays - 1; i >= 0; i--) {
    const d = new Date(endDate);
    d.setDate(d.getDate() - i);
    const key = formatLocalDateYMD(d);
    series.push(dailyMap.get(key) ?? emptyIntervalBucket(key));
  }
  return series;
}

export function buildWeeklyRoutineIntervalBoxPlots(
  records: RoutineRecord[],
  span: WeeklySpanOption = 4,
  focusDate?: string
): PeriodRoutineIntervalBucket[] {
  const routineBucketMap = buildDailyRoutineBucketMap(records);
  const { dailyMap } = buildDailyRoutineIntervalSummary(records);
  const endDateStr = resolveRoutineFocusDate(routineBucketMap, focusDate);
  const endMonday = getMondayOfWeek(parseLocalDateYMD(endDateStr));

  let weekCount: number;
  if (span === 'all') {
    const allDatesAsc = Array.from(
      new Set([...routineBucketMap.keys(), ...dailyMap.keys()])
    ).sort((a, b) => a.localeCompare(b));
    if (allDatesAsc.length === 0) {
      weekCount = 4;
    } else {
      const startMonday = getMondayOfWeek(parseLocalDateYMD(allDatesAsc[0]));
      const diffWeeks =
        Math.round((endMonday.getTime() - startMonday.getTime()) / (7 * 86_400_000)) + 1;
      weekCount = Math.max(4, Math.min(52, diffWeeks));
    }
  } else {
    weekCount = Math.max(1, span);
  }

  const periods: PeriodRoutineIntervalBucket[] = [];

  for (let w = weekCount - 1; w >= 0; w--) {
    const start = new Date(endMonday);
    start.setDate(start.getDate() - w * 7);
    const end = new Date(start);
    end.setDate(end.getDate() + 6);

    const feedVals: number[] = [];
    const diaperVals: number[] = [];
    let daysWithFeedIntervals = 0;
    let daysWithDiaperIntervals = 0;

    for (let dayIdx = 0; dayIdx < 7; dayIdx++) {
      const d = new Date(start);
      d.setDate(d.getDate() + dayIdx);
      const bucket = dailyMap.get(formatLocalDateYMD(d));
      if (!bucket) continue;

      if (bucket.feedIntervalsHours.length > 0) {
        feedVals.push(...bucket.feedIntervalsHours);
        daysWithFeedIntervals += 1;
      }
      if (bucket.diaperIntervalsHours.length > 0) {
        diaperVals.push(...bucket.diaperIntervalsHours);
        daysWithDiaperIntervals += 1;
      }
    }

    const startLabel = `${SHORT_MONTHS[start.getMonth()]} ${start.getDate()}`;
    const endLabel = `${SHORT_MONTHS[end.getMonth()]} ${end.getDate()}, ${end.getFullYear()}`;
    const key = formatLocalDateYMD(start);

    periods.push({
      key,
      label: startLabel,
      rangeLabel: `${startLabel} – ${endLabel}`,
      daysWithFeedIntervals,
      daysWithDiaperIntervals,
      feedStats: computeBoxPlotStats(feedVals),
      diaperStats: computeBoxPlotStats(diaperVals),
    });
  }

  return periods;
}

export function buildMonthlyRoutineIntervalBoxPlots(
  records: RoutineRecord[],
  span: MonthlySpanOption = 6,
  focusDate?: string
): PeriodRoutineIntervalBucket[] {
  const routineBucketMap = buildDailyRoutineBucketMap(records);
  const { dailyMap } = buildDailyRoutineIntervalSummary(records);
  const endDateStr = resolveRoutineFocusDate(routineBucketMap, focusDate);
  const endDate = parseLocalDateYMD(endDateStr);
  const endYear = endDate.getFullYear();
  const endMonth = endDate.getMonth();

  let monthCount: number;
  if (span === 'all') {
    const allDatesAsc = Array.from(
      new Set([...routineBucketMap.keys(), ...dailyMap.keys()])
    ).sort((a, b) => a.localeCompare(b));
    if (allDatesAsc.length === 0) {
      monthCount = 3;
    } else {
      const startDate = parseLocalDateYMD(allDatesAsc[0]);
      const diffMonths =
        (endYear - startDate.getFullYear()) * 12 + (endMonth - startDate.getMonth()) + 1;
      monthCount = Math.max(3, Math.min(24, diffMonths));
    }
  } else {
    monthCount = Math.max(1, span);
  }

  const bucketsByMonth = new Map<string, DailyRoutineIntervalBucket[]>();
  for (const [dateKey, bucket] of dailyMap.entries()) {
    const ym = dateKey.slice(0, 7);
    const list = bucketsByMonth.get(ym) ?? [];
    list.push(bucket);
    bucketsByMonth.set(ym, list);
  }

  const startAnchor = new Date(endYear, endMonth - (monthCount - 1), 1, 12, 0, 0, 0);
  const spansMultipleYears = startAnchor.getFullYear() !== endYear;

  const periods: PeriodRoutineIntervalBucket[] = [];

  for (let m = monthCount - 1; m >= 0; m--) {
    const monthDate = new Date(endYear, endMonth - m, 1, 12, 0, 0, 0);
    const y = monthDate.getFullYear();
    const mo = monthDate.getMonth();
    const key = `${y}-${String(mo + 1).padStart(2, '0')}`;
    const monthBuckets = bucketsByMonth.get(key) ?? [];

    const feedVals: number[] = [];
    const diaperVals: number[] = [];
    let daysWithFeedIntervals = 0;
    let daysWithDiaperIntervals = 0;

    for (const bucket of monthBuckets) {
      if (bucket.feedIntervalsHours.length > 0) {
        feedVals.push(...bucket.feedIntervalsHours);
        daysWithFeedIntervals += 1;
      }
      if (bucket.diaperIntervalsHours.length > 0) {
        diaperVals.push(...bucket.diaperIntervalsHours);
        daysWithDiaperIntervals += 1;
      }
    }

    const label = spansMultipleYears
      ? `${SHORT_MONTHS[mo]} '${String(y).slice(-2)}`
      : SHORT_MONTHS[mo];

    periods.push({
      key,
      label,
      rangeLabel: `${FULL_MONTHS[mo]} ${y}`,
      daysWithFeedIntervals,
      daysWithDiaperIntervals,
      feedStats: computeBoxPlotStats(feedVals),
      diaperStats: computeBoxPlotStats(diaperVals),
    });
  }

  return periods;
}



