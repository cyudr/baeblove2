import React, { useEffect, useState } from 'react';
import { Droplets, Scale, X } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import {
  DEFAULT_DIAPER_LOAD,
  detectDefaultFeedingMethod,
  getGrowthRecordDate,
  getRoutineRecordDate,
  normalizeDiaperLoad,
  normalizeFeedingMethod,
  normalizeStoolValue,
  parseDiaperLoadCount,
} from '../../utils/careInterpreter';
import { StoolSelect } from '../common/StoolSelect';
import { DiaperLoadControl } from '../common/DiaperLoadControl';
import { FeedingMethodSelect } from '../common/FeedingMethodSelect';
import type { GrowthRecord, RoutineRecord } from '../../types';

const DIAPER_PRESETS = ['Wet', 'Dirty', 'Mixed'] as const;

interface EditCareRecordModalProps {
  growthRecord: GrowthRecord | null;
  routineRecord: RoutineRecord | null;
  onClose: () => void;
}

export const EditCareRecordModal: React.FC<EditCareRecordModalProps> = ({
  growthRecord,
  routineRecord,
  onClose,
}) => {
  const { editGrowthRecord, editRoutineRecord } = useApp();

  // Shared fields
  const [date, setDate] = useState('');
  const [loggedBy, setLoggedBy] = useState('');
  const [remark, setRemark] = useState('');

  // Growth fields
  const [dailyWeight, setDailyWeight] = useState('');
  const [dailyLength, setDailyLength] = useState('');
  const [temperature, setTemperature] = useState('');

  // Routine fields
  const [time, setTime] = useState('');
  const [ebmMl, setEbmMl] = useState('');
  const [formulaMl, setFormulaMl] = useState('');
  const [feedDurationMin, setFeedDurationMin] = useState('');
  const [feedingMethod, setFeedingMethod] = useState('');
  const [methodTouched, setMethodTouched] = useState(false);
  const [diaper, setDiaper] = useState('');
  const [diaperLoad, setDiaperLoad] = useState(DEFAULT_DIAPER_LOAD);
  const [stool, setStool] = useState('');

  const [isSaving, setIsSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    setErrorMsg(null);
    setIsSaving(false);

    if (growthRecord) {
      setDate(getGrowthRecordDate(growthRecord));
      setTime(growthRecord.time ? growthRecord.time.slice(0, 5) : '');
      setLoggedBy(growthRecord.name ?? '');
      setDailyWeight(growthRecord.daily_weight !== null ? String(growthRecord.daily_weight) : '');
      setDailyLength(growthRecord.daily_length !== null ? String(growthRecord.daily_length) : '');
      setTemperature(growthRecord.temperature !== null ? String(growthRecord.temperature) : '');
      setRemark(growthRecord.remark ?? '');
    } else if (routineRecord) {
      setDate(getRoutineRecordDate(routineRecord));
      setTime(routineRecord.time ? routineRecord.time.slice(0, 5) : '');
      setLoggedBy(routineRecord.name ?? '');
      setEbmMl(routineRecord.emb_mL !== null ? String(routineRecord.emb_mL) : '');
      setFormulaMl(
        routineRecord.formula_mL !== null ? String(routineRecord.formula_mL) : ''
      );
      setFeedDurationMin(
        routineRecord.feed_duration_min !== null
          ? String(routineRecord.feed_duration_min)
          : ''
      );
      const existingMethod = normalizeFeedingMethod(routineRecord.feeding_method);
      setFeedingMethod(
        existingMethod ||
          detectDefaultFeedingMethod({
            ebmMl: routineRecord.emb_mL,
            formulaMl: routineRecord.formula_mL,
            feedDurationMin: routineRecord.feed_duration_min,
          })
      );
      setMethodTouched(Boolean(existingMethod));
      setDiaper(routineRecord.diaper ?? '');
      setDiaperLoad(normalizeDiaperLoad(routineRecord['diaper load'], DEFAULT_DIAPER_LOAD));
      setStool(normalizeStoolValue(routineRecord.stool));
      setRemark(routineRecord.remark ?? '');
    }
  }, [growthRecord, routineRecord]);

  useEffect(() => {
    if (!routineRecord || methodTouched) return;
    setFeedingMethod(
      detectDefaultFeedingMethod({
        ebmMl,
        formulaMl,
        feedDurationMin,
      })
    );
  }, [routineRecord, ebmMl, formulaMl, feedDurationMin, methodTouched]);

  if (!growthRecord && !routineRecord) return null;

  const isGrowth = Boolean(growthRecord);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSaving) return;
    setErrorMsg(null);
    setIsSaving(true);

    try {
      if (growthRecord) {
        const parsedWeight = dailyWeight.trim() !== '' ? parseFloat(dailyWeight) : null;
        const parsedLength = dailyLength.trim() !== '' ? parseFloat(dailyLength) : null;
        const parsedTemp = temperature.trim() !== '' ? parseFloat(temperature) : null;

        if (
          parsedWeight === null &&
          parsedLength === null &&
          parsedTemp === null &&
          !remark.trim()
        ) {
          setErrorMsg('Enter at least one measurement (weight, length, temperature, or remark).');
          return;
        }

        const res = await editGrowthRecord(growthRecord.id, {
          date: date || null,
          time: time || null,
          daily_weight: parsedWeight,
          daily_length: parsedLength,
          temperature: parsedTemp,
          name: loggedBy.trim() || null,
          remark: remark.trim() || null,
        });

        if (res.error) {
          setErrorMsg(res.error);
          return;
        }
        onClose();
      } else if (routineRecord) {
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
          !remark.trim()
        ) {
          setErrorMsg(
            'Enter at least one routine value (EBM, Formula, duration, method, diaper, stool, or remark).'
          );
          return;
        }

        const res = await editRoutineRecord(routineRecord.id, {
          date: date || null,
          time: time || null,
          emb_mL: parsedEbm,
          formula_mL: parsedFormula,
          feed_duration_min: parsedDuration,
          feeding_method: cleanMethod,
          diaper: diaper.trim() || null,
          'diaper load': hasDiaperContext ? loadCount : null,
          stool: cleanStool,
          name: loggedBy.trim() || null,
          remark: remark.trim() || null,
        });

        if (res.error) {
          setErrorMsg(res.error);
          return;
        }
        onClose();
      }
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-stone-900/60 dark:bg-black/75 backdrop-blur-xs overflow-y-auto">
      <div className="bg-white dark:bg-stone-900 rounded-3xl max-w-lg w-full p-6 shadow-2xl border border-stone-200 dark:border-stone-800 relative my-6">
        <div className="flex items-center justify-between pb-3.5 border-b border-stone-100 dark:border-stone-800">
          <div className="flex items-center gap-2.5">
            <div
              className={`w-9 h-9 rounded-2xl flex items-center justify-center shrink-0 ${
                isGrowth
                  ? 'bg-amber-100 dark:bg-amber-950/70 text-amber-700 dark:text-amber-300'
                  : 'bg-emerald-100 dark:bg-emerald-950/70 text-emerald-700 dark:text-emerald-300'
              }`}
            >
              {isGrowth ? <Scale className="w-4 h-4" /> : <Droplets className="w-4 h-4" />}
            </div>
            <div>
              <h3 className="text-base font-bold text-stone-900 dark:text-white">
                {isGrowth
                  ? `Edit Growth Record #${growthRecord?.id}`
                  : `Edit Routine Record #${routineRecord?.id}`}
              </h3>
              <p className="text-[11px] text-stone-500 dark:text-stone-400">
                Changes save directly to Supabase
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-stone-400 hover:text-stone-700 dark:hover:text-stone-200 rounded-lg hover:bg-stone-100 dark:hover:bg-stone-800 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          {isGrowth ? (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-[11px] font-semibold text-stone-600 dark:text-stone-300 mb-1">
                    Date
                  </label>
                  <input
                    type="date"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    className="w-full px-3 py-2 text-xs bg-stone-50 dark:bg-stone-800 border border-stone-200 dark:border-stone-700 text-stone-900 dark:text-white rounded-xl focus:outline-hidden focus:border-amber-500"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-stone-600 dark:text-stone-300 mb-1">
                    Time
                  </label>
                  <input
                    type="time"
                    value={time}
                    onChange={(e) => setTime(e.target.value)}
                    className="w-full px-3 py-2 text-xs font-mono bg-stone-50 dark:bg-stone-800 border border-stone-200 dark:border-stone-700 text-stone-900 dark:text-white rounded-xl focus:outline-hidden focus:border-amber-500"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-stone-600 dark:text-stone-300 mb-1">
                    Logged By
                  </label>
                  <input
                    type="text"
                    value={loggedBy}
                    onChange={(e) => setLoggedBy(e.target.value)}
                    placeholder="e.g. Mom, Dad, Caregiver"
                    className="w-full px-3 py-2 text-xs bg-stone-50 dark:bg-stone-800 border border-stone-200 dark:border-stone-700 text-stone-900 dark:text-white rounded-xl focus:outline-hidden focus:border-amber-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
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
                  <label className="block text-[11px] font-semibold text-stone-600 dark:text-stone-300 mb-1">
                    Temperature (°C)
                  </label>
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
            </>
          ) : (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-[11px] font-semibold text-stone-600 dark:text-stone-300 mb-1">
                    Date
                  </label>
                  <input
                    type="date"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    className="w-full px-3 py-2 text-xs bg-stone-50 dark:bg-stone-800 border border-stone-200 dark:border-stone-700 text-stone-900 dark:text-white rounded-xl focus:outline-hidden focus:border-emerald-500"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-stone-600 dark:text-stone-300 mb-1">
                    Time
                  </label>
                  <input
                    type="time"
                    value={time}
                    onChange={(e) => setTime(e.target.value)}
                    className="w-full px-3 py-2 text-xs bg-stone-50 dark:bg-stone-800 border border-stone-200 dark:border-stone-700 text-stone-900 dark:text-white rounded-xl focus:outline-hidden focus:border-emerald-500"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-stone-600 dark:text-stone-300 mb-1">
                    Logged By
                  </label>
                  <input
                    type="text"
                    value={loggedBy}
                    onChange={(e) => setLoggedBy(e.target.value)}
                    placeholder="e.g. Mom, Dad"
                    className="w-full px-3 py-2 text-xs bg-stone-50 dark:bg-stone-800 border border-stone-200 dark:border-stone-700 text-stone-900 dark:text-white rounded-xl focus:outline-hidden focus:border-emerald-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div>
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
                    className="w-full px-3 py-2 text-xs font-mono bg-stone-50 dark:bg-stone-800 border border-stone-200 dark:border-stone-700 text-stone-900 dark:text-white rounded-xl focus:outline-hidden focus:border-emerald-500"
                  />
                </div>
                <div>
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
                    className="w-full px-3 py-2 text-xs font-mono bg-stone-50 dark:bg-stone-800 border border-stone-200 dark:border-stone-700 text-stone-900 dark:text-white rounded-xl focus:outline-hidden focus:border-emerald-500"
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

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-semibold text-stone-600 dark:text-stone-300 mb-1">
                    Stool
                  </label>
                  <StoolSelect value={stool} onChange={setStool} />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-stone-600 dark:text-stone-300 mb-1">
                    Diaper Load
                  </label>
                  <DiaperLoadControl value={diaperLoad} onChange={setDiaperLoad} />
                </div>
              </div>

              <div>
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
                    placeholder="Custom..."
                    className="flex-1 min-w-[110px] px-3 py-1.5 text-xs bg-stone-50 dark:bg-stone-800 border border-stone-200 dark:border-stone-700 text-stone-900 dark:text-white rounded-xl focus:outline-hidden focus:border-emerald-500"
                  />
                </div>
              </div>
            </>
          )}

          <div>
            <label className="block text-[11px] font-semibold text-stone-600 dark:text-stone-300 mb-1">
              Remark
            </label>
            <input
              type="text"
              value={remark}
              onChange={(e) => setRemark(e.target.value)}
              placeholder="Optional notes..."
              className="w-full px-3 py-2 text-xs bg-stone-50 dark:bg-stone-800 border border-stone-200 dark:border-stone-700 text-stone-900 dark:text-white rounded-xl focus:outline-hidden focus:border-stone-400"
            />
          </div>

          {errorMsg && (
            <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-900/70 text-xs text-rose-700 dark:text-rose-300">
              {errorMsg}
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-3 border-t border-stone-100 dark:border-stone-800">
            <button
              type="button"
              onClick={onClose}
              disabled={isSaving}
              className="px-4 py-2 text-xs font-semibold text-stone-600 dark:text-stone-400 hover:text-stone-900 dark:hover:text-white rounded-xl transition-colors cursor-pointer disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSaving}
              className="px-4 py-2 text-xs font-bold text-white bg-stone-900 hover:bg-stone-800 dark:bg-stone-100 dark:hover:bg-white dark:text-stone-900 rounded-xl shadow-xs transition-colors cursor-pointer disabled:opacity-50"
            >
              {isSaving ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
