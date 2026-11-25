import React, { useEffect, useMemo, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { calculatePercentile, UnitConverter } from '../../data/growthStandards';
import {
  classifyTemperature,
  doesRecordMatchProfile,
  formatDiaperLoad,
  getGrowthRecordDate,
  getRoutineRecordDate,
} from '../../utils/careInterpreter';
import {
  ClipboardList,
  Plus,
  Trash2,
  FileText,
  History,
  HeartPulse,
  Baby,
  ArrowRight,
  Pencil,
  Droplets,
  Scale,
  RefreshCw,
  Filter,
  Sparkles,
} from 'lucide-react';
import { AttachedPrenatalHistoryModal } from '../modals/AttachedPrenatalHistoryModal';
import { EditAuthModal } from '../modals/EditAuthModal';
import { EditCareRecordModal } from '../modals/EditCareRecordModal';
import { MassImportModal, type MassImportTable } from '../modals/MassImportModal';
import type {
  BabyMeasurement,
  FetalMeasurement,
  GrowthRecord,
  RoutineRecord,
} from '../../types';

type HistorySubTab = 'all' | 'routine' | 'growth' | 'clinical' | 'fetal-history';

type PendingEditAction =
  | { kind: 'routine'; record: RoutineRecord }
  | { kind: 'growth'; record: GrowthRecord }
  | { kind: 'baby'; record: BabyMeasurement }
  | { kind: 'fetal'; record: FetalMeasurement };

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

interface HistoryLogsViewProps {
  onOpenLogModal: () => void;
  onEditBabyMeasurement?: (measurement: BabyMeasurement) => void;
  onEditFetalMeasurement?: (measurement: FetalMeasurement) => void;
  onEditRoutineRecord?: (record: RoutineRecord) => void;
  onEditGrowthRecord?: (record: GrowthRecord) => void;
  onNavigateTab?: (tab: string) => void;
  onOpenEditProfileModal?: () => void;
  onOpenExportModal: () => void;
}

export const HistoryLogsView: React.FC<HistoryLogsViewProps> = ({
  onOpenLogModal,
  onEditBabyMeasurement,
  onEditFetalMeasurement,
  onEditRoutineRecord,
  onEditGrowthRecord,
  onNavigateTab,
  onOpenEditProfileModal,
  onOpenExportModal,
}) => {
  const {
    activeProfile,
    activeBabyMeasurements,
    activeFetalMeasurements,
    growthRecords,
    routineRecords,
    isCareTablesLoading,
    refreshCareTables,
    removeGrowthRecord,
    removeRoutineRecord,
    getAttachedFetalMeasurements,
    deleteBabyMeasurement,
    deleteFetalMeasurement,
    unitSystem,
  } = useApp();

  const [activeSubTab, setActiveSubTab] = useState<HistorySubTab>('all');
  const [loggerFilter, setLoggerFilter] = useState<string>('all');
  const [isHistoryModalOpen, setIsHistoryModalOpen] = useState(false);
  const [pendingDeleteKey, setPendingDeleteKey] = useState<string | null>(null);
  const [pendingEditAction, setPendingEditAction] = useState<PendingEditAction | null>(null);
  const [editingRoutineInHistory, setEditingRoutineInHistory] = useState<RoutineRecord | null>(null);
  const [editingGrowthInHistory, setEditingGrowthInHistory] = useState<GrowthRecord | null>(null);
  const [massImportTable, setMassImportTable] = useState<MassImportTable | null>(null);

  const isBaby = activeProfile?.type === 'baby';
  const hasAttachedFetal = Boolean(isBaby && activeProfile?.attachedFetalProfileId);
  const attachedFetalScans =
    hasAttachedFetal && activeProfile ? getAttachedFetalMeasurements(activeProfile.id) : [];

  useEffect(() => {
    setLoggerFilter('all');
  }, [activeProfile?.id]);

  // Scope routine & growth history to the active profile loaded from "entries" via profile_id
  const profileRoutineRecords = useMemo(() => {
    if (!activeProfile) return routineRecords;
    return routineRecords.filter((r) => doesRecordMatchProfile(r, activeProfile));
  }, [routineRecords, activeProfile]);

  const profileGrowthRecords = useMemo(() => {
    if (!activeProfile) return growthRecords;
    return growthRecords.filter((g) => doesRecordMatchProfile(g, activeProfile));
  }, [growthRecords, activeProfile]);

  const availableLoggers = useMemo(() => {
    const set = new Set<string>();
    for (const r of profileRoutineRecords) {
      if (r.name?.trim()) set.add(r.name.trim());
    }
    for (const g of profileGrowthRecords) {
      if (g.name?.trim()) set.add(g.name.trim());
    }
    for (const m of activeBabyMeasurements) {
      if (m.loggedBy?.trim()) set.add(m.loggedBy.trim());
    }
    for (const m of activeFetalMeasurements) {
      if (m.loggedBy?.trim()) set.add(m.loggedBy.trim());
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [profileRoutineRecords, profileGrowthRecords, activeBabyMeasurements, activeFetalMeasurements]);

  const filteredRoutine = useMemo(() => {
    if (loggerFilter === 'all') return profileRoutineRecords;
    const target = loggerFilter.trim().toLowerCase();
    return profileRoutineRecords.filter((r) => (r.name ?? '').trim().toLowerCase() === target);
  }, [profileRoutineRecords, loggerFilter]);

  const filteredGrowth = useMemo(() => {
    if (loggerFilter === 'all') return profileGrowthRecords;
    const target = loggerFilter.trim().toLowerCase();
    return profileGrowthRecords.filter((g) => (g.name ?? '').trim().toLowerCase() === target);
  }, [profileGrowthRecords, loggerFilter]);

  const filteredBabyMeasurements = useMemo(() => {
    if (loggerFilter === 'all') return activeBabyMeasurements;
    const target = loggerFilter.trim().toLowerCase();
    return activeBabyMeasurements.filter((m) => (m.loggedBy ?? '').trim().toLowerCase() === target);
  }, [activeBabyMeasurements, loggerFilter]);

  const filteredFetalMeasurements = useMemo(() => {
    if (loggerFilter === 'all') return activeFetalMeasurements;
    const target = loggerFilter.trim().toLowerCase();
    return activeFetalMeasurements.filter((m) => (m.loggedBy ?? '').trim().toLowerCase() === target);
  }, [activeFetalMeasurements, loggerFilter]);

  const clinicalCount = activeProfile
    ? isBaby
      ? activeBabyMeasurements.length
      : activeFetalMeasurements.length
    : 0;

  const renderRoutineTable = () => (
    <div className="bg-white dark:bg-stone-900 rounded-3xl border border-stone-200 dark:border-stone-800 shadow-xs overflow-hidden transition-colors">
      <div className="px-5 py-3.5 border-b border-stone-100 dark:border-stone-800 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Droplets className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
          <h3 className="text-xs font-bold text-stone-800 dark:text-stone-200 uppercase tracking-wider">
            Routine Data History ({filteredRoutine.length})
          </h3>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setMassImportTable('routine')}
            className="text-xs font-semibold text-emerald-700 dark:text-emerald-400 hover:underline flex items-center gap-1 cursor-pointer"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>Mass Import</span>
          </button>
          {onNavigateTab && (
            <button
              type="button"
              onClick={() => onNavigateTab('routine')}
              className="text-xs font-semibold text-stone-600 dark:text-stone-300 hover:underline flex items-center gap-1 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Log Routine</span>
            </button>
          )}
        </div>
      </div>

      {filteredRoutine.length === 0 ? (
        <div className="p-10 text-center text-xs text-stone-500 dark:text-stone-400">
          No routine entries found in Supabase yet. Log feeds or diapers in the Routine tab.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-stone-50/80 dark:bg-stone-850/80 border-b border-stone-200 dark:border-stone-800 text-stone-500 dark:text-stone-400 text-[11px] font-semibold">
                <th className="py-3 px-4">Date &amp; Time</th>
                <th className="py-3 px-4">Logged By</th>
                <th className="py-3 px-4">EBM (mL)</th>
                <th className="py-3 px-4">Formula (mL)</th>
                <th className="py-3 px-4">Total (mL)</th>
                <th className="py-3 px-4">Duration</th>
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
                    <td className="py-3 px-4 max-w-xs truncate text-stone-500 dark:text-stone-400">
                      {row.remark || '—'}
                    </td>
                    <td className="py-3 px-4 text-right whitespace-nowrap">
                      <div className="inline-flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => setPendingEditAction({ kind: 'routine', record: row })}
                          className="p-1.5 text-stone-400 hover:text-stone-800 dark:hover:text-white rounded-lg hover:bg-stone-100 dark:hover:bg-stone-800 transition-colors cursor-pointer"
                          title="Authenticate with bae_Key to edit routine entry"
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
  );

  const renderGrowthTable = () => (
    <div className="bg-white dark:bg-stone-900 rounded-3xl border border-stone-200 dark:border-stone-800 shadow-xs overflow-hidden transition-colors">
      <div className="px-5 py-3.5 border-b border-stone-100 dark:border-stone-800 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Scale className="w-4 h-4 text-amber-600 dark:text-amber-400" />
          <h3 className="text-xs font-bold text-stone-800 dark:text-stone-200 uppercase tracking-wider">
            Growth Data History ({filteredGrowth.length})
          </h3>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setMassImportTable('growth')}
            className="text-xs font-semibold text-amber-700 dark:text-amber-400 hover:underline flex items-center gap-1 cursor-pointer"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>Mass Import</span>
          </button>
          {onNavigateTab && (
            <button
              type="button"
              onClick={() => onNavigateTab('charts')}
              className="text-xs font-semibold text-stone-600 dark:text-stone-300 hover:underline flex items-center gap-1 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Log Growth</span>
            </button>
          )}
        </div>
      </div>

      {filteredGrowth.length === 0 ? (
        <div className="p-10 text-center text-xs text-stone-500 dark:text-stone-400">
          No daily growth entries found in Supabase yet. Log weight, length, or temperature in the Growth tab.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-stone-50/80 dark:bg-stone-850/80 border-b border-stone-200 dark:border-stone-800 text-stone-500 dark:text-stone-400 text-[11px] font-semibold">
                <th className="py-3 px-4">Date</th>
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
                const deleteKey = `growth-${row.id}`;
                return (
                  <tr
                    key={row.id}
                    className="hover:bg-stone-50/70 dark:hover:bg-stone-800/40 transition-colors"
                  >
                    <td className="py-3 px-4 whitespace-nowrap font-bold text-stone-900 dark:text-white">
                      <div>{getGrowthRecordDate(row)}</div>
                      <div className="text-[10px] font-normal text-stone-400 dark:text-stone-500">
                        {formatDateTime(row.created_at)}
                      </div>
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
                          onClick={() => setPendingEditAction({ kind: 'growth', record: row })}
                          className="p-1.5 text-stone-400 hover:text-stone-800 dark:hover:text-white rounded-lg hover:bg-stone-100 dark:hover:bg-stone-800 transition-colors cursor-pointer"
                          title="Authenticate with bae_Key to edit growth entry"
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
  );

  const renderClinicalTable = () => {
    if (!activeProfile) {
      return (
        <div className="bg-white dark:bg-stone-900 rounded-3xl border border-stone-200 dark:border-stone-800 p-10 text-center text-xs text-stone-500 dark:text-stone-400">
          Add a child or pregnancy profile to record pediatric checkups or ultrasound scans.
        </div>
      );
    }

    return (
      <div className="bg-white dark:bg-stone-900 rounded-3xl border border-stone-200 dark:border-stone-800 shadow-xs overflow-hidden transition-colors">
        <div className="px-5 py-3.5 border-b border-stone-100 dark:border-stone-800 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            {isBaby ? (
              <Baby className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
            ) : (
              <HeartPulse className="w-4 h-4 text-amber-600 dark:text-amber-400" />
            )}
            <h3 className="text-xs font-bold text-stone-800 dark:text-stone-200 uppercase tracking-wider">
              {isBaby
                ? `Pediatric Checkups (${activeBabyMeasurements.length})`
                : `Ultrasound Scans (${activeFetalMeasurements.length})`}
            </h3>
          </div>
          <button
            type="button"
            onClick={onOpenLogModal}
            className="text-xs font-semibold text-stone-700 dark:text-stone-300 hover:underline flex items-center gap-1 cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>{isBaby ? 'Add Checkup' : 'Add Ultrasound'}</span>
          </button>
        </div>

        {isBaby ? (
          filteredBabyMeasurements.length === 0 ? (
            <div className="p-10 text-center text-xs text-stone-500 dark:text-stone-400">
              No pediatric checkups recorded yet for {activeProfile.name}.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-stone-50/80 dark:bg-stone-850/80 border-b border-stone-200 dark:border-stone-800 text-stone-500 dark:text-stone-400 text-[11px] font-semibold">
                    <th className="py-3 px-4">Date</th>
                    <th className="py-3 px-4">Logged By</th>
                    <th className="py-3 px-4">Age</th>
                    <th className="py-3 px-4">Weight</th>
                    <th className="py-3 px-4">Weight %ile</th>
                    <th className="py-3 px-4">Length</th>
                    <th className="py-3 px-4">Head Circ.</th>
                    <th className="py-3 px-4">Notes &amp; Observations</th>
                    <th className="py-3 px-4 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100 dark:divide-stone-800 text-stone-700 dark:text-stone-300">
                  {filteredBabyMeasurements.map((m) => {
                    const weightPct = m.weightKg
                      ? calculatePercentile(m.weightKg, m.ageInMonths, 'weight', activeProfile.gender)
                      : null;
                    const deleteKey = `baby-m-${m.id}`;

                    return (
                      <tr
                        key={m.id}
                        className="hover:bg-stone-50/70 dark:hover:bg-stone-800/40 transition-colors"
                      >
                        <td className="py-3.5 px-4 font-bold text-stone-900 dark:text-white whitespace-nowrap">
                          {m.date}
                          {m.pediatricianVisit && (
                            <span className="block text-[10px] text-emerald-700 dark:text-emerald-400 font-semibold">
                              Well-child check
                            </span>
                          )}
                        </td>
                        <td className="py-3.5 px-4 whitespace-nowrap">{m.loggedBy || '—'}</td>
                        <td className="py-3.5 px-4 whitespace-nowrap font-mono">{m.ageInMonths} mo</td>
                        <td className="py-3.5 px-4 font-mono font-bold whitespace-nowrap">
                          {m.weightKg ? UnitConverter.formatWeight(m.weightKg, unitSystem) : '—'}
                        </td>
                        <td className="py-3.5 px-4 whitespace-nowrap">
                          {weightPct ? (
                            <span className="font-bold text-emerald-800 dark:text-emerald-400 px-2 py-0.5 rounded-full bg-emerald-100/70 dark:bg-emerald-950/70 border border-emerald-200/60 dark:border-emerald-800/60">
                              {weightPct.percentile}th %ile
                            </span>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td className="py-3.5 px-4 font-mono whitespace-nowrap">
                          {m.lengthCm ? UnitConverter.formatLength(m.lengthCm, unitSystem) : '—'}
                        </td>
                        <td className="py-3.5 px-4 font-mono whitespace-nowrap">
                          {m.headCircumferenceCm
                            ? UnitConverter.formatLength(m.headCircumferenceCm, unitSystem)
                            : '—'}
                        </td>
                        <td className="py-3.5 px-4 max-w-xs truncate text-stone-500 dark:text-stone-400">
                          {m.notes || '—'}
                        </td>
                        <td className="py-3.5 px-4 text-right whitespace-nowrap">
                          <div className="inline-flex items-center gap-1">
                            {onEditBabyMeasurement && (
                              <button
                                type="button"
                                onClick={() => setPendingEditAction({ kind: 'baby', record: m })}
                                className="p-1.5 text-stone-400 hover:text-stone-800 dark:hover:text-white rounded-lg hover:bg-stone-100 dark:hover:bg-stone-800 transition-colors cursor-pointer"
                                title="Authenticate with bae_Key to edit measurement"
                              >
                                <Pencil className="w-3.5 h-3.5" />
                              </button>
                            )}
                            {pendingDeleteKey === deleteKey ? (
                              <button
                                type="button"
                                onClick={() => {
                                  setPendingDeleteKey(null);
                                  deleteBabyMeasurement(m.id);
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
                                title="Delete"
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
          )
        ) : filteredFetalMeasurements.length === 0 ? (
          <div className="p-10 text-center text-xs text-stone-500 dark:text-stone-400">
            No ultrasound scans logged yet for {activeProfile.name}.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-stone-50/80 dark:bg-stone-850/80 border-b border-stone-200 dark:border-stone-800 text-stone-500 dark:text-stone-400 text-[11px] font-semibold">
                  <th className="py-3 px-4">Date</th>
                  <th className="py-3 px-4">Logged By</th>
                  <th className="py-3 px-4">Gestational Age</th>
                  <th className="py-3 px-4">EFW (Weight)</th>
                  <th className="py-3 px-4">BPD</th>
                  <th className="py-3 px-4">HC</th>
                  <th className="py-3 px-4">AC</th>
                  <th className="py-3 px-4">FL</th>
                  <th className="py-3 px-4">Fundal Ht.</th>
                  <th className="py-3 px-4">Maternal Wt.</th>
                  <th className="py-3 px-4">Clinic / Notes</th>
                  <th className="py-3 px-4 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100 dark:divide-stone-800 text-stone-700 dark:text-stone-300">
                {filteredFetalMeasurements.map((m) => {
                  const deleteKey = `fetal-m-${m.id}`;
                  return (
                    <tr
                      key={m.id}
                      className="hover:bg-stone-50/70 dark:hover:bg-stone-800/40 transition-colors"
                    >
                      <td className="py-3.5 px-4 font-bold text-stone-900 dark:text-white whitespace-nowrap">
                        {m.date}
                      </td>
                      <td className="py-3.5 px-4 whitespace-nowrap">{m.loggedBy || '—'}</td>
                      <td className="py-3.5 px-4 whitespace-nowrap font-mono font-bold text-amber-900 dark:text-amber-400">
                        {m.gestationalWeeks}w {m.gestationalDays}d
                      </td>
                      <td className="py-3.5 px-4 font-mono font-bold text-emerald-800 dark:text-emerald-400 whitespace-nowrap">
                        {m.efwGrams ? UnitConverter.formatFetalWeight(m.efwGrams, unitSystem) : '—'}
                      </td>
                      <td className="py-3.5 px-4 font-mono whitespace-nowrap">
                        {m.bpdMm ? `${m.bpdMm} mm` : '—'}
                      </td>
                      <td className="py-3.5 px-4 font-mono whitespace-nowrap">
                        {m.hcMm ? `${m.hcMm} mm` : '—'}
                      </td>
                      <td className="py-3.5 px-4 font-mono whitespace-nowrap">
                        {m.acMm ? `${m.acMm} mm` : '—'}
                      </td>
                      <td className="py-3.5 px-4 font-mono whitespace-nowrap">
                        {m.flMm ? `${m.flMm} mm` : '—'}
                      </td>
                      <td className="py-3.5 px-4 font-mono whitespace-nowrap">
                        {m.fundalHeightCm ? `${m.fundalHeightCm} cm` : '—'}
                      </td>
                      <td className="py-3.5 px-4 font-mono whitespace-nowrap">
                        {m.maternalWeightKg
                          ? unitSystem === 'metric'
                            ? `${m.maternalWeightKg} kg`
                            : `${(m.maternalWeightKg * 2.20462).toFixed(1)} lb`
                          : '—'}
                      </td>
                      <td className="py-3.5 px-4 max-w-xs truncate text-stone-500 dark:text-stone-400">
                        {m.notes || m.scanLocation || '—'}
                      </td>
                      <td className="py-3.5 px-4 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1">
                          {onEditFetalMeasurement && (
                            <button
                              type="button"
                              onClick={() => setPendingEditAction({ kind: 'fetal', record: m })}
                              className="p-1.5 text-stone-400 hover:text-stone-800 dark:hover:text-white rounded-lg hover:bg-stone-100 dark:hover:bg-stone-800 transition-colors cursor-pointer"
                              title="Authenticate with bae_Key to edit ultrasound record"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                          )}
                          {pendingDeleteKey === deleteKey ? (
                            <button
                              type="button"
                              onClick={() => {
                                setPendingDeleteKey(null);
                                deleteFetalMeasurement(m.id);
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
                              title="Delete"
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
    );
  };

  const renderAttachedFetalTable = () => (
    <div className="bg-white dark:bg-stone-900 rounded-3xl border border-stone-200 dark:border-stone-800 shadow-xs overflow-hidden transition-colors">
      <div className="px-5 py-3.5 border-b border-stone-100 dark:border-stone-800 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <HeartPulse className="w-4 h-4 text-amber-600 dark:text-amber-400" />
          <h3 className="text-xs font-bold text-stone-800 dark:text-stone-200 uppercase tracking-wider">
            Attached Ultrasound Scans ({attachedFetalScans.length})
          </h3>
        </div>
        <button
          type="button"
          onClick={() => setIsHistoryModalOpen(true)}
          className="text-xs font-semibold text-amber-700 dark:text-amber-400 hover:underline flex items-center gap-1 cursor-pointer"
        >
          <span>Review Full Prenatal Journey</span>
          <ArrowRight className="w-3 h-3" />
        </button>
      </div>
      {attachedFetalScans.length === 0 ? (
        <div className="p-10 text-center text-xs text-stone-500 dark:text-stone-400">
          No attached ultrasound scans found for this baby profile.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-amber-50/60 dark:bg-amber-950/40 border-b border-amber-200 dark:border-amber-900 text-stone-600 dark:text-stone-300 text-[11px] font-semibold">
                <th className="py-3 px-4">Date</th>
                <th className="py-3 px-4">Gestational Age</th>
                <th className="py-3 px-4">EFW</th>
                <th className="py-3 px-4">BPD</th>
                <th className="py-3 px-4">HC</th>
                <th className="py-3 px-4">AC</th>
                <th className="py-3 px-4">FL</th>
                <th className="py-3 px-4">Fundal Ht.</th>
                <th className="py-3 px-4">Clinic / Notes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100 dark:divide-stone-800 text-stone-700 dark:text-stone-300 font-mono">
              {attachedFetalScans.map((m) => (
                <tr key={m.id} className="hover:bg-stone-50/70 dark:hover:bg-stone-800/40 transition-colors">
                  <td className="py-3.5 px-4 font-sans font-bold text-stone-900 dark:text-white whitespace-nowrap">
                    {m.date}
                  </td>
                  <td className="py-3.5 px-4 whitespace-nowrap font-bold text-amber-900 dark:text-amber-400">
                    {m.gestationalWeeks}w {m.gestationalDays}d
                  </td>
                  <td className="py-3.5 px-4 font-bold text-emerald-800 dark:text-emerald-400 whitespace-nowrap">
                    {m.efwGrams ? UnitConverter.formatFetalWeight(m.efwGrams, unitSystem) : '—'}
                  </td>
                  <td className="py-3.5 px-4 whitespace-nowrap">{m.bpdMm ? `${m.bpdMm} mm` : '—'}</td>
                  <td className="py-3.5 px-4 whitespace-nowrap">{m.hcMm ? `${m.hcMm} mm` : '—'}</td>
                  <td className="py-3.5 px-4 whitespace-nowrap">{m.acMm ? `${m.acMm} mm` : '—'}</td>
                  <td className="py-3.5 px-4 whitespace-nowrap">{m.flMm ? `${m.flMm} mm` : '—'}</td>
                  <td className="py-3.5 px-4 whitespace-nowrap">
                    {m.fundalHeightCm ? `${m.fundalHeightCm} cm` : '—'}
                  </td>
                  <td className="py-3.5 px-4 font-sans max-w-xs truncate text-stone-500 dark:text-stone-400">
                    {m.notes || m.scanLocation || '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );

  return (
    <div className="space-y-6">
      {/* Header Card */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 bg-white dark:bg-stone-900 rounded-3xl border border-stone-200 dark:border-stone-800 p-5 md:p-6 shadow-xs transition-colors">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-2xl bg-stone-100 dark:bg-stone-800 text-stone-800 dark:text-stone-200 flex items-center justify-center shadow-2xs">
              <ClipboardList className="w-4 h-4" />
            </div>
            <h2 className="text-xl font-bold text-stone-900 dark:text-white">
              Routine &amp; Growth History
            </h2>
          </div>
          <p className="text-xs text-stone-500 dark:text-stone-400 mt-1">
            Live synced history of routine logs, daily growth records, and clinical measurements from Supabase.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-stone-50 dark:bg-stone-800 border border-stone-200 dark:border-stone-700 text-xs">
            <Filter className="w-3.5 h-3.5 text-stone-400" />
            <select
              aria-label="Filter history by person who logged it"
              value={loggerFilter}
              onChange={(e) => setLoggerFilter(e.target.value)}
              className="bg-transparent text-stone-700 dark:text-stone-200 font-semibold focus:outline-hidden cursor-pointer"
            >
              <option value="all">All Loggers</option>
              {availableLoggers.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </div>

          <button
            type="button"
            onClick={() =>
              setMassImportTable(
                activeSubTab === 'growth'
                  ? 'growth'
                  : activeSubTab === 'routine'
                    ? 'routine'
                    : 'auto'
              )
            }
            className="px-3 py-2 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 dark:bg-emerald-500 dark:hover:bg-emerald-400 dark:text-stone-950 rounded-xl shadow-xs transition-colors flex items-center gap-1.5 cursor-pointer"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>Mass Import</span>
          </button>

          <button
            type="button"
            onClick={() => void refreshCareTables()}
            disabled={isCareTablesLoading}
            className="px-3 py-2 text-xs font-semibold text-stone-700 dark:text-stone-200 bg-stone-100 dark:bg-stone-800 hover:bg-stone-200 dark:hover:bg-stone-700 border border-stone-200/60 dark:border-stone-700/60 rounded-xl transition-colors flex items-center gap-1.5 cursor-pointer disabled:opacity-60"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isCareTablesLoading ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>

          {activeProfile && onOpenEditProfileModal && (
            <button
              type="button"
              onClick={onOpenEditProfileModal}
              className="px-3 py-2 text-xs font-semibold text-stone-700 dark:text-stone-200 bg-stone-100 dark:bg-stone-800 hover:bg-stone-200 dark:hover:bg-stone-700 border border-stone-200/60 dark:border-stone-700/60 rounded-xl transition-colors flex items-center gap-1.5 cursor-pointer"
            >
              <Pencil className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
              <span>{isBaby ? 'Edit Birth Data' : 'Edit Profile'}</span>
            </button>
          )}

          {hasAttachedFetal && (
            <button
              type="button"
              onClick={() => setIsHistoryModalOpen(true)}
              className="px-3 py-2 text-xs font-semibold text-amber-900 dark:text-amber-200 bg-amber-50 dark:bg-amber-950/60 hover:bg-amber-100 dark:hover:bg-amber-900 border border-amber-200 dark:border-amber-800 rounded-xl transition-colors flex items-center gap-1.5 cursor-pointer"
            >
              <History className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
              <span>In-Womb</span>
            </button>
          )}

          <button
            type="button"
            onClick={onOpenExportModal}
            className="px-3 py-2 text-xs font-semibold text-stone-700 dark:text-stone-200 bg-stone-100 dark:bg-stone-800 hover:bg-stone-200 dark:hover:bg-stone-700 border border-stone-200/60 dark:border-stone-700/60 rounded-xl transition-colors flex items-center gap-1.5 cursor-pointer"
          >
            <FileText className="w-3.5 h-3.5 text-stone-500 dark:text-stone-400" />
            <span>Report</span>
          </button>
        </div>
      </div>

      {/* Sub-Tab Bar */}
      <div className="flex flex-wrap items-center gap-1.5 p-1.5 bg-stone-100 dark:bg-stone-850 rounded-2xl border border-stone-200 dark:border-stone-800">
        <button
          type="button"
          onClick={() => setActiveSubTab('all')}
          className={`px-3.5 py-1.5 text-xs font-semibold rounded-xl transition-all flex items-center gap-1.5 cursor-pointer ${
            activeSubTab === 'all'
              ? 'bg-white dark:bg-stone-900 text-stone-900 dark:text-white shadow-xs font-bold'
              : 'text-stone-600 dark:text-stone-400 hover:text-stone-900 dark:hover:text-white'
          }`}
        >
          <History className="w-3.5 h-3.5 text-stone-500" />
          <span>All Logs ({filteredRoutine.length + filteredGrowth.length})</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveSubTab('routine')}
          className={`px-3.5 py-1.5 text-xs font-semibold rounded-xl transition-all flex items-center gap-1.5 cursor-pointer ${
            activeSubTab === 'routine'
              ? 'bg-white dark:bg-stone-900 text-stone-900 dark:text-white shadow-xs font-bold'
              : 'text-stone-600 dark:text-stone-400 hover:text-stone-900 dark:hover:text-white'
          }`}
        >
          <Droplets className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
          <span>Routine History ({filteredRoutine.length})</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveSubTab('growth')}
          className={`px-3.5 py-1.5 text-xs font-semibold rounded-xl transition-all flex items-center gap-1.5 cursor-pointer ${
            activeSubTab === 'growth'
              ? 'bg-white dark:bg-stone-900 text-stone-900 dark:text-white shadow-xs font-bold'
              : 'text-stone-600 dark:text-stone-400 hover:text-stone-900 dark:hover:text-white'
          }`}
        >
          <Scale className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
          <span>Growth History ({filteredGrowth.length})</span>
        </button>

        {activeProfile && (
          <button
            type="button"
            onClick={() => setActiveSubTab('clinical')}
            className={`px-3.5 py-1.5 text-xs font-semibold rounded-xl transition-all flex items-center gap-1.5 cursor-pointer ${
              activeSubTab === 'clinical'
                ? 'bg-white dark:bg-stone-900 text-stone-900 dark:text-white shadow-xs font-bold'
                : 'text-stone-600 dark:text-stone-400 hover:text-stone-900 dark:hover:text-white'
            }`}
          >
            {isBaby ? (
              <Baby className="w-3.5 h-3.5 text-teal-600 dark:text-teal-400" />
            ) : (
              <HeartPulse className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
            )}
            <span>
              {isBaby ? `Pediatric Checkups (${clinicalCount})` : `Ultrasound Scans (${clinicalCount})`}
            </span>
          </button>
        )}

        {hasAttachedFetal && (
          <button
            type="button"
            onClick={() => setActiveSubTab('fetal-history')}
            className={`px-3.5 py-1.5 text-xs font-semibold rounded-xl transition-all flex items-center gap-1.5 cursor-pointer ${
              activeSubTab === 'fetal-history'
                ? 'bg-white dark:bg-stone-900 text-amber-900 dark:text-amber-200 shadow-xs font-bold'
                : 'text-stone-600 dark:text-stone-400 hover:text-stone-900 dark:hover:text-white'
            }`}
          >
            <HeartPulse className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
            <span>Attached In-Womb ({attachedFetalScans.length})</span>
          </button>
        )}
      </div>

      {/* Rendered Tables */}
      {activeSubTab === 'all' && (
        <div className="space-y-6">
          {renderRoutineTable()}
          {renderGrowthTable()}
          {activeProfile && clinicalCount > 0 && renderClinicalTable()}
        </div>
      )}

      {activeSubTab === 'routine' && renderRoutineTable()}
      {activeSubTab === 'growth' && renderGrowthTable()}
      {activeSubTab === 'clinical' && renderClinicalTable()}
      {activeSubTab === 'fetal-history' && hasAttachedFetal && renderAttachedFetalTable()}

      {/* Attached Prenatal History Modal */}
      {hasAttachedFetal && activeProfile && (
        <AttachedPrenatalHistoryModal
          isOpen={isHistoryModalOpen}
          onClose={() => setIsHistoryModalOpen(false)}
          babyProfile={activeProfile}
        />
      )}

      {/* bae_Key Authentication Modal before editing any History entry */}
      <EditAuthModal
        isOpen={Boolean(pendingEditAction)}
        title="Authenticate to Edit History"
        description={
          pendingEditAction?.kind === 'routine'
            ? `Enter your bae_Key passkey to edit routine record #${pendingEditAction.record.id}.`
            : pendingEditAction?.kind === 'growth'
              ? `Enter your bae_Key passkey to edit growth record #${pendingEditAction.record.id}.`
              : pendingEditAction?.kind === 'baby'
                ? `Enter your bae_Key passkey to edit pediatric checkup (${pendingEditAction.record.date}).`
                : pendingEditAction?.kind === 'fetal'
                  ? `Enter your bae_Key passkey to edit ultrasound scan (${pendingEditAction.record.date}).`
                  : undefined
        }
        onClose={() => setPendingEditAction(null)}
        onAuthenticated={() => {
          if (!pendingEditAction) return;
          const action = pendingEditAction;
          setPendingEditAction(null);
          if (action.kind === 'routine') {
            setEditingGrowthInHistory(null);
            setEditingRoutineInHistory(action.record);
          } else if (action.kind === 'growth') {
            setEditingRoutineInHistory(null);
            setEditingGrowthInHistory(action.record);
          } else if (action.kind === 'baby') {
            onEditBabyMeasurement?.(action.record);
          } else if (action.kind === 'fetal') {
            onEditFetalMeasurement?.(action.record);
          }
        }}
      />

      {/* Direct In-History Record Editor for Growth & Routine rows */}
      <EditCareRecordModal
        growthRecord={editingGrowthInHistory}
        routineRecord={editingRoutineInHistory}
        onClose={() => {
          setEditingGrowthInHistory(null);
          setEditingRoutineInHistory(null);
        }}
      />

      {/* Gemini-Enabled Mass Import Modal for Routine & Growth tables */}
      <MassImportModal
        isOpen={massImportTable !== null}
        initialTable={massImportTable ?? 'routine'}
        onClose={() => setMassImportTable(null)}
      />
    </div>
  );
};
