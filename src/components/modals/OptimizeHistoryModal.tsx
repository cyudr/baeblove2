import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  ArrowRight,
  Check,
  CheckCircle2,
  Droplets,
  Loader2,
  RefreshCw,
  Scale,
  Sparkles,
  Wand2,
  X,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { EditAuthModal } from './EditAuthModal';
import {
  formatDiaperLoad,
  formatFeedingMethodLabel,
  getGrowthRecordDate,
  getRoutineRecordDate,
  normalizeFeedingMethod,
  normalizeRoutineTimeHHMM,
  normalizeStoolValue,
  parseDiaperLoadCount,
} from '../../utils/careInterpreter';
import type {
  GrowthRecord,
  NewGrowthRecordInput,
  NewRoutineRecordInput,
  RoutineRecord,
} from '../../types';

export type OptimizeScope = 'both' | 'routine' | 'growth';

interface OptimizeHistoryModalProps {
  isOpen: boolean;
  initialScope?: OptimizeScope;
  routineRecords: RoutineRecord[];
  growthRecords: GrowthRecord[];
  onClose: () => void;
}

interface FieldDiff {
  field: string;
  label: string;
  before: string;
  after: string;
}

interface RoutineSuggestion {
  kind: 'routine';
  key: string;
  id: number;
  date: string;
  time: string;
  reason: string;
  selected: boolean;
  updates: NewRoutineRecordInput;
  diffs: FieldDiff[];
}

interface GrowthSuggestion {
  kind: 'growth';
  key: string;
  id: number;
  date: string;
  time: string;
  reason: string;
  selected: boolean;
  updates: NewGrowthRecordInput;
  diffs: FieldDiff[];
}

type OptimizationSuggestion = RoutineSuggestion | GrowthSuggestion;

const BATCH_SIZE = 45;

const OPTIMIZE_RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    summary: {
      type: 'STRING',
      description: 'Concise 1-2 sentence summary of suggested cleanups and data moved from remarks.',
    },
    routineEdits: {
      type: 'ARRAY',
      description: 'Suggested edits for routine records that actually need changes. Omit rows with no improvements.',
      items: {
        type: 'OBJECT',
        properties: {
          id: { type: 'INTEGER', description: 'Exact numeric id of the existing routine record.' },
          reason: {
            type: 'STRING',
            description: 'Short explanation of what was standardized or moved from remark.',
          },
          time: { type: 'STRING', nullable: true, description: 'Normalized 24h HH:MM time (or keep existing).' },
          emb_mL: { type: 'INTEGER', nullable: true, description: 'Expressed breast milk in integer mL.' },
          formula_mL: { type: 'INTEGER', nullable: true, description: 'Formula in integer mL.' },
          feed_duration_min: { type: 'INTEGER', nullable: true, description: 'Feed duration in integer minutes.' },
          feeding_method: {
            type: 'STRING',
            nullable: true,
            description: 'One of "bottle", "latch", "cup", "stringe", or null.',
          },
          diaper: { type: 'STRING', nullable: true, description: '"Wet", "Dirty", "Mixed", or concise label, or null.' },
          diaper_load: { type: 'INTEGER', nullable: true, description: 'Positive integer diaper load count (e.g. 1, 2, 3) or null.' },
          stool: { type: 'STRING', nullable: true, description: 'Stool color code ONLY: "M", "G", "GY", "Y", or null.' },
          name: { type: 'STRING', nullable: true, description: 'Consistent caregiver logger name, or null.' },
          remark: {
            type: 'STRING',
            nullable: true,
            description: 'Cleaned remaining remark after removing data moved to dedicated columns, or null if nothing remains.',
          },
        },
        required: [
          'id',
          'reason',
          'time',
          'emb_mL',
          'formula_mL',
          'feed_duration_min',
          'feeding_method',
          'diaper',
          'diaper_load',
          'stool',
          'name',
          'remark',
        ],
      },
    },
    growthEdits: {
      type: 'ARRAY',
      description: 'Suggested edits for growth records that actually need changes. Omit rows with no improvements.',
      items: {
        type: 'OBJECT',
        properties: {
          id: { type: 'INTEGER', description: 'Exact numeric id of the existing growth record.' },
          reason: {
            type: 'STRING',
            description: 'Short explanation of what was standardized or moved from remark.',
          },
          time: { type: 'STRING', nullable: true, description: 'Normalized 24h HH:MM time (or keep existing).' },
          daily_weight: { type: 'NUMBER', nullable: true, description: 'Weight in kg (up to 3 decimals) or null.' },
          daily_length: { type: 'NUMBER', nullable: true, description: 'Length in cm (up to 1 decimal) or null.' },
          temperature: { type: 'NUMBER', nullable: true, description: 'Body temperature in °C (up to 1 decimal) or null.' },
          name: { type: 'STRING', nullable: true, description: 'Consistent caregiver logger name, or null.' },
          remark: {
            type: 'STRING',
            nullable: true,
            description: 'Cleaned remaining remark after removing data moved to dedicated columns, or null if nothing remains.',
          },
        },
        required: ['id', 'reason', 'time', 'daily_weight', 'daily_length', 'temperature', 'name', 'remark'],
      },
    },
  },
  required: ['summary', 'routineEdits', 'growthEdits'],
};

const OPTIMIZE_SYSTEM_INSTRUCTION = [
  'You are a careful baby-care database auditor and data-cleaning assistant.',
  'Review the provided Routine and/or Growth records and suggest ONLY genuine, high-confidence edits for:',
  '1) Moving structured data trapped inside `remark` into the proper columns (and removing the moved fragment from `remark`, keeping any remaining qualitative observation; set `remark` to null if nothing remains).',
  '2) Standardizing inconsistent values across records while preserving exact clinical meaning.',
  '',
  'ROUTINE column rules:',
  '- time: 24-hour HH:MM (e.g. "07:30", "19:45"). Extract time from remark only if `time` is null/empty.',
  '- emb_mL / formula_mL: integer mL. Extract from remark (e.g. "EBM 90ml", "BM 80", "FM 60ml", "3 oz formula" -> 89) when column is missing. Never overwrite an existing non-null volume unless clearly a typo/duplicate note.',
  '- feed_duration_min: integer minutes (e.g. "20 min latch" -> 20).',
  '- feeding_method: strictly one of "bottle", "latch", "cup", "stringe", or null. Infer "bottle" when emb_mL/formula_mL is present and method is missing, or "latch" when only feed_duration_min is present and method is missing. Move method words ("direct latch", "bottle fed", "syringe", "cup") out of remark.',
  '- diaper: standardize synonyms/casing ("wet", "pee", "urine" -> "Wet"; "dirty", "poop", "poo", "stool" -> "Dirty"; "both", "wet & dirty", "pee+poop" -> "Mixed"). Extract from remark when diaper is null.',
  '- stool: ONLY valid stool color codes: "M" (Meconium), "G" (Greenish), "GY" (Greenish Yellow), "Y" (Yellow). Strip any "x1"/"x2"/"2x" multiplier from stool and place that integer into `diaper_load`.',
  '- diaper_load: positive integer count (1, 2, 3, ...). Set to 1 if diaper or stool is present and diaper_load is null, or extract multiplier ("x2", "2x", "heavy x3") from stool/remark.',
  '- name: standardize inconsistent capitalization/whitespace of caregiver logger names across rows (e.g. "mom" -> "Mom" if "Mom" is the predominant casing). Do NOT invent a logger name if null.',
  '',
  'GROWTH column rules:',
  '- time: 24-hour HH:MM. Extract from remark if time is null and remark explicitly mentions a measurement time (e.g. "weighed at 08:30", "8am").',
  '- daily_weight: weight in kg (up to 3 decimals). Extract from remark (e.g. "4.525kg", "4525g" -> 4.525) if daily_weight is null, OR convert an obvious gram entry (> 50, e.g. 4520 -> 4.52) to kg.',
  '- daily_length: length in cm (1 decimal). Extract from remark if daily_length is null.',
  '- temperature: body temperature in °C (1 decimal). Extract from remark if temperature is null, OR convert an obvious Fahrenheit entry (> 45, e.g. 98.6 -> 37.0) to °C.',
  '- name: standardize caregiver name capitalization across rows. Do NOT invent a name if null.',
  '',
  'STRICT RULES:',
  '- Only include records in `routineEdits` or `growthEdits` that have at least one actual field improvement.',
  '- For EVERY edit object you return, populate ALL schema fields with the complete target value for that row (keep unchanged columns identical to their original values; never accidentally blank out existing columns).',
  '- Do NOT fabricate measurements or alter dates. Never drop meaningful parent observations from `remark`.',
].join('\n');

function toNullableCleanText(val: unknown): string | null {
  if (typeof val !== 'string') return null;
  const t = val.trim();
  return t.length > 0 ? t : null;
}

function toNullableCleanInt(val: unknown): number | null {
  if (val === null || val === undefined || val === '') return null;
  const n = Number(val);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n);
}

function toNullableCleanFloat(val: unknown, decimals: number): number | null {
  if (val === null || val === undefined || val === '') return null;
  const n = Number(val);
  if (!Number.isFinite(n) || n <= 0) return null;
  const factor = Math.pow(10, decimals);
  return Math.round(n * factor) / factor;
}

function formatDiffVal(val: string | number | null | undefined, suffix = ''): string {
  if (val === null || val === undefined || val === '') return '—';
  return suffix ? `${val}${suffix}` : String(val);
}

function buildRoutineSuggestion(
  rawEdit: Record<string, unknown>,
  byId: Map<number, RoutineRecord>
): RoutineSuggestion | null {
  const id = Number(rawEdit.id);
  const existing = byId.get(id);
  if (!existing) return null;

  const updates: NewRoutineRecordInput = {};
  const diffs: FieldDiff[] = [];

  // time
  const oldTime = normalizeRoutineTimeHHMM(existing.time) || null;
  const newTime = normalizeRoutineTimeHHMM(typeof rawEdit.time === 'string' ? rawEdit.time : null) || null;
  if (newTime !== oldTime && !(oldTime && !newTime)) {
    updates.time = newTime;
    diffs.push({
      field: 'time',
      label: 'Time',
      before: formatDiffVal(oldTime),
      after: formatDiffVal(newTime),
    });
  }

  // emb_mL
  const oldEbm = existing.emb_mL;
  const newEbm = toNullableCleanInt(rawEdit.emb_mL);
  if (newEbm !== oldEbm) {
    updates.emb_mL = newEbm;
    diffs.push({
      field: 'emb_mL',
      label: 'EBM (mL)',
      before: formatDiffVal(oldEbm, ' mL'),
      after: formatDiffVal(newEbm, ' mL'),
    });
  }

  // formula_mL
  const oldFormula = existing.formula_mL;
  const newFormula = toNullableCleanInt(rawEdit.formula_mL);
  if (newFormula !== oldFormula) {
    updates.formula_mL = newFormula;
    diffs.push({
      field: 'formula_mL',
      label: 'Formula (mL)',
      before: formatDiffVal(oldFormula, ' mL'),
      after: formatDiffVal(newFormula, ' mL'),
    });
  }

  // feed_duration_min
  const oldDur = existing.feed_duration_min;
  const newDur = toNullableCleanInt(rawEdit.feed_duration_min);
  if (newDur !== oldDur) {
    updates.feed_duration_min = newDur;
    diffs.push({
      field: 'feed_duration_min',
      label: 'Duration',
      before: formatDiffVal(oldDur, ' min'),
      after: formatDiffVal(newDur, ' min'),
    });
  }

  // feeding_method
  const oldMethod = normalizeFeedingMethod(existing.feeding_method) || null;
  const newMethod =
    normalizeFeedingMethod(typeof rawEdit.feeding_method === 'string' ? rawEdit.feeding_method : null) ||
    null;
  if (newMethod !== oldMethod) {
    updates.feeding_method = newMethod;
    diffs.push({
      field: 'feeding_method',
      label: 'Method',
      before: oldMethod ? formatFeedingMethodLabel(oldMethod) : '—',
      after: newMethod ? formatFeedingMethodLabel(newMethod) : '—',
    });
  }

  // diaper
  const oldDiaper = toNullableCleanText(existing.diaper);
  const newDiaper = toNullableCleanText(rawEdit.diaper);
  if (newDiaper !== oldDiaper) {
    updates.diaper = newDiaper;
    diffs.push({
      field: 'diaper',
      label: 'Diaper',
      before: formatDiffVal(oldDiaper),
      after: formatDiffVal(newDiaper),
    });
  }

  // diaper load
  const oldLoad = existing['diaper load'];
  const rawLoad = rawEdit.diaper_load;
  const parsedLoad =
    rawLoad !== null && rawLoad !== undefined && rawLoad !== ''
      ? parseDiaperLoadCount(typeof rawLoad === 'number' ? rawLoad : String(rawLoad), 0)
      : null;
  const newLoad = parsedLoad && parsedLoad >= 1 ? parsedLoad : null;
  if (newLoad !== oldLoad) {
    updates['diaper load'] = newLoad;
    diffs.push({
      field: 'diaper load',
      label: 'Diaper Load',
      before: oldLoad !== null ? formatDiaperLoad(oldLoad) : '—',
      after: newLoad !== null ? formatDiaperLoad(newLoad) : '—',
    });
  }

  // stool
  const oldStool = normalizeStoolValue(existing.stool) || toNullableCleanText(existing.stool);
  const rawStoolStr = toNullableCleanText(rawEdit.stool);
  const newStool = rawStoolStr ? normalizeStoolValue(rawStoolStr) || null : null;
  if (newStool !== oldStool) {
    updates.stool = newStool;
    diffs.push({
      field: 'stool',
      label: 'Stool',
      before: formatDiffVal(oldStool),
      after: formatDiffVal(newStool),
    });
  }

  // name
  const oldName = toNullableCleanText(existing.name);
  const newName = toNullableCleanText(rawEdit.name);
  if (newName !== oldName && !(oldName && !newName)) {
    updates.name = newName;
    diffs.push({
      field: 'name',
      label: 'Logged By',
      before: formatDiffVal(oldName),
      after: formatDiffVal(newName),
    });
  }

  // remark
  const oldRemark = toNullableCleanText(existing.remark);
  const newRemark = toNullableCleanText(rawEdit.remark);
  if (newRemark !== oldRemark) {
    updates.remark = newRemark;
    diffs.push({
      field: 'remark',
      label: 'Remark',
      before: formatDiffVal(oldRemark),
      after: formatDiffVal(newRemark),
    });
  }

  if (diffs.length === 0) return null;

  return {
    kind: 'routine',
    key: `routine-${id}`,
    id,
    date: getRoutineRecordDate(existing),
    time: oldTime || newTime || '',
    reason: toNullableCleanText(rawEdit.reason) || 'Standardized fields for consistency',
    selected: true,
    updates,
    diffs,
  };
}

function buildGrowthSuggestion(
  rawEdit: Record<string, unknown>,
  byId: Map<number, GrowthRecord>
): GrowthSuggestion | null {
  const id = Number(rawEdit.id);
  const existing = byId.get(id);
  if (!existing) return null;

  const updates: NewGrowthRecordInput = {};
  const diffs: FieldDiff[] = [];

  // time
  const oldTime = normalizeRoutineTimeHHMM(existing.time) || null;
  const newTime = normalizeRoutineTimeHHMM(typeof rawEdit.time === 'string' ? rawEdit.time : null) || null;
  if (newTime !== oldTime && !(oldTime && !newTime)) {
    updates.time = newTime;
    diffs.push({
      field: 'time',
      label: 'Time',
      before: formatDiffVal(oldTime),
      after: formatDiffVal(newTime),
    });
  }

  // daily_weight
  const oldWeight = existing.daily_weight;
  const newWeight = toNullableCleanFloat(rawEdit.daily_weight, 3);
  const weightChanged =
    (oldWeight === null) !== (newWeight === null) ||
    (oldWeight !== null && newWeight !== null && Math.abs(oldWeight - newWeight) >= 0.0005);
  if (weightChanged) {
    updates.daily_weight = newWeight;
    diffs.push({
      field: 'daily_weight',
      label: 'Weight',
      before: formatDiffVal(oldWeight, ' kg'),
      after: formatDiffVal(newWeight, ' kg'),
    });
  }

  // daily_length
  const oldLength = existing.daily_length;
  const newLength = toNullableCleanFloat(rawEdit.daily_length, 1);
  const lengthChanged =
    (oldLength === null) !== (newLength === null) ||
    (oldLength !== null && newLength !== null && Math.abs(oldLength - newLength) >= 0.05);
  if (lengthChanged) {
    updates.daily_length = newLength;
    diffs.push({
      field: 'daily_length',
      label: 'Length',
      before: formatDiffVal(oldLength, ' cm'),
      after: formatDiffVal(newLength, ' cm'),
    });
  }

  // temperature
  const oldTemp = existing.temperature;
  const newTemp = toNullableCleanFloat(rawEdit.temperature, 1);
  const tempChanged =
    (oldTemp === null) !== (newTemp === null) ||
    (oldTemp !== null && newTemp !== null && Math.abs(oldTemp - newTemp) >= 0.05);
  if (tempChanged) {
    updates.temperature = newTemp;
    diffs.push({
      field: 'temperature',
      label: 'Temperature',
      before: formatDiffVal(oldTemp, '°C'),
      after: formatDiffVal(newTemp, '°C'),
    });
  }

  // name
  const oldName = toNullableCleanText(existing.name);
  const newName = toNullableCleanText(rawEdit.name);
  if (newName !== oldName && !(oldName && !newName)) {
    updates.name = newName;
    diffs.push({
      field: 'name',
      label: 'Logged By',
      before: formatDiffVal(oldName),
      after: formatDiffVal(newName),
    });
  }

  // remark
  const oldRemark = toNullableCleanText(existing.remark);
  const newRemark = toNullableCleanText(rawEdit.remark);
  if (newRemark !== oldRemark) {
    updates.remark = newRemark;
    diffs.push({
      field: 'remark',
      label: 'Remark',
      before: formatDiffVal(oldRemark),
      after: formatDiffVal(newRemark),
    });
  }

  if (diffs.length === 0) return null;

  return {
    kind: 'growth',
    key: `growth-${id}`,
    id,
    date: getGrowthRecordDate(existing),
    time: oldTime || newTime || '',
    reason: toNullableCleanText(rawEdit.reason) || 'Standardized fields for consistency',
    selected: true,
    updates,
    diffs,
  };
}

export const OptimizeHistoryModal: React.FC<OptimizeHistoryModalProps> = ({
  isOpen,
  initialScope = 'both',
  routineRecords,
  growthRecords,
  onClose,
}) => {
  const { editRoutineRecord, editGrowthRecord } = useApp();

  const [scope, setScope] = useState<OptimizeScope>(initialScope);
  const [rowLimit, setRowLimit] = useState<'60' | '120' | 'all'>('60');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisProgress, setAnalysisProgress] = useState<string | null>(null);
  const [hasAnalyzed, setHasAnalyzed] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<OptimizationSuggestion[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [applySuccessMsg, setApplySuccessMsg] = useState<string | null>(null);
  const [isApplying, setIsApplying] = useState(false);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setScope(initialScope);
    setHasAnalyzed(false);
    setSummary(null);
    setSuggestions([]);
    setErrorMsg(null);
    setApplySuccessMsg(null);
    setAnalysisProgress(null);
  }, [isOpen, initialScope]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isAnalyzing && !isApplying && !isAuthModalOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isAnalyzing, isApplying, isAuthModalOpen, onClose]);

  const targetRoutine = useMemo(() => {
    if (scope === 'growth') return [];
    if (rowLimit === 'all') return routineRecords;
    return routineRecords.slice(0, Number(rowLimit));
  }, [scope, rowLimit, routineRecords]);

  const targetGrowth = useMemo(() => {
    if (scope === 'routine') return [];
    if (rowLimit === 'all') return growthRecords;
    return growthRecords.slice(0, Number(rowLimit));
  }, [scope, rowLimit, growthRecords]);

  const selectedCount = useMemo(
    () => suggestions.filter((s) => s.selected).length,
    [suggestions]
  );

  const runAnalysis = useCallback(async () => {
    if (targetRoutine.length === 0 && targetGrowth.length === 0) {
      setErrorMsg('No routine or growth records available in the selected scope.');
      return;
    }

    setIsAnalyzing(true);
    setErrorMsg(null);
    setApplySuccessMsg(null);
    setSummary(null);
    setSuggestions([]);

    const routineById = new Map(targetRoutine.map((r) => [r.id, r]));
    const growthById = new Map(targetGrowth.map((g) => [g.id, g]));

    // Chunk records so each Gemini call stays crisp and never truncates JSON
    const batches: Array<{ routine: RoutineRecord[]; growth: GrowthRecord[] }> = [];
    for (let i = 0; i < targetRoutine.length; i += BATCH_SIZE) {
      batches.push({ routine: targetRoutine.slice(i, i + BATCH_SIZE), growth: [] });
    }
    for (let i = 0; i < targetGrowth.length; i += BATCH_SIZE) {
      const slice = targetGrowth.slice(i, i + BATCH_SIZE);
      if (batches.length > 0 && batches[batches.length - 1].routine.length + batches[batches.length - 1].growth.length + slice.length <= BATCH_SIZE) {
        batches[batches.length - 1].growth.push(...slice);
      } else {
        batches.push({ routine: [], growth: slice });
      }
    }

    const collected = new Map<string, OptimizationSuggestion>();
    const summaries: string[] = [];

    try {
      for (let b = 0; b < batches.length; b += 1) {
        const batch = batches[b];
        setAnalysisProgress(
          batches.length > 1
            ? `Analyzing batch ${b + 1} of ${batches.length} with Gemini...`
            : 'Analyzing records with Gemini...'
        );

        const compactRoutine = batch.routine.map((r) => ({
          id: r.id,
          date: getRoutineRecordDate(r),
          time: normalizeRoutineTimeHHMM(r.time) || null,
          emb_mL: r.emb_mL,
          formula_mL: r.formula_mL,
          feed_duration_min: r.feed_duration_min,
          feeding_method: r.feeding_method,
          diaper: r.diaper,
          diaper_load: r['diaper load'],
          stool: r.stool,
          name: r.name,
          remark: r.remark,
        }));

        const compactGrowth = batch.growth.map((g) => ({
          id: g.id,
          date: getGrowthRecordDate(g),
          time: normalizeRoutineTimeHHMM(g.time) || null,
          daily_weight: g.daily_weight,
          daily_length: g.daily_length,
          temperature: g.temperature,
          name: g.name,
          remark: g.remark,
        }));

        const prompt = [
          'Audit the following baby-care history records for data consistency and structured info trapped inside `remark` columns.',
          compactRoutine.length > 0
            ? `\nROUTINE RECORDS (${compactRoutine.length}):\n${JSON.stringify(compactRoutine)}`
            : '\nROUTINE RECORDS: []',
          compactGrowth.length > 0
            ? `\nGROWTH RECORDS (${compactGrowth.length}):\n${JSON.stringify(compactGrowth)}`
            : '\nGROWTH RECORDS: []',
          '\nReturn ONLY rows that benefit from a real improvement.',
        ].join('\n');

        const response = await fetch('/api/gemini', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prompt,
            systemInstruction: OPTIMIZE_SYSTEM_INSTRUCTION,
            responseMimeType: 'application/json',
            responseSchema: OPTIMIZE_RESPONSE_SCHEMA,
            thinkingLevel: 'LOW',
          }),
        });

        const data = (await response.json().catch(() => ({}))) as {
          text?: string;
          error?: string;
        };

        if (!response.ok || data.error) {
          throw new Error(data.error || `Gemini request failed (${response.status}).`);
        }

        const rawText = (data.text ?? '').trim();
        if (!rawText) continue;

        const parsed = JSON.parse(rawText) as {
          summary?: string;
          routineEdits?: Array<Record<string, unknown>>;
          growthEdits?: Array<Record<string, unknown>>;
        };

        if (typeof parsed.summary === 'string' && parsed.summary.trim()) {
          summaries.push(parsed.summary.trim());
        }

        if (Array.isArray(parsed.routineEdits)) {
          for (const edit of parsed.routineEdits) {
            const suggestion = buildRoutineSuggestion(edit, routineById);
            if (suggestion) collected.set(suggestion.key, suggestion);
          }
        }

        if (Array.isArray(parsed.growthEdits)) {
          for (const edit of parsed.growthEdits) {
            const suggestion = buildGrowthSuggestion(edit, growthById);
            if (suggestion) collected.set(suggestion.key, suggestion);
          }
        }
      }

      const list = Array.from(collected.values()).sort((a, b) => {
        const aKey = `${a.date}T${a.time || '00:00'}`;
        const bKey = `${b.date}T${b.time || '00:00'}`;
        return bKey.localeCompare(aKey);
      });

      setSuggestions(list);
      setSummary(
        summaries.length > 0
          ? summaries[0]
          : list.length > 0
            ? `Found ${list.length} record${list.length === 1 ? '' : 's'} with suggested consistency or remark improvements.`
            : 'All analyzed records already look consistent and well-structured.'
      );
      setHasAnalyzed(true);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to analyze records with Gemini.');
    } finally {
      setIsAnalyzing(false);
      setAnalysisProgress(null);
    }
  }, [targetRoutine, targetGrowth]);

  const applySelectedEdits = async () => {
    const toApply = suggestions.filter((s) => s.selected);
    if (toApply.length === 0) return;

    setIsApplying(true);
    setErrorMsg(null);
    setApplySuccessMsg(null);

    let updatedRoutine = 0;
    let updatedGrowth = 0;
    const failedKeys = new Set<string>();
    const errors: string[] = [];

    for (const item of toApply) {
      if (item.kind === 'routine') {
        const res = await editRoutineRecord(item.id, item.updates);
        if (res.error) {
          failedKeys.add(item.key);
          errors.push(`Routine #${item.id}: ${res.error}`);
        } else {
          updatedRoutine += 1;
        }
      } else {
        const res = await editGrowthRecord(item.id, item.updates);
        if (res.error) {
          failedKeys.add(item.key);
          errors.push(`Growth #${item.id}: ${res.error}`);
        } else {
          updatedGrowth += 1;
        }
      }
    }

    setSuggestions((prev) =>
      prev.filter((item) => !item.selected || failedKeys.has(item.key))
    );

    if (errors.length > 0) {
      setErrorMsg(errors.slice(0, 3).join(' | '));
    }

    const totalUpdated = updatedRoutine + updatedGrowth;
    if (totalUpdated > 0) {
      const parts: string[] = [];
      if (updatedRoutine > 0) parts.push(`${updatedRoutine} routine`);
      if (updatedGrowth > 0) parts.push(`${updatedGrowth} growth`);
      setApplySuccessMsg(`Updated ${parts.join(' and ')} record${totalUpdated === 1 ? '' : 's'} in Supabase.`);
    }

    setIsApplying(false);
  };

  if (!isOpen) return null;

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-stone-900/60 dark:bg-black/75 backdrop-blur-xs overflow-y-auto">
        <div className="bg-white dark:bg-stone-900 rounded-3xl max-w-3xl w-full shadow-2xl border border-stone-200 dark:border-stone-800 my-4 overflow-hidden flex flex-col max-h-[90vh]">
          {/* Header */}
          <div className="px-5 sm:px-6 py-4 border-b border-stone-100 dark:border-stone-800 flex items-center justify-between gap-3 shrink-0">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-9 h-9 rounded-2xl bg-emerald-100 dark:bg-emerald-950/70 text-emerald-700 dark:text-emerald-300 flex items-center justify-center shrink-0">
                <Wand2 className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <h3 className="text-base font-bold text-stone-900 dark:text-white truncate">
                  Optimise History with Gemini
                </h3>
                <p className="text-[11px] text-stone-500 dark:text-stone-400">
                  Standardizes fields and extracts misplaced data from remarks into the right columns.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              disabled={isAnalyzing || isApplying}
              className="p-1.5 text-stone-400 hover:text-stone-700 dark:hover:text-stone-200 rounded-lg hover:bg-stone-100 dark:hover:bg-stone-800 transition-colors cursor-pointer disabled:opacity-50"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Controls */}
          <div className="px-5 sm:px-6 py-3.5 bg-stone-50/80 dark:bg-stone-800/40 border-b border-stone-100 dark:border-stone-800 flex flex-wrap items-center justify-between gap-3 shrink-0">
            <div className="flex flex-wrap items-center gap-2">
              <div className="inline-flex p-0.5 bg-stone-200/70 dark:bg-stone-800 rounded-xl border border-stone-200/80 dark:border-stone-700">
                {(
                  [
                    { id: 'both', label: `All (${routineRecords.length + growthRecords.length})` },
                    { id: 'routine', label: `Routine (${routineRecords.length})` },
                    { id: 'growth', label: `Growth (${growthRecords.length})` },
                  ] as const
                ).map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    disabled={isAnalyzing || isApplying}
                    onClick={() => setScope(opt.id)}
                    className={`px-2.5 py-1 text-[11px] font-semibold rounded-lg transition-colors cursor-pointer ${
                      scope === opt.id
                        ? 'bg-white dark:bg-stone-900 text-stone-900 dark:text-white shadow-2xs font-bold'
                        : 'text-stone-600 dark:text-stone-400 hover:text-stone-900 dark:hover:text-white'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>

              <select
                aria-label="Number of recent records to analyze"
                value={rowLimit}
                disabled={isAnalyzing || isApplying}
                onChange={(e) => setRowLimit(e.target.value as '60' | '120' | 'all')}
                className="px-2.5 py-1.5 text-[11px] font-semibold bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-700 text-stone-700 dark:text-stone-200 rounded-xl focus:outline-hidden cursor-pointer"
              >
                <option value="60">Latest 60 per table</option>
                <option value="120">Latest 120 per table</option>
                <option value="all">All visible records</option>
              </select>
            </div>

            <button
              type="button"
              onClick={() => void runAnalysis()}
              disabled={isAnalyzing || isApplying || (targetRoutine.length === 0 && targetGrowth.length === 0)}
              className="px-3.5 py-2 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 dark:bg-emerald-500 dark:hover:bg-emerald-400 dark:text-stone-950 rounded-xl shadow-xs transition-colors flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
            >
              {isAnalyzing ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : hasAnalyzed ? (
                <RefreshCw className="w-3.5 h-3.5" />
              ) : (
                <Sparkles className="w-3.5 h-3.5" />
              )}
              <span>
                {isAnalyzing
                  ? 'Analysing...'
                  : hasAnalyzed
                    ? 'Re-run Audit'
                    : `Scan ${targetRoutine.length + targetGrowth.length} Records`}
              </span>
            </button>
          </div>

          {/* Body */}
          <div className="p-5 sm:p-6 overflow-y-auto space-y-4 flex-1">
            {errorMsg && (
              <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-900/70 text-xs text-rose-700 dark:text-rose-300 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{errorMsg}</span>
              </div>
            )}

            {applySuccessMsg && (
              <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-xs text-emerald-800 dark:text-emerald-200 flex items-center gap-2 font-medium">
                <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                <span>{applySuccessMsg}</span>
              </div>
            )}

            {isAnalyzing && (
              <div className="py-12 text-center space-y-2.5">
                <Loader2 className="w-7 h-7 animate-spin text-emerald-600 dark:text-emerald-400 mx-auto" />
                <div className="text-xs font-bold text-stone-800 dark:text-stone-200">
                  {analysisProgress || 'Analyzing records with Gemini...'}
                </div>
                <p className="text-[11px] text-stone-500 dark:text-stone-400">
                  Checking remarks, feeding methods, diaper/stool codes, units, and naming consistency.
                </p>
              </div>
            )}

            {!isAnalyzing && !hasAnalyzed && (
              <div className="py-10 px-4 text-center space-y-3 border border-dashed border-stone-200 dark:border-stone-800 rounded-2xl">
                <Sparkles className="w-7 h-7 text-emerald-600 dark:text-emerald-400 mx-auto" />
                <div className="space-y-1 max-w-md mx-auto">
                  <h4 className="text-sm font-bold text-stone-900 dark:text-white">
                    Review before anything changes
                  </h4>
                  <p className="text-xs text-stone-500 dark:text-stone-400 leading-relaxed">
                    Gemini will inspect your selected history logs, detect misplaced feed volumes, durations, stool codes, weights, or temperatures written inside remarks, and propose consistent edits for your approval.
                  </p>
                </div>
              </div>
            )}

            {!isAnalyzing && hasAnalyzed && (
              <>
                {summary && (
                  <div className="px-3.5 py-2.5 rounded-xl bg-stone-50 dark:bg-stone-800/60 border border-stone-200/70 dark:border-stone-700/70 text-xs text-stone-700 dark:text-stone-300">
                    <span className="font-bold text-stone-900 dark:text-white">Gemini Summary: </span>
                    {summary}
                  </div>
                )}

                {suggestions.length === 0 ? (
                  <div className="py-10 text-center space-y-2">
                    <CheckCircle2 className="w-7 h-7 text-emerald-600 dark:text-emerald-400 mx-auto" />
                    <div className="text-xs font-bold text-stone-800 dark:text-stone-200">
                      No edits needed
                    </div>
                    <p className="text-[11px] text-stone-500 dark:text-stone-400">
                      Your scanned records are already clean and consistent.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="font-bold text-stone-800 dark:text-stone-200">
                        Suggested Edits ({selectedCount} of {suggestions.length} selected)
                      </span>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() =>
                            setSuggestions((prev) => prev.map((s) => ({ ...s, selected: true })))
                          }
                          className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-400 hover:underline cursor-pointer"
                        >
                          Select All
                        </button>
                        <span className="text-stone-300 dark:text-stone-700">·</span>
                        <button
                          type="button"
                          onClick={() =>
                            setSuggestions((prev) => prev.map((s) => ({ ...s, selected: false })))
                          }
                          className="text-[11px] font-semibold text-stone-500 dark:text-stone-400 hover:underline cursor-pointer"
                        >
                          Deselect All
                        </button>
                      </div>
                    </div>

                    <div className="space-y-2.5">
                      {suggestions.map((item) => (
                        <label
                          key={item.key}
                          className={`block rounded-2xl border p-3.5 transition-colors cursor-pointer ${
                            item.selected
                              ? 'bg-emerald-50/40 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-800/80'
                              : 'bg-stone-50/70 dark:bg-stone-800/30 border-stone-200/70 dark:border-stone-800 opacity-70'
                          }`}
                        >
                          <div className="flex items-start gap-2.5">
                            <input
                              type="checkbox"
                              checked={item.selected}
                              onChange={(e) =>
                                setSuggestions((prev) =>
                                  prev.map((s) =>
                                    s.key === item.key ? { ...s, selected: e.target.checked } : s
                                  )
                                )
                              }
                              className="mt-0.5 accent-emerald-600 cursor-pointer"
                            />
                            <div className="min-w-0 flex-1 space-y-2">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <div className="flex items-center gap-1.5 text-xs font-bold text-stone-900 dark:text-white">
                                  {item.kind === 'routine' ? (
                                    <Droplets className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                                  ) : (
                                    <Scale className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 shrink-0" />
                                  )}
                                  <span>
                                    {item.kind === 'routine' ? 'Routine' : 'Growth'} #{item.id}
                                  </span>
                                  <span className="font-mono text-[11px] font-semibold text-stone-500 dark:text-stone-400">
                                    · {item.date}
                                    {item.time ? ` ${item.time}` : ''}
                                  </span>
                                </div>
                              </div>

                              <p className="text-[11px] text-stone-600 dark:text-stone-300">
                                {item.reason}
                              </p>

                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 pt-1">
                                {item.diffs.map((diff) => (
                                  <div
                                    key={diff.field}
                                    className="px-2.5 py-1.5 rounded-xl bg-white dark:bg-stone-900 border border-stone-200/70 dark:border-stone-700/70 text-[11px] flex items-center gap-1.5 min-w-0"
                                  >
                                    <span className="font-semibold text-stone-500 dark:text-stone-400 shrink-0">
                                      {diff.label}:
                                    </span>
                                    <span className="text-stone-500 dark:text-stone-400 line-through truncate">
                                      {diff.before}
                                    </span>
                                    <ArrowRight className="w-3 h-3 text-emerald-600 dark:text-emerald-400 shrink-0" />
                                    <span className="font-bold text-emerald-800 dark:text-emerald-300 truncate">
                                      {diff.after}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          </div>
                        </label>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>

          {/* Footer */}
          <div className="px-5 sm:px-6 py-3.5 border-t border-stone-100 dark:border-stone-800 flex items-center justify-between gap-3 shrink-0 bg-stone-50/50 dark:bg-stone-900">
            <span className="text-[11px] text-stone-500 dark:text-stone-400">
              Edits save directly to Supabase after bae_Key confirmation.
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                disabled={isAnalyzing || isApplying}
                className="px-3.5 py-2 text-xs font-semibold text-stone-600 dark:text-stone-400 hover:text-stone-900 dark:hover:text-white rounded-xl transition-colors cursor-pointer disabled:opacity-50"
              >
                Close
              </button>
              {suggestions.length > 0 && (
                <button
                  type="button"
                  disabled={selectedCount === 0 || isApplying || isAnalyzing}
                  onClick={() => setIsAuthModalOpen(true)}
                  className="px-4 py-2 text-xs font-bold text-white bg-stone-900 hover:bg-stone-800 dark:bg-stone-100 dark:hover:bg-white dark:text-stone-900 rounded-xl shadow-xs transition-colors flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                >
                  {isApplying ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Check className="w-3.5 h-3.5" />
                  )}
                  <span>
                    {isApplying
                      ? 'Applying...'
                      : `Apply Selected (${selectedCount})`}
                  </span>
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      <EditAuthModal
        isOpen={isAuthModalOpen}
        title="Authenticate to Apply Optimisations"
        description={`Enter your bae_Key passkey to apply ${selectedCount} Gemini-suggested edit${selectedCount === 1 ? '' : 's'} to Supabase.`}
        onClose={() => setIsAuthModalOpen(false)}
        onAuthenticated={() => {
          setIsAuthModalOpen(false);
          void applySelectedEdits();
        }}
      />
    </>
  );
};
