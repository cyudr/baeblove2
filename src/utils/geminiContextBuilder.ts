import type {
  BabyMeasurement,
  ChildProfile,
  FetalMeasurement,
  GrowthRecord,
  NoteRecord,
  RoutineRecord,
  UnitSystem,
} from '../types';
import {
  formatDiaperLoad,
  getGrowthRecordDate,
  getRoutineRecordDate,
  interpretGrowthTable,
  interpretRoutineTable,
} from './careInterpreter';
import {
  computeExactAgeFromBirth,
  formatAgeFromBirthDate,
  getLocalTodayDateStr,
} from './ageCalculator';
import { calculateGestationalAge } from '../data/fetalStandards';
import { calculatePercentile } from '../data/growthStandards';

export type GeminiChatFocus = 'growth' | 'routine';

export interface GeminiContextInput {
  focus: GeminiChatFocus;
  activeProfile: ChildProfile | undefined;
  unitSystem: UnitSystem;
  growthRecords: GrowthRecord[];
  routineRecords: RoutineRecord[];
  noteRecords: NoteRecord[];
  babyMeasurements: BabyMeasurement[];
  fetalMeasurements: FetalMeasurement[];
}

export function buildGeminiSystemInstruction(input: GeminiContextInput): string {
  const {
    focus,
    activeProfile,
    unitSystem,
    growthRecords,
    routineRecords,
    noteRecords,
    babyMeasurements,
    fetalMeasurements,
  } = input;

  const today = getLocalTodayDateStr();
  const lines: string[] = [];

  lines.push(
    'You are a knowledgeable, warm pediatric and maternal care data assistant embedded inside BaeLove (a baby & fetal growth and daily routine tracker).'
  );
  lines.push(
    `The user opened this chat from the ${focus === 'growth' ? 'Growth Tracking & WHO Curves' : 'Routine Data Logging (Feeding & Diapers)'} section.`
  );
  lines.push(
    'Answer concisely, clearly, and directly using the exact loaded data below. Cite specific dates, numbers, trends, and percentiles from the loaded records when helpful. Always distinguish between observed data trends and general pediatric guidance, and remind parents to consult their pediatrician for medical decisions or urgent symptoms (such as fever in a young infant, dehydration, or sudden weight loss). Keep formatting clean with short paragraphs or bullet points.'
  );
  lines.push('');
  lines.push(`=== CURRENT DATE & PREFERENCES ===`);
  lines.push(`Today: ${today}`);
  lines.push(`Preferred Display Unit System: ${unitSystem}`);

  lines.push('');
  lines.push('=== ACTIVE PROFILE ===');
  if (activeProfile) {
    lines.push(`Name: ${activeProfile.name}`);
    lines.push(`Type: ${activeProfile.type}`);
    lines.push(`Gender: ${activeProfile.gender}`);
    if (activeProfile.type === 'baby') {
      const currentAge = formatAgeFromBirthDate(activeProfile.dateOfEvent, today);
      const exactAge = computeExactAgeFromBirth(activeProfile.dateOfEvent, today);
      lines.push(`Birthday: ${activeProfile.dateOfEvent}`);
      if (currentAge && exactAge) {
        lines.push(
          `Current Age: ${currentAge} (${exactAge.totalDays} days / ${exactAge.exactWeeks.toFixed(1)} weeks / ${exactAge.exactMonths.toFixed(2)} months)`
        );
      }
      if (activeProfile.birthWeightKg) lines.push(`Birth Weight: ${activeProfile.birthWeightKg} kg`);
      if (activeProfile.birthLengthCm) lines.push(`Birth Length: ${activeProfile.birthLengthCm} cm`);
      if (activeProfile.birthHeadCircumferenceCm) {
        lines.push(`Birth Head Circumference: ${activeProfile.birthHeadCircumferenceCm} cm`);
      }
    } else {
      const ga = calculateGestationalAge(activeProfile.dateOfEvent);
      lines.push(`Estimated Due Date: ${activeProfile.dateOfEvent}`);
      lines.push(`Current Gestational Age: ${ga.weeks}w ${ga.days}d`);
    }
    if (activeProfile.notes) lines.push(`Profile Notes: ${activeProfile.notes}`);
  } else {
    lines.push('No active child/pregnancy profile selected.');
  }

  // Growth summary + rows
  const growthSummary = interpretGrowthTable(growthRecords, activeProfile);
  lines.push('');
  lines.push(`=== LOADED GROWTH DATA (${growthRecords.length} daily records) ===`);
  if (growthRecords.length > 0) {
    lines.push(
      `Summary: latestWeight=${growthSummary.latestWeightKg !== null ? `${growthSummary.latestWeightKg} kg` : 'n/a'}` +
        `${growthSummary.weightPercentile !== null ? ` (${growthSummary.weightPercentile}th WHO %ile)` : ''}` +
        `${growthSummary.weightVelocityGramsPerDay !== null ? `, velocity=${growthSummary.weightVelocityGramsPerDay} g/day` : ''}` +
        `; latestLength=${growthSummary.latestLengthCm !== null ? `${growthSummary.latestLengthCm} cm` : 'n/a'}` +
        `${growthSummary.lengthPercentile !== null ? ` (${growthSummary.lengthPercentile}th WHO %ile)` : ''}` +
        `; latestTemp=${growthSummary.latestTempC !== null ? `${growthSummary.latestTempC}°C` : 'n/a'}` +
        `${growthSummary.feverEpisodes > 0 ? `, feverLogs=${growthSummary.feverEpisodes}` : ''}`
    );

    const recentGrowth = growthRecords.slice(0, 40);
    lines.push('Recent daily growth rows (newest first):');
    for (const g of recentGrowth) {
      const d = getGrowthRecordDate(g);
      const t = g.time ? g.time.slice(0, 5) : '';
      const dateTimeLabel = t ? `${d} ${t}` : d;
      const age =
        activeProfile?.type === 'baby'
          ? formatAgeFromBirthDate(activeProfile.dateOfEvent, d, true)
          : null;
      const parts: string[] = [age ? `${dateTimeLabel} (age ${age})` : dateTimeLabel];
      if (g.daily_weight !== null) parts.push(`weight=${g.daily_weight}kg`);
      if (g.daily_length !== null) parts.push(`length=${g.daily_length}cm`);
      if (g.temperature !== null) parts.push(`temp=${g.temperature}°C`);
      if (g.remark) parts.push(`remark="${g.remark}"`);
      if (g.name) parts.push(`by=${g.name}`);
      lines.push(`- ${parts.join(' | ')}`);
    }
  } else {
    lines.push('No daily growth records loaded.');
  }

  // Pediatric / Ultrasound clinical measurements
  if (activeProfile?.type === 'baby' && babyMeasurements.length > 0) {
    lines.push('');
    lines.push(`=== PEDIATRIC CHECKUP MEASUREMENTS (${babyMeasurements.length} records) ===`);
    for (const m of babyMeasurements.slice(-25)) {
      const exact = computeExactAgeFromBirth(activeProfile.dateOfEvent, m.date);
      const ageLabel = formatAgeFromBirthDate(activeProfile.dateOfEvent, m.date, true);
      const exactMonths = exact ? exact.exactMonths : m.ageInMonths;
      const parts: string[] = [ageLabel ? `${m.date} (age ${ageLabel})` : m.date];
      if (m.weightKg !== undefined) {
        const pct = calculatePercentile(m.weightKg, exactMonths, 'weight', activeProfile.gender).percentile;
        parts.push(`weight=${m.weightKg}kg (${pct}th %ile)`);
      }
      if (m.lengthCm !== undefined) {
        const pct = calculatePercentile(m.lengthCm, exactMonths, 'length', activeProfile.gender).percentile;
        parts.push(`length=${m.lengthCm}cm (${pct}th %ile)`);
      }
      if (m.headCircumferenceCm !== undefined) {
        const pct = calculatePercentile(
          m.headCircumferenceCm,
          exactMonths,
          'headCircumference',
          activeProfile.gender
        ).percentile;
        parts.push(`HC=${m.headCircumferenceCm}cm (${pct}th %ile)`);
      }
      if (m.notes) parts.push(`notes="${m.notes}"`);
      lines.push(`- ${parts.join(' | ')}`);
    }
  } else if (activeProfile?.type === 'fetal' && fetalMeasurements.length > 0) {
    lines.push('');
    lines.push(`=== FETAL ULTRASOUND MEASUREMENTS (${fetalMeasurements.length} records) ===`);
    for (const m of fetalMeasurements.slice(-25)) {
      const parts: string[] = [`${m.date} (GA ${m.gestationalWeeks}w${m.gestationalDays}d)`];
      if (m.efwGrams !== undefined) parts.push(`EFW=${m.efwGrams}g`);
      if (m.bpdMm !== undefined) parts.push(`BPD=${m.bpdMm}mm`);
      if (m.hcMm !== undefined) parts.push(`HC=${m.hcMm}mm`);
      if (m.acMm !== undefined) parts.push(`AC=${m.acMm}mm`);
      if (m.flMm !== undefined) parts.push(`FL=${m.flMm}mm`);
      if (m.notes) parts.push(`notes="${m.notes}"`);
      lines.push(`- ${parts.join(' | ')}`);
    }
  }

  // Routine summary + rows
  const latestWeightForTarget =
    growthSummary.latestWeightKg ??
    babyMeasurements[babyMeasurements.length - 1]?.weightKg ??
    activeProfile?.birthWeightKg ??
    null;
  const routineSummary = interpretRoutineTable(
    routineRecords,
    latestWeightForTarget,
    undefined,
    activeProfile?.type === 'baby' ? activeProfile.dateOfEvent : null
  );
  lines.push('');
  lines.push(`=== LOADED ROUTINE DATA (${routineRecords.length} records) ===`);
  lines.push('Stool Legend: M = Meconium, G = Greenish, GY = Greenish Yellow, Y = Yellow. Diaper load is x1, x2, x3...');
  if (routineRecords.length > 0) {
    const tb = routineSummary.todayBucket;
    lines.push(
      `Latest Day (${tb.date}): totalMilk=${tb.totalMl}mL ` +
        `(EBM=${tb.ebmMl}mL, Formula=${tb.formulaMl}mL), ` +
        `feeds=${tb.feedCount}, avgDuration=${tb.avgDurationMin ?? 'n/a'}min, ` +
        `diapers=${tb.totalDiapers} (wet=${tb.wetDiapers}, mixed=${tb.mixedDiapers}, wetPlusMixed=${tb.wetDiapers + tb.mixedDiapers}/6 hydration benchmark, dirty=${tb.dirtyDiapers})` +
        `${routineSummary.targetMinMl !== null && routineSummary.targetMaxMl !== null ? `, estimatedDailyTarget=${routineSummary.targetMinMl}–${routineSummary.targetMaxMl}mL` : ''}` +
        `${routineSummary.estimatedTargetMl !== null ? ` (target=${routineSummary.estimatedTargetMl}mL)` : ''}`
    );

    if (routineSummary.dailySeries.length > 0) {
      lines.push('Recent daily totals:');
      for (const day of routineSummary.dailySeries) {
        lines.push(
          `- ${day.date}: total=${day.totalMl}mL (EBM=${day.ebmMl}mL, Formula=${day.formulaMl}mL), feeds=${day.feedCount}, diapers=${day.totalDiapers} (wet=${day.wetDiapers}, mixed=${day.mixedDiapers}, wetPlusMixed=${day.wetDiapers + day.mixedDiapers}, dirty=${day.dirtyDiapers})`
        );
      }
    }

    const recentRoutine = routineRecords.slice(0, 60);
    lines.push('Recent routine rows (newest first):');
    for (const r of recentRoutine) {
      const d = getRoutineRecordDate(r);
      const t = r.time ? r.time.slice(0, 5) : '';
      const parts: string[] = [t ? `${d} ${t}` : d];
      if (r.emb_mL !== null) parts.push(`EBM=${r.emb_mL}mL`);
      if (r.formula_mL !== null) parts.push(`Formula=${r.formula_mL}mL`);
      if (r.feed_duration_min !== null) parts.push(`duration=${r.feed_duration_min}min`);
      if (r.feeding_method) parts.push(`method=${r.feeding_method}`);
      if (r.diaper) parts.push(`diaper=${r.diaper}`);
      if (r['diaper load'] !== null && r['diaper load'] !== undefined) {
        parts.push(`load=${formatDiaperLoad(r['diaper load'])}`);
      }
      if (r.stool) parts.push(`stool=${r.stool}`);
      if (r.remark) parts.push(`remark="${r.remark}"`);
      if (r.name) parts.push(`by=${r.name}`);
      lines.push(`- ${parts.join(' | ')}`);
    }
  } else {
    lines.push('No routine records loaded.');
  }

  // Notes (optional context)
  if (noteRecords.length > 0) {
    lines.push('');
    lines.push(`=== RECENT CARE NOTES (${Math.min(10, noteRecords.length)} of ${noteRecords.length}) ===`);
    for (const n of noteRecords.slice(0, 10)) {
      const dateStr = n.created_at.slice(0, 10);
      const body = [n.notes, n.remark ? `(remark: ${n.remark})` : ''].filter(Boolean).join(' ');
      if (body) lines.push(`- ${dateStr}: ${body}`);
    }
  }

  return lines.join('\n');
}
