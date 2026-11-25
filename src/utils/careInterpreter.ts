import { calculatePercentile } from '../data/growthStandards';
import { getProfileNumericId } from '../lib/entriesStorage';
import type { BabyMeasurement, ChildProfile, GrowthRecord, NoteRecord, RoutineRecord } from '../types';

export function doesRecordMatchProfile(
  record: { profile_id?: string | null; name?: string | null } | null | undefined,
  profile: ChildProfile | undefined
): boolean {
  if (!profile) return true;
  if (!record) return false;

  const recordProfileId = (record.profile_id ?? '').trim();
  if (recordProfileId) {
    return recordProfileId === profile.id.trim();
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

  const birthMs = new Date(profile.dateOfEvent).getTime();
  if (Number.isNaN(birthMs)) return babyMeasurements;

  const matchingGrowth = growthRecords.filter((g) => {
    if (g.daily_weight === null && g.daily_length === null) return false;
    return doesRecordMatchProfile(g, profile);
  });

  const merged: BabyMeasurement[] = [...babyMeasurements];

  for (const g of matchingGrowth) {
    const dateStr = getGrowthRecordDate(g);
    const alreadyExists = merged.some(
      (m) =>
        m.date === dateStr &&
        (g.daily_weight === null || m.weightKg === g.daily_weight) &&
        (g.daily_length === null || m.lengthCm === g.daily_length)
    );
    if (alreadyExists) continue;

    const recMs = new Date(`${dateStr}T12:00:00`).getTime();
    const diffDays = Number.isNaN(recMs)
      ? 0
      : Math.max(0, Math.floor((recMs - birthMs) / (1000 * 60 * 60 * 24)));
    const ageInMonths = Math.round((diffDays / 30.4375) * 10) / 10;
    const ageInWeeks = Math.round((diffDays / 7) * 10) / 10;

    merged.push({
      id: `supabase-growth-${g.id}`,
      profileId: profile.id,
      date: dateStr,
      ageInMonths,
      ageInWeeks,
      weightKg: g.daily_weight ?? undefined,
      lengthCm: g.daily_length ?? undefined,
      notes: g.remark ?? undefined,
    });
  }

  return merged.sort((a, b) => a.ageInMonths - b.ageInMonths);
}

export type TempSeverity = 'low' | 'normal' | 'elevated' | 'fever';

export interface TempClassification {
  severity: TempSeverity;
  label: string;
  guidance: string;
  fahrenheit: number;
}

export function classifyTemperature(tempC: number): TempClassification {
  const fahrenheit = Math.round((tempC * 9) / 5 + 32 * 10) / 10;
  const f = Math.round(((tempC * 9) / 5 + 32) * 10) / 10;
  void fahrenheit;

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
  weightDeltaGrams: number | null;
  weightVelocityGramsPerDay: number | null;
  weightPercentile: number | null;
  latestLengthCm: number | null;
  lengthDeltaCm: number | null;
  lengthPercentile: number | null;
  latestTempC: number | null;
  tempClass: TempClassification | null;
  minTempC: number | null;
  maxTempC: number | null;
  feverEpisodes: number;
  insights: string[];
}

function getProfileAgeMonths(profile: ChildProfile | undefined, referenceIso?: string): number | null {
  if (!profile || profile.type !== 'baby') return null;
  const birth = new Date(profile.dateOfEvent);
  const ref = referenceIso ? new Date(referenceIso) : new Date();
  if (Number.isNaN(birth.getTime()) || Number.isNaN(ref.getTime())) return null;
  const diffDays = Math.max(0, (ref.getTime() - birth.getTime()) / (1000 * 60 * 60 * 24));
  return Math.round((diffDays / 30.4375) * 10) / 10;
}

export function interpretGrowthTable(
  records: GrowthRecord[],
  profile?: ChildProfile
): GrowthInterpretation {
  // Sort chronological ascending by recorded date (falling back to created_at)
  const sorted = [...records].sort((a, b) => {
    const aKey = `${getGrowthRecordDate(a)}T${a.created_at.slice(11, 19)}`;
    const bKey = `${getGrowthRecordDate(b)}T${b.created_at.slice(11, 19)}`;
    return aKey.localeCompare(bKey);
  });

  const weightRows = sorted.filter((r) => r.daily_weight !== null && r.daily_weight > 0);
  const lengthRows = sorted.filter((r) => r.daily_length !== null && r.daily_length > 0);
  const tempRows = sorted.filter((r) => r.temperature !== null && r.temperature > 0);

  const latestWeightRow = weightRows[weightRows.length - 1];
  const prevWeightRow = weightRows.length >= 2 ? weightRows[weightRows.length - 2] : undefined;

  const latestWeightKg = latestWeightRow?.daily_weight ?? null;
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
  const latestLengthCm = latestLengthRow?.daily_length ?? null;
  const lengthDeltaCm =
    latestLengthRow && prevLengthRow && latestLengthRow.daily_length !== null && prevLengthRow.daily_length !== null
      ? Math.round((latestLengthRow.daily_length - prevLengthRow.daily_length) * 10) / 10
      : null;

  const ageMonthsForLength = latestLengthRow
    ? getProfileAgeMonths(profile, `${getGrowthRecordDate(latestLengthRow)}T12:00:00`)
    : null;
  const lengthPercentile =
    latestLengthCm !== null && ageMonthsForLength !== null && profile?.type === 'baby'
      ? calculatePercentile(latestLengthCm, ageMonthsForLength, 'length', profile.gender).percentile
      : null;

  const latestTempRow = tempRows[tempRows.length - 1];
  const latestTempC = latestTempRow?.temperature ?? null;
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
        `Latest daily weight is ${latestWeightKg.toFixed(2)} kg${pctText}, changing ${sign}${weightDeltaGrams} g since the prior entry${velText}.`
      );
    } else {
      insights.push(`Latest daily weight is ${latestWeightKg.toFixed(2)} kg${pctText}.`);
    }
  }

  if (latestLengthCm !== null) {
    const pctText = lengthPercentile !== null ? ` (~${lengthPercentile}th WHO percentile)` : '';
    const deltaText =
      lengthDeltaCm !== null
        ? ` (${lengthDeltaCm >= 0 ? '+' : ''}${lengthDeltaCm} cm from previous)`
        : '';
    insights.push(`Latest recorded length is ${latestLengthCm.toFixed(1)} cm${pctText}${deltaText}.`);
  }

  if (latestTempC !== null && tempClass) {
    insights.push(
      `Latest temperature is ${latestTempC.toFixed(1)}°C (${tempClass.fahrenheit}°F) — ${tempClass.label}. ${tempClass.guidance}`
    );
  }

  if (insights.length === 0) {
    insights.push('Log daily weight, length, or temperature entries to generate trend and WHO percentile interpretations.');
  }

  return {
    totalRecords: records.length,
    latestWeightKg,
    weightDeltaGrams,
    weightVelocityGramsPerDay,
    weightPercentile,
    latestLengthCm,
    lengthDeltaCm,
    lengthPercentile,
    latestTempC,
    tempClass,
    minTempC,
    maxTempC,
    feverEpisodes,
    insights,
  };
}

export interface DailyRoutineBucket {
  date: string;
  ebmMl: number;
  formulaMl: number;
  totalMl: number;
  feedCount: number;
  totalDurationMin: number;
  avgDurationMin: number | null;
  wetDiapers: number;
  dirtyDiapers: number;
  mixedDiapers: number;
  totalDiapers: number;
}

export interface RoutineInterpretation {
  activeDateLabel: string;
  isToday: boolean;
  todayBucket: DailyRoutineBucket;
  sevenDayAvgMl: number | null;
  ebmSharePct: number;
  formulaSharePct: number;
  avgMlPerFeed: number | null;
  estimatedTargetMl: number | null;
  targetMinMl: number | null;
  targetMaxMl: number | null;
  targetProgressPct: number | null;
  lastFeedLabel: string | null;
  dailySeries: DailyRoutineBucket[];
  insights: string[];
}

export function getRoutineRecordDate(record: RoutineRecord): string {
  if (record.date && /^\d{4}-\d{2}-\d{2}/.test(record.date)) {
    return record.date.slice(0, 10);
  }
  return record.created_at.slice(0, 10);
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
    totalDurationMin: 0,
    avgDurationMin: null,
    wetDiapers: 0,
    dirtyDiapers: 0,
    mixedDiapers: 0,
    totalDiapers: 0,
  };
}

export function interpretRoutineTable(
  records: RoutineRecord[],
  latestWeightKg: number | null
): RoutineInterpretation {
  const todayStr = new Date().toISOString().split('T')[0];
  const bucketMap = new Map<string, DailyRoutineBucket>();

  for (const r of records) {
    const dateKey = getRoutineRecordDate(r);
    const bucket = bucketMap.get(dateKey) ?? emptyBucket(dateKey);

    const ebm = Math.max(0, r['EBM (mL)'] ?? 0);
    const formula = Math.max(0, r['Formula (mL)'] ?? 0);
    const duration = Math.max(0, r['feed duration (min)'] ?? 0);

    bucket.ebmMl += ebm;
    bucket.formulaMl += formula;
    bucket.totalMl += ebm + formula;

    if (ebm > 0 || formula > 0 || duration > 0) {
      bucket.feedCount += 1;
    }
    if (duration > 0) {
      bucket.totalDurationMin += duration;
    }

    const diaperKind = classifyDiaperValue(r.Diaper);
    if (diaperKind === 'wet') {
      bucket.wetDiapers += 1;
      bucket.totalDiapers += 1;
    } else if (diaperKind === 'dirty') {
      bucket.dirtyDiapers += 1;
      bucket.totalDiapers += 1;
    } else if (diaperKind === 'mixed') {
      bucket.mixedDiapers += 1;
      bucket.totalDiapers += 1;
    } else if (r.Diaper && r.Diaper.trim().length > 0 && r.Diaper.trim().toLowerCase() !== 'dry') {
      bucket.totalDiapers += 1;
    }

    bucketMap.set(dateKey, bucket);
  }

  for (const bucket of bucketMap.values()) {
    bucket.avgDurationMin =
      bucket.feedCount > 0 && bucket.totalDurationMin > 0
        ? Math.round(bucket.totalDurationMin / bucket.feedCount)
        : null;
  }

  const allDatesDesc = Array.from(bucketMap.keys()).sort((a, b) => b.localeCompare(a));
  const hasToday = bucketMap.has(todayStr);
  const focusDate = hasToday ? todayStr : allDatesDesc[0] ?? todayStr;
  const todayBucket = bucketMap.get(focusDate) ?? emptyBucket(focusDate);

  // Build 7-day series ending on focusDate (or latest 7 recorded days if sparser)
  const dailySeries: DailyRoutineBucket[] = [];
  const endDate = new Date(`${focusDate}T12:00:00`);
  for (let i = 6; i >= 0; i--) {
    const d = new Date(endDate);
    d.setDate(d.getDate() - i);
    const key = d.toISOString().split('T')[0];
    dailySeries.push(bucketMap.get(key) ?? emptyBucket(key));
  }

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

  // Weight-based infant fluid target (~150 mL/kg/day, typical range 120–180 mL/kg/day, capped reasonably around 950–1000 mL for older infants)
  const estimatedTargetMl =
    latestWeightKg && latestWeightKg > 0
      ? Math.min(1000, Math.round(latestWeightKg * 150))
      : null;
  const targetMinMl =
    latestWeightKg && latestWeightKg > 0
      ? Math.min(850, Math.round(latestWeightKg * 120))
      : null;
  const targetMaxMl =
    latestWeightKg && latestWeightKg > 0
      ? Math.min(1100, Math.round(latestWeightKg * 180))
      : null;
  const targetProgressPct =
    estimatedTargetMl && estimatedTargetMl > 0
      ? Math.min(150, Math.round((todayBucket.totalMl / estimatedTargetMl) * 100))
      : null;

  // Latest feeding timestamp label
  const feedRecords = records.filter(
    (r) => (r['EBM (mL)'] ?? 0) > 0 || (r['Formula (mL)'] ?? 0) > 0 || (r['feed duration (min)'] ?? 0) > 0
  );
  let lastFeedLabel: string | null = null;
  if (feedRecords.length > 0) {
    const latestFeed = [...feedRecords].sort((a, b) => {
      const aKey = `${getRoutineRecordDate(a)}T${a.time || a.created_at.slice(11, 19)}`;
      const bKey = `${getRoutineRecordDate(b)}T${b.time || b.created_at.slice(11, 19)}`;
      return bKey.localeCompare(aKey);
    })[0];
    const vol = (latestFeed['EBM (mL)'] ?? 0) + (latestFeed['Formula (mL)'] ?? 0);
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

    if (estimatedTargetMl && targetMinMl && targetMaxMl) {
      if (todayBucket.totalMl >= targetMinMl && todayBucket.totalMl <= targetMaxMl) {
        insights.push(
          `Intake is right within the weight-calibrated daily target band (${targetMinMl}–${targetMaxMl} mL/day based on ${latestWeightKg?.toFixed(2)} kg).`
        );
      } else if (todayBucket.totalMl < targetMinMl) {
        insights.push(
          `Currently at ${targetProgressPct}% of the ~${estimatedTargetMl} mL weight-based daily estimate (${targetMinMl}–${targetMaxMl} mL range).`
        );
      } else {
        insights.push(
          `Intake exceeds the typical ~${estimatedTargetMl} mL daily benchmark — common during growth spurts.`
        );
      }
    }
  }

  if (todayBucket.totalDiapers > 0) {
    const hydrationNote =
      effectiveWetCount >= 6
        ? 'Healthy hydration output (≥6 wet/mixed diapers).'
        : 'Continue monitoring wet diaper output toward the typical ≥6/day hydration benchmark.';
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
    estimatedTargetMl,
    targetMinMl,
    targetMaxMl,
    targetProgressPct,
    lastFeedLabel,
    dailySeries,
    insights,
  };
}
