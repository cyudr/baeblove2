import React, { useState, useMemo, useEffect } from 'react';
import { useApp } from '../../context/AppContext';
import { UnitConverter } from '../../data/growthStandards';
import {
  DEFAULT_DIAPER_LOAD,
  DEFAULT_MILK_FORMULA,
  detectDefaultFeedingMethod,
  doesRecordMatchProfile,
  formatDiaperLoad,
  formatFeedingMethodLabel,
  getGrowthRecordDate,
  getRoutineRecordDate,
  interpretRoutineTable,
  normalizeDiaperLoad,
  normalizeFeedingMethod,
  normalizeRoutineTimeHHMM,
  normalizeStoolValue,
  parseDiaperLoadCount,
} from '../../utils/careInterpreter';
import { EditAuthModal } from '../modals/EditAuthModal';
import { AskGeminiModal } from '../modals/AskGeminiModal';
import { StoolSelect } from '../common/StoolSelect';
import { DiaperLoadControl } from '../common/DiaperLoadControl';
import { FeedingMethodSelect } from '../common/FeedingMethodSelect';
import { RemarkTooltipCell } from '../common/RemarkTooltipCell';
import { RoutineSummaryAndChartsGrid } from '../charts/RoutineTrendCharts';
import type { RoutineRecord } from '../../types';
import {
  Droplets,
  Plus,
  Pencil,
  Trash2,
  Check,
  X,
  Sparkles,
  Filter,
  RotateCcw,
  Lock,
  Calculator,
  SlidersHorizontal,
  ChevronDown,
  AlertTriangle,
} from 'lucide-react';

const DIAPER_PRESETS = ['Wet', 'Dirty', 'Mixed'] as const;

function getCurrentDateStr(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function getCurrentTimeStr(): string {
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

interface RoutineViewProps {
  initialEditRecord?: RoutineRecord | null;
  onClearInitialEdit?: () => void;
}

export const RoutineView: React.FC<RoutineViewProps> = ({
  initialEditRecord = null,
  onClearInitialEdit,
}) => {
  const {
    activeProfile,
    activeBabyMeasurements,
    growthRecords,
    routineRecords,
    addRoutineRecord,
    editRoutineRecord,
    removeRoutineRecord,
  } = useApp();

  const [loggerFilter, setLoggerFilter] = useState<string>('all');

  // Routine form state (`name` column = person logging the info; `profile_id` = active profile from entries)
  const [editingRoutineId, setEditingRoutineId] = useState<number | null>(null);
  const [loggedBy, setLoggedBy] = useState<string>('');
  const [routineDate, setRoutineDate] = useState<string>(getCurrentDateStr);
  const [routineTime, setRoutineTime] = useState<string>(getCurrentTimeStr);
  const [ebmMl, setEbmMl] = useState<string>('');
  const [formulaMl, setFormulaMl] = useState<string>('');
  const [feedDurationMin, setFeedDurationMin] = useState<string>('');
  const [feedingMethod, setFeedingMethod] = useState<string>('');
  const [methodTouched, setMethodTouched] = useState<boolean>(false);
  const [diaper, setDiaper] = useState<string>('');
  const [diaperLoad, setDiaperLoad] = useState<string>(DEFAULT_DIAPER_LOAD);
  const [stool, setStool] = useState<string>('');
  const [routineRemark, setRoutineRemark] = useState<string>('');
  const [routineError, setRoutineError] = useState<string | null>(null);
  const [retrieveNotice, setRetrieveNotice] = useState<string | null>(null);
  const [isSavingRoutine, setIsSavingRoutine] = useState(false);

  // Two-step inline delete confirmation & bae_Key edit auth
  const [pendingDeleteId, setPendingDeleteId] = useState<number | null>(null);
  const [pendingAuthRecord, setPendingAuthRecord] = useState<RoutineRecord | null>(null);
  const [isAskGeminiOpen, setIsAskGeminiOpen] = useState(false);
  const [isLogCardExpanded, setIsLogCardExpanded] = useState(false);

  // Editable Milk Intake Formula state (x–y mL/kg/day, feeds/day, z% target in range)
  const [isFormulaModalOpen, setIsFormulaModalOpen] = useState(false);
  const [minRateInput, setMinRateInput] = useState<string>(String(DEFAULT_MILK_FORMULA.minMlPerKg));
  const [maxRateInput, setMaxRateInput] = useState<string>(String(DEFAULT_MILK_FORMULA.maxMlPerKg));
  const [feedsPerDayInput, setFeedsPerDayInput] = useState<string>(
    String(DEFAULT_MILK_FORMULA.feedsPerDay)
  );
  const [targetPctInput, setTargetPctInput] = useState<string>(
    String(DEFAULT_MILK_FORMULA.targetRangePct)
  );

  useEffect(() => {
    setLoggerFilter('all');
  }, [activeProfile?.id]);

  useEffect(() => {
    if (!isFormulaModalOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsFormulaModalOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isFormulaModalOpen]);

  // Auto-detect feeding method while not manually overridden
  useEffect(() => {
    if (methodTouched) return;
    setFeedingMethod(
      detectDefaultFeedingMethod({
        ebmMl,
        formulaMl,
        feedDurationMin,
      })
    );
  }, [ebmMl, formulaMl, feedDurationMin, methodTouched]);

  // Populate form when navigated from History tab to edit a specific record
  useEffect(() => {
    if (!initialEditRecord) return;
    setEditingRoutineId(initialEditRecord.id);
    setLoggedBy(initialEditRecord.name ?? '');
    setRoutineDate(
      initialEditRecord.date ? initialEditRecord.date.slice(0, 10) : getCurrentDateStr()
    );
    setRoutineTime(
      initialEditRecord.time ? initialEditRecord.time.slice(0, 5) : getCurrentTimeStr()
    );
    setEbmMl(initialEditRecord.emb_mL !== null ? String(initialEditRecord.emb_mL) : '');
    setFormulaMl(
      initialEditRecord.formula_mL !== null ? String(initialEditRecord.formula_mL) : ''
    );
    setFeedDurationMin(
      initialEditRecord.feed_duration_min !== null
        ? String(initialEditRecord.feed_duration_min)
        : ''
    );
    const existingMethod = normalizeFeedingMethod(initialEditRecord.feeding_method);
    setFeedingMethod(
      existingMethod ||
        detectDefaultFeedingMethod({
          ebmMl: initialEditRecord.emb_mL,
          formulaMl: initialEditRecord.formula_mL,
          feedDurationMin: initialEditRecord.feed_duration_min,
        })
    );
    setMethodTouched(Boolean(existingMethod));
    setDiaper(initialEditRecord.diaper ?? '');
    setDiaperLoad(normalizeDiaperLoad(initialEditRecord['diaper load'], DEFAULT_DIAPER_LOAD));
    setStool(normalizeStoolValue(initialEditRecord.stool));
    setRoutineRemark(initialEditRecord.remark ?? '');
    setRoutineError(null);
    setRetrieveNotice(null);
    setIsLogCardExpanded(true);
    onClearInitialEdit?.();
  }, [initialEditRecord, onClearInitialEdit]);

  // Scope routine & growth records to the active profile loaded from "entries" via profile_id
  const profileRoutineRecords = useMemo(() => {
    if (!activeProfile) return routineRecords;
    return routineRecords.filter((r) => doesRecordMatchProfile(r, activeProfile));
  }, [routineRecords, activeProfile]);

  const latestRoutineRecord = profileRoutineRecords[0] ?? null;

  const profileGrowthRecords = useMemo(() => {
    if (!activeProfile) return growthRecords;
    return growthRecords.filter((g) => doesRecordMatchProfile(g, activeProfile));
  }, [growthRecords, activeProfile]);

  const availableLoggers = useMemo(() => {
    const set = new Set<string>();
    for (const r of profileRoutineRecords) {
      if (r.name?.trim()) set.add(r.name.trim());
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [profileRoutineRecords]);

  const filteredRoutine = useMemo(() => {
    if (loggerFilter === 'all') return profileRoutineRecords;
    const target = loggerFilter.trim().toLowerCase();
    return profileRoutineRecords.filter((r) => (r.name ?? '').trim().toLowerCase() === target);
  }, [profileRoutineRecords, loggerFilter]);

  // Always use the baby's current (most recent) recorded weight
  const currentWeightInfo = useMemo<{
    weightKg: number | null;
    sourceLabel: string | null;
  }>(() => {
    const growthWeightRows = profileGrowthRecords
      .filter((g) => g.daily_weight !== null && g.daily_weight > 0)
      .sort((a, b) => {
        const aKey = `${getGrowthRecordDate(a)}T${a.created_at.slice(11, 19)}`;
        const bKey = `${getGrowthRecordDate(b)}T${b.created_at.slice(11, 19)}`;
        return bKey.localeCompare(aKey);
      });
    const latestGrowthRow = growthWeightRows[0];
    const growthDate = latestGrowthRow ? getGrowthRecordDate(latestGrowthRow) : null;

    const babyWeightRows = activeBabyMeasurements
      .filter((m) => typeof m.weightKg === 'number' && m.weightKg > 0)
      .sort((a, b) => b.date.localeCompare(a.date));
    const latestBabyRow = babyWeightRows[0];

    if (
      latestGrowthRow &&
      latestGrowthRow.daily_weight !== null &&
      latestBabyRow &&
      typeof latestBabyRow.weightKg === 'number'
    ) {
      if (latestBabyRow.date > (growthDate ?? '')) {
        return {
          weightKg: latestBabyRow.weightKg,
          sourceLabel: `Measurement · ${latestBabyRow.date}`,
        };
      }
      return {
        weightKg: latestGrowthRow.daily_weight,
        sourceLabel: `Growth log · ${growthDate}`,
      };
    }

    if (latestGrowthRow && latestGrowthRow.daily_weight !== null) {
      return {
        weightKg: latestGrowthRow.daily_weight,
        sourceLabel: `Growth log · ${growthDate}`,
      };
    }

    if (latestBabyRow && typeof latestBabyRow.weightKg === 'number') {
      return {
        weightKg: latestBabyRow.weightKg,
        sourceLabel: `Measurement · ${latestBabyRow.date}`,
      };
    }

    if (activeProfile?.birthWeightKg && activeProfile.birthWeightKg > 0) {
      return {
        weightKg: activeProfile.birthWeightKg,
        sourceLabel: 'Birth weight',
      };
    }

    return { weightKg: null, sourceLabel: null };
  }, [profileGrowthRecords, activeBabyMeasurements, activeProfile?.birthWeightKg]);

  const currentWeightKg = currentWeightInfo.weightKg;

  const milkFormulaConfig = useMemo(() => {
    const parsedMin = parseFloat(minRateInput);
    const parsedMax = parseFloat(maxRateInput);
    const parsedFeeds = parseFloat(feedsPerDayInput);
    const parsedZ = parseFloat(targetPctInput);

    const minMlPerKg =
      Number.isFinite(parsedMin) && parsedMin > 0 ? parsedMin : DEFAULT_MILK_FORMULA.minMlPerKg;
    const maxMlPerKg =
      Number.isFinite(parsedMax) && parsedMax > 0 ? parsedMax : DEFAULT_MILK_FORMULA.maxMlPerKg;
    const feedsPerDay =
      Number.isFinite(parsedFeeds) && parsedFeeds > 0
        ? Math.min(24, parsedFeeds)
        : DEFAULT_MILK_FORMULA.feedsPerDay;
    const targetRangePct = Number.isFinite(parsedZ)
      ? Math.min(100, Math.max(0, parsedZ))
      : DEFAULT_MILK_FORMULA.targetRangePct;

    return { minMlPerKg, maxMlPerKg, feedsPerDay, targetRangePct };
  }, [minRateInput, maxRateInput, feedsPerDayInput, targetPctInput]);

  const lowFormulaRate = Math.min(milkFormulaConfig.minMlPerKg, milkFormulaConfig.maxMlPerKg);
  const highFormulaRate = Math.max(milkFormulaConfig.minMlPerKg, milkFormulaConfig.maxMlPerKg);
  const isFormulaCustomized =
    minRateInput !== String(DEFAULT_MILK_FORMULA.minMlPerKg) ||
    maxRateInput !== String(DEFAULT_MILK_FORMULA.maxMlPerKg) ||
    feedsPerDayInput !== String(DEFAULT_MILK_FORMULA.feedsPerDay) ||
    targetPctInput !== String(DEFAULT_MILK_FORMULA.targetRangePct);

  const resetMilkFormula = () => {
    setMinRateInput(String(DEFAULT_MILK_FORMULA.minMlPerKg));
    setMaxRateInput(String(DEFAULT_MILK_FORMULA.maxMlPerKg));
    setFeedsPerDayInput(String(DEFAULT_MILK_FORMULA.feedsPerDay));
    setTargetPctInput(String(DEFAULT_MILK_FORMULA.targetRangePct));
  };

  const routineInsights = useMemo(
    () => interpretRoutineTable(filteredRoutine, currentWeightKg, milkFormulaConfig),
    [filteredRoutine, currentWeightKg, milkFormulaConfig]
  );

  // Detect potentially duplicated or conflicting routine entry strictly by Date & Time
  const dateTimeCollision = useMemo<{
    level: 'duplicate' | 'conflict';
    existing: RoutineRecord;
    summary: string;
  } | null>(() => {
    const cleanDate = routineDate.trim().slice(0, 10);
    if (!cleanDate) return null;
    const cleanTime = normalizeRoutineTimeHHMM(routineTime);

    const parsedEbm = ebmMl.trim() !== '' ? parseInt(ebmMl, 10) : null;
    const parsedFormula = formulaMl.trim() !== '' ? parseInt(formulaMl, 10) : null;
    const parsedDuration = feedDurationMin.trim() !== '' ? parseInt(feedDurationMin, 10) : null;
    const cleanMethod = normalizeFeedingMethod(feedingMethod);
    const cleanDiaper = diaper.trim().toLowerCase();
    const cleanStool = normalizeStoolValue(stool).toLowerCase();
    const loadCount = parseDiaperLoadCount(diaperLoad, 1);
    const loadChanged = loadCount !== 1;
    const effectiveLoad = cleanDiaper || cleanStool || loadChanged ? loadCount : null;
    const cleanRemark = routineRemark.trim().toLowerCase();

    const hasEnteredData =
      parsedEbm !== null ||
      parsedFormula !== null ||
      parsedDuration !== null ||
      cleanMethod !== '' ||
      cleanDiaper !== '' ||
      cleanStool !== '' ||
      loadChanged ||
      cleanRemark !== '';

    for (const rec of profileRoutineRecords) {
      if (editingRoutineId !== null && rec.id === editingRoutineId) continue;
      const recDate = getRoutineRecordDate(rec);
      if (recDate !== cleanDate) continue;

      const recTime = normalizeRoutineTimeHHMM(rec.time);
      if (cleanTime !== recTime) continue;

      const recMethod = normalizeFeedingMethod(rec.feeding_method);
      const recDiaper = (rec.diaper || '').trim().toLowerCase();
      const recStool = normalizeStoolValue(rec.stool).toLowerCase();
      const recRemark = (rec.remark || '').trim().toLowerCase();

      const summaryParts: string[] = [recDate];
      if (recTime) summaryParts.push(recTime);
      if (rec.emb_mL !== null) summaryParts.push(`EBM ${rec.emb_mL} mL`);
      if (rec.formula_mL !== null) summaryParts.push(`Formula ${rec.formula_mL} mL`);
      if (rec.feed_duration_min !== null) summaryParts.push(`${rec.feed_duration_min} min`);
      if (rec.feeding_method) summaryParts.push(formatFeedingMethodLabel(rec.feeding_method));
      if (rec.diaper) summaryParts.push(rec.diaper);
      if (rec['diaper load'] !== null) summaryParts.push(formatDiaperLoad(rec['diaper load']));
      if (rec.stool) summaryParts.push(`Stool ${rec.stool}`);

      const allMatch =
        hasEnteredData &&
        parsedEbm === rec.emb_mL &&
        parsedFormula === rec.formula_mL &&
        parsedDuration === rec.feed_duration_min &&
        cleanMethod === recMethod &&
        cleanDiaper === recDiaper &&
        effectiveLoad === rec['diaper load'] &&
        cleanStool === recStool &&
        cleanRemark === recRemark;

      return {
        level: allMatch ? 'duplicate' : 'conflict',
        existing: rec,
        summary: summaryParts.join(' · '),
      };
    }

    return null;
  }, [
    routineDate,
    routineTime,
    ebmMl,
    formulaMl,
    feedDurationMin,
    feedingMethod,
    diaper,
    diaperLoad,
    stool,
    routineRemark,
    profileRoutineRecords,
    editingRoutineId,
  ]);

  const resetRoutineForm = (preserveLogger = false) => {
    setEditingRoutineId(null);
    if (!preserveLogger) setLoggedBy('');
    setRoutineDate(getCurrentDateStr());
    setRoutineTime(getCurrentTimeStr());
    setEbmMl('');
    setFormulaMl('');
    setFeedDurationMin('');
    setFeedingMethod('');
    setMethodTouched(false);
    setDiaper('');
    setDiaperLoad(DEFAULT_DIAPER_LOAD);
    setStool('');
    setRoutineRemark('');
    setRoutineError(null);
    setRetrieveNotice(null);
  };

  const handleRetrieveLastRoutine = () => {
    if (!latestRoutineRecord) return;
    setEditingRoutineId(null);
    setRoutineDate(getCurrentDateStr());
    setRoutineTime(getCurrentTimeStr());
    setLoggedBy(latestRoutineRecord.name ?? '');
    setEbmMl(
      latestRoutineRecord.emb_mL !== null ? String(latestRoutineRecord.emb_mL) : ''
    );
    setFormulaMl(
      latestRoutineRecord.formula_mL !== null
        ? String(latestRoutineRecord.formula_mL)
        : ''
    );
    setFeedDurationMin(
      latestRoutineRecord.feed_duration_min !== null
        ? String(latestRoutineRecord.feed_duration_min)
        : ''
    );
    const lastMethod = normalizeFeedingMethod(latestRoutineRecord.feeding_method);
    setFeedingMethod(
      lastMethod ||
        detectDefaultFeedingMethod({
          ebmMl: latestRoutineRecord.emb_mL,
          formulaMl: latestRoutineRecord.formula_mL,
          feedDurationMin: latestRoutineRecord.feed_duration_min,
        })
    );
    setMethodTouched(Boolean(lastMethod));
    setDiaper(latestRoutineRecord.diaper ?? '');
    setDiaperLoad(normalizeDiaperLoad(latestRoutineRecord['diaper load'], DEFAULT_DIAPER_LOAD));
    setStool(normalizeStoolValue(latestRoutineRecord.stool));
    setRoutineRemark(latestRoutineRecord.remark ?? '');
    setRoutineError(null);
    const whenLabel = [
      getRoutineRecordDate(latestRoutineRecord),
      latestRoutineRecord.time ? latestRoutineRecord.time.slice(0, 5) : '',
    ]
      .filter(Boolean)
      .join(' ');
    setRetrieveNotice(`Loaded values from last entry (${whenLabel}) as a new log.`);
  };

  const applyEditRoutine = (row: RoutineRecord) => {
    setEditingRoutineId(row.id);
    setLoggedBy(row.name ?? '');
    setRoutineDate(row.date ? row.date.slice(0, 10) : getCurrentDateStr());
    setRoutineTime(row.time ? row.time.slice(0, 5) : getCurrentTimeStr());
    setEbmMl(row.emb_mL !== null ? String(row.emb_mL) : '');
    setFormulaMl(row.formula_mL !== null ? String(row.formula_mL) : '');
    setFeedDurationMin(
      row.feed_duration_min !== null ? String(row.feed_duration_min) : ''
    );
    const existingMethod = normalizeFeedingMethod(row.feeding_method);
    setFeedingMethod(
      existingMethod ||
        detectDefaultFeedingMethod({
          ebmMl: row.emb_mL,
          formulaMl: row.formula_mL,
          feedDurationMin: row.feed_duration_min,
        })
    );
    setMethodTouched(Boolean(existingMethod));
    setDiaper(row.diaper ?? '');
    setDiaperLoad(normalizeDiaperLoad(row['diaper load'], DEFAULT_DIAPER_LOAD));
    setStool(normalizeStoolValue(row.stool));
    setRoutineRemark(row.remark ?? '');
    setRoutineError(null);
    setRetrieveNotice(null);
    setIsLogCardExpanded(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const requestEditRoutine = (row: RoutineRecord) => {
    setPendingAuthRecord(row);
  };

  const handleSaveRoutine = async (e: React.FormEvent) => {
    e.preventDefault();
    setRoutineError(null);

    const parsedEbm = ebmMl.trim() !== '' ? parseInt(ebmMl, 10) : null;
    const parsedFormula = formulaMl.trim() !== '' ? parseInt(formulaMl, 10) : null;
    const parsedDuration = feedDurationMin.trim() !== '' ? parseInt(feedDurationMin, 10) : null;
    const cleanMethod = methodTouched
      ? normalizeFeedingMethod(feedingMethod) || null
      : detectDefaultFeedingMethod({
          ebmMl: parsedEbm,
          formulaMl: parsedFormula,
          feedDurationMin: parsedDuration,
        }) || null;
    const cleanStool = normalizeStoolValue(stool) || null;
    const loadCount = parseDiaperLoadCount(diaperLoad, 1);
    const loadChanged = loadCount !== 1;
    const hasDiaperContext = Boolean(diaper.trim() || cleanStool || loadChanged);

    if (
      parsedEbm === null &&
      parsedFormula === null &&
      parsedDuration === null &&
      !cleanMethod &&
      !diaper.trim() &&
      !cleanStool &&
      !loadChanged &&
      !routineRemark.trim()
    ) {
      setRoutineError(
        'Enter at least one routine value (EBM, Formula, duration, method, diaper, stool, or remark).'
      );
      return;
    }

    setIsSavingRoutine(true);
    try {
      const payload = {
        profile_id: activeProfile?.id ?? null,
        date: routineDate || null,
        time: routineTime || null,
        emb_mL: parsedEbm,
        formula_mL: parsedFormula,
        diaper: diaper.trim() || null,
        'diaper load': hasDiaperContext ? loadCount : null,
        stool: cleanStool,
        name: loggedBy.trim() || null,
        remark: routineRemark.trim() || null,
        feed_duration_min: parsedDuration,
        feeding_method: cleanMethod,
      };

      const res =
        editingRoutineId !== null
          ? await editRoutineRecord(editingRoutineId, payload)
          : await addRoutineRecord(payload);

      if (res.error) {
        setRoutineError(res.error);
      } else {
        resetRoutineForm(editingRoutineId === null);
      }
    } finally {
      setIsSavingRoutine(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header Card */}
      <div className="bg-white dark:bg-stone-900 rounded-3xl border border-stone-200 dark:border-stone-800 p-5 md:p-6 shadow-xs space-y-4 transition-colors">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-2xl bg-emerald-100 dark:bg-emerald-950/70 text-emerald-700 dark:text-emerald-300 flex items-center justify-center shadow-2xs shrink-0">
              <Droplets className="w-4 h-4" />
            </div>
            <h2 className="text-xl font-bold text-stone-900 dark:text-white">
              Routine Data Logging
            </h2>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setIsAskGeminiOpen(true)}
              className="px-3.5 py-2 text-xs font-bold text-emerald-900 dark:text-emerald-200 bg-emerald-50 dark:bg-emerald-950/60 hover:bg-emerald-100 dark:hover:bg-emerald-900/70 border border-emerald-200 dark:border-emerald-800 rounded-xl transition-colors flex items-center gap-1.5 cursor-pointer shadow-2xs"
            >
              <Sparkles className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
              <span>Ask Gemini</span>
            </button>
          </div>
        </div>

        {/* Routine Interpretation */}
        <div className="pt-4 border-t border-stone-100 dark:border-stone-800">
          <div className="flex items-center gap-1.5 text-xs font-bold text-emerald-900 dark:text-emerald-300 mb-2">
            <Sparkles className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
            <span>Routine Interpretation</span>
          </div>
          <ul className="space-y-1.5 text-xs leading-relaxed text-stone-700 dark:text-stone-300">
            {routineInsights.insights.map((line, i) => (
              <li key={i} className="flex items-start gap-2">
                <span className="text-emerald-600 dark:text-emerald-400 font-bold mt-0.5 shrink-0">•</span>
                <span>{line}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* Record / Edit Routine Form */}
      <form
        onSubmit={handleSaveRoutine}
        className="bg-white dark:bg-stone-900 rounded-3xl border border-stone-200 dark:border-stone-800 shadow-xs overflow-hidden transition-colors"
      >
        <button
          type="button"
          onClick={() => setIsLogCardExpanded((prev) => !prev)}
          aria-expanded={isLogCardExpanded}
          className={`w-full p-5 md:p-6 flex items-center justify-between gap-3 text-left hover:bg-stone-50/70 dark:hover:bg-stone-800/40 transition-colors cursor-pointer ${
            isLogCardExpanded ? 'border-b border-stone-100 dark:border-stone-800' : ''
          }`}
        >
          <div className="flex items-center gap-2 flex-wrap min-w-0">
            <h3 className="text-sm font-bold text-stone-900 dark:text-white flex items-center gap-2 whitespace-nowrap">
              <Plus className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
              <span>
                {editingRoutineId !== null
                  ? `Edit Routine Entry #${editingRoutineId}`
                  : 'Log Routine Entry'}
              </span>
            </h3>
            {activeProfile && (
              <span className="text-[11px] font-semibold px-2 py-0.5 rounded-lg bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300 whitespace-nowrap">
                Profile: {activeProfile.name}
              </span>
            )}
          </div>
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-stone-500 dark:text-stone-400 shrink-0">
            <span className="hidden sm:inline">{isLogCardExpanded ? 'Fold' : 'Expand'}</span>
            <ChevronDown
              className={`w-4 h-4 transition-transform ${isLogCardExpanded ? 'rotate-180' : ''}`}
            />
          </span>
        </button>

        {isLogCardExpanded && (
          <div className="p-5 md:p-6 space-y-4">
            {(latestRoutineRecord || editingRoutineId !== null) && (
              <div className="flex flex-wrap items-center gap-2">
                {latestRoutineRecord && (
                  <>
                    <button
                      type="button"
                      onClick={handleRetrieveLastRoutine}
                      className="px-2.5 py-1.5 text-[11px] font-semibold text-stone-700 dark:text-stone-200 bg-stone-100 dark:bg-stone-800 hover:bg-stone-200 dark:hover:bg-stone-700 border border-stone-200 dark:border-stone-700 rounded-xl transition-colors flex items-center gap-1 cursor-pointer"
                      title="Copy values from the latest routine entry into a new log"
                    >
                      <RotateCcw className="w-3 h-3" />
                      <span>Retrieve Last</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => requestEditRoutine(latestRoutineRecord)}
                      className="px-2.5 py-1.5 text-[11px] font-semibold text-emerald-900 dark:text-emerald-200 bg-emerald-50 dark:bg-emerald-950/60 hover:bg-emerald-100 dark:hover:bg-emerald-900 border border-emerald-200 dark:border-emerald-800 rounded-xl transition-colors flex items-center gap-1 cursor-pointer"
                      title="Authenticate with bae_Key to edit the latest routine entry"
                    >
                      <Lock className="w-3 h-3" />
                      <span>Edit Last</span>
                    </button>
                  </>
                )}
                {editingRoutineId !== null && (
                  <button
                    type="button"
                    onClick={() => resetRoutineForm(false)}
                    className="px-2 py-1.5 text-xs font-semibold text-stone-500 hover:text-stone-800 dark:hover:text-stone-200 flex items-center gap-1 cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                    <span>Cancel edit</span>
                  </button>
                )}
              </div>
            )}

        {retrieveNotice && (
          <div className="px-3 py-2 rounded-xl bg-emerald-50/80 dark:bg-emerald-950/40 border border-emerald-200/80 dark:border-emerald-900/60 text-xs text-emerald-900 dark:text-emerald-200 flex items-center justify-between gap-2">
            <span>{retrieveNotice}</span>
            <button
              type="button"
              onClick={() => setRetrieveNotice(null)}
              className="text-emerald-700 dark:text-emerald-300 hover:opacity-80 cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        <div className="space-y-3">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 sm:gap-3">
            <div className="min-w-0 col-span-2 sm:col-span-1">
              <label className="block text-[11px] font-semibold text-stone-600 dark:text-stone-300 mb-1">
                Logged By
              </label>
              <input
                type="text"
                value={loggedBy}
                onChange={(e) => setLoggedBy(e.target.value)}
                placeholder="e.g. Mom, Dad, Caregiver"
                className="w-full min-w-0 px-2.5 sm:px-3 py-2 text-xs bg-stone-50 dark:bg-stone-800 border border-stone-200 dark:border-stone-700 text-stone-900 dark:text-white rounded-xl focus:outline-hidden focus:border-emerald-500"
              />
            </div>

            <div className="min-w-0">
              <label className="block text-[11px] font-semibold text-stone-600 dark:text-stone-300 mb-1">
                Date
              </label>
              <input
                type="date"
                value={routineDate}
                onChange={(e) => setRoutineDate(e.target.value)}
                className="w-full min-w-0 px-2.5 sm:px-3 py-2 text-xs bg-stone-50 dark:bg-stone-800 border border-stone-200 dark:border-stone-700 text-stone-900 dark:text-white rounded-xl focus:outline-hidden focus:border-emerald-500"
              />
            </div>

            <div className="min-w-0">
              <label className="block text-[11px] font-semibold text-stone-600 dark:text-stone-300 mb-1">
                Time
              </label>
              <input
                type="time"
                value={routineTime}
                onChange={(e) => setRoutineTime(e.target.value)}
                className="w-full min-w-0 px-2.5 sm:px-3 py-2 text-xs bg-stone-50 dark:bg-stone-800 border border-stone-200 dark:border-stone-700 text-stone-900 dark:text-white rounded-xl focus:outline-hidden focus:border-emerald-500"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-3">
            <div className="min-w-0">
              <label className="block text-[11px] font-semibold text-stone-600 dark:text-stone-300 mb-1">
                Feed Duration (min)
              </label>
              <input
                type="number"
                min="0"
                step="1"
                value={feedDurationMin}
                onChange={(e) => setFeedDurationMin(e.target.value)}
                placeholder="e.g. 20"
                className="w-full min-w-0 px-2.5 sm:px-3 py-2 text-xs font-mono bg-stone-50 dark:bg-stone-800 border border-stone-200 dark:border-stone-700 text-stone-900 dark:text-white rounded-xl focus:outline-hidden focus:border-emerald-500"
              />
            </div>

            <div className="min-w-0">
              <label className="block text-[11px] font-semibold text-stone-600 dark:text-stone-300 mb-1">
                EBM (mL)
              </label>
              <input
                type="number"
                inputMode="numeric"
                min="0"
                step="1"
                value={ebmMl}
                onChange={(e) => setEbmMl(e.target.value)}
                placeholder="e.g. 90"
                className="w-full min-w-0 px-2.5 sm:px-3 py-2 text-xs font-mono bg-stone-50 dark:bg-stone-800 border border-stone-200 dark:border-stone-700 text-stone-900 dark:text-white rounded-xl focus:outline-hidden focus:border-emerald-500"
              />
            </div>

            <div className="min-w-0">
              <label className="block text-[11px] font-semibold text-stone-600 dark:text-stone-300 mb-1">
                Formula (mL)
              </label>
              <input
                type="number"
                inputMode="numeric"
                min="0"
                step="1"
                value={formulaMl}
                onChange={(e) => setFormulaMl(e.target.value)}
                placeholder="e.g. 60"
                className="w-full min-w-0 px-2.5 sm:px-3 py-2 text-xs font-mono bg-stone-50 dark:bg-stone-800 border border-stone-200 dark:border-stone-700 text-stone-900 dark:text-white rounded-xl focus:outline-hidden focus:border-emerald-500"
              />
            </div>

            <div className="min-w-0">
              <label className="block text-[11px] font-semibold text-stone-600 dark:text-stone-300 mb-1">
                Method
              </label>
              <FeedingMethodSelect
                value={feedingMethod}
                onChange={(val) => {
                  setFeedingMethod(val);
                  setMethodTouched(true);
                }}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2.5 sm:gap-3">
            <div className="min-w-0">
              <label className="block text-[11px] font-semibold text-stone-600 dark:text-stone-300 mb-1">
                Stool
              </label>
              <StoolSelect value={stool} onChange={setStool} />
            </div>

            <div className="min-w-0">
              <label className="block text-[11px] font-semibold text-stone-600 dark:text-stone-300 mb-1">
                Diaper Load
              </label>
              <DiaperLoadControl value={diaperLoad} onChange={setDiaperLoad} />
            </div>
          </div>

          <div className="min-w-0">
            <label className="block text-[11px] font-semibold text-stone-600 dark:text-stone-300 mb-1">
              Diaper
            </label>
            <div className="flex flex-wrap items-center gap-1.5">
              {DIAPER_PRESETS.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => setDiaper(diaper === preset ? '' : preset)}
                  className={`px-2.5 py-1.5 text-xs font-semibold rounded-xl border transition-colors cursor-pointer ${
                    diaper === preset
                      ? 'bg-emerald-600 text-white border-emerald-600'
                      : 'bg-stone-50 dark:bg-stone-800 text-stone-700 dark:text-stone-300 border-stone-200 dark:border-stone-700 hover:bg-stone-100 dark:hover:bg-stone-700'
                  }`}
                >
                  {preset}
                </button>
              ))}
              <input
                type="text"
                value={diaper}
                onChange={(e) => setDiaper(e.target.value)}
                placeholder="Or custom..."
                className="flex-1 min-w-[110px] px-2.5 sm:px-3 py-1.5 text-xs bg-stone-50 dark:bg-stone-800 border border-stone-200 dark:border-stone-700 text-stone-900 dark:text-white rounded-xl focus:outline-hidden focus:border-emerald-500"
              />
            </div>
          </div>
        </div>

        {dateTimeCollision && (
          <div
            className={`px-3 py-2.5 rounded-xl border text-xs flex flex-wrap items-center justify-between gap-2 ${
              dateTimeCollision.level === 'duplicate'
                ? 'bg-rose-50/90 dark:bg-rose-950/40 border-rose-200 dark:border-rose-900/70 text-rose-900 dark:text-rose-200'
                : 'bg-amber-50/90 dark:bg-amber-950/40 border-amber-200 dark:border-amber-900/70 text-amber-900 dark:text-amber-200'
            }`}
          >
            <div className="flex items-start gap-2 min-w-0 flex-1">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <div className="min-w-0">
                <span className="font-bold">
                  {dateTimeCollision.level === 'duplicate'
                    ? 'Duplicate entry detected (same date & time): '
                    : 'Conflicting entry at same date & time: '}
                </span>
                <span className="break-words">{dateTimeCollision.summary}</span>
              </div>
            </div>
            <button
              type="button"
              onClick={() => requestEditRoutine(dateTimeCollision.existing)}
              className="px-2.5 py-1 text-[11px] font-bold bg-white dark:bg-stone-900 border border-current/25 rounded-lg hover:opacity-85 transition-opacity cursor-pointer shrink-0"
            >
              Edit Existing
            </button>
          </div>
        )}

        <div className="flex flex-col sm:flex-row gap-2.5 sm:gap-3 items-stretch sm:items-end">
          <div className="flex-1 min-w-0">
            <label className="block text-[11px] font-semibold text-stone-600 dark:text-stone-300 mb-1">
              Remark
            </label>
            <input
              type="text"
              value={routineRemark}
              onChange={(e) => setRoutineRemark(e.target.value)}
              placeholder="Optional observation (e.g. burped well, sleepy after feed)"
              className="w-full min-w-0 px-2.5 sm:px-3 py-2 text-xs bg-stone-50 dark:bg-stone-800 border border-stone-200 dark:border-stone-700 text-stone-900 dark:text-white rounded-xl focus:outline-hidden focus:border-emerald-500"
            />
          </div>

          <button
            type="submit"
            disabled={isSavingRoutine}
            className="px-5 py-2 text-xs font-bold text-white bg-stone-900 hover:bg-stone-800 dark:bg-stone-100 dark:hover:bg-white dark:text-stone-900 rounded-xl shadow-xs transition-all flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-60"
          >
            {editingRoutineId !== null ? (
              <Check className="w-3.5 h-3.5" />
            ) : (
              <Plus className="w-3.5 h-3.5" />
            )}
            <span>
              {isSavingRoutine
                ? 'Saving...'
                : editingRoutineId !== null
                  ? 'Update Entry'
                  : 'Save Routine'}
            </span>
          </button>
        </div>

            {routineError && (
              <p className="text-xs font-medium text-rose-600 dark:text-rose-400">{routineError}</p>
            )}
          </div>
        )}
      </form>

      {/* Compact Milk Intake Suggestion Card (Infant / Baby / Toddler profiles only) */}
      {activeProfile?.type !== 'fetal' && (
      <div className="bg-white dark:bg-stone-900 rounded-3xl border border-stone-200 dark:border-stone-800 p-5 shadow-xs space-y-4 transition-colors">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-emerald-100 dark:bg-emerald-950/70 text-emerald-700 dark:text-emerald-300 flex items-center justify-center shrink-0">
              <Calculator className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-stone-900 dark:text-white">
                Milk Intake Suggestion
              </h3>
              <p className="text-[11px] text-stone-500 dark:text-stone-400">
                Weight basis:{' '}
                {currentWeightKg !== null ? (
                  <>
                    <strong className="font-mono text-stone-800 dark:text-stone-200">
                      {UnitConverter.formatKgValue(currentWeightKg)} kg
                    </strong>
                    {currentWeightInfo.sourceLabel && (
                      <span className="text-stone-400 dark:text-stone-500">
                        {' '}
                        ({currentWeightInfo.sourceLabel})
                      </span>
                    )}
                  </>
                ) : (
                  <span>No current weight logged yet</span>
                )}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setIsFormulaModalOpen(true)}
            className="px-3 py-1.5 text-xs font-semibold text-stone-700 dark:text-stone-200 bg-stone-100 dark:bg-stone-800 hover:bg-stone-200 dark:hover:bg-stone-700 border border-stone-200 dark:border-stone-700 rounded-xl transition-colors flex items-center gap-1.5 cursor-pointer"
          >
            <SlidersHorizontal className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
            <span>Formula &amp; Config</span>
          </button>
        </div>

        {currentWeightKg !== null &&
        routineInsights.recommendedFeedMl !== null &&
        routineInsights.perFeedMinMl !== null &&
        routineInsights.perFeedMaxMl !== null &&
        routineInsights.estimatedTargetMl !== null &&
        routineInsights.targetMinMl !== null &&
        routineInsights.targetMaxMl !== null ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {/* Per Feed Suggestion */}
            <div className="rounded-2xl border border-emerald-200/90 dark:border-emerald-900/60 bg-emerald-50/50 dark:bg-emerald-950/20 px-4 py-3.5 flex items-center justify-between gap-3">
              <div>
                <div className="text-[11px] font-bold text-emerald-950 dark:text-emerald-200 flex items-center gap-1.5 flex-wrap">
                  <span>Per Feed Target</span>
                  <span className="font-semibold text-emerald-700 dark:text-emerald-400">
                    · for {milkFormulaConfig.feedsPerDay} feed
                    {milkFormulaConfig.feedsPerDay === 1 ? '' : 's'}
                  </span>
                </div>
                <div className="mt-1">
                  <span className="text-2xl font-black font-mono text-stone-900 dark:text-white">
                    {routineInsights.recommendedFeedMl}
                  </span>
                  <span className="text-xs font-bold text-stone-500 dark:text-stone-400 ml-1">
                    mL / feed
                  </span>
                </div>
              </div>
              <div className="text-right">
                <div className="text-[10px] uppercase tracking-wider font-semibold text-stone-500 dark:text-stone-400">
                  Min – Max
                </div>
                <div className="text-sm font-bold font-mono text-stone-800 dark:text-stone-200 mt-0.5">
                  {routineInsights.perFeedMinMl} – {routineInsights.perFeedMaxMl} mL
                </div>
              </div>
            </div>

            {/* Per Day Suggestion */}
            <div className="rounded-2xl border border-stone-200 dark:border-stone-800 bg-stone-50/70 dark:bg-stone-800/40 px-4 py-3.5 flex items-center justify-between gap-3">
              <div>
                <div className="text-[11px] font-bold text-stone-800 dark:text-stone-200">
                  Per Day Target
                </div>
                <div className="mt-1">
                  <span className="text-2xl font-black font-mono text-stone-900 dark:text-white">
                    {routineInsights.estimatedTargetMl}
                  </span>
                  <span className="text-xs font-bold text-stone-500 dark:text-stone-400 ml-1">
                    mL / day
                  </span>
                </div>
              </div>
              <div className="text-right">
                <div className="text-[10px] uppercase tracking-wider font-semibold text-stone-500 dark:text-stone-400">
                  Min – Max
                </div>
                <div className="text-sm font-bold font-mono text-stone-800 dark:text-stone-200 mt-0.5">
                  {routineInsights.targetMinMl} – {routineInsights.targetMaxMl} mL
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-stone-200 dark:border-stone-700 p-3.5 text-xs text-stone-500 dark:text-stone-400">
            Log baby&apos;s current weight in the <strong>Growth</strong> tab (or set birth weight in the profile) to calculate daily and per-feed milk intake targets.
          </div>
        )}
      </div>
      )}

      {/* Analytics & Interactive Daily / Weekly / Monthly Box Plot Charts */}
      <RoutineSummaryAndChartsGrid
        records={filteredRoutine}
        routineInsights={routineInsights}
        profile={activeProfile}
        growthRecords={profileGrowthRecords}
        babyMeasurements={activeBabyMeasurements}
      />

      {/* Recent Routine Entries Table */}
      <div className="bg-white dark:bg-stone-900 rounded-3xl border border-stone-200 dark:border-stone-800 shadow-xs overflow-hidden transition-colors">
        <div className="px-5 py-3.5 border-b border-stone-100 dark:border-stone-800 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-xs font-bold text-stone-800 dark:text-stone-200 uppercase tracking-wider">
            Logged Routine Entries ({filteredRoutine.length})
          </h3>
          <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-stone-50 dark:bg-stone-800 border border-stone-200 dark:border-stone-700 text-xs transition-colors">
            <Filter className="w-3.5 h-3.5 text-stone-400" />
            <select
              aria-label="Filter routine records by person who logged them"
              value={loggerFilter}
              onChange={(e) => setLoggerFilter(e.target.value)}
              className="bg-transparent text-stone-700 dark:text-stone-200 font-semibold focus:outline-hidden cursor-pointer"
            >
              <option value="all" className="bg-white dark:bg-stone-900 text-stone-900 dark:text-stone-100">All Loggers</option>
              {availableLoggers.map((n) => (
                <option key={n} value={n} className="bg-white dark:bg-stone-900 text-stone-900 dark:text-stone-100">
                  {n}
                </option>
              ))}
            </select>
          </div>
        </div>
        {filteredRoutine.length === 0 ? (
          <div className="p-10 text-center text-xs text-stone-500 dark:text-stone-400">
            No routine records found yet. Log an entry above or click Refresh to load from Supabase.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-stone-50/80 dark:bg-stone-800/80 border-b border-stone-200 dark:border-stone-800 text-stone-500 dark:text-stone-400 text-[11px] font-semibold">
                  <th className="py-3 px-4">Date &amp; Time</th>
                  <th className="py-3 px-4">Logged By</th>
                  <th className="py-3 px-4">EBM (mL)</th>
                  <th className="py-3 px-4">Formula (mL)</th>
                  <th className="py-3 px-4">Total (mL)</th>
                  <th className="py-3 px-4">Duration</th>
                  <th className="py-3 px-4">Method</th>
                  <th className="py-3 px-4">Diaper</th>
                  <th className="py-3 px-4">Diaper Load</th>
                  <th className="py-3 px-4">Stool</th>
                  <th className="py-3 px-4">Remark</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100 dark:divide-stone-800 text-stone-700 dark:text-stone-300">
                {filteredRoutine.map((row) => {
                  const totalVol = (row.emb_mL ?? 0) + (row.formula_mL ?? 0);
                  const methodLabel = formatFeedingMethodLabel(row.feeding_method);
                  return (
                    <tr
                      key={row.id}
                      className="hover:bg-stone-50/70 dark:hover:bg-stone-800/40 transition-colors"
                    >
                      <td className="py-3 px-4 whitespace-nowrap font-bold text-stone-900 dark:text-white">
                        <span>{getRoutineRecordDate(row)}</span>
                        {row.time && (
                          <span className="ml-1.5 font-mono text-[11px] text-stone-500 dark:text-stone-400 font-normal">
                            {row.time.slice(0, 5)}
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap">{row.name || '—'}</td>
                      <td className="py-3 px-4 font-mono whitespace-nowrap text-emerald-700 dark:text-emerald-400 font-semibold">
                        {row.emb_mL !== null ? `${row.emb_mL} mL` : '—'}
                      </td>
                      <td className="py-3 px-4 font-mono whitespace-nowrap text-amber-700 dark:text-amber-400 font-semibold">
                        {row.formula_mL !== null ? `${row.formula_mL} mL` : '—'}
                      </td>
                      <td className="py-3 px-4 font-mono font-bold whitespace-nowrap">
                        {totalVol > 0 ? `${totalVol} mL` : '—'}
                      </td>
                      <td className="py-3 px-4 font-mono whitespace-nowrap">
                        {row.feed_duration_min !== null
                          ? `${row.feed_duration_min} min`
                          : '—'}
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap">
                        {methodLabel ? (
                          <span className="px-2 py-0.5 rounded-lg bg-sky-50 dark:bg-sky-950/50 text-sky-900 dark:text-sky-200 font-semibold">
                            {methodLabel}
                          </span>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap">
                        {row.diaper ? (
                          <span className="px-2 py-0.5 rounded-lg bg-stone-100 dark:bg-stone-800 text-stone-700 dark:text-stone-200 font-semibold">
                            {row.diaper}
                          </span>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap">
                        {row['diaper load'] !== null ? (
                          <span className="px-2 py-0.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/50 text-emerald-900 dark:text-emerald-200 font-mono font-semibold">
                            {formatDiaperLoad(row['diaper load'])}
                          </span>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap">
                        {row.stool ? (
                          <span className="px-2 py-0.5 rounded-lg bg-amber-50 dark:bg-amber-950/50 text-amber-900 dark:text-amber-200 font-mono font-semibold">
                            {row.stool}
                          </span>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap">
                        <RemarkTooltipCell remark={row.remark} />
                      </td>
                      <td className="py-3 px-4 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => requestEditRoutine(row)}
                            className="p-1.5 text-stone-400 hover:text-stone-800 dark:hover:text-white rounded-lg hover:bg-stone-100 dark:hover:bg-stone-800 transition-colors cursor-pointer"
                            title="Authenticate with bae_Key to edit routine entry"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          {pendingDeleteId === row.id ? (
                            <button
                              type="button"
                              onClick={() => {
                                setPendingDeleteId(null);
                                void removeRoutineRecord(row.id);
                              }}
                              className="px-2 py-1 text-[10px] font-bold text-white bg-rose-600 hover:bg-rose-700 rounded-lg cursor-pointer"
                            >
                              Confirm
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setPendingDeleteId(row.id)}
                              className="p-1.5 text-stone-400 hover:text-rose-600 dark:hover:text-rose-400 rounded-lg hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors cursor-pointer"
                              title="Delete routine entry"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Floating Milk Intake Formula & Configuration Window */}
      {isFormulaModalOpen && (
        <div
          className="fixed inset-0 z-50 bg-stone-950/50 backdrop-blur-xs flex items-center justify-center p-4"
          onClick={() => setIsFormulaModalOpen(false)}
          role="dialog"
          aria-modal="true"
          aria-labelledby="milk-formula-modal-title"
        >
          <div
            className="w-full max-w-xl bg-white dark:bg-stone-900 rounded-3xl border border-stone-200 dark:border-stone-800 shadow-2xl overflow-hidden max-h-[90vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="px-5 py-4 border-b border-stone-100 dark:border-stone-800 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-emerald-100 dark:bg-emerald-950/70 text-emerald-700 dark:text-emerald-300 flex items-center justify-center">
                  <Calculator className="w-4 h-4" />
                </div>
                <div>
                  <h3
                    id="milk-formula-modal-title"
                    className="text-sm font-bold text-stone-900 dark:text-white"
                  >
                    Milk Intake Formula &amp; Configuration
                  </h3>
                  <p className="text-[11px] text-stone-500 dark:text-stone-400">
                    Calculated automatically from baby&apos;s current weight
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsFormulaModalOpen(false)}
                className="p-1.5 rounded-xl text-stone-400 hover:text-stone-700 dark:hover:text-stone-200 hover:bg-stone-100 dark:hover:bg-stone-800 transition-colors cursor-pointer"
                aria-label="Close milk intake formula window"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-5 space-y-5 overflow-y-auto">
              {/* Current Baby Weight Basis */}
              <div className="rounded-2xl bg-stone-50 dark:bg-stone-800/70 border border-stone-200/80 dark:border-stone-700/70 px-4 py-3 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="text-[10px] uppercase tracking-wider font-semibold text-stone-500 dark:text-stone-400">
                    Current Baby Weight Basis
                  </div>
                  <div className="text-sm font-bold text-stone-900 dark:text-white mt-0.5">
                    {currentWeightKg !== null ? (
                      <span className="font-mono">{UnitConverter.formatKgValue(currentWeightKg)} kg</span>
                    ) : (
                      <span className="text-stone-500 font-normal">
                        No weight logged yet — log a weight in the Growth tab
                      </span>
                    )}
                  </div>
                </div>
                {currentWeightInfo.sourceLabel && (
                  <span className="text-[11px] font-medium text-stone-500 dark:text-stone-400">
                    {currentWeightInfo.sourceLabel}
                  </span>
                )}
              </div>

              {/* Editable Configuration Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <div>
                  <label className="block text-[11px] font-semibold text-stone-600 dark:text-stone-300 mb-1">
                    Min Rate <span className="font-mono text-stone-400">(x, mL/kg/day)</span>
                  </label>
                  <input
                    type="number"
                    min="1"
                    step="5"
                    value={minRateInput}
                    onChange={(e) => setMinRateInput(e.target.value)}
                    className="w-full px-3 py-2 text-xs font-mono bg-stone-50 dark:bg-stone-800 border border-stone-200 dark:border-stone-700 text-stone-900 dark:text-white rounded-xl focus:outline-hidden focus:border-emerald-500"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-stone-600 dark:text-stone-300 mb-1">
                    Max Rate <span className="font-mono text-stone-400">(y, mL/kg/day)</span>
                  </label>
                  <input
                    type="number"
                    min="1"
                    step="5"
                    value={maxRateInput}
                    onChange={(e) => setMaxRateInput(e.target.value)}
                    className="w-full px-3 py-2 text-xs font-mono bg-stone-50 dark:bg-stone-800 border border-stone-200 dark:border-stone-700 text-stone-900 dark:text-white rounded-xl focus:outline-hidden focus:border-emerald-500"
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-[11px] font-semibold text-stone-600 dark:text-stone-300">
                      Feeds / Day
                    </label>
                    <span className="text-[10px] font-mono text-stone-400">
                      ~{(24 / milkFormulaConfig.feedsPerDay).toFixed(1)}h apart
                    </span>
                  </div>
                  <input
                    type="number"
                    min="1"
                    max="24"
                    step="1"
                    value={feedsPerDayInput}
                    onChange={(e) => setFeedsPerDayInput(e.target.value)}
                    className="w-full px-3 py-2 text-xs font-mono bg-stone-50 dark:bg-stone-800 border border-stone-200 dark:border-stone-700 text-stone-900 dark:text-white rounded-xl focus:outline-hidden focus:border-emerald-500"
                  />
                  {routineInsights.todayBucket.feedCount > 0 &&
                    routineInsights.todayBucket.feedCount !== milkFormulaConfig.feedsPerDay && (
                      <button
                        type="button"
                        onClick={() =>
                          setFeedsPerDayInput(String(routineInsights.todayBucket.feedCount))
                        }
                        className="mt-1.5 text-[11px] font-semibold text-emerald-700 dark:text-emerald-400 hover:underline cursor-pointer"
                      >
                        Use {routineInsights.activeDateLabel.toLowerCase()}&apos;s{' '}
                        {routineInsights.todayBucket.feedCount} feeds
                      </button>
                    )}
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-[11px] font-semibold text-stone-600 dark:text-stone-300">
                      Target in Range <span className="font-mono text-stone-400">(z%)</span>
                    </label>
                    <span className="text-[10px] font-mono text-emerald-700 dark:text-emerald-400 font-semibold">
                      {routineInsights.effectiveTargetMlPerKg} mL/kg
                    </span>
                  </div>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="5"
                    value={targetPctInput}
                    onChange={(e) => setTargetPctInput(e.target.value)}
                    className="w-full px-3 py-2 text-xs font-mono bg-stone-50 dark:bg-stone-800 border border-stone-200 dark:border-stone-700 text-stone-900 dark:text-white rounded-xl focus:outline-hidden focus:border-emerald-500"
                  />
                  <input
                    type="range"
                    aria-label="Target percentage within min-max milk intake range"
                    min={0}
                    max={100}
                    step={5}
                    value={milkFormulaConfig.targetRangePct}
                    onChange={(e) => setTargetPctInput(e.target.value)}
                    className="w-full mt-2 accent-emerald-600 cursor-pointer h-1.5"
                  />
                </div>
              </div>

              {/* Full Formula Reference */}
              <div className="rounded-2xl border border-emerald-200/80 dark:border-emerald-900/60 bg-emerald-50/40 dark:bg-emerald-950/20 p-4 space-y-2 text-xs">
                <div className="font-bold text-emerald-950 dark:text-emerald-200">
                  Formula Breakdown
                </div>
                <div className="space-y-1.5 font-mono text-[11px] text-stone-700 dark:text-stone-300">
                  <div className="flex flex-wrap justify-between gap-2">
                    <span>Daily Min = Weight × x</span>
                    <span className="font-bold text-stone-900 dark:text-white">
                      {currentWeightKg !== null && routineInsights.targetMinMl !== null
                        ? `${UnitConverter.formatKgValue(currentWeightKg)} × ${lowFormulaRate} = ${routineInsights.targetMinMl} mL`
                        : `${lowFormulaRate} mL/kg`}
                    </span>
                  </div>
                  <div className="flex flex-wrap justify-between gap-2">
                    <span>Daily Max = Weight × y</span>
                    <span className="font-bold text-stone-900 dark:text-white">
                      {currentWeightKg !== null && routineInsights.targetMaxMl !== null
                        ? `${UnitConverter.formatKgValue(currentWeightKg)} × ${highFormulaRate} = ${routineInsights.targetMaxMl} mL`
                        : `${highFormulaRate} mL/kg`}
                    </span>
                  </div>
                  <div className="flex flex-wrap justify-between gap-2">
                    <span>Daily Target = Weight × [x + z% × (y − x)]</span>
                    <span className="font-bold text-emerald-800 dark:text-emerald-300">
                      {currentWeightKg !== null && routineInsights.estimatedTargetMl !== null
                        ? `${UnitConverter.formatKgValue(currentWeightKg)} × ${routineInsights.effectiveTargetMlPerKg} = ${routineInsights.estimatedTargetMl} mL`
                        : `${routineInsights.effectiveTargetMlPerKg} mL/kg`}
                    </span>
                  </div>
                  <div className="flex flex-wrap justify-between gap-2 pt-1.5 border-t border-emerald-200/70 dark:border-emerald-900/50">
                    <span>Per Feed Target = Daily Target ÷ Feeds/day</span>
                    <span className="font-bold text-emerald-800 dark:text-emerald-300">
                      {routineInsights.estimatedTargetMl !== null &&
                      routineInsights.recommendedFeedMl !== null
                        ? `${routineInsights.estimatedTargetMl} ÷ ${milkFormulaConfig.feedsPerDay} = ${routineInsights.recommendedFeedMl} mL (${routineInsights.perFeedMinMl}–${routineInsights.perFeedMaxMl})`
                        : `÷ ${milkFormulaConfig.feedsPerDay} feeds`}
                    </span>
                  </div>
                </div>
              </div>

              {/* Live Visual Preview Bars */}
              {currentWeightKg !== null &&
                routineInsights.recommendedFeedMl !== null &&
                routineInsights.perFeedMinMl !== null &&
                routineInsights.perFeedMaxMl !== null &&
                routineInsights.estimatedTargetMl !== null &&
                routineInsights.targetMinMl !== null &&
                routineInsights.targetMaxMl !== null && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="rounded-2xl border border-stone-200 dark:border-stone-800 p-3 space-y-2">
                      <div className="flex items-center justify-between text-[11px] font-bold text-stone-700 dark:text-stone-200">
                        <span>Per Feed ({milkFormulaConfig.targetRangePct}%)</span>
                        <span className="font-mono text-emerald-700 dark:text-emerald-400">
                          {routineInsights.recommendedFeedMl} mL
                        </span>
                      </div>
                      <div className="relative h-2 rounded-full bg-emerald-200/70 dark:bg-emerald-900/60">
                        <div
                          className="absolute inset-y-0 left-0 rounded-full bg-emerald-500/80 dark:bg-emerald-400/80"
                          style={{ width: `${milkFormulaConfig.targetRangePct}%` }}
                        />
                        <div
                          className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3 h-3 rounded-full bg-stone-900 dark:bg-white border-2 border-emerald-500"
                          style={{ left: `${milkFormulaConfig.targetRangePct}%` }}
                        />
                      </div>
                      <div className="flex justify-between text-[10px] font-mono text-stone-500 dark:text-stone-400">
                        <span>Min {routineInsights.perFeedMinMl} mL</span>
                        <span>Max {routineInsights.perFeedMaxMl} mL</span>
                      </div>
                    </div>

                    <div className="rounded-2xl border border-stone-200 dark:border-stone-800 p-3 space-y-2">
                      <div className="flex items-center justify-between text-[11px] font-bold text-stone-700 dark:text-stone-200">
                        <span>Per Day ({milkFormulaConfig.targetRangePct}%)</span>
                        <span className="font-mono text-stone-900 dark:text-white">
                          {routineInsights.estimatedTargetMl} mL
                        </span>
                      </div>
                      <div className="relative h-2 rounded-full bg-stone-200 dark:bg-stone-700">
                        <div
                          className="absolute inset-y-0 left-0 rounded-full bg-stone-500/80 dark:bg-stone-400/80"
                          style={{ width: `${milkFormulaConfig.targetRangePct}%` }}
                        />
                        <div
                          className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3 h-3 rounded-full bg-stone-900 dark:bg-white border-2 border-stone-500"
                          style={{ left: `${milkFormulaConfig.targetRangePct}%` }}
                        />
                      </div>
                      <div className="flex justify-between text-[10px] font-mono text-stone-500 dark:text-stone-400">
                        <span>Min {routineInsights.targetMinMl} mL</span>
                        <span>Max {routineInsights.targetMaxMl} mL</span>
                      </div>
                    </div>
                  </div>
                )}
            </div>

            {/* Modal Footer */}
            <div className="px-5 py-3.5 border-t border-stone-100 dark:border-stone-800 flex items-center justify-between gap-2 bg-stone-50/70 dark:bg-stone-900/80">
              <button
                type="button"
                onClick={resetMilkFormula}
                disabled={!isFormulaCustomized}
                className="px-3 py-1.5 text-xs font-semibold text-stone-600 dark:text-stone-300 bg-white dark:bg-stone-800 hover:bg-stone-100 dark:hover:bg-stone-700 border border-stone-200 dark:border-stone-700 rounded-xl transition-colors flex items-center gap-1.5 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Reset Defaults</span>
              </button>

              <button
                type="button"
                onClick={() => setIsFormulaModalOpen(false)}
                className="px-4 py-1.5 text-xs font-bold text-white bg-stone-900 hover:bg-stone-800 dark:bg-stone-100 dark:hover:bg-white dark:text-stone-900 rounded-xl transition-colors cursor-pointer"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* bae_Key Authentication Modal for Editing Routine Entries */}
      <EditAuthModal
        isOpen={Boolean(pendingAuthRecord)}
        title="Authenticate to Edit Routine Entry"
        description={
          pendingAuthRecord
            ? `Enter your bae_Key passkey to edit routine record #${pendingAuthRecord.id} (${getRoutineRecordDate(pendingAuthRecord)}${pendingAuthRecord.time ? ` ${pendingAuthRecord.time.slice(0, 5)}` : ''}).`
            : undefined
        }
        onClose={() => setPendingAuthRecord(null)}
        onAuthenticated={() => {
          if (pendingAuthRecord) {
            const target = pendingAuthRecord;
            setPendingAuthRecord(null);
            applyEditRoutine(target);
          }
        }}
      />

      <AskGeminiModal
        isOpen={isAskGeminiOpen}
        onClose={() => setIsAskGeminiOpen(false)}
        focus="routine"
      />
    </div>
  );
};
