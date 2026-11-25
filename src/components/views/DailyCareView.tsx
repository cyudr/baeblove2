import React, { useState, useMemo, useEffect } from 'react';
import { useApp } from '../../context/AppContext';
import { UnitConverter } from '../../data/growthStandards';
import {
  classifyTemperature,
  getRoutineRecordDate,
  interpretGrowthTable,
  interpretRoutineTable,
} from '../../utils/careInterpreter';
import type { GrowthRecord, RoutineRecord } from '../../types';
import {
  Droplets,
  Thermometer,
  Scale,
  Ruler,
  Clock,
  Plus,
  RefreshCw,
  Pencil,
  Trash2,
  Check,
  X,
  Sparkles,
  Activity,
  Baby,
  Filter,
} from 'lucide-react';

const DIAPER_PRESETS = ['Wet', 'Dirty', 'Mixed', 'Dry'] as const;

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

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function tempBadgeClasses(severity: 'low' | 'normal' | 'elevated' | 'fever'): string {
  switch (severity) {
    case 'normal':
      return 'bg-emerald-100/80 dark:bg-emerald-950/70 text-emerald-800 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800';
    case 'elevated':
      return 'bg-amber-100/80 dark:bg-amber-950/70 text-amber-900 dark:text-amber-300 border-amber-200 dark:border-amber-800';
    case 'fever':
      return 'bg-rose-100/80 dark:bg-rose-950/70 text-rose-800 dark:text-rose-300 border-rose-200 dark:border-rose-800';
    case 'low':
      return 'bg-sky-100/80 dark:bg-sky-950/70 text-sky-800 dark:text-sky-300 border-sky-200 dark:border-sky-800';
  }
}

export const DailyCareView: React.FC = () => {
  const {
    activeProfile,
    activeBabyMeasurements,
    unitSystem,
    growthRecords,
    routineRecords,
    isCareTablesLoading,
    refreshCareTables,
    addGrowthRecord,
    editGrowthRecord,
    removeGrowthRecord,
    addRoutineRecord,
    editRoutineRecord,
    removeRoutineRecord,
  } = useApp();

  const [section, setSection] = useState<'routine' | 'growth'>('routine');
  const [nameFilter, setNameFilter] = useState<string>('all');

  // Routine form state
  const [editingRoutineId, setEditingRoutineId] = useState<number | null>(null);
  const [routineName, setRoutineName] = useState<string>(activeProfile?.name || '');
  const [routineDate, setRoutineDate] = useState<string>(getCurrentDateStr);
  const [routineTime, setRoutineTime] = useState<string>(getCurrentTimeStr);
  const [ebmMl, setEbmMl] = useState<string>('');
  const [formulaMl, setFormulaMl] = useState<string>('');
  const [feedDurationMin, setFeedDurationMin] = useState<string>('');
  const [diaper, setDiaper] = useState<string>('');
  const [routineRemark, setRoutineRemark] = useState<string>('');
  const [routineError, setRoutineError] = useState<string | null>(null);
  const [isSavingRoutine, setIsSavingRoutine] = useState(false);

  // Growth form state
  const [editingGrowthId, setEditingGrowthId] = useState<number | null>(null);
  const [growthName, setGrowthName] = useState<string>(activeProfile?.name || '');
  const [dailyWeight, setDailyWeight] = useState<string>('');
  const [dailyLength, setDailyLength] = useState<string>('');
  const [temperature, setTemperature] = useState<string>('');
  const [growthRemark, setGrowthRemark] = useState<string>('');
  const [growthError, setGrowthError] = useState<string | null>(null);
  const [isSavingGrowth, setIsSavingGrowth] = useState(false);

  // Two-step inline delete confirmation
  const [pendingDeleteKey, setPendingDeleteKey] = useState<string | null>(null);

  useEffect(() => {
    if (!editingRoutineId && activeProfile?.name) {
      setRoutineName(activeProfile.name);
    }
    if (!editingGrowthId && activeProfile?.name) {
      setGrowthName(activeProfile.name);
    }
  }, [activeProfile?.name, editingRoutineId, editingGrowthId]);

  // Distinct names present across both tables + active profile
  const availableNames = useMemo(() => {
    const set = new Set<string>();
    if (activeProfile?.name) set.add(activeProfile.name);
    for (const r of routineRecords) {
      if (r.name?.trim()) set.add(r.name.trim());
    }
    for (const g of growthRecords) {
      if (g.name?.trim()) set.add(g.name.trim());
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [activeProfile?.name, routineRecords, growthRecords]);

  const filteredRoutine = useMemo(() => {
    if (nameFilter === 'all') return routineRecords;
    const target = nameFilter.trim().toLowerCase();
    return routineRecords.filter((r) => (r.name ?? '').trim().toLowerCase() === target);
  }, [routineRecords, nameFilter]);

  const filteredGrowth = useMemo(() => {
    if (nameFilter === 'all') return growthRecords;
    const target = nameFilter.trim().toLowerCase();
    return growthRecords.filter((g) => (g.name ?? '').trim().toLowerCase() === target);
  }, [growthRecords, nameFilter]);

  const growthInsights = useMemo(
    () => interpretGrowthTable(filteredGrowth, activeProfile),
    [filteredGrowth, activeProfile]
  );

  // Use latest weight from `growth` table if present, otherwise fallback to active baby measurement
  const referenceWeightKg = useMemo(() => {
    if (growthInsights.latestWeightKg !== null) return growthInsights.latestWeightKg;
    const latestBaby = activeBabyMeasurements[activeBabyMeasurements.length - 1];
    return latestBaby?.weightKg ?? activeProfile?.birthWeightKg ?? null;
  }, [growthInsights.latestWeightKg, activeBabyMeasurements, activeProfile?.birthWeightKg]);

  const routineInsights = useMemo(
    () => interpretRoutineTable(filteredRoutine, referenceWeightKg),
    [filteredRoutine, referenceWeightKg]
  );

  const liveTempPreview = useMemo(() => {
    const parsed = parseFloat(temperature);
    if (!temperature || Number.isNaN(parsed) || parsed < 30 || parsed > 45) return null;
    return classifyTemperature(parsed);
  }, [temperature]);

  const resetRoutineForm = () => {
    setEditingRoutineId(null);
    setRoutineName(activeProfile?.name || '');
    setRoutineDate(getCurrentDateStr());
    setRoutineTime(getCurrentTimeStr());
    setEbmMl('');
    setFormulaMl('');
    setFeedDurationMin('');
    setDiaper('');
    setRoutineRemark('');
    setRoutineError(null);
  };

  const resetGrowthForm = () => {
    setEditingGrowthId(null);
    setGrowthName(activeProfile?.name || '');
    setDailyWeight('');
    setDailyLength('');
    setTemperature('');
    setGrowthRemark('');
    setGrowthError(null);
  };

  const handleSaveRoutine = async (e: React.FormEvent) => {
    e.preventDefault();
    setRoutineError(null);

    const parsedEbm = ebmMl.trim() !== '' ? parseInt(ebmMl, 10) : null;
    const parsedFormula = formulaMl.trim() !== '' ? parseInt(formulaMl, 10) : null;
    const parsedDuration = feedDurationMin.trim() !== '' ? parseInt(feedDurationMin, 10) : null;

    if (
      parsedEbm === null &&
      parsedFormula === null &&
      parsedDuration === null &&
      !diaper.trim() &&
      !routineRemark.trim()
    ) {
      setRoutineError('Enter at least one routine value (EBM, Formula, duration, diaper, or remark).');
      return;
    }

    setIsSavingRoutine(true);
    try {
      const payload = {
        date: routineDate || null,
        time: routineTime || null,
        'EBM (mL)': parsedEbm,
        'Formula (mL)': parsedFormula,
        Diaper: diaper.trim() || null,
        name: routineName.trim() || activeProfile?.name || null,
        remark: routineRemark.trim() || null,
        'feed duration (min)': parsedDuration,
      };

      const res =
        editingRoutineId !== null
          ? await editRoutineRecord(editingRoutineId, payload)
          : await addRoutineRecord(payload);

      if (res.error) {
        setRoutineError(res.error);
      } else {
        resetRoutineForm();
      }
    } finally {
      setIsSavingRoutine(false);
    }
  };

  const handleEditRoutine = (row: RoutineRecord) => {
    setSection('routine');
    setEditingRoutineId(row.id);
    setRoutineName(row.name ?? activeProfile?.name ?? '');
    setRoutineDate(row.date ? row.date.slice(0, 10) : getCurrentDateStr());
    setRoutineTime(row.time ? row.time.slice(0, 5) : getCurrentTimeStr());
    setEbmMl(row['EBM (mL)'] !== null ? String(row['EBM (mL)']) : '');
    setFormulaMl(row['Formula (mL)'] !== null ? String(row['Formula (mL)']) : '');
    setFeedDurationMin(
      row['feed duration (min)'] !== null ? String(row['feed duration (min)']) : ''
    );
    setDiaper(row.Diaper ?? '');
    setRoutineRemark(row.remark ?? '');
    setRoutineError(null);
  };

  const handleSaveGrowth = async (e: React.FormEvent) => {
    e.preventDefault();
    setGrowthError(null);

    const parsedWeight = dailyWeight.trim() !== '' ? parseFloat(dailyWeight) : null;
    const parsedLength = dailyLength.trim() !== '' ? parseFloat(dailyLength) : null;
    const parsedTemp = temperature.trim() !== '' ? parseFloat(temperature) : null;

    if (
      parsedWeight === null &&
      parsedLength === null &&
      parsedTemp === null &&
      !growthRemark.trim()
    ) {
      setGrowthError('Enter at least one measurement (weight, length, temperature, or remark).');
      return;
    }

    setIsSavingGrowth(true);
    try {
      const payload = {
        daily_weight: parsedWeight,
        daily_length: parsedLength,
        temperature: parsedTemp,
        remark: growthRemark.trim() || null,
        name: growthName.trim() || activeProfile?.name || null,
      };

      const res =
        editingGrowthId !== null
          ? await editGrowthRecord(editingGrowthId, payload)
          : await addGrowthRecord(payload);

      if (res.error) {
        setGrowthError(res.error);
      } else {
        resetGrowthForm();
      }
    } finally {
      setIsSavingGrowth(false);
    }
  };

  const handleEditGrowth = (row: GrowthRecord) => {
    setSection('growth');
    setEditingGrowthId(row.id);
    setGrowthName(row.name ?? activeProfile?.name ?? '');
    setDailyWeight(row.daily_weight !== null ? String(row.daily_weight) : '');
    setDailyLength(row.daily_length !== null ? String(row.daily_length) : '');
    setTemperature(row.temperature !== null ? String(row.temperature) : '');
    setGrowthRemark(row.remark ?? '');
    setGrowthError(null);
  };

  const maxSeriesMl = Math.max(
    1,
    ...routineInsights.dailySeries.map((d) => d.totalMl),
    routineInsights.estimatedTargetMl ?? 0
  );

  return (
    <div className="space-y-6">
      {/* Header Card */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white dark:bg-stone-900 rounded-3xl border border-stone-200 dark:border-stone-800 p-5 md:p-6 shadow-xs transition-colors">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-2xl bg-emerald-100 dark:bg-emerald-950/70 text-emerald-700 dark:text-emerald-300 flex items-center justify-center shadow-2xs">
              <Activity className="w-4 h-4" />
            </div>
            <h2 className="text-xl font-bold text-stone-900 dark:text-white">
              Daily Routine &amp; Growth Log
            </h2>
          </div>
          <p className="text-xs text-stone-500 dark:text-stone-400 mt-1">
            Record, load, and interpret daily feeds (EBM &amp; formula), diapers, weight, length, and temperature.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-stone-50 dark:bg-stone-800 border border-stone-200 dark:border-stone-700 text-xs">
            <Filter className="w-3.5 h-3.5 text-stone-400" />
            <select
              aria-label="Filter records by child name"
              value={nameFilter}
              onChange={(e) => setNameFilter(e.target.value)}
              className="bg-transparent text-stone-700 dark:text-stone-200 font-semibold focus:outline-hidden cursor-pointer"
            >
              <option value="all">All Names</option>
              {availableNames.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </div>

          <button
            type="button"
            onClick={() => void refreshCareTables()}
            disabled={isCareTablesLoading}
            className="px-3.5 py-2 text-xs font-semibold text-stone-700 dark:text-stone-200 bg-stone-100 dark:bg-stone-800 hover:bg-stone-200 dark:hover:bg-stone-700 border border-stone-200/70 dark:border-stone-700 rounded-xl transition-colors flex items-center gap-1.5 cursor-pointer disabled:opacity-60"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isCareTablesLoading ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* Section Switcher */}
      <div className="flex items-center gap-1.5 p-1.5 bg-stone-200/60 dark:bg-stone-900 rounded-2xl border border-stone-200 dark:border-stone-800 w-fit">
        <button
          type="button"
          onClick={() => setSection('routine')}
          className={`px-4 py-2 text-xs font-bold rounded-xl transition-all flex items-center gap-2 cursor-pointer ${
            section === 'routine'
              ? 'bg-white dark:bg-stone-800 text-stone-900 dark:text-white shadow-xs'
              : 'text-stone-600 dark:text-stone-400 hover:text-stone-900 dark:hover:text-white'
          }`}
        >
          <Droplets className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
          <span>Routine ({filteredRoutine.length})</span>
        </button>

        <button
          type="button"
          onClick={() => setSection('growth')}
          className={`px-4 py-2 text-xs font-bold rounded-xl transition-all flex items-center gap-2 cursor-pointer ${
            section === 'growth'
              ? 'bg-white dark:bg-stone-800 text-stone-900 dark:text-white shadow-xs'
              : 'text-stone-600 dark:text-stone-400 hover:text-stone-900 dark:hover:text-white'
          }`}
        >
          <Thermometer className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
          <span>Growth &amp; Vitals ({filteredGrowth.length})</span>
        </button>
      </div>

      {/* ================================================================ */}
      {/* ROUTINE TAB                                                      */}
      {/* ================================================================ */}
      {section === 'routine' && (
        <div className="space-y-6">
          {/* Analytics & Interpretation KPI Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3.5">
            {/* Total Milk Intake */}
            <div className="bg-white dark:bg-stone-900 rounded-3xl border border-stone-200 dark:border-stone-800 p-5 shadow-xs flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between text-xs font-bold text-stone-700 dark:text-stone-200">
                  <span className="flex items-center gap-2">
                    <Droplets className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                    Milk Intake ({routineInsights.activeDateLabel})
                  </span>
                  {routineInsights.targetProgressPct !== null && (
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100/80 dark:bg-emerald-950/70 text-emerald-800 dark:text-emerald-300">
                      {routineInsights.targetProgressPct}% goal
                    </span>
                  )}
                </div>
                <div className="text-3xl font-black text-stone-900 dark:text-white mt-2">
                  {routineInsights.todayBucket.totalMl} <span className="text-base font-bold text-stone-400">mL</span>
                </div>
                <div className="text-[11px] text-stone-500 dark:text-stone-400 mt-1">
                  EBM: <strong className="text-emerald-700 dark:text-emerald-400">{routineInsights.todayBucket.ebmMl} mL</strong>
                  {' · '}
                  Formula: <strong className="text-amber-700 dark:text-amber-400">{routineInsights.todayBucket.formulaMl} mL</strong>
                </div>
              </div>

              <div className="mt-3 space-y-1.5">
                <div className="w-full h-2.5 bg-stone-100 dark:bg-stone-800 rounded-full overflow-hidden flex">
                  {routineInsights.todayBucket.totalMl > 0 && (
                    <>
                      <div
                        className="h-full bg-emerald-500"
                        style={{ width: `${routineInsights.ebmSharePct}%` }}
                        title={`EBM ${routineInsights.ebmSharePct}%`}
                      />
                      <div
                        className="h-full bg-amber-500"
                        style={{ width: `${routineInsights.formulaSharePct}%` }}
                        title={`Formula ${routineInsights.formulaSharePct}%`}
                      />
                    </>
                  )}
                </div>
                <div className="flex justify-between text-[10px] text-stone-400 dark:text-stone-500 font-medium">
                  <span>EBM {routineInsights.ebmSharePct}%</span>
                  <span>
                    {routineInsights.estimatedTargetMl
                      ? `Est. target ~${routineInsights.estimatedTargetMl} mL`
                      : `Formula ${routineInsights.formulaSharePct}%`}
                  </span>
                </div>
              </div>
            </div>

            {/* Feeding Rhythm */}
            <div className="bg-white dark:bg-stone-900 rounded-3xl border border-stone-200 dark:border-stone-800 p-5 shadow-xs flex flex-col justify-between">
              <div>
                <div className="flex items-center gap-2 text-xs font-bold text-stone-700 dark:text-stone-200">
                  <Clock className="w-4 h-4 text-sky-600 dark:text-sky-400" />
                  <span>Feeding Rhythm</span>
                </div>
                <div className="text-3xl font-black text-stone-900 dark:text-white mt-2">
                  {routineInsights.todayBucket.feedCount}{' '}
                  <span className="text-base font-bold text-stone-400">
                    feed{routineInsights.todayBucket.feedCount === 1 ? '' : 's'}
                  </span>
                </div>
                <div className="text-[11px] text-stone-500 dark:text-stone-400 mt-1 space-y-0.5">
                  <div>
                    Avg volume:{' '}
                    <strong className="text-stone-800 dark:text-stone-200">
                      {routineInsights.avgMlPerFeed ? `${routineInsights.avgMlPerFeed} mL` : '—'}
                    </strong>
                  </div>
                  <div>
                    Avg duration:{' '}
                    <strong className="text-stone-800 dark:text-stone-200">
                      {routineInsights.todayBucket.avgDurationMin !== null
                        ? `${routineInsights.todayBucket.avgDurationMin} min`
                        : '—'}
                    </strong>
                  </div>
                </div>
              </div>

              <div className="mt-3 pt-2.5 border-t border-stone-100 dark:border-stone-800 text-[10px] text-stone-500 dark:text-stone-400 truncate">
                Last feed: <span className="font-semibold text-stone-700 dark:text-stone-200">{routineInsights.lastFeedLabel ?? 'None yet'}</span>
              </div>
            </div>

            {/* Diaper Output */}
            <div className="bg-white dark:bg-stone-900 rounded-3xl border border-stone-200 dark:border-stone-800 p-5 shadow-xs flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between text-xs font-bold text-stone-700 dark:text-stone-200">
                  <span className="flex items-center gap-2">
                    <Baby className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                    Diaper Output
                  </span>
                  <span
                    className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                      routineInsights.todayBucket.wetDiapers + routineInsights.todayBucket.mixedDiapers >= 6
                        ? 'bg-emerald-100/80 dark:bg-emerald-950/70 text-emerald-800 dark:text-emerald-300'
                        : 'bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300'
                    }`}
                  >
                    {routineInsights.todayBucket.wetDiapers + routineInsights.todayBucket.mixedDiapers}/6 wet
                  </span>
                </div>
                <div className="text-3xl font-black text-stone-900 dark:text-white mt-2">
                  {routineInsights.todayBucket.totalDiapers}{' '}
                  <span className="text-base font-bold text-stone-400">changes</span>
                </div>
                <div className="flex flex-wrap gap-1.5 mt-2 text-[11px]">
                  <span className="px-2 py-0.5 rounded-lg bg-sky-50 dark:bg-sky-950/50 text-sky-800 dark:text-sky-300 font-semibold">
                    Wet: {routineInsights.todayBucket.wetDiapers}
                  </span>
                  <span className="px-2 py-0.5 rounded-lg bg-amber-50 dark:bg-amber-950/50 text-amber-800 dark:text-amber-300 font-semibold">
                    Dirty: {routineInsights.todayBucket.dirtyDiapers}
                  </span>
                  <span className="px-2 py-0.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/50 text-emerald-800 dark:text-emerald-300 font-semibold">
                    Mixed: {routineInsights.todayBucket.mixedDiapers}
                  </span>
                </div>
              </div>

              <div className="mt-3 pt-2.5 border-t border-stone-100 dark:border-stone-800 text-[10px] text-stone-500 dark:text-stone-400">
                Pediatric hydration benchmark: ≥6 wet diapers/day
              </div>
            </div>

            {/* 7-Day Volume Trend */}
            <div className="bg-white dark:bg-stone-900 rounded-3xl border border-stone-200 dark:border-stone-800 p-5 shadow-xs flex flex-col justify-between">
              <div className="flex items-center justify-between text-xs font-bold text-stone-700 dark:text-stone-200">
                <span>7-Day Volume Trend</span>
                <span className="text-[10px] font-mono text-stone-500 dark:text-stone-400">
                  Avg {routineInsights.sevenDayAvgMl ?? 0} mL
                </span>
              </div>

              <div className="flex items-end justify-between gap-1.5 h-24 pt-3">
                {routineInsights.dailySeries.map((bucket) => {
                  const ebmHeight = Math.round((bucket.ebmMl / maxSeriesMl) * 100);
                  const formulaHeight = Math.round((bucket.formulaMl / maxSeriesMl) * 100);
                  const dayLabel = bucket.date.slice(5);
                  return (
                    <div
                      key={bucket.date}
                      className="flex-1 flex flex-col items-center gap-1 h-full justify-end"
                      title={`${bucket.date}: ${bucket.totalMl} mL (EBM ${bucket.ebmMl} / Formula ${bucket.formulaMl})`}
                    >
                      <div className="w-full max-w-[22px] flex-1 flex flex-col justify-end bg-stone-100 dark:bg-stone-800 rounded-lg overflow-hidden">
                        {formulaHeight > 0 && (
                          <div
                            className="w-full bg-amber-400 dark:bg-amber-500 transition-all"
                            style={{ height: `${formulaHeight}%` }}
                          />
                        )}
                        {ebmHeight > 0 && (
                          <div
                            className="w-full bg-emerald-500 dark:bg-emerald-400 transition-all"
                            style={{ height: `${ebmHeight}%` }}
                          />
                        )}
                      </div>
                      <span className="text-[9px] font-mono text-stone-400 dark:text-stone-500">
                        {dayLabel}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Clinical Interpretation Box */}
          <div className="bg-emerald-50/70 dark:bg-emerald-950/25 border border-emerald-200/80 dark:border-emerald-900/50 rounded-3xl p-4 sm:p-5">
            <div className="flex items-center gap-2 text-xs font-bold text-emerald-900 dark:text-emerald-300 mb-2">
              <Sparkles className="w-4 h-4" />
              <span>Routine Interpretation</span>
            </div>
            <ul className="space-y-1.5 text-xs text-stone-700 dark:text-stone-300">
              {routineInsights.insights.map((line, i) => (
                <li key={i} className="flex items-start gap-2">
                  <span className="text-emerald-600 dark:text-emerald-400 font-bold mt-0.5">•</span>
                  <span>{line}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Input / Record Form for `routine` */}
          <form
            onSubmit={handleSaveRoutine}
            className="bg-white dark:bg-stone-900 rounded-3xl border border-stone-200 dark:border-stone-800 p-5 md:p-6 shadow-xs space-y-4"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-stone-900 dark:text-white flex items-center gap-2">
                <Plus className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                <span>{editingRoutineId !== null ? `Edit Routine Entry #${editingRoutineId}` : 'Record Routine Entry'}</span>
              </h3>
              {editingRoutineId !== null && (
                <button
                  type="button"
                  onClick={resetRoutineForm}
                  className="text-xs font-semibold text-stone-500 hover:text-stone-800 dark:hover:text-stone-200 flex items-center gap-1 cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                  <span>Cancel edit</span>
                </button>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <div>
                <label className="block text-[11px] font-semibold text-stone-600 dark:text-stone-300 mb-1">
                  Name
                </label>
                <input
                  type="text"
                  value={routineName}
                  onChange={(e) => setRoutineName(e.target.value)}
                  placeholder="Baby name"
                  className="w-full px-3 py-2 text-xs bg-stone-50 dark:bg-stone-800 border border-stone-200 dark:border-stone-700 text-stone-900 dark:text-white rounded-xl focus:outline-hidden focus:border-emerald-500"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-stone-600 dark:text-stone-300 mb-1">
                  Date
                </label>
                <input
                  type="date"
                  value={routineDate}
                  onChange={(e) => setRoutineDate(e.target.value)}
                  className="w-full px-3 py-2 text-xs bg-stone-50 dark:bg-stone-800 border border-stone-200 dark:border-stone-700 text-stone-900 dark:text-white rounded-xl focus:outline-hidden focus:border-emerald-500"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-stone-600 dark:text-stone-300 mb-1">
                  Time
                </label>
                <input
                  type="time"
                  value={routineTime}
                  onChange={(e) => setRoutineTime(e.target.value)}
                  className="w-full px-3 py-2 text-xs bg-stone-50 dark:bg-stone-800 border border-stone-200 dark:border-stone-700 text-stone-900 dark:text-white rounded-xl focus:outline-hidden focus:border-emerald-500"
                />
              </div>

              <div>
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
                  className="w-full px-3 py-2 text-xs font-mono bg-stone-50 dark:bg-stone-800 border border-stone-200 dark:border-stone-700 text-stone-900 dark:text-white rounded-xl focus:outline-hidden focus:border-emerald-500"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-stone-600 dark:text-stone-300 mb-1">
                  EBM (mL)
                </label>
                <input
                  type="number"
                  min="0"
                  step="5"
                  value={ebmMl}
                  onChange={(e) => setEbmMl(e.target.value)}
                  placeholder="e.g. 90"
                  className="w-full px-3 py-2 text-xs font-mono bg-stone-50 dark:bg-stone-800 border border-stone-200 dark:border-stone-700 text-stone-900 dark:text-white rounded-xl focus:outline-hidden focus:border-emerald-500"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-stone-600 dark:text-stone-300 mb-1">
                  Formula (mL)
                </label>
                <input
                  type="number"
                  min="0"
                  step="5"
                  value={formulaMl}
                  onChange={(e) => setFormulaMl(e.target.value)}
                  placeholder="e.g. 60"
                  className="w-full px-3 py-2 text-xs font-mono bg-stone-50 dark:bg-stone-800 border border-stone-200 dark:border-stone-700 text-stone-900 dark:text-white rounded-xl focus:outline-hidden focus:border-emerald-500"
                />
              </div>

              <div className="sm:col-span-2">
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
                    className="flex-1 min-w-[110px] px-3 py-1.5 text-xs bg-stone-50 dark:bg-stone-800 border border-stone-200 dark:border-stone-700 text-stone-900 dark:text-white rounded-xl focus:outline-hidden focus:border-emerald-500"
                  />
                </div>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-end">
              <div className="flex-1">
                <label className="block text-[11px] font-semibold text-stone-600 dark:text-stone-300 mb-1">
                  Remark
                </label>
                <input
                  type="text"
                  value={routineRemark}
                  onChange={(e) => setRoutineRemark(e.target.value)}
                  placeholder="Optional observation (e.g. burped well, sleepy after feed)"
                  className="w-full px-3 py-2 text-xs bg-stone-50 dark:bg-stone-800 border border-stone-200 dark:border-stone-700 text-stone-900 dark:text-white rounded-xl focus:outline-hidden focus:border-emerald-500"
                />
              </div>

              <button
                type="submit"
                disabled={isSavingRoutine}
                className="px-5 py-2 text-xs font-bold text-white bg-stone-900 hover:bg-stone-800 dark:bg-stone-100 dark:hover:bg-white dark:text-stone-900 rounded-xl shadow-xs transition-all flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-60"
              >
                {editingRoutineId !== null ? <Check className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
                <span>{isSavingRoutine ? 'Saving...' : editingRoutineId !== null ? 'Update Entry' : 'Save Routine'}</span>
              </button>
            </div>

            {routineError && (
              <p className="text-xs font-medium text-rose-600 dark:text-rose-400">{routineError}</p>
            )}
          </form>

          {/* Loaded `routine` Table */}
          <div className="bg-white dark:bg-stone-900 rounded-3xl border border-stone-200 dark:border-stone-800 shadow-xs overflow-hidden">
            {filteredRoutine.length === 0 ? (
              <div className="p-10 text-center text-xs text-stone-500 dark:text-stone-400">
                No routine records found yet. Record an entry above or refresh to load records from your database.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="bg-stone-50/80 dark:bg-stone-850/80 border-b border-stone-200 dark:border-stone-800 text-stone-500 dark:text-stone-400 text-[11px] font-semibold">
                      <th className="py-3 px-4">Date &amp; Time</th>
                      <th className="py-3 px-4">Name</th>
                      <th className="py-3 px-4">EBM (mL)</th>
                      <th className="py-3 px-4">Formula (mL)</th>
                      <th className="py-3 px-4">Total (mL)</th>
                      <th className="py-3 px-4">Duration</th>
                      <th className="py-3 px-4">Diaper</th>
                      <th className="py-3 px-4">Remark</th>
                      <th className="py-3 px-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100 dark:divide-stone-800 text-stone-700 dark:text-stone-300">
                    {filteredRoutine.map((row) => {
                      const totalVol = (row['EBM (mL)'] ?? 0) + (row['Formula (mL)'] ?? 0);
                      const deleteKey = `routine-${row.id}`;
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
                            {row['EBM (mL)'] !== null ? `${row['EBM (mL)']} mL` : '—'}
                          </td>
                          <td className="py-3 px-4 font-mono whitespace-nowrap text-amber-700 dark:text-amber-400 font-semibold">
                            {row['Formula (mL)'] !== null ? `${row['Formula (mL)']} mL` : '—'}
                          </td>
                          <td className="py-3 px-4 font-mono font-bold whitespace-nowrap">
                            {totalVol > 0 ? `${totalVol} mL` : '—'}
                          </td>
                          <td className="py-3 px-4 font-mono whitespace-nowrap">
                            {row['feed duration (min)'] !== null
                              ? `${row['feed duration (min)']} min`
                              : '—'}
                          </td>
                          <td className="py-3 px-4 whitespace-nowrap">
                            {row.Diaper ? (
                              <span className="px-2 py-0.5 rounded-lg bg-stone-100 dark:bg-stone-800 text-stone-700 dark:text-stone-200 font-semibold">
                                {row.Diaper}
                              </span>
                            ) : (
                              '—'
                            )}
                          </td>
                          <td className="py-3 px-4 max-w-xs truncate text-stone-500 dark:text-stone-400">
                            {row.remark || '—'}
                          </td>
                          <td className="py-3 px-4 text-right whitespace-nowrap">
                            <div className="inline-flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => handleEditRoutine(row)}
                                className="p-1.5 text-stone-400 hover:text-stone-800 dark:hover:text-white rounded-lg hover:bg-stone-100 dark:hover:bg-stone-800 transition-colors cursor-pointer"
                                title="Edit routine entry"
                              >
                                <Pencil className="w-3.5 h-3.5" />
                              </button>
                              {pendingDeleteKey === deleteKey ? (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setPendingDeleteKey(null);
                                    void removeRoutineRecord(row.id);
                                  }}
                                  className="px-2 py-1 text-[10px] font-bold text-white bg-rose-600 hover:bg-rose-700 rounded-lg cursor-pointer"
                                >
                                  Confirm
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => setPendingDeleteKey(deleteKey)}
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
        </div>
      )}

      {/* ================================================================ */}
      {/* GROWTH & VITALS TAB                                              */}
      {/* ================================================================ */}
      {section === 'growth' && (
        <div className="space-y-6">
          {/* Analytics & Interpretation KPI Grid */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5">
            {/* Latest Daily Weight */}
            <div className="bg-white dark:bg-stone-900 rounded-3xl border border-stone-200 dark:border-stone-800 p-5 shadow-xs flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between text-xs font-bold text-stone-700 dark:text-stone-200">
                  <span className="flex items-center gap-2">
                    <Scale className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                    Daily Weight
                  </span>
                  {growthInsights.weightPercentile !== null && (
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100/80 dark:bg-emerald-950/70 text-emerald-800 dark:text-emerald-300">
                      WHO {growthInsights.weightPercentile}th %ile
                    </span>
                  )}
                </div>
                <div className="text-3xl font-black text-stone-900 dark:text-white mt-2">
                  {growthInsights.latestWeightKg !== null
                    ? UnitConverter.formatWeight(growthInsights.latestWeightKg, unitSystem)
                    : '—'}
                </div>
              </div>
              <div className="mt-3 pt-2.5 border-t border-stone-100 dark:border-stone-800 text-[11px] text-stone-500 dark:text-stone-400 flex items-center justify-between">
                <span>
                  Change:{' '}
                  <strong className="text-stone-800 dark:text-stone-200">
                    {growthInsights.weightDeltaGrams !== null
                      ? `${growthInsights.weightDeltaGrams >= 0 ? '+' : ''}${growthInsights.weightDeltaGrams} g`
                      : '—'}
                  </strong>
                </span>
                {growthInsights.weightVelocityGramsPerDay !== null && (
                  <span className="font-mono font-semibold text-emerald-700 dark:text-emerald-400">
                    {growthInsights.weightVelocityGramsPerDay >= 0 ? '+' : ''}
                    {growthInsights.weightVelocityGramsPerDay} g/day
                  </span>
                )}
              </div>
            </div>

            {/* Latest Daily Length */}
            <div className="bg-white dark:bg-stone-900 rounded-3xl border border-stone-200 dark:border-stone-800 p-5 shadow-xs flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between text-xs font-bold text-stone-700 dark:text-stone-200">
                  <span className="flex items-center gap-2">
                    <Ruler className="w-4 h-4 text-teal-600 dark:text-teal-400" />
                    Daily Length
                  </span>
                  {growthInsights.lengthPercentile !== null && (
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-teal-100/80 dark:bg-teal-950/70 text-teal-800 dark:text-teal-300">
                      WHO {growthInsights.lengthPercentile}th %ile
                    </span>
                  )}
                </div>
                <div className="text-3xl font-black text-stone-900 dark:text-white mt-2">
                  {growthInsights.latestLengthCm !== null
                    ? UnitConverter.formatLength(growthInsights.latestLengthCm, unitSystem)
                    : '—'}
                </div>
              </div>
              <div className="mt-3 pt-2.5 border-t border-stone-100 dark:border-stone-800 text-[11px] text-stone-500 dark:text-stone-400">
                Change:{' '}
                <strong className="text-stone-800 dark:text-stone-200">
                  {growthInsights.lengthDeltaCm !== null
                    ? `${growthInsights.lengthDeltaCm >= 0 ? '+' : ''}${growthInsights.lengthDeltaCm} cm`
                    : '—'}
                </strong>
              </div>
            </div>

            {/* Latest Temperature */}
            <div className="bg-white dark:bg-stone-900 rounded-3xl border border-stone-200 dark:border-stone-800 p-5 shadow-xs flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between text-xs font-bold text-stone-700 dark:text-stone-200">
                  <span className="flex items-center gap-2">
                    <Thermometer className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                    Temperature
                  </span>
                  {growthInsights.tempClass && (
                    <span
                      className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${tempBadgeClasses(
                        growthInsights.tempClass.severity
                      )}`}
                    >
                      {growthInsights.tempClass.label}
                    </span>
                  )}
                </div>
                <div className="text-3xl font-black text-stone-900 dark:text-white mt-2">
                  {growthInsights.latestTempC !== null
                    ? `${growthInsights.latestTempC.toFixed(1)}°C`
                    : '—'}
                  {growthInsights.tempClass && (
                    <span className="text-sm font-semibold text-stone-400 ml-2">
                      ({growthInsights.tempClass.fahrenheit}°F)
                    </span>
                  )}
                </div>
              </div>
              <div className="mt-3 pt-2.5 border-t border-stone-100 dark:border-stone-800 text-[11px] text-stone-500 dark:text-stone-400 flex items-center justify-between">
                <span>
                  Range:{' '}
                  <strong className="text-stone-800 dark:text-stone-200">
                    {growthInsights.minTempC !== null && growthInsights.maxTempC !== null
                      ? `${growthInsights.minTempC.toFixed(1)}–${growthInsights.maxTempC.toFixed(1)}°C`
                      : '—'}
                  </strong>
                </span>
                {growthInsights.feverEpisodes > 0 && (
                  <span className="font-semibold text-rose-600 dark:text-rose-400">
                    {growthInsights.feverEpisodes} fever log{growthInsights.feverEpisodes === 1 ? '' : 's'}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Clinical Interpretation Box */}
          <div className="bg-amber-50/70 dark:bg-amber-950/25 border border-amber-200/80 dark:border-amber-900/50 rounded-3xl p-4 sm:p-5">
            <div className="flex items-center gap-2 text-xs font-bold text-amber-900 dark:text-amber-300 mb-2">
              <Sparkles className="w-4 h-4" />
              <span>Growth &amp; Vitals Interpretation</span>
            </div>
            <ul className="space-y-1.5 text-xs text-stone-700 dark:text-stone-300">
              {growthInsights.insights.map((line, i) => (
                <li key={i} className="flex items-start gap-2">
                  <span className="text-amber-600 dark:text-amber-400 font-bold mt-0.5">•</span>
                  <span>{line}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Input / Record Form for `growth` */}
          <form
            onSubmit={handleSaveGrowth}
            className="bg-white dark:bg-stone-900 rounded-3xl border border-stone-200 dark:border-stone-800 p-5 md:p-6 shadow-xs space-y-4"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-stone-900 dark:text-white flex items-center gap-2">
                <Plus className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                <span>{editingGrowthId !== null ? `Edit Growth Entry #${editingGrowthId}` : 'Record Daily Growth & Vitals'}</span>
              </h3>
              {editingGrowthId !== null && (
                <button
                  type="button"
                  onClick={resetGrowthForm}
                  className="text-xs font-semibold text-stone-500 hover:text-stone-800 dark:hover:text-stone-200 flex items-center gap-1 cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                  <span>Cancel edit</span>
                </button>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <div>
                <label className="block text-[11px] font-semibold text-stone-600 dark:text-stone-300 mb-1">
                  Name
                </label>
                <input
                  type="text"
                  value={growthName}
                  onChange={(e) => setGrowthName(e.target.value)}
                  placeholder="Baby name"
                  className="w-full px-3 py-2 text-xs bg-stone-50 dark:bg-stone-800 border border-stone-200 dark:border-stone-700 text-stone-900 dark:text-white rounded-xl focus:outline-hidden focus:border-amber-500"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-stone-600 dark:text-stone-300 mb-1">
                  Daily Weight (kg)
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={dailyWeight}
                  onChange={(e) => setDailyWeight(e.target.value)}
                  placeholder="e.g. 6.45"
                  className="w-full px-3 py-2 text-xs font-mono bg-stone-50 dark:bg-stone-800 border border-stone-200 dark:border-stone-700 text-stone-900 dark:text-white rounded-xl focus:outline-hidden focus:border-amber-500"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-stone-600 dark:text-stone-300 mb-1">
                  Daily Length (cm)
                </label>
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  value={dailyLength}
                  onChange={(e) => setDailyLength(e.target.value)}
                  placeholder="e.g. 62.5"
                  className="w-full px-3 py-2 text-xs font-mono bg-stone-50 dark:bg-stone-800 border border-stone-200 dark:border-stone-700 text-stone-900 dark:text-white rounded-xl focus:outline-hidden focus:border-amber-500"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-[11px] font-semibold text-stone-600 dark:text-stone-300">
                    Temperature (°C)
                  </label>
                  {liveTempPreview && (
                    <span
                      className={`text-[10px] font-bold px-1.5 py-0.2 rounded-full border ${tempBadgeClasses(
                        liveTempPreview.severity
                      )}`}
                    >
                      {liveTempPreview.label}
                    </span>
                  )}
                </div>
                <input
                  type="number"
                  step="0.1"
                  min="30"
                  max="45"
                  value={temperature}
                  onChange={(e) => setTemperature(e.target.value)}
                  placeholder="e.g. 36.8"
                  className="w-full px-3 py-2 text-xs font-mono bg-stone-50 dark:bg-stone-800 border border-stone-200 dark:border-stone-700 text-stone-900 dark:text-white rounded-xl focus:outline-hidden focus:border-amber-500"
                />
              </div>
            </div>

            <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-end">
              <div className="flex-1">
                <label className="block text-[11px] font-semibold text-stone-600 dark:text-stone-300 mb-1">
                  Remark
                </label>
                <input
                  type="text"
                  value={growthRemark}
                  onChange={(e) => setGrowthRemark(e.target.value)}
                  placeholder="Optional notes (e.g. morning weigh-in before feed, post-vaccine check)"
                  className="w-full px-3 py-2 text-xs bg-stone-50 dark:bg-stone-800 border border-stone-200 dark:border-stone-700 text-stone-900 dark:text-white rounded-xl focus:outline-hidden focus:border-amber-500"
                />
              </div>

              <button
                type="submit"
                disabled={isSavingGrowth}
                className="px-5 py-2 text-xs font-bold text-white bg-stone-900 hover:bg-stone-800 dark:bg-stone-100 dark:hover:bg-white dark:text-stone-900 rounded-xl shadow-xs transition-all flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-60"
              >
                {editingGrowthId !== null ? <Check className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
                <span>{isSavingGrowth ? 'Saving...' : editingGrowthId !== null ? 'Update Entry' : 'Save Growth'}</span>
              </button>
            </div>

            {growthError && (
              <p className="text-xs font-medium text-rose-600 dark:text-rose-400">{growthError}</p>
            )}
          </form>

          {/* Loaded `growth` Table */}
          <div className="bg-white dark:bg-stone-900 rounded-3xl border border-stone-200 dark:border-stone-800 shadow-xs overflow-hidden">
            {filteredGrowth.length === 0 ? (
              <div className="p-10 text-center text-xs text-stone-500 dark:text-stone-400">
                No daily growth records found yet. Record an entry above or refresh to load records from your database.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="bg-stone-50/80 dark:bg-stone-850/80 border-b border-stone-200 dark:border-stone-800 text-stone-500 dark:text-stone-400 text-[11px] font-semibold">
                      <th className="py-3 px-4">Recorded At</th>
                      <th className="py-3 px-4">Name</th>
                      <th className="py-3 px-4">Daily Weight</th>
                      <th className="py-3 px-4">Daily Length</th>
                      <th className="py-3 px-4">Temperature</th>
                      <th className="py-3 px-4">Remark</th>
                      <th className="py-3 px-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100 dark:divide-stone-800 text-stone-700 dark:text-stone-300">
                    {filteredGrowth.map((row) => {
                      const tempInfo =
                        row.temperature !== null ? classifyTemperature(row.temperature) : null;
                      const deleteKey = `growth-${row.id}`;
                      return (
                        <tr
                          key={row.id}
                          className="hover:bg-stone-50/70 dark:hover:bg-stone-800/40 transition-colors"
                        >
                          <td className="py-3 px-4 whitespace-nowrap font-bold text-stone-900 dark:text-white">
                            {formatDateTime(row.created_at)}
                          </td>
                          <td className="py-3 px-4 whitespace-nowrap">{row.name || '—'}</td>
                          <td className="py-3 px-4 font-mono font-bold whitespace-nowrap">
                            {row.daily_weight !== null
                              ? UnitConverter.formatWeight(row.daily_weight, unitSystem)
                              : '—'}
                          </td>
                          <td className="py-3 px-4 font-mono whitespace-nowrap">
                            {row.daily_length !== null
                              ? UnitConverter.formatLength(row.daily_length, unitSystem)
                              : '—'}
                          </td>
                          <td className="py-3 px-4 whitespace-nowrap">
                            {row.temperature !== null && tempInfo ? (
                              <span
                                className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border font-mono font-bold text-[11px] ${tempBadgeClasses(
                                  tempInfo.severity
                                )}`}
                              >
                                <span>{row.temperature.toFixed(1)}°C</span>
                                <span className="font-sans font-semibold text-[10px]">
                                  {tempInfo.label}
                                </span>
                              </span>
                            ) : (
                              '—'
                            )}
                          </td>
                          <td className="py-3 px-4 max-w-xs truncate text-stone-500 dark:text-stone-400">
                            {row.remark || '—'}
                          </td>
                          <td className="py-3 px-4 text-right whitespace-nowrap">
                            <div className="inline-flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => handleEditGrowth(row)}
                                className="p-1.5 text-stone-400 hover:text-stone-800 dark:hover:text-white rounded-lg hover:bg-stone-100 dark:hover:bg-stone-800 transition-colors cursor-pointer"
                                title="Edit growth entry"
                              >
                                <Pencil className="w-3.5 h-3.5" />
                              </button>
                              {pendingDeleteKey === deleteKey ? (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setPendingDeleteKey(null);
                                    void removeGrowthRecord(row.id);
                                  }}
                                  className="px-2 py-1 text-[10px] font-bold text-white bg-rose-600 hover:bg-rose-700 rounded-lg cursor-pointer"
                                >
                                  Confirm
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => setPendingDeleteKey(deleteKey)}
                                  className="p-1.5 text-stone-400 hover:text-rose-600 dark:hover:text-rose-400 rounded-lg hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors cursor-pointer"
                                  title="Delete growth entry"
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
        </div>
      )}
    </div>
  );
};
