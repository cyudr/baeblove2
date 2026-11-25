import React, { useState, useMemo, useEffect } from 'react';
import { useApp } from '../../context/AppContext';
import { UnitConverter } from '../../data/growthStandards';
import {
  classifyTemperature,
  doesRecordMatchProfile,
  getGrowthRecordDate,
  interpretGrowthTable,
  mergeProfileGrowthMeasurements,
} from '../../utils/careInterpreter';
import { formatAgeFromBirthDate } from '../../utils/ageCalculator';
import { InteractiveGrowthChart } from '../charts/InteractiveGrowthChart';
import { FetalBiometricsChart } from '../charts/FetalBiometricsChart';
import { EditAuthModal } from '../modals/EditAuthModal';
import { AskGeminiModal } from '../modals/AskGeminiModal';
import type { BabyMeasurement, GrowthRecord } from '../../types';
import {
  Scale,
  Ruler,
  Thermometer,
  Plus,
  Pencil,
  Trash2,
  Check,
  X,
  Sparkles,
  Filter,
  RotateCcw,
  Lock,
  ChevronDown,
  AlertTriangle,
} from 'lucide-react';

function getCurrentDateStr(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
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
    addGrowthRecord,
    editGrowthRecord,
    removeGrowthRecord,
  } = useApp();

  const [loggerFilter, setLoggerFilter] = useState<string>('all');

  // Growth form state (`name` column = person logging the info; `profile_id` = active profile from entries)
  const [editingGrowthId, setEditingGrowthId] = useState<number | null>(null);
  const [growthDate, setGrowthDate] = useState<string>(getCurrentDateStr);
  const [loggedBy, setLoggedBy] = useState<string>('');
  const [dailyWeight, setDailyWeight] = useState<string>('');
  const [dailyLength, setDailyLength] = useState<string>('');
  const [temperature, setTemperature] = useState<string>('');
  const [growthRemark, setGrowthRemark] = useState<string>('');
  const [growthError, setGrowthError] = useState<string | null>(null);
  const [retrieveNotice, setRetrieveNotice] = useState<string | null>(null);
  const [isSavingGrowth, setIsSavingGrowth] = useState(false);

  const [pendingDeleteId, setPendingDeleteId] = useState<number | null>(null);
  const [pendingAuthRecord, setPendingAuthRecord] = useState<GrowthRecord | null>(null);
  const [isAskGeminiOpen, setIsAskGeminiOpen] = useState(false);
  const [isLogCardExpanded, setIsLogCardExpanded] = useState(false);

  useEffect(() => {
    setLoggerFilter('all');
  }, [activeProfile?.id]);

  useEffect(() => {
    if (!initialEditRecord) return;
    setEditingGrowthId(initialEditRecord.id);
    setGrowthDate(getGrowthRecordDate(initialEditRecord));
    setLoggedBy(initialEditRecord.name ?? '');
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
    setRetrieveNotice(null);
    setIsLogCardExpanded(true);
    onClearInitialEdit?.();
  }, [initialEditRecord, onClearInitialEdit]);

  // Scope growth records to the active profile loaded from "entries" via profile_id
  const profileGrowthRecords = useMemo(() => {
    if (!activeProfile) return growthRecords;
    return growthRecords.filter((g) => doesRecordMatchProfile(g, activeProfile));
  }, [growthRecords, activeProfile]);

  const latestGrowthRecord = profileGrowthRecords[0] ?? null;

  const availableLoggers = useMemo(() => {
    const set = new Set<string>();
    for (const g of profileGrowthRecords) {
      if (g.name?.trim()) set.add(g.name.trim());
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [profileGrowthRecords]);

  const filteredGrowth = useMemo(() => {
    if (loggerFilter === 'all') return profileGrowthRecords;
    const target = loggerFilter.trim().toLowerCase();
    return profileGrowthRecords.filter((g) => (g.name ?? '').trim().toLowerCase() === target);
  }, [profileGrowthRecords, loggerFilter]);

  const growthInsights = useMemo(
    () => interpretGrowthTable(filteredGrowth, activeProfile),
    [filteredGrowth, activeProfile]
  );

  // Merge Supabase `growth` table weight/length readings for the active baby profile into the WHO chart
  const mergedBabyMeasurements = useMemo<BabyMeasurement[]>(
    () => mergeProfileGrowthMeasurements(activeProfile, activeBabyMeasurements, growthRecords),
    [activeProfile, activeBabyMeasurements, growthRecords]
  );

  const liveTempPreview = useMemo(() => {
    const parsed = parseFloat(temperature);
    if (!temperature || Number.isNaN(parsed) || parsed < 30 || parsed > 45) return null;
    return classifyTemperature(parsed);
  }, [temperature]);

  // Detect potentially duplicated or conflicting growth entry by Date
  const dateCollision = useMemo<{
    level: 'duplicate' | 'conflict';
    existing: GrowthRecord;
    summary: string;
  } | null>(() => {
    const cleanDate = growthDate.trim().slice(0, 10);
    if (!cleanDate) return null;

    const parsedWeight = dailyWeight.trim() !== '' ? parseFloat(dailyWeight) : null;
    const parsedLength = dailyLength.trim() !== '' ? parseFloat(dailyLength) : null;
    const parsedTemp = temperature.trim() !== '' ? parseFloat(temperature) : null;
    const cleanRemark = growthRemark.trim().toLowerCase();

    const hasEnteredData =
      (parsedWeight !== null && Number.isFinite(parsedWeight)) ||
      (parsedLength !== null && Number.isFinite(parsedLength)) ||
      (parsedTemp !== null && Number.isFinite(parsedTemp)) ||
      cleanRemark !== '';

    for (const rec of profileGrowthRecords) {
      if (editingGrowthId !== null && rec.id === editingGrowthId) continue;
      const recDate = getGrowthRecordDate(rec);
      if (recDate !== cleanDate) continue;

      const summaryParts: string[] = [recDate];
      if (rec.daily_weight !== null) summaryParts.push(`${rec.daily_weight} kg`);
      if (rec.daily_length !== null) summaryParts.push(`${rec.daily_length} cm`);
      if (rec.temperature !== null) summaryParts.push(`${rec.temperature}°C`);

      const sameWeight =
        parsedWeight === null
          ? rec.daily_weight === null
          : rec.daily_weight !== null && Math.abs(rec.daily_weight - parsedWeight) < 0.0005;
      const sameLength =
        parsedLength === null
          ? rec.daily_length === null
          : rec.daily_length !== null && Math.abs(rec.daily_length - parsedLength) <= 0.1;
      const sameTemp =
        parsedTemp === null
          ? rec.temperature === null
          : rec.temperature !== null && Math.abs(rec.temperature - parsedTemp) <= 0.1;
      const sameRemark = cleanRemark === (rec.remark || '').trim().toLowerCase();

      const allMatch = hasEnteredData && sameWeight && sameLength && sameTemp && sameRemark;

      return {
        level: allMatch ? 'duplicate' : 'conflict',
        existing: rec,
        summary: summaryParts.join(' · '),
      };
    }

    return null;
  }, [
    growthDate,
    dailyWeight,
    dailyLength,
    temperature,
    growthRemark,
    profileGrowthRecords,
    editingGrowthId,
  ]);

  const resetGrowthForm = (preserveLogger = false) => {
    setEditingGrowthId(null);
    setGrowthDate(getCurrentDateStr());
    if (!preserveLogger) setLoggedBy('');
    setDailyWeight('');
    setDailyLength('');
    setTemperature('');
    setGrowthRemark('');
    setGrowthError(null);
    setRetrieveNotice(null);
  };

  const handleRetrieveLastGrowth = () => {
    if (!latestGrowthRecord) return;
    setEditingGrowthId(null);
    setGrowthDate(getCurrentDateStr());
    setLoggedBy(latestGrowthRecord.name ?? '');
    setDailyWeight(
      latestGrowthRecord.daily_weight !== null ? String(latestGrowthRecord.daily_weight) : ''
    );
    setDailyLength(
      latestGrowthRecord.daily_length !== null ? String(latestGrowthRecord.daily_length) : ''
    );
    setTemperature(
      latestGrowthRecord.temperature !== null ? String(latestGrowthRecord.temperature) : ''
    );
    setGrowthRemark(latestGrowthRecord.remark ?? '');
    setGrowthError(null);
    setRetrieveNotice(
      `Loaded values from last entry (${getGrowthRecordDate(latestGrowthRecord)}) as a new log.`
    );
  };

  const applyEditGrowth = (row: GrowthRecord) => {
    setEditingGrowthId(row.id);
    setGrowthDate(getGrowthRecordDate(row));
    setLoggedBy(row.name ?? '');
    setDailyWeight(row.daily_weight !== null ? String(row.daily_weight) : '');
    setDailyLength(row.daily_length !== null ? String(row.daily_length) : '');
    setTemperature(row.temperature !== null ? String(row.temperature) : '');
    setGrowthRemark(row.remark ?? '');
    setGrowthError(null);
    setRetrieveNotice(null);
    setIsLogCardExpanded(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const requestEditGrowth = (row: GrowthRecord) => {
    setPendingAuthRecord(row);
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
        profile_id: activeProfile?.id ?? null,
        date: growthDate || null,
        daily_weight: parsedWeight,
        daily_length: parsedLength,
        temperature: parsedTemp,
        remark: growthRemark.trim() || null,
        name: loggedBy.trim() || null,
      };

      const res =
        editingGrowthId !== null
          ? await editGrowthRecord(editingGrowthId, payload)
          : await addGrowthRecord(payload);

      if (res.error) {
        setGrowthError(res.error);
      } else {
        resetGrowthForm(editingGrowthId === null);
      }
    } finally {
      setIsSavingGrowth(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header Card */}
      <div className="bg-white dark:bg-stone-900 rounded-3xl border border-stone-200 dark:border-stone-800 p-5 md:p-6 shadow-xs space-y-4 transition-colors">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-2xl bg-amber-100 dark:bg-amber-950/70 text-amber-700 dark:text-amber-300 flex items-center justify-center shadow-2xs shrink-0">
              <Scale className="w-4 h-4" />
            </div>
            <h2 className="text-xl font-bold text-stone-900 dark:text-white">
              {activeProfile?.type === 'fetal'
                ? 'Fetal Growth & Biometric Curves'
                : 'Growth Tracking'}
            </h2>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setIsAskGeminiOpen(true)}
              className="px-3 py-1.5 rounded-xl border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/60 hover:bg-emerald-100 dark:hover:bg-emerald-900/70 text-xs font-bold text-emerald-900 dark:text-emerald-200 transition-colors flex items-center gap-1.5 cursor-pointer shadow-2xs"
            >
              <Sparkles className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
              <span>Ask Gemini</span>
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

        {/* Growth & Vitals Interpretation */}
        <div className="pt-4 border-t border-stone-100 dark:border-stone-800">
          <div className="flex items-center gap-1.5 text-xs font-bold text-amber-900 dark:text-amber-300 mb-2">
            <Sparkles className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 shrink-0" />
            <span>Growth &amp; Vitals Interpretation</span>
          </div>
          <ul className="space-y-1.5 text-xs leading-relaxed text-stone-700 dark:text-stone-300">
            {growthInsights.insights.map((line, i) => (
              <li key={i} className="flex items-start gap-2">
                <span className="text-amber-600 dark:text-amber-400 font-bold mt-0.5 shrink-0">•</span>
                <span>{line}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* Record / Edit Daily Growth Form (Supabase "growth" table) */}
      <form
        onSubmit={handleSaveGrowth}
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
              <Plus className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
              <span>
                {editingGrowthId !== null
                  ? `Edit Growth Entry #${editingGrowthId}`
                  : 'Log Daily Growth & Vitals'}
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
            {(latestGrowthRecord || editingGrowthId !== null) && (
              <div className="flex flex-wrap items-center gap-2">
                {latestGrowthRecord && (
                  <>
                    <button
                      type="button"
                      onClick={handleRetrieveLastGrowth}
                      className="px-2.5 py-1.5 text-[11px] font-semibold text-stone-700 dark:text-stone-200 bg-stone-100 dark:bg-stone-800 hover:bg-stone-200 dark:hover:bg-stone-700 border border-stone-200 dark:border-stone-700 rounded-xl transition-colors flex items-center gap-1 cursor-pointer"
                      title="Copy values from the latest growth entry into a new log"
                    >
                      <RotateCcw className="w-3 h-3" />
                      <span>Retrieve Last</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => requestEditGrowth(latestGrowthRecord)}
                      className="px-2.5 py-1.5 text-[11px] font-semibold text-amber-900 dark:text-amber-200 bg-amber-50 dark:bg-amber-950/60 hover:bg-amber-100 dark:hover:bg-amber-900 border border-amber-200 dark:border-amber-800 rounded-xl transition-colors flex items-center gap-1 cursor-pointer"
                      title="Authenticate with bae_Key to edit the latest growth entry"
                    >
                      <Lock className="w-3 h-3" />
                      <span>Edit Last</span>
                    </button>
                  </>
                )}
                {editingGrowthId !== null && (
                  <button
                    type="button"
                    onClick={() => resetGrowthForm(false)}
                    className="px-2 py-1.5 text-xs font-semibold text-stone-500 hover:text-stone-800 dark:hover:text-stone-200 flex items-center gap-1 cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                    <span>Cancel edit</span>
                  </button>
                )}
              </div>
            )}

        {retrieveNotice && (
          <div className="px-3 py-2 rounded-xl bg-amber-50/80 dark:bg-amber-950/40 border border-amber-200/80 dark:border-amber-900/60 text-xs text-amber-900 dark:text-amber-200 flex items-center justify-between gap-2">
            <span>{retrieveNotice}</span>
            <button
              type="button"
              onClick={() => setRetrieveNotice(null)}
              className="text-amber-700 dark:text-amber-300 hover:opacity-80 cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        <div className="grid grid-cols-2 lg:grid-cols-5 gap-2.5 sm:gap-3">
          <div className="min-w-0">
            <label className="block text-[11px] font-semibold text-stone-600 dark:text-stone-300 mb-1">
              Logged By
            </label>
            <input
              type="text"
              value={loggedBy}
              onChange={(e) => setLoggedBy(e.target.value)}
              placeholder="e.g. Mom, Dad, Caregiver"
              className="w-full min-w-0 px-2.5 sm:px-3 py-2 text-xs bg-stone-50 dark:bg-stone-800 border border-stone-200 dark:border-stone-700 text-stone-900 dark:text-white rounded-xl focus:outline-hidden focus:border-amber-500"
            />
          </div>

          <div className="min-w-0">
            <label className="block text-[11px] font-semibold text-stone-600 dark:text-stone-300 mb-1">
              Date
            </label>
            <input
              type="date"
              value={growthDate}
              onChange={(e) => setGrowthDate(e.target.value)}
              className="w-full min-w-0 px-2.5 sm:px-3 py-2 text-xs bg-stone-50 dark:bg-stone-800 border border-stone-200 dark:border-stone-700 text-stone-900 dark:text-white rounded-xl focus:outline-hidden focus:border-amber-500"
            />
          </div>

          <div className="min-w-0">
            <label className="block text-[11px] font-semibold text-stone-600 dark:text-stone-300 mb-1">
              Daily Weight (kg)
            </label>
            <input
              type="number"
              step="0.001"
              min="0"
              value={dailyWeight}
              onChange={(e) => setDailyWeight(e.target.value)}
              placeholder="e.g. 6.455"
              className="w-full min-w-0 px-2.5 sm:px-3 py-2 text-xs font-mono bg-stone-50 dark:bg-stone-800 border border-stone-200 dark:border-stone-700 text-stone-900 dark:text-white rounded-xl focus:outline-hidden focus:border-amber-500"
            />
          </div>

          <div className="min-w-0">
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
              className="w-full min-w-0 px-2.5 sm:px-3 py-2 text-xs font-mono bg-stone-50 dark:bg-stone-800 border border-stone-200 dark:border-stone-700 text-stone-900 dark:text-white rounded-xl focus:outline-hidden focus:border-amber-500"
            />
          </div>

          <div className="min-w-0 col-span-2 lg:col-span-1">
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
              className="w-full min-w-0 px-2.5 sm:px-3 py-2 text-xs font-mono bg-stone-50 dark:bg-stone-800 border border-stone-200 dark:border-stone-700 text-stone-900 dark:text-white rounded-xl focus:outline-hidden focus:border-amber-500"
            />
          </div>
        </div>

        {dateCollision && (
          <div
            className={`px-3 py-2.5 rounded-xl border text-xs flex flex-wrap items-center justify-between gap-2 ${
              dateCollision.level === 'duplicate'
                ? 'bg-rose-50/90 dark:bg-rose-950/40 border-rose-200 dark:border-rose-900/70 text-rose-900 dark:text-rose-200'
                : 'bg-amber-50/90 dark:bg-amber-950/40 border-amber-200 dark:border-amber-900/70 text-amber-900 dark:text-amber-200'
            }`}
          >
            <div className="flex items-start gap-2 min-w-0 flex-1">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <div className="min-w-0">
                <span className="font-bold">
                  {dateCollision.level === 'duplicate'
                    ? 'Duplicate entry detected (same date): '
                    : 'Conflicting entry on same date: '}
                </span>
                <span className="break-words">{dateCollision.summary}</span>
              </div>
            </div>
            <button
              type="button"
              onClick={() => requestEditGrowth(dateCollision.existing)}
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
              value={growthRemark}
              onChange={(e) => setGrowthRemark(e.target.value)}
              placeholder="Optional notes (e.g. morning weigh-in before feed, post-vaccine check)"
              className="w-full min-w-0 px-2.5 sm:px-3 py-2 text-xs bg-stone-50 dark:bg-stone-800 border border-stone-200 dark:border-stone-700 text-stone-900 dark:text-white rounded-xl focus:outline-hidden focus:border-amber-500"
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
          </div>
        )}
      </form>

      {/* Combined "Latest" Card (Weight, Length & Temperature on one row) */}
      <div className="bg-white dark:bg-stone-900 rounded-3xl border border-stone-200 dark:border-stone-800 shadow-xs overflow-hidden transition-colors">
        <div className="px-4 sm:px-5 py-3 border-b border-stone-100 dark:border-stone-800 flex items-center justify-between">
          <h3 className="text-xs font-bold text-stone-800 dark:text-stone-200 uppercase tracking-wider">
            Latest
          </h3>
        </div>
        <div className="grid grid-cols-3 divide-x divide-stone-100 dark:divide-stone-800">
          {/* Weight */}
          <div className="p-3 sm:p-4 min-w-0 flex flex-col justify-between gap-2">
            <div>
              <div className="flex items-center justify-between gap-1 text-[11px] sm:text-xs font-bold text-stone-700 dark:text-stone-200">
                <span className="flex items-center gap-1.5 truncate">
                  <Scale className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                  <span className="truncate">Weight</span>
                </span>
                {growthInsights.weightPercentile !== null && (
                  <span className="hidden sm:inline-flex text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-100/80 dark:bg-emerald-950/70 text-emerald-800 dark:text-emerald-300 shrink-0">
                    {growthInsights.weightPercentile}th %ile
                  </span>
                )}
              </div>
              <div className="text-lg sm:text-2xl font-black text-stone-900 dark:text-white mt-1 truncate">
                {growthInsights.latestWeightKg !== null
                  ? UnitConverter.formatWeight(growthInsights.latestWeightKg, unitSystem)
                  : '—'}
              </div>
              {growthInsights.latestWeightDate && (
                <div className="text-[10px] text-stone-400 dark:text-stone-500 mt-0.5 truncate">
                  {growthInsights.latestWeightDate}
                </div>
              )}
              {growthInsights.weightPercentile !== null && (
                <div className="sm:hidden text-[10px] font-bold text-emerald-700 dark:text-emerald-400 mt-0.5">
                  WHO {growthInsights.weightPercentile}th %ile
                </div>
              )}
            </div>
            <div className="pt-2 border-t border-stone-100 dark:border-stone-800 text-[10px] sm:text-[11px] text-stone-500 dark:text-stone-400 flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5">
              <span className="truncate">
                Δ{' '}
                <strong className="text-stone-800 dark:text-stone-200">
                  {growthInsights.weightDeltaGrams !== null
                    ? `${growthInsights.weightDeltaGrams >= 0 ? '+' : ''}${growthInsights.weightDeltaGrams} g`
                    : '—'}
                </strong>
              </span>
              {growthInsights.weightVelocityGramsPerDay !== null && (
                <span className="font-mono font-semibold text-emerald-700 dark:text-emerald-400 truncate">
                  {growthInsights.weightVelocityGramsPerDay >= 0 ? '+' : ''}
                  {growthInsights.weightVelocityGramsPerDay} g/d
                </span>
              )}
            </div>
          </div>

          {/* Length */}
          <div className="p-3 sm:p-4 min-w-0 flex flex-col justify-between gap-2">
            <div>
              <div className="flex items-center justify-between gap-1 text-[11px] sm:text-xs font-bold text-stone-700 dark:text-stone-200">
                <span className="flex items-center gap-1.5 truncate">
                  <Ruler className="w-3.5 h-3.5 text-teal-600 dark:text-teal-400 shrink-0" />
                  <span className="truncate">Length</span>
                </span>
                {growthInsights.lengthPercentile !== null && (
                  <span className="hidden sm:inline-flex text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-teal-100/80 dark:bg-teal-950/70 text-teal-800 dark:text-teal-300 shrink-0">
                    {growthInsights.lengthPercentile}th %ile
                  </span>
                )}
              </div>
              <div className="text-lg sm:text-2xl font-black text-stone-900 dark:text-white mt-1 truncate">
                {growthInsights.latestLengthCm !== null
                  ? UnitConverter.formatLength(growthInsights.latestLengthCm, unitSystem)
                  : '—'}
              </div>
              {(growthInsights.latestLengthDate || growthInsights.lengthIsFromBirth) && (
                <div className="text-[10px] text-stone-400 dark:text-stone-500 mt-0.5 truncate">
                  {growthInsights.lengthIsFromBirth
                    ? growthInsights.latestLengthDate
                      ? `Birth · ${growthInsights.latestLengthDate}`
                      : 'Birth length'
                    : growthInsights.latestLengthDate}
                </div>
              )}
              {growthInsights.lengthPercentile !== null && (
                <div className="sm:hidden text-[10px] font-bold text-teal-700 dark:text-teal-400 mt-0.5">
                  WHO {growthInsights.lengthPercentile}th %ile
                </div>
              )}
            </div>
            <div className="pt-2 border-t border-stone-100 dark:border-stone-800 text-[10px] sm:text-[11px] text-stone-500 dark:text-stone-400 truncate">
              {growthInsights.lengthIsFromBirth ? (
                <span className="text-stone-500 dark:text-stone-400">From birth data</span>
              ) : (
                <>
                  Δ{' '}
                  <strong className="text-stone-800 dark:text-stone-200">
                    {growthInsights.lengthDeltaCm !== null
                      ? `${growthInsights.lengthDeltaCm >= 0 ? '+' : ''}${growthInsights.lengthDeltaCm} cm`
                      : '—'}
                  </strong>
                </>
              )}
            </div>
          </div>

          {/* Temperature */}
          <div className="p-3 sm:p-4 min-w-0 flex flex-col justify-between gap-2">
            <div>
              <div className="flex items-center justify-between gap-1 text-[11px] sm:text-xs font-bold text-stone-700 dark:text-stone-200">
                <span className="flex items-center gap-1.5 truncate">
                  <Thermometer className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 shrink-0" />
                  <span className="truncate">Temp</span>
                </span>
                {growthInsights.tempClass && (
                  <span
                    className={`hidden sm:inline-flex text-[10px] font-bold px-1.5 py-0.5 rounded-full border shrink-0 ${tempBadgeClasses(
                      growthInsights.tempClass.severity
                    )}`}
                  >
                    {growthInsights.tempClass.label}
                  </span>
                )}
              </div>
              <div className="text-lg sm:text-2xl font-black text-stone-900 dark:text-white mt-1 truncate">
                {growthInsights.latestTempC !== null
                  ? `${growthInsights.latestTempC.toFixed(1)}°C`
                  : '—'}
                {growthInsights.tempClass && (
                  <span className="hidden sm:inline text-xs font-semibold text-stone-400 ml-1.5">
                    ({growthInsights.tempClass.fahrenheit}°F)
                  </span>
                )}
              </div>
              {growthInsights.latestTempDate && (
                <div className="text-[10px] text-stone-400 dark:text-stone-500 mt-0.5 truncate">
                  {growthInsights.latestTempDate}
                </div>
              )}
              {growthInsights.tempClass && (
                <div className="sm:hidden text-[10px] font-bold text-amber-700 dark:text-amber-400 mt-0.5 truncate">
                  {growthInsights.tempClass.label}
                </div>
              )}
            </div>
            <div className="pt-2 border-t border-stone-100 dark:border-stone-800 text-[10px] sm:text-[11px] text-stone-500 dark:text-stone-400 flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5">
              <span className="truncate">
                <strong className="text-stone-800 dark:text-stone-200">
                  {growthInsights.minTempC !== null && growthInsights.maxTempC !== null
                    ? `${growthInsights.minTempC.toFixed(1)}–${growthInsights.maxTempC.toFixed(1)}°C`
                    : '—'}
                </strong>
              </span>
              {growthInsights.feverEpisodes > 0 && (
                <span className="font-semibold text-rose-600 dark:text-rose-400 truncate">
                  {growthInsights.feverEpisodes} fever
                </span>
              )}
            </div>
          </div>
        </div>
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
        <div className="bg-white dark:bg-stone-900 rounded-3xl border border-stone-200 dark:border-stone-800 p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4 transition-colors">
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
      <div className="bg-white dark:bg-stone-900 rounded-3xl border border-stone-200 dark:border-stone-800 shadow-xs overflow-hidden transition-colors">
        <div className="px-5 py-3.5 border-b border-stone-100 dark:border-stone-800 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-xs font-bold text-stone-800 dark:text-stone-200 uppercase tracking-wider">
            Logged Daily Growth Entries ({filteredGrowth.length})
          </h3>
          <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-stone-50 dark:bg-stone-800 border border-stone-200 dark:border-stone-700 text-xs transition-colors">
            <Filter className="w-3.5 h-3.5 text-stone-400" />
            <select
              aria-label="Filter growth records by person who logged them"
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
        {filteredGrowth.length === 0 ? (
          <div className="p-10 text-center text-xs text-stone-500 dark:text-stone-400">
            No daily growth records logged yet. Use the form above or click Refresh to load from Supabase.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-stone-50/80 dark:bg-stone-800/80 border-b border-stone-200 dark:border-stone-800 text-stone-500 dark:text-stone-400 text-[11px] font-semibold">
                  <th className="py-3 px-4">Date</th>
                  {activeProfile?.type === 'baby' && <th className="py-3 px-4">Age</th>}
                  <th className="py-3 px-4">Logged By</th>
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
                  const recordDateStr = getGrowthRecordDate(row);
                  const autoAgeLabel =
                    activeProfile?.type === 'baby'
                      ? formatAgeFromBirthDate(activeProfile.dateOfEvent, recordDateStr)
                      : null;
                  return (
                    <tr
                      key={row.id}
                      className="hover:bg-stone-50/70 dark:hover:bg-stone-800/40 transition-colors"
                    >
                      <td className="py-3 px-4 whitespace-nowrap font-bold text-stone-900 dark:text-white">
                        <div>{recordDateStr}</div>
                        <div className="text-[10px] font-normal text-stone-400 dark:text-stone-500">
                          {formatDateTime(row.created_at)}
                        </div>
                      </td>
                      {activeProfile?.type === 'baby' && (
                        <td className="py-3 px-4 whitespace-nowrap font-mono text-[11px] font-semibold text-emerald-800 dark:text-emerald-300">
                          {autoAgeLabel ?? '—'}
                        </td>
                      )}
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
                            onClick={() => requestEditGrowth(row)}
                            className="p-1.5 text-stone-400 hover:text-stone-800 dark:hover:text-white rounded-lg hover:bg-stone-100 dark:hover:bg-stone-800 transition-colors cursor-pointer"
                            title="Authenticate with bae_Key to edit growth entry"
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

      {/* bae_Key Authentication Modal for Editing Growth Entries */}
      <EditAuthModal
        isOpen={Boolean(pendingAuthRecord)}
        title="Authenticate to Edit Growth Entry"
        description={
          pendingAuthRecord
            ? `Enter your bae_Key passkey to edit growth record #${pendingAuthRecord.id} (${getGrowthRecordDate(pendingAuthRecord)}).`
            : undefined
        }
        onClose={() => setPendingAuthRecord(null)}
        onAuthenticated={() => {
          if (pendingAuthRecord) {
            const target = pendingAuthRecord;
            setPendingAuthRecord(null);
            applyEditGrowth(target);
          }
        }}
      />

      <AskGeminiModal
        isOpen={isAskGeminiOpen}
        onClose={() => setIsAskGeminiOpen(false)}
        focus="growth"
      />
    </div>
  );
};
