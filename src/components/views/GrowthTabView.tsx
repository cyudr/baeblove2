import React, { useState, useMemo, useEffect } from 'react';
import { useApp } from '../../context/AppContext';
import { UnitConverter } from '../../data/growthStandards';
import { classifyTemperature, interpretGrowthTable } from '../../utils/careInterpreter';
import { InteractiveGrowthChart } from '../charts/InteractiveGrowthChart';
import { FetalBiometricsChart } from '../charts/FetalBiometricsChart';
import type { BabyMeasurement, GrowthRecord } from '../../types';
import {
  Scale,
  Ruler,
  Thermometer,
  Plus,
  RefreshCw,
  Pencil,
  Trash2,
  Check,
  X,
  Sparkles,
  Filter,
  BookOpen,
} from 'lucide-react';

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

interface GrowthTabViewProps {
  onOpenLogModal: () => void;
  onOpenFormulaModal: () => void;
  onOpenProfileModal?: () => void;
  initialEditRecord?: GrowthRecord | null;
  onClearInitialEdit?: () => void;
}

export const GrowthTabView: React.FC<GrowthTabViewProps> = ({
  onOpenLogModal,
  onOpenFormulaModal,
  onOpenProfileModal,
  initialEditRecord = null,
  onClearInitialEdit,
}) => {
  const {
    activeProfile,
    activeBabyMeasurements,
    activeFetalMeasurements,
    unitSystem,
    growthRecords,
    isCareTablesLoading,
    refreshCareTables,
    addGrowthRecord,
    editGrowthRecord,
    removeGrowthRecord,
  } = useApp();

  const [nameFilter, setNameFilter] = useState<string>('all');

  // Growth form state
  const [editingGrowthId, setEditingGrowthId] = useState<number | null>(null);
  const [growthName, setGrowthName] = useState<string>(activeProfile?.name || '');
  const [dailyWeight, setDailyWeight] = useState<string>('');
  const [dailyLength, setDailyLength] = useState<string>('');
  const [temperature, setTemperature] = useState<string>('');
  const [growthRemark, setGrowthRemark] = useState<string>('');
  const [growthError, setGrowthError] = useState<string | null>(null);
  const [isSavingGrowth, setIsSavingGrowth] = useState(false);

  const [pendingDeleteId, setPendingDeleteId] = useState<number | null>(null);

  useEffect(() => {
    if (!editingGrowthId && activeProfile?.name) {
      setGrowthName(activeProfile.name);
    }
  }, [activeProfile?.name, editingGrowthId]);

  useEffect(() => {
    if (!initialEditRecord) return;
    setEditingGrowthId(initialEditRecord.id);
    setGrowthName(initialEditRecord.name ?? activeProfile?.name ?? '');
    setDailyWeight(
      initialEditRecord.daily_weight !== null ? String(initialEditRecord.daily_weight) : ''
    );
    setDailyLength(
      initialEditRecord.daily_length !== null ? String(initialEditRecord.daily_length) : ''
    );
    setTemperature(
      initialEditRecord.temperature !== null ? String(initialEditRecord.temperature) : ''
    );
    setGrowthRemark(initialEditRecord.remark ?? '');
    setGrowthError(null);
    onClearInitialEdit?.();
  }, [initialEditRecord, activeProfile?.name, onClearInitialEdit]);

  const availableNames = useMemo(() => {
    const set = new Set<string>();
    if (activeProfile?.name) set.add(activeProfile.name);
    for (const g of growthRecords) {
      if (g.name?.trim()) set.add(g.name.trim());
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [activeProfile?.name, growthRecords]);

  const filteredGrowth = useMemo(() => {
    if (nameFilter === 'all') return growthRecords;
    const target = nameFilter.trim().toLowerCase();
    return growthRecords.filter((g) => (g.name ?? '').trim().toLowerCase() === target);
  }, [growthRecords, nameFilter]);

  const growthInsights = useMemo(
    () => interpretGrowthTable(filteredGrowth, activeProfile),
    [filteredGrowth, activeProfile]
  );

  // Merge Supabase `growth` table weight/length readings for the active baby profile into the WHO chart
  const mergedBabyMeasurements = useMemo<BabyMeasurement[]>(() => {
    if (!activeProfile || activeProfile.type !== 'baby') return activeBabyMeasurements;

    const birthMs = new Date(activeProfile.dateOfEvent).getTime();
    if (Number.isNaN(birthMs)) return activeBabyMeasurements;

    const activeNameLower = activeProfile.name.trim().toLowerCase();
    const activeFirstNameLower = activeNameLower.split(' ')[0];

    const matchingGrowth = growthRecords.filter((g) => {
      if (g.daily_weight === null && g.daily_length === null) return false;
      const gName = (g.name ?? '').trim().toLowerCase();
      if (!gName) return true;
      return gName === activeNameLower || gName === activeFirstNameLower;
    });

    const merged: BabyMeasurement[] = [...activeBabyMeasurements];

    for (const g of matchingGrowth) {
      const dateStr = g.created_at.slice(0, 10);
      const alreadyExists = merged.some(
        (m) =>
          m.date === dateStr &&
          (g.daily_weight === null || m.weightKg === g.daily_weight) &&
          (g.daily_length === null || m.lengthCm === g.daily_length)
      );
      if (alreadyExists) continue;

      const recMs = new Date(g.created_at).getTime();
      const diffDays = Number.isNaN(recMs)
        ? 0
        : Math.max(0, Math.floor((recMs - birthMs) / (1000 * 60 * 60 * 24)));
      const ageInMonths = Math.round((diffDays / 30.4375) * 10) / 10;
      const ageInWeeks = Math.round((diffDays / 7) * 10) / 10;

      merged.push({
        id: `supabase-growth-${g.id}`,
        profileId: activeProfile.id,
        date: dateStr,
        ageInMonths,
        ageInWeeks,
        weightKg: g.daily_weight ?? undefined,
        lengthCm: g.daily_length ?? undefined,
        notes: g.remark ?? undefined,
      });
    }

    return merged.sort((a, b) => a.ageInMonths - b.ageInMonths);
  }, [activeProfile, activeBabyMeasurements, growthRecords]);

  const liveTempPreview = useMemo(() => {
    const parsed = parseFloat(temperature);
    if (!temperature || Number.isNaN(parsed) || parsed < 30 || parsed > 45) return null;
    return classifyTemperature(parsed);
  }, [temperature]);

  const resetGrowthForm = () => {
    setEditingGrowthId(null);
    setGrowthName(activeProfile?.name || '');
    setDailyWeight('');
    setDailyLength('');
    setTemperature('');
    setGrowthRemark('');
    setGrowthError(null);
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
    setEditingGrowthId(row.id);
    setGrowthName(row.name ?? activeProfile?.name ?? '');
    setDailyWeight(row.daily_weight !== null ? String(row.daily_weight) : '');
    setDailyLength(row.daily_length !== null ? String(row.daily_length) : '');
    setTemperature(row.temperature !== null ? String(row.temperature) : '');
    setGrowthRemark(row.remark ?? '');
    setGrowthError(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <div className="space-y-6">
      {/* Header Card */}
      <div className="bg-white dark:bg-stone-900 rounded-3xl border border-stone-200 dark:border-stone-800 p-5 md:p-6 shadow-xs flex flex-col lg:flex-row lg:items-center justify-between gap-4 transition-colors">
        <div>
          <h2 className="text-xl font-bold text-stone-900 dark:text-white">
            {activeProfile?.type === 'fetal'
              ? 'Fetal Growth & Biometric Curves'
              : 'Growth Tracking & WHO Curves'}
          </h2>
          <p className="text-xs text-stone-500 dark:text-stone-400 mt-1">
            {activeProfile?.type === 'fetal'
              ? 'Log daily vitals or ultrasound biometrics plotted against Hadlock fetal growth distribution curves.'
              : 'Log daily weight, length, and temperature directly to Supabase and visualize WHO percentile curves.'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-stone-50 dark:bg-stone-800 border border-stone-200 dark:border-stone-700 text-xs">
            <Filter className="w-3.5 h-3.5 text-stone-400" />
            <select
              aria-label="Filter growth records by child name"
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
            className="px-3 py-1.5 rounded-xl border border-stone-200 dark:border-stone-700 bg-stone-50 dark:bg-stone-800 hover:bg-stone-100 dark:hover:bg-stone-700 text-xs font-semibold text-stone-700 dark:text-stone-200 transition-colors flex items-center gap-1.5 cursor-pointer disabled:opacity-60"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isCareTablesLoading ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>

          <button
            type="button"
            onClick={onOpenFormulaModal}
            className="px-3 py-1.5 rounded-xl border border-stone-200 dark:border-stone-700 bg-stone-50 dark:bg-stone-800 hover:bg-stone-100 dark:hover:bg-stone-700 text-xs font-semibold text-stone-700 dark:text-stone-200 hover:text-amber-900 dark:hover:text-amber-300 transition-colors flex items-center gap-1.5 cursor-pointer"
          >
            <BookOpen className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
            <span>Formula Math</span>
          </button>

          {activeProfile ? (
            <button
              type="button"
              onClick={onOpenLogModal}
              className="px-3.5 py-1.5 rounded-xl bg-stone-900 hover:bg-stone-800 dark:bg-stone-100 dark:hover:bg-white text-white dark:text-stone-900 text-xs font-bold transition-colors flex items-center gap-1.5 cursor-pointer shadow-xs"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>{activeProfile.type === 'baby' ? 'Log Pediatric Checkup' : 'Log Ultrasound'}</span>
            </button>
          ) : (
            onOpenProfileModal && (
              <button
                type="button"
                onClick={onOpenProfileModal}
                className="px-3.5 py-1.5 rounded-xl bg-stone-900 hover:bg-stone-800 dark:bg-stone-100 dark:hover:bg-white text-white dark:text-stone-900 text-xs font-bold transition-colors flex items-center gap-1.5 cursor-pointer shadow-xs"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add Profile</span>
              </button>
            )
          )}
        </div>
      </div>

      {/* Record / Edit Daily Growth Form (Supabase "growth" table) */}
      <form
        onSubmit={handleSaveGrowth}
        className="bg-white dark:bg-stone-900 rounded-3xl border border-stone-200 dark:border-stone-800 p-5 md:p-6 shadow-xs space-y-4"
      >
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-stone-900 dark:text-white flex items-center gap-2">
            <Plus className="w-4 h-4 text-amber-600 dark:text-amber-400" />
            <span>
              {editingGrowthId !== null
                ? `Edit Growth Entry #${editingGrowthId}`
                : 'Log Daily Growth & Vitals'}
            </span>
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
            {editingGrowthId !== null ? (
              <Check className="w-3.5 h-3.5" />
            ) : (
              <Plus className="w-3.5 h-3.5" />
            )}
            <span>
              {isSavingGrowth
                ? 'Saving...'
                : editingGrowthId !== null
                  ? 'Update Entry'
                  : 'Save Growth'}
            </span>
          </button>
        </div>

        {growthError && (
          <p className="text-xs font-medium text-rose-600 dark:text-rose-400">{growthError}</p>
        )}
      </form>

      {/* Growth & Vitals Interpretation Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5">
        <div className="bg-white dark:bg-stone-900 rounded-3xl border border-stone-200 dark:border-stone-800 p-5 shadow-xs flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between text-xs font-bold text-stone-700 dark:text-stone-200">
              <span className="flex items-center gap-2">
                <Scale className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                Latest Daily Weight
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

        <div className="bg-white dark:bg-stone-900 rounded-3xl border border-stone-200 dark:border-stone-800 p-5 shadow-xs flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between text-xs font-bold text-stone-700 dark:text-stone-200">
              <span className="flex items-center gap-2">
                <Ruler className="w-4 h-4 text-teal-600 dark:text-teal-400" />
                Latest Daily Length
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

        <div className="bg-white dark:bg-stone-900 rounded-3xl border border-stone-200 dark:border-stone-800 p-5 shadow-xs flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between text-xs font-bold text-stone-700 dark:text-stone-200">
              <span className="flex items-center gap-2">
                <Thermometer className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                Body Temperature
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
                {growthInsights.feverEpisodes} fever log
                {growthInsights.feverEpisodes === 1 ? '' : 's'}
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

      {/* Clinical Reference Chart */}
      {activeProfile?.type === 'baby' ? (
        <InteractiveGrowthChart
          profile={activeProfile}
          measurements={mergedBabyMeasurements}
          unitSystem={unitSystem}
          onOpenFormulaModal={onOpenFormulaModal}
        />
      ) : activeProfile ? (
        <FetalBiometricsChart
          profile={activeProfile}
          measurements={activeFetalMeasurements}
          unitSystem={unitSystem}
          onOpenFormulaModal={onOpenFormulaModal}
        />
      ) : (
        <div className="bg-white dark:bg-stone-900 rounded-3xl border border-stone-200 dark:border-stone-800 p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h3 className="text-sm font-bold text-stone-900 dark:text-white">
              Add a Profile to Plot WHO / Fetal Percentile Curves
            </h3>
            <p className="text-xs text-stone-500 dark:text-stone-400 mt-1">
              Your daily Supabase growth records above are saved and tracked automatically. Add a child or pregnancy profile with date of birth and gender to compute age-calibrated percentile curves.
            </p>
          </div>
          {onOpenProfileModal && (
            <button
              type="button"
              onClick={onOpenProfileModal}
              className="self-start sm:self-auto px-4 py-2 text-xs font-bold text-white bg-stone-900 hover:bg-stone-800 dark:bg-stone-100 dark:hover:bg-white dark:text-stone-900 rounded-xl shadow-xs transition-colors flex items-center gap-1.5 cursor-pointer shrink-0"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add Profile</span>
            </button>
          )}
        </div>
      )}

      {/* Logged Daily Growth Table */}
      <div className="bg-white dark:bg-stone-900 rounded-3xl border border-stone-200 dark:border-stone-800 shadow-xs overflow-hidden">
        <div className="px-5 py-3.5 border-b border-stone-100 dark:border-stone-800 flex items-center justify-between">
          <h3 className="text-xs font-bold text-stone-800 dark:text-stone-200 uppercase tracking-wider">
            Logged Daily Growth Entries ({filteredGrowth.length})
          </h3>
        </div>
        {filteredGrowth.length === 0 ? (
          <div className="p-10 text-center text-xs text-stone-500 dark:text-stone-400">
            No daily growth records logged yet. Use the form above or click Refresh to load from Supabase.
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
                          {pendingDeleteId === row.id ? (
                            <button
                              type="button"
                              onClick={() => {
                                setPendingDeleteId(null);
                                void removeGrowthRecord(row.id);
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
  );
};
