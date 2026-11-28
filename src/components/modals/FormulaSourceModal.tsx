import React, { useEffect, useState } from 'react';
import { useApp } from '../../context/AppContext';
import {
  FORMULA_CATALOG,
  calculateDynamicEFW,
} from '../../data/formulaSources';
import {
  calculatePercentile,
  getInterpolatedWHOPoint,
  UnitConverter,
} from '../../data/growthStandards';
import { DEFAULT_MILK_FORMULA, MIN_MILK_TARGET_AGE_DAYS } from '../../utils/careInterpreter';
import {
  FetalFormulaId,
  GestationalMethodId,
  CustomFormulaConfig,
} from '../../types';
import { X, BookOpen, Check, Calculator, Sliders, Sparkles } from 'lucide-react';

interface FormulaSourceModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type PregnancyFormulaTab = 'efw' | 'gestational' | 'fetal-sandbox';
type BabyFormulaTab = 'who' | 'pediatric-formulas' | 'baby-sandbox';
type FormulaModalTab = PregnancyFormulaTab | BabyFormulaTab;

export const FormulaSourceModal: React.FC<FormulaSourceModalProps> = ({
  isOpen,
  onClose,
}) => {
  const { activeProfile, formulaSettings, updateFormulaSettings, unitSystem } = useApp();

  const isPregnancy = activeProfile?.type === 'fetal';
  const isBaby = activeProfile?.type === 'baby';

  const [activeTab, setActiveTab] = useState<FormulaModalTab>(
    isPregnancy ? 'efw' : 'who'
  );

  // Sync tab strictly to the active profile type whenever modal opens or profile switches
  useEffect(() => {
    if (!isOpen) return;
    if (isPregnancy) {
      setActiveTab((prev) =>
        prev === 'efw' || prev === 'gestational' || prev === 'fetal-sandbox' ? prev : 'efw'
      );
    } else if (isBaby) {
      setActiveTab((prev) =>
        prev === 'who' || prev === 'pediatric-formulas' || prev === 'baby-sandbox' ? prev : 'who'
      );
    }
  }, [isOpen, isPregnancy, isBaby]);

  // Custom fetal EFW formula inputs (Pregnancy profile only)
  const [customName, setCustomName] = useState(formulaSettings.customFormula.name);
  const [customIntercept, setCustomIntercept] = useState(
    formulaSettings.customFormula.baseIntercept.toString()
  );
  const [customAc, setCustomAc] = useState(formulaSettings.customFormula.acCoeff.toString());
  const [customFl, setCustomFl] = useState(formulaSettings.customFormula.flCoeff.toString());
  const [customHc, setCustomHc] = useState(formulaSettings.customFormula.hcCoeff.toString());
  const [customBpd, setCustomBpd] = useState(formulaSettings.customFormula.bpdCoeff.toString());
  const [customAcFl, setCustomAcFl] = useState(
    formulaSettings.customFormula.acFlInteractionCoeff.toString()
  );

  // Gestational settings (Pregnancy profile only)
  const [gestationalMethod, setGestationalMethod] = useState<GestationalMethodId>(
    formulaSettings.gestationalMethod
  );
  const [customDays, setCustomDays] = useState(formulaSettings.customGestationalDays.toString());

  // Fetal sandbox inputs (Pregnancy profile only)
  const [sandboxBpd, setSandboxBpd] = useState('72');
  const [sandboxHc, setSandboxHc] = useState('265');
  const [sandboxAc, setSandboxAc] = useState('245');
  const [sandboxFl, setSandboxFl] = useState('54');

  // Baby/Toddler WHO & Feeding sandbox inputs (Baby profile only)
  const [babySandboxAgeMonths, setBabySandboxAgeMonths] = useState('3');
  const [babySandboxGender, setBabySandboxGender] = useState<'boy' | 'girl'>(
    activeProfile?.gender === 'girl' ? 'girl' : 'boy'
  );
  const [babySandboxWeightKg, setBabySandboxWeightKg] = useState('6.2');
  const [babySandboxLengthCm, setBabySandboxLengthCm] = useState('61.0');
  const [babySandboxHcCm, setBabySandboxHcCm] = useState('40.5');

  useEffect(() => {
    if (isBaby && activeProfile) {
      setBabySandboxGender(activeProfile.gender === 'girl' ? 'girl' : 'boy');
    }
  }, [isBaby, activeProfile]);

  if (!isOpen) return null;

  const handleSelectEfwFormula = (id: FetalFormulaId) => {
    updateFormulaSettings({ fetalEfwFormula: id });
  };

  const handleSaveCustomFormula = (e: React.FormEvent) => {
    e.preventDefault();
    const newConfig: CustomFormulaConfig = {
      name: customName.trim() || 'Custom Formula',
      equationDescription: 'User-calibrated biometric regression model',
      baseIntercept: parseFloat(customIntercept) || 1.35,
      acCoeff: parseFloat(customAc) || 0.042,
      flCoeff: parseFloat(customFl) || 0.174,
      hcCoeff: parseFloat(customHc) || 0.006,
      bpdCoeff: parseFloat(customBpd) || 0.0006,
      acFlInteractionCoeff: parseFloat(customAcFl) || -0.0038,
    };
    updateFormulaSettings({
      fetalEfwFormula: 'custom',
      customFormula: newConfig,
    });
  };

  const handleSaveGestationalMethod = () => {
    updateFormulaSettings({
      gestationalMethod,
      customGestationalDays: parseInt(customDays, 10) || 280,
    });
  };

  // Fetal sandbox computations (used only in Pregnancy profile)
  const bpdNum = parseFloat(sandboxBpd) || undefined;
  const hcNum = parseFloat(sandboxHc) || undefined;
  const acNum = parseFloat(sandboxAc) || undefined;
  const flNum = parseFloat(sandboxFl) || undefined;

  const testHadlock4 = isPregnancy
    ? calculateDynamicEFW(
        { bpdMm: bpdNum, hcMm: hcNum, acMm: acNum, flMm: flNum },
        { ...formulaSettings, fetalEfwFormula: 'hadlock4' }
      )
    : null;

  const testHadlock3 = isPregnancy
    ? calculateDynamicEFW(
        { bpdMm: bpdNum, hcMm: hcNum, acMm: acNum, flMm: flNum },
        { ...formulaSettings, fetalEfwFormula: 'hadlock3' }
      )
    : null;

  const testShepard = isPregnancy
    ? calculateDynamicEFW(
        { bpdMm: bpdNum, hcMm: hcNum, acMm: acNum, flMm: flNum },
        { ...formulaSettings, fetalEfwFormula: 'shepard' }
      )
    : null;

  const testIntergrowth = isPregnancy
    ? calculateDynamicEFW(
        { bpdMm: bpdNum, hcMm: hcNum, acMm: acNum, flMm: flNum },
        { ...formulaSettings, fetalEfwFormula: 'intergrowth21' }
      )
    : null;

  // Baby/Toddler WHO & Milk Target sandbox computations (used only in Baby profile)
  const parsedBabyAge = Math.min(60, Math.max(0, parseFloat(babySandboxAgeMonths) || 0));
  const parsedBabyWeight = parseFloat(babySandboxWeightKg);
  const parsedBabyLength = parseFloat(babySandboxLengthCm);
  const parsedBabyHc = parseFloat(babySandboxHcCm);

  const babyWeightPoint = isBaby
    ? getInterpolatedWHOPoint(parsedBabyAge, 'weight', babySandboxGender)
    : null;
  const babyLengthPoint = isBaby
    ? getInterpolatedWHOPoint(parsedBabyAge, 'length', babySandboxGender)
    : null;
  const babyHcPoint = isBaby
    ? getInterpolatedWHOPoint(parsedBabyAge, 'headCircumference', babySandboxGender)
    : null;

  const babyWeightResult =
    isBaby && Number.isFinite(parsedBabyWeight) && parsedBabyWeight > 0
      ? calculatePercentile(parsedBabyWeight, parsedBabyAge, 'weight', babySandboxGender)
      : null;
  const babyLengthResult =
    isBaby && Number.isFinite(parsedBabyLength) && parsedBabyLength > 0
      ? calculatePercentile(parsedBabyLength, parsedBabyAge, 'length', babySandboxGender)
      : null;
  const babyHcResult =
    isBaby && Number.isFinite(parsedBabyHc) && parsedBabyHc > 0
      ? calculatePercentile(parsedBabyHc, parsedBabyAge, 'headCircumference', babySandboxGender)
      : null;

  const babySandboxAgeDays = parsedBabyAge * 30.4375;
  const isSandboxMilkTargetEligible = babySandboxAgeDays >= MIN_MILK_TARGET_AGE_DAYS;

  const milkMinMl =
    isBaby &&
    isSandboxMilkTargetEligible &&
    Number.isFinite(parsedBabyWeight) &&
    parsedBabyWeight > 0
      ? Math.round(parsedBabyWeight * DEFAULT_MILK_FORMULA.minMlPerKg)
      : null;
  const milkMaxMl =
    isBaby &&
    isSandboxMilkTargetEligible &&
    Number.isFinite(parsedBabyWeight) &&
    parsedBabyWeight > 0
      ? Math.round(parsedBabyWeight * DEFAULT_MILK_FORMULA.maxMlPerKg)
      : null;
  const milkTargetMl =
    milkMinMl !== null && milkMaxMl !== null
      ? Math.round(
          milkMinMl + (milkMaxMl - milkMinMl) * (DEFAULT_MILK_FORMULA.targetRangePct / 100)
        )
      : null;
  const milkPerFeedMl =
    milkTargetMl !== null
      ? Math.round(milkTargetMl / DEFAULT_MILK_FORMULA.feedsPerDay)
      : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-stone-900/60 dark:bg-black/75 backdrop-blur-xs overflow-y-auto">
      <div className="bg-white dark:bg-stone-900 rounded-3xl max-w-3xl w-full p-6 md:p-8 shadow-2xl border border-stone-200 dark:border-stone-800 relative my-8 transition-colors">
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-stone-100 dark:border-stone-800">
          <div className="flex items-center gap-2.5">
            <div
              className={`w-9 h-9 rounded-xl flex items-center justify-center ${
                isPregnancy
                  ? 'bg-amber-100 dark:bg-amber-950/80 text-amber-800 dark:text-amber-300'
                  : 'bg-emerald-100 dark:bg-emerald-950/80 text-emerald-800 dark:text-emerald-300'
              }`}
            >
              <BookOpen className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-stone-900 dark:text-white">
                {isPregnancy
                  ? 'Fetal Development Formulas & Clinical Sources'
                  : isBaby
                    ? 'Infant & Toddler Growth Formulas & Sources'
                    : 'Clinical Data Formulas & Scientific Sources'}
              </h3>
              <p className="text-xs text-stone-500 dark:text-stone-400">
                {isPregnancy
                  ? 'Ultrasound biometric regressions, gestational dating methods, and peer-reviewed prenatal citations.'
                  : isBaby
                    ? 'WHO 2006 child growth standards, feeding volume targets, and pediatric clinical formulas.'
                    : 'Select a pregnancy or baby/toddler profile to inspect its corresponding clinical formulas.'}
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

        {/* Empty state if no active profile is selected */}
        {!activeProfile && (
          <div className="mt-6 p-6 rounded-2xl border border-dashed border-stone-200 dark:border-stone-700 text-center space-y-2">
            <p className="text-sm font-bold text-stone-800 dark:text-stone-200">
              No active profile selected
            </p>
            <p className="text-xs text-stone-500 dark:text-stone-400">
              Add or select a <strong>Pregnancy</strong> profile to view fetal biometric &amp; gestational formulas, or a <strong>Baby / Toddler</strong> profile to view WHO LMS growth &amp; infant feeding formulas.
            </p>
          </div>
        )}

        {/* ================================================================ */}
        {/* PREGNANCY PROFILE ONLY: FETAL DEVELOPMENT FORMULAS               */}
        {/* ================================================================ */}
        {isPregnancy && (
          <>
            {/* Pregnancy Tab Switcher */}
            <div className="flex items-center gap-1.5 mt-4 pb-2 border-b border-stone-100 dark:border-stone-800 overflow-x-auto scrollbar-none">
              <button
                type="button"
                onClick={() => setActiveTab('efw')}
                className={`px-3 py-1.5 text-xs font-semibold rounded-xl transition-colors whitespace-nowrap cursor-pointer ${
                  activeTab === 'efw'
                    ? 'bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900 shadow-xs'
                    : 'text-stone-600 dark:text-stone-400 hover:text-stone-900 dark:hover:text-white bg-stone-100 dark:bg-stone-800'
                }`}
              >
                Fetal EFW Formulas ({formulaSettings.fetalEfwFormula.toUpperCase()})
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('gestational')}
                className={`px-3 py-1.5 text-xs font-semibold rounded-xl transition-colors whitespace-nowrap cursor-pointer ${
                  activeTab === 'gestational'
                    ? 'bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900 shadow-xs'
                    : 'text-stone-600 dark:text-stone-400 hover:text-stone-900 dark:hover:text-white bg-stone-100 dark:bg-stone-800'
                }`}
              >
                Gestational Age Methods
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('fetal-sandbox')}
                className={`px-3 py-1.5 text-xs font-semibold rounded-xl transition-colors whitespace-nowrap flex items-center gap-1.5 cursor-pointer ${
                  activeTab === 'fetal-sandbox'
                    ? 'bg-amber-800 dark:bg-amber-700 text-white shadow-xs'
                    : 'text-stone-600 dark:text-stone-400 hover:text-stone-900 dark:hover:text-white bg-stone-100 dark:bg-stone-800'
                }`}
              >
                <Calculator className="w-3.5 h-3.5" />
                <span>Fetal EFW Sandbox</span>
              </button>
            </div>

            {/* PREGNANCY TAB 1: FETAL EFW FORMULAS */}
            {activeTab === 'efw' && (
              <div className="mt-4 space-y-4 max-h-[60vh] overflow-y-auto pr-1">
                <p className="text-xs text-stone-600 dark:text-stone-400 leading-relaxed">
                  Ultrasound estimation of fetal weight relies on multivariable regression models. Select your preferred clinical standard or calibrate custom coefficients for your clinic:
                </p>

                <div className="space-y-3">
                  {FORMULA_CATALOG.filter((f) => f.id !== 'custom').map((f) => {
                    const isSelected = formulaSettings.fetalEfwFormula === f.id;
                    return (
                      <div
                        key={f.id}
                        onClick={() => handleSelectEfwFormula(f.id)}
                        className={`p-4 rounded-2xl border transition-all cursor-pointer ${
                          isSelected
                            ? 'border-amber-500 bg-amber-50/40 dark:bg-amber-950/30 ring-1 ring-amber-400 dark:ring-amber-600'
                            : 'border-stone-200 dark:border-stone-800 hover:border-stone-300 dark:hover:border-stone-700 bg-white dark:bg-stone-800/40'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="flex items-center gap-2">
                              <h4 className="text-sm font-bold text-stone-900 dark:text-white">{f.name}</h4>
                              <span className="text-[11px] text-stone-400 dark:text-stone-500">({f.year})</span>
                            </div>
                            <span className="text-xs text-amber-900 dark:text-amber-400 font-medium block mt-0.5">
                              {f.source}
                            </span>
                          </div>
                          <div
                            className={`w-5 h-5 rounded-full border flex items-center justify-center shrink-0 ${
                              isSelected
                                ? 'border-amber-600 bg-amber-600 text-white'
                                : 'border-stone-300 dark:border-stone-600'
                            }`}
                          >
                            {isSelected && <Check className="w-3 h-3 stroke-[3]" />}
                          </div>
                        </div>

                        <div className="mt-2.5 p-2.5 bg-stone-50 dark:bg-stone-800 rounded-xl font-mono text-[11px] text-stone-800 dark:text-stone-200 border border-stone-200/60 dark:border-stone-700/60 overflow-x-auto">
                          {f.equationDisplay}
                        </div>

                        <p className="text-xs text-stone-600 dark:text-stone-400 mt-2 leading-relaxed">
                          {f.clinicalNotes}
                        </p>

                        <div className="mt-2 pt-2 border-t border-stone-100 dark:border-stone-800 flex flex-wrap items-center justify-between text-[11px] text-stone-500 dark:text-stone-400 gap-1">
                          <span>
                            Requires: <strong>{f.requiredParameters.join(', ')}</strong>
                          </span>
                          <span className="italic">{f.recommendedFor}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Custom Formula Builder */}
                <div className="border border-stone-200 dark:border-stone-800 rounded-2xl p-4 bg-stone-50/50 dark:bg-stone-800/40">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <Sliders className="w-4 h-4 text-amber-700 dark:text-amber-400" />
                      <h4 className="text-xs font-bold uppercase tracking-wider text-stone-900 dark:text-white">
                        Configure Custom Formula Coefficients
                      </h4>
                    </div>
                    <span className="text-[11px] text-stone-500 dark:text-stone-400">
                      Log10 Polynomial Model
                    </span>
                  </div>

                  <form onSubmit={handleSaveCustomFormula} className="space-y-3">
                    <div>
                      <label className="block text-[11px] font-semibold text-stone-700 dark:text-stone-300 mb-1">
                        Formula Name / Clinic Protocol
                      </label>
                      <input
                        type="text"
                        value={customName}
                        onChange={(e) => setCustomName(e.target.value)}
                        className="w-full px-3 py-1.5 text-xs bg-white dark:bg-stone-800 border border-stone-200 dark:border-stone-700 text-stone-900 dark:text-white rounded-xl"
                      />
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                      <div>
                        <label className="block text-[10px] text-stone-500 dark:text-stone-400 mb-0.5">
                          Base Intercept (a)
                        </label>
                        <input
                          type="number"
                          step="0.0001"
                          value={customIntercept}
                          onChange={(e) => setCustomIntercept(e.target.value)}
                          className="w-full px-2 py-1 text-xs bg-white dark:bg-stone-800 border border-stone-200 dark:border-stone-700 text-stone-900 dark:text-white rounded-lg font-mono"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] text-stone-500 dark:text-stone-400 mb-0.5">
                          AC Coeff (b)
                        </label>
                        <input
                          type="number"
                          step="0.0001"
                          value={customAc}
                          onChange={(e) => setCustomAc(e.target.value)}
                          className="w-full px-2 py-1 text-xs bg-white dark:bg-stone-800 border border-stone-200 dark:border-stone-700 text-stone-900 dark:text-white rounded-lg font-mono"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] text-stone-500 dark:text-stone-400 mb-0.5">
                          FL Coeff (c)
                        </label>
                        <input
                          type="number"
                          step="0.0001"
                          value={customFl}
                          onChange={(e) => setCustomFl(e.target.value)}
                          className="w-full px-2 py-1 text-xs bg-white dark:bg-stone-800 border border-stone-200 dark:border-stone-700 text-stone-900 dark:text-white rounded-lg font-mono"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] text-stone-500 dark:text-stone-400 mb-0.5">
                          HC Coeff (d)
                        </label>
                        <input
                          type="number"
                          step="0.0001"
                          value={customHc}
                          onChange={(e) => setCustomHc(e.target.value)}
                          className="w-full px-2 py-1 text-xs bg-white dark:bg-stone-800 border border-stone-200 dark:border-stone-700 text-stone-900 dark:text-white rounded-lg font-mono"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] text-stone-500 dark:text-stone-400 mb-0.5">
                          BPD Coeff (e)
                        </label>
                        <input
                          type="number"
                          step="0.0001"
                          value={customBpd}
                          onChange={(e) => setCustomBpd(e.target.value)}
                          className="w-full px-2 py-1 text-xs bg-white dark:bg-stone-800 border border-stone-200 dark:border-stone-700 text-stone-900 dark:text-white rounded-lg font-mono"
                        />
                      </div>
                      <div className="col-span-2">
                        <label className="block text-[10px] text-stone-500 dark:text-stone-400 mb-0.5">
                          AC · FL Interaction (f)
                        </label>
                        <input
                          type="number"
                          step="0.00001"
                          value={customAcFl}
                          onChange={(e) => setCustomAcFl(e.target.value)}
                          className="w-full px-2 py-1 text-xs bg-white dark:bg-stone-800 border border-stone-200 dark:border-stone-700 text-stone-900 dark:text-white rounded-lg font-mono"
                        />
                      </div>
                    </div>

                    <div className="flex justify-end pt-1">
                      <button
                        type="submit"
                        className="px-3.5 py-1.5 text-xs font-semibold text-white bg-amber-800 hover:bg-amber-900 dark:bg-amber-700 dark:hover:bg-amber-600 rounded-xl transition-colors shadow-xs cursor-pointer"
                      >
                        Activate Custom Formula
                      </button>
                    </div>
                  </form>
                </div>
              </div>
            )}

            {/* PREGNANCY TAB 2: GESTATIONAL AGE METHODS */}
            {activeTab === 'gestational' && (
              <div className="mt-4 space-y-4">
                <p className="text-xs text-stone-600 dark:text-stone-400 leading-relaxed">
                  Standard clinical calculations establish estimated due dates and gestational age based on specific biological assumptions regarding follicular phases:
                </p>

                <div className="space-y-3">
                  {/* Naegele's rule */}
                  <div
                    onClick={() => setGestationalMethod('naegele')}
                    className={`p-4 rounded-2xl border cursor-pointer transition-all ${
                      gestationalMethod === 'naegele'
                        ? 'border-amber-500 bg-amber-50/40 dark:bg-amber-950/30 ring-1 ring-amber-400 dark:ring-amber-600'
                        : 'border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-800/40 hover:border-stone-300 dark:hover:border-stone-700'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <h4 className="text-sm font-bold text-stone-900 dark:text-white">
                        Naegele’s Rule (Standard 280 Days)
                      </h4>
                      <div
                        className={`w-5 h-5 rounded-full border flex items-center justify-center ${
                          gestationalMethod === 'naegele'
                            ? 'border-amber-600 bg-amber-600 text-white'
                            : 'border-stone-300 dark:border-stone-600'
                        }`}
                      >
                        {gestationalMethod === 'naegele' && <Check className="w-3 h-3 stroke-[3]" />}
                      </div>
                    </div>
                    <div className="mt-1.5 font-mono text-[11px] text-stone-700 dark:text-stone-300 bg-stone-50 dark:bg-stone-800 p-2 rounded-xl border border-stone-200/60 dark:border-stone-700/60">
                      Gestational Age = Days since LMP = (Due Date − 280 Days)
                    </div>
                    <p className="text-xs text-stone-500 dark:text-stone-400 mt-1.5">
                      The universal standard used by ACOG assuming a standard 28-day cycle with ovulation on Day 14 (40 weeks total).
                    </p>
                  </div>

                  {/* Mittendorf-Williams */}
                  <div
                    onClick={() => setGestationalMethod('mittendorf')}
                    className={`p-4 rounded-2xl border cursor-pointer transition-all ${
                      gestationalMethod === 'mittendorf'
                        ? 'border-amber-500 bg-amber-50/40 dark:bg-amber-950/30 ring-1 ring-amber-400 dark:ring-amber-600'
                        : 'border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-800/40 hover:border-stone-300 dark:hover:border-stone-700'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <h4 className="text-sm font-bold text-stone-900 dark:text-white">
                        Mittendorf-Williams Rule (288 Days)
                      </h4>
                      <div
                        className={`w-5 h-5 rounded-full border flex items-center justify-center ${
                          gestationalMethod === 'mittendorf'
                            ? 'border-amber-600 bg-amber-600 text-white'
                            : 'border-stone-300 dark:border-stone-600'
                        }`}
                      >
                        {gestationalMethod === 'mittendorf' && <Check className="w-3 h-3 stroke-[3]" />}
                      </div>
                    </div>
                    <div className="mt-1.5 font-mono text-[11px] text-stone-700 dark:text-stone-300 bg-stone-50 dark:bg-stone-800 p-2 rounded-xl border border-stone-200/60 dark:border-stone-700/60">
                      Primigravida Duration = LMP + 288 Days (41 weeks + 1 day)
                    </div>
                    <p className="text-xs text-stone-500 dark:text-stone-400 mt-1.5">
                      Published in Obstetrics &amp; Gynecology (1990). Demonstrates that healthy first-time mothers naturally average 8 days longer than Naegele&apos;s model.
                    </p>
                  </div>

                  {/* Custom Days */}
                  <div
                    onClick={() => setGestationalMethod('customDays')}
                    className={`p-4 rounded-2xl border cursor-pointer transition-all ${
                      gestationalMethod === 'customDays'
                        ? 'border-amber-500 bg-amber-50/40 dark:bg-amber-950/30 ring-1 ring-amber-400 dark:ring-amber-600'
                        : 'border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-800/40 hover:border-stone-300 dark:hover:border-stone-700'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <h4 className="text-sm font-bold text-stone-900 dark:text-white">
                        Custom Cycle Length / IVF Calibrated Days
                      </h4>
                      <div
                        className={`w-5 h-5 rounded-full border flex items-center justify-center ${
                          gestationalMethod === 'customDays'
                            ? 'border-amber-600 bg-amber-600 text-white'
                            : 'border-stone-300 dark:border-stone-600'
                        }`}
                      >
                        {gestationalMethod === 'customDays' && <Check className="w-3 h-3 stroke-[3]" />}
                      </div>
                    </div>
                    <p className="text-xs text-stone-500 dark:text-stone-400 mt-1">
                      Adjust duration for longer/shorter menstrual cycles (e.g. 35-day cycle: 287 days) or exact IVF 5-day blastocyst embryo transfer (266 days from retrieval).
                    </p>
                    <div className="mt-2 flex items-center gap-2">
                      <label className="text-xs font-semibold text-stone-700 dark:text-stone-300">
                        Total Pregnancy Days:
                      </label>
                      <input
                        type="number"
                        min="250"
                        max="310"
                        value={customDays}
                        onChange={(e) => setCustomDays(e.target.value)}
                        className="w-24 px-2 py-1 text-xs bg-white dark:bg-stone-800 border border-stone-200 dark:border-stone-700 text-stone-900 dark:text-white rounded-lg font-mono"
                      />
                      <span className="text-xs text-stone-400 dark:text-stone-500">
                        days ({((parseInt(customDays, 10) || 280) / 7).toFixed(1)} weeks)
                      </span>
                    </div>
                  </div>
                </div>

                <div className="flex justify-end pt-2">
                  <button
                    type="button"
                    onClick={handleSaveGestationalMethod}
                    className="px-4 py-2 text-xs font-semibold text-white bg-stone-900 hover:bg-stone-800 dark:bg-stone-100 dark:hover:bg-white dark:text-stone-900 rounded-xl transition-colors shadow-xs cursor-pointer"
                  >
                    Save Gestational Method
                  </button>
                </div>
              </div>
            )}

            {/* PREGNANCY TAB 3: FETAL EFW SANDBOX */}
            {activeTab === 'fetal-sandbox' && (
              <div className="mt-4 space-y-4">
                <div className="p-3 bg-amber-50/60 dark:bg-amber-950/30 rounded-xl border border-amber-200/60 dark:border-amber-900/40 text-xs text-amber-950 dark:text-amber-200 flex items-start gap-2">
                  <Sparkles className="w-4 h-4 text-amber-700 dark:text-amber-400 shrink-0 mt-0.5" />
                  <span>
                    <strong>Live Fetal EFW Sandbox:</strong> Enter test ultrasound millimeter biometrics to compare how different fetal clinical models compute estimated fetal weight simultaneously.
                  </span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                  <div>
                    <label className="block text-[11px] font-semibold text-stone-700 dark:text-stone-300 mb-1">
                      BPD (mm)
                    </label>
                    <input
                      type="number"
                      value={sandboxBpd}
                      onChange={(e) => setSandboxBpd(e.target.value)}
                      className="w-full px-2.5 py-1.5 text-xs bg-white dark:bg-stone-800 border border-stone-200 dark:border-stone-700 text-stone-900 dark:text-white rounded-xl font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-stone-700 dark:text-stone-300 mb-1">
                      HC (mm)
                    </label>
                    <input
                      type="number"
                      value={sandboxHc}
                      onChange={(e) => setSandboxHc(e.target.value)}
                      className="w-full px-2.5 py-1.5 text-xs bg-white dark:bg-stone-800 border border-stone-200 dark:border-stone-700 text-stone-900 dark:text-white rounded-xl font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-stone-700 dark:text-stone-300 mb-1">
                      AC (mm)
                    </label>
                    <input
                      type="number"
                      value={sandboxAc}
                      onChange={(e) => setSandboxAc(e.target.value)}
                      className="w-full px-2.5 py-1.5 text-xs bg-white dark:bg-stone-800 border border-stone-200 dark:border-stone-700 text-stone-900 dark:text-white rounded-xl font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-stone-700 dark:text-stone-300 mb-1">
                      FL (mm)
                    </label>
                    <input
                      type="number"
                      value={sandboxFl}
                      onChange={(e) => setSandboxFl(e.target.value)}
                      className="w-full px-2.5 py-1.5 text-xs bg-white dark:bg-stone-800 border border-stone-200 dark:border-stone-700 text-stone-900 dark:text-white rounded-xl font-mono"
                    />
                  </div>
                </div>

                <div className="overflow-x-auto rounded-2xl border border-stone-200 dark:border-stone-700">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="bg-stone-50 dark:bg-stone-800 border-b border-stone-200 dark:border-stone-700 text-stone-500 dark:text-stone-400 font-semibold text-[11px]">
                        <th className="py-2.5 px-3">Formula Standard</th>
                        <th className="py-2.5 px-3">Estimated Weight</th>
                        <th className="py-2.5 px-3">Imperial Equivalent</th>
                        <th className="py-2.5 px-3 text-right">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-stone-100 dark:divide-stone-800 font-mono text-xs">
                      <tr
                        className={
                          formulaSettings.fetalEfwFormula === 'hadlock4'
                            ? 'bg-amber-50/40 dark:bg-amber-950/20 font-bold'
                            : ''
                        }
                      >
                        <td className="py-2 px-3 font-sans text-stone-800 dark:text-stone-200">
                          Hadlock 4-Parameter (1985)
                        </td>
                        <td className="py-2 px-3 text-stone-900 dark:text-white">
                          {testHadlock4 ? `${testHadlock4.efwGrams} g` : '—'}
                        </td>
                        <td className="py-2 px-3 text-stone-600 dark:text-stone-400">
                          {testHadlock4 ? `${(testHadlock4.efwGrams * 0.035274).toFixed(1)} oz` : '—'}
                        </td>
                        <td className="py-2 px-3 text-right font-sans text-[11px] text-amber-800 dark:text-amber-400">
                          {formulaSettings.fetalEfwFormula === 'hadlock4' ? 'Active' : ''}
                        </td>
                      </tr>
                      <tr
                        className={
                          formulaSettings.fetalEfwFormula === 'hadlock3'
                            ? 'bg-amber-50/40 dark:bg-amber-950/20 font-bold'
                            : ''
                        }
                      >
                        <td className="py-2 px-3 font-sans text-stone-800 dark:text-stone-200">
                          Hadlock 3-Parameter (1984)
                        </td>
                        <td className="py-2 px-3 text-stone-900 dark:text-white">
                          {testHadlock3 ? `${testHadlock3.efwGrams} g` : '—'}
                        </td>
                        <td className="py-2 px-3 text-stone-600 dark:text-stone-400">
                          {testHadlock3 ? `${(testHadlock3.efwGrams * 0.035274).toFixed(1)} oz` : '—'}
                        </td>
                        <td className="py-2 px-3 text-right font-sans text-[11px] text-amber-800 dark:text-amber-400">
                          {formulaSettings.fetalEfwFormula === 'hadlock3' ? 'Active' : ''}
                        </td>
                      </tr>
                      <tr
                        className={
                          formulaSettings.fetalEfwFormula === 'shepard'
                            ? 'bg-amber-50/40 dark:bg-amber-950/20 font-bold'
                            : ''
                        }
                      >
                        <td className="py-2 px-3 font-sans text-stone-800 dark:text-stone-200">
                          Shepard &amp; Warsof (1982)
                        </td>
                        <td className="py-2 px-3 text-stone-900 dark:text-white">
                          {testShepard ? `${testShepard.efwGrams} g` : '—'}
                        </td>
                        <td className="py-2 px-3 text-stone-600 dark:text-stone-400">
                          {testShepard ? `${(testShepard.efwGrams * 0.035274).toFixed(1)} oz` : '—'}
                        </td>
                        <td className="py-2 px-3 text-right font-sans text-[11px] text-amber-800 dark:text-amber-400">
                          {formulaSettings.fetalEfwFormula === 'shepard' ? 'Active' : ''}
                        </td>
                      </tr>
                      <tr
                        className={
                          formulaSettings.fetalEfwFormula === 'intergrowth21'
                            ? 'bg-amber-50/40 dark:bg-amber-950/20 font-bold'
                            : ''
                        }
                      >
                        <td className="py-2 px-3 font-sans text-stone-800 dark:text-stone-200">
                          INTERGROWTH-21st (2014)
                        </td>
                        <td className="py-2 px-3 text-stone-900 dark:text-white">
                          {testIntergrowth ? `${testIntergrowth.efwGrams} g` : '—'}
                        </td>
                        <td className="py-2 px-3 text-stone-600 dark:text-stone-400">
                          {testIntergrowth
                            ? `${(testIntergrowth.efwGrams * 0.035274).toFixed(1)} oz`
                            : '—'}
                        </td>
                        <td className="py-2 px-3 text-right font-sans text-[11px] text-amber-800 dark:text-amber-400">
                          {formulaSettings.fetalEfwFormula === 'intergrowth21' ? 'Active' : ''}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        )}

        {/* ================================================================ */}
        {/* BABY / TODDLER PROFILE ONLY: INFANT, BABY & TODDLER FORMULAS     */}
        {/* ================================================================ */}
        {isBaby && (
          <>
            {/* Baby/Toddler Tab Switcher */}
            <div className="flex items-center gap-1.5 mt-4 pb-2 border-b border-stone-100 dark:border-stone-800 overflow-x-auto scrollbar-none">
              <button
                type="button"
                onClick={() => setActiveTab('who')}
                className={`px-3 py-1.5 text-xs font-semibold rounded-xl transition-colors whitespace-nowrap cursor-pointer ${
                  activeTab === 'who'
                    ? 'bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900 shadow-xs'
                    : 'text-stone-600 dark:text-stone-400 hover:text-stone-900 dark:hover:text-white bg-stone-100 dark:bg-stone-800'
                }`}
              >
                WHO LMS Growth Standards
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('pediatric-formulas')}
                className={`px-3 py-1.5 text-xs font-semibold rounded-xl transition-colors whitespace-nowrap cursor-pointer ${
                  activeTab === 'pediatric-formulas'
                    ? 'bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900 shadow-xs'
                    : 'text-stone-600 dark:text-stone-400 hover:text-stone-900 dark:hover:text-white bg-stone-100 dark:bg-stone-800'
                }`}
              >
                Feeding, Velocity &amp; Vitals
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('baby-sandbox')}
                className={`px-3 py-1.5 text-xs font-semibold rounded-xl transition-colors whitespace-nowrap flex items-center gap-1.5 cursor-pointer ${
                  activeTab === 'baby-sandbox'
                    ? 'bg-emerald-700 dark:bg-emerald-600 text-white shadow-xs'
                    : 'text-stone-600 dark:text-stone-400 hover:text-stone-900 dark:hover:text-white bg-stone-100 dark:bg-stone-800'
                }`}
              >
                <Calculator className="w-3.5 h-3.5" />
                <span>WHO &amp; Feeding Sandbox</span>
              </button>
            </div>

            {/* BABY TAB 1: WHO LMS GROWTH STANDARDS */}
            {activeTab === 'who' && (
              <div className="mt-4 space-y-4 max-h-[60vh] overflow-y-auto pr-1 text-xs text-stone-700 dark:text-stone-300 leading-relaxed">
                <div className="p-4 bg-emerald-50/60 dark:bg-emerald-950/30 rounded-2xl border border-emerald-200/80 dark:border-emerald-900/40 space-y-2.5">
                  <h4 className="text-sm font-bold text-emerald-950 dark:text-emerald-300">
                    World Health Organization (WHO) Child Growth Standards (2006, 0–60 Months)
                  </h4>
                  <p>
                    The WHO Multicentre Growth Reference Study (MGRS) assessed 8,440 healthy breastfed infants and toddlers across six diverse countries (Brazil, Ghana, India, Norway, Oman, USA) raised in optimal socio-environmental conditions.
                  </p>
                  <div className="font-mono text-[11px] p-2.5 bg-white dark:bg-stone-800 rounded-xl border border-emerald-200 dark:border-stone-700 text-emerald-950 dark:text-emerald-300 space-y-1">
                    <div>Z-Score (L ≠ 0): Z = [ (X / M)^L − 1 ] / (L · S)</div>
                    <div>Z-Score (L = 0): Z = ln(X / M) / S</div>
                    <div>Percentile: P = Φ(Z) × 100  (Standard Normal CDF)</div>
                  </div>
                  <ul className="space-y-1 list-disc list-inside text-stone-600 dark:text-stone-400 pt-1">
                    <li>
                      <strong>L (Lambda):</strong> Box-Cox power transformation parameter correcting for distribution skewness.
                    </li>
                    <li>
                      <strong>M (Mu):</strong> Sex- and age-specific median (50th percentile) interpolated for exact age in months.
                    </li>
                    <li>
                      <strong>S (Sigma):</strong> Generalized coefficient of variation defining expected spread across percentiles (3rd, 15th, 50th, 85th, 97th).
                    </li>
                    <li>
                      <strong>Age Normalization:</strong> Exact Months = Days since Birth ÷ 30.4375 (WHO clinical average month = 365.25 ÷ 12).
                    </li>
                  </ul>
                </div>

                <div className="p-4 bg-indigo-50/50 dark:bg-indigo-950/25 rounded-2xl border border-indigo-200/70 dark:border-indigo-900/40 space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h4 className="text-sm font-bold text-indigo-950 dark:text-indigo-200">
                      Conditional Weight Projection &amp; ±1 SE Zone (Cole, 1995)
                    </h4>
                    <span className="text-[11px] font-medium text-indigo-800 dark:text-indigo-300">
                      Arch Dis Child 1995;73(1):8–16
                    </span>
                  </div>
                  <p>
                    Weight projections on the WHO chart use Cole&apos;s conditional Z-score model coupled with the inverse WHO 2006 LMS Box-Cox curve rather than linear extrapolation, capturing natural non-linear infant growth deceleration and asymmetric prediction uncertainty.
                  </p>
                  <div className="font-mono text-[11px] p-2.5 bg-white dark:bg-stone-800 rounded-xl border border-indigo-200/70 dark:border-stone-700 text-indigo-950 dark:text-indigo-200 space-y-1">
                    <div>r(t₁, t₂) = [ (t₁ + 1) / (t₂ + 1) ]^0.42  (age t in months)</div>
                    <div>ẑ(t₂ | t₁) = μ_channel + r(t₁, t₂) · (z₁ − μ_channel)</div>
                    <div>SE_z(t₂ | t₁) = √(1 − r(t₁, t₂)²)</div>
                    <div>Ŵ(t) = M(t) · [ 1 + L(t) · S(t) · ẑ(t) ]^(1 / L(t))</div>
                  </div>
                  <p className="text-stone-600 dark:text-stone-400">
                    The shaded ±1 SE band maps ẑ(t) ± SE_z(t) back into kg/lb through the WHO LMS inverse function, starting at zero width at the latest measurement and widening smoothly with forecast horizon.
                  </p>
                </div>

                <div className="p-4 bg-stone-50 dark:bg-stone-800/60 rounded-2xl border border-stone-200 dark:border-stone-700 space-y-2">
                  <h5 className="font-bold text-stone-900 dark:text-white">
                    Why WHO Standards vs. CDC 2000 Reference?
                  </h5>
                  <p>
                    The AAP (American Academy of Pediatrics) and CDC officially recommend using <strong>WHO Growth Standards</strong> for infants and toddlers aged 0 to 24 months (and extended through 60 months) because they describe how children <em>should grow under optimal conditions</em> (prescriptive), rather than historical descriptive samples.
                  </p>
                </div>
              </div>
            )}

            {/* BABY TAB 2: FEEDING, VELOCITY & VITALS FORMULAS */}
            {activeTab === 'pediatric-formulas' && (
              <div className="mt-4 space-y-3.5 max-h-[60vh] overflow-y-auto pr-1 text-xs text-stone-700 dark:text-stone-300 leading-relaxed">
                {/* Daily Milk Intake Target */}
                <div className="p-4 rounded-2xl border border-emerald-200/80 dark:border-emerald-900/50 bg-emerald-50/40 dark:bg-emerald-950/20 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <h4 className="text-sm font-bold text-stone-900 dark:text-white">
                      Weight-Based Daily Milk Intake Target
                    </h4>
                    <span className="text-[11px] font-mono text-emerald-800 dark:text-emerald-300">
                      Default: {DEFAULT_MILK_FORMULA.minMlPerKg}–{DEFAULT_MILK_FORMULA.maxMlPerKg} mL/kg/day
                    </span>
                  </div>
                  <div className="font-mono text-[11px] p-2.5 bg-white dark:bg-stone-800 rounded-xl border border-stone-200/70 dark:border-stone-700 space-y-1 text-stone-800 dark:text-stone-200">
                    <div>Eligibility = Day {MIN_MILK_TARGET_AGE_DAYS} onwards</div>
                    <div>Daily Min (mL) = Weight (kg) × x mL/kg</div>
                    <div>Daily Max (mL) = Weight (kg) × y mL/kg</div>
                    <div>Daily Target (mL) = Min + (Max − Min) × (z / 100)</div>
                    <div>Per-Feed Target (mL) = Daily Target ÷ Feeds per Day</div>
                  </div>
                  <p className="text-stone-600 dark:text-stone-400">
                    Applies from Day {MIN_MILK_TARGET_AGE_DAYS} onwards in the Routine tab and Feeding Rhythm chart to estimate recommended daily and per-feed breast milk / formula intake from baby&apos;s current or daily recorded weight (customizable in Routine → Formula &amp; Config).
                  </p>
                </div>

                {/* Weight Gain Velocity */}
                <div className="p-4 rounded-2xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-800/40 space-y-2">
                  <h4 className="text-sm font-bold text-stone-900 dark:text-white">
                    Infant Weight Gain Velocity
                  </h4>
                  <div className="font-mono text-[11px] p-2.5 bg-stone-50 dark:bg-stone-800 rounded-xl border border-stone-200/70 dark:border-stone-700 text-stone-800 dark:text-stone-200">
                    Velocity (g/day) = [ (Latest Weight kg − Prior Weight kg) × 1000 ] ÷ Days Elapsed
                  </div>
                  <p className="text-stone-600 dark:text-stone-400">
                    Evaluates longitudinal growth momentum between consecutive weight records rather than isolated snapshots.
                  </p>
                </div>

                {/* Body Temperature Classification */}
                <div className="p-4 rounded-2xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-800/40 space-y-2">
                  <h4 className="text-sm font-bold text-stone-900 dark:text-white">
                    Pediatric Body Temperature Bands
                  </h4>
                  <div className="font-mono text-[11px] p-2.5 bg-stone-50 dark:bg-stone-800 rounded-xl border border-stone-200/70 dark:border-stone-700 space-y-1 text-stone-800 dark:text-stone-200">
                    <div>°F = (°C × 9 / 5) + 32</div>
                    <div>Low: &lt; 36.0°C · Normal: 36.0–37.4°C · Elevated: 37.5–37.9°C · Fever: ≥ 38.0°C</div>
                  </div>
                  <p className="text-stone-600 dark:text-stone-400">
                    Standard pediatric clinical thresholds applied to daily temperature logs. For infants under 3 months, a temperature of 38.0°C (100.4°F) or higher warrants prompt medical evaluation.
                  </p>
                </div>
              </div>
            )}

            {/* BABY TAB 3: WHO & FEEDING SANDBOX */}
            {activeTab === 'baby-sandbox' && (
              <div className="mt-4 space-y-4">
                <div className="p-3 bg-emerald-50/60 dark:bg-emerald-950/30 rounded-xl border border-emerald-200/60 dark:border-emerald-900/40 text-xs text-emerald-950 dark:text-emerald-200 flex items-start gap-2">
                  <Sparkles className="w-4 h-4 text-emerald-700 dark:text-emerald-400 shrink-0 mt-0.5" />
                  <span>
                    <strong>Live WHO &amp; Feeding Sandbox:</strong> Test any age (0–60 months) and anthropometric measurements to compute exact WHO 2006 LMS percentiles, Z-scores, and daily milk targets.
                  </span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5">
                  <div>
                    <label className="block text-[11px] font-semibold text-stone-700 dark:text-stone-300 mb-1">
                      Age (months)
                    </label>
                    <input
                      type="number"
                      min="0"
                      max="60"
                      step="0.5"
                      value={babySandboxAgeMonths}
                      onChange={(e) => setBabySandboxAgeMonths(e.target.value)}
                      className="w-full px-2.5 py-1.5 text-xs bg-white dark:bg-stone-800 border border-stone-200 dark:border-stone-700 text-stone-900 dark:text-white rounded-xl font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-stone-700 dark:text-stone-300 mb-1">
                      Sex
                    </label>
                    <select
                      value={babySandboxGender}
                      onChange={(e) => setBabySandboxGender(e.target.value as 'boy' | 'girl')}
                      className="w-full px-2.5 py-1.5 text-xs bg-white dark:bg-stone-800 border border-stone-200 dark:border-stone-700 text-stone-900 dark:text-white rounded-xl font-semibold"
                    >
                      <option value="boy">Boy</option>
                      <option value="girl">Girl</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-stone-700 dark:text-stone-300 mb-1">
                      Weight (kg)
                    </label>
                    <input
                      type="number"
                      step="0.001"
                      min="0"
                      value={babySandboxWeightKg}
                      onChange={(e) => setBabySandboxWeightKg(e.target.value)}
                      className="w-full px-2.5 py-1.5 text-xs bg-white dark:bg-stone-800 border border-stone-200 dark:border-stone-700 text-stone-900 dark:text-white rounded-xl font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-stone-700 dark:text-stone-300 mb-1">
                      Length (cm)
                    </label>
                    <input
                      type="number"
                      step="0.1"
                      min="0"
                      value={babySandboxLengthCm}
                      onChange={(e) => setBabySandboxLengthCm(e.target.value)}
                      className="w-full px-2.5 py-1.5 text-xs bg-white dark:bg-stone-800 border border-stone-200 dark:border-stone-700 text-stone-900 dark:text-white rounded-xl font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-stone-700 dark:text-stone-300 mb-1">
                      Head Circ. (cm)
                    </label>
                    <input
                      type="number"
                      step="0.1"
                      min="0"
                      value={babySandboxHcCm}
                      onChange={(e) => setBabySandboxHcCm(e.target.value)}
                      className="w-full px-2.5 py-1.5 text-xs bg-white dark:bg-stone-800 border border-stone-200 dark:border-stone-700 text-stone-900 dark:text-white rounded-xl font-mono"
                    />
                  </div>
                </div>

                {/* WHO Results Table */}
                <div className="overflow-x-auto rounded-2xl border border-stone-200 dark:border-stone-700">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="bg-stone-50 dark:bg-stone-800 border-b border-stone-200 dark:border-stone-700 text-stone-500 dark:text-stone-400 font-semibold text-[11px]">
                        <th className="py-2.5 px-3">Metric</th>
                        <th className="py-2.5 px-3">WHO Median (50th)</th>
                        <th className="py-2.5 px-3">Expected (15th–85th)</th>
                        <th className="py-2.5 px-3">Z-Score</th>
                        <th className="py-2.5 px-3 text-right">WHO Percentile</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-stone-100 dark:divide-stone-800 font-mono text-xs">
                      <tr>
                        <td className="py-2 px-3 font-sans font-semibold text-stone-800 dark:text-stone-200">
                          Weight
                        </td>
                        <td className="py-2 px-3 text-stone-700 dark:text-stone-300">
                          {babyWeightPoint ? UnitConverter.formatWeight(babyWeightPoint.p50, unitSystem) : '—'}
                        </td>
                        <td className="py-2 px-3 text-stone-500 dark:text-stone-400">
                          {babyWeightPoint
                            ? `${UnitConverter.formatWeight(babyWeightPoint.p15, unitSystem)} – ${UnitConverter.formatWeight(babyWeightPoint.p85, unitSystem)}`
                            : '—'}
                        </td>
                        <td className="py-2 px-3 text-stone-700 dark:text-stone-300">
                          {babyWeightResult
                            ? `${babyWeightResult.zScore >= 0 ? '+' : ''}${babyWeightResult.zScore.toFixed(2)}`
                            : '—'}
                        </td>
                        <td className="py-2 px-3 text-right font-bold text-emerald-700 dark:text-emerald-400">
                          {babyWeightResult ? `${babyWeightResult.percentile}th` : '—'}
                        </td>
                      </tr>
                      <tr>
                        <td className="py-2 px-3 font-sans font-semibold text-stone-800 dark:text-stone-200">
                          Length / Height
                        </td>
                        <td className="py-2 px-3 text-stone-700 dark:text-stone-300">
                          {babyLengthPoint ? UnitConverter.formatLength(babyLengthPoint.p50, unitSystem) : '—'}
                        </td>
                        <td className="py-2 px-3 text-stone-500 dark:text-stone-400">
                          {babyLengthPoint
                            ? `${UnitConverter.formatLength(babyLengthPoint.p15, unitSystem)} – ${UnitConverter.formatLength(babyLengthPoint.p85, unitSystem)}`
                            : '—'}
                        </td>
                        <td className="py-2 px-3 text-stone-700 dark:text-stone-300">
                          {babyLengthResult
                            ? `${babyLengthResult.zScore >= 0 ? '+' : ''}${babyLengthResult.zScore.toFixed(2)}`
                            : '—'}
                        </td>
                        <td className="py-2 px-3 text-right font-bold text-teal-700 dark:text-teal-400">
                          {babyLengthResult ? `${babyLengthResult.percentile}th` : '—'}
                        </td>
                      </tr>
                      <tr>
                        <td className="py-2 px-3 font-sans font-semibold text-stone-800 dark:text-stone-200">
                          Head Circumference
                        </td>
                        <td className="py-2 px-3 text-stone-700 dark:text-stone-300">
                          {babyHcPoint ? UnitConverter.formatLength(babyHcPoint.p50, unitSystem) : '—'}
                        </td>
                        <td className="py-2 px-3 text-stone-500 dark:text-stone-400">
                          {babyHcPoint
                            ? `${UnitConverter.formatLength(babyHcPoint.p15, unitSystem)} – ${UnitConverter.formatLength(babyHcPoint.p85, unitSystem)}`
                            : '—'}
                        </td>
                        <td className="py-2 px-3 text-stone-700 dark:text-stone-300">
                          {babyHcResult
                            ? `${babyHcResult.zScore >= 0 ? '+' : ''}${babyHcResult.zScore.toFixed(2)}`
                            : '—'}
                        </td>
                        <td className="py-2 px-3 text-right font-bold text-amber-700 dark:text-amber-400">
                          {babyHcResult ? `${babyHcResult.percentile}th` : '—'}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                {/* Weight-Based Milk Target Preview */}
                {milkTargetMl !== null && milkMinMl !== null && milkMaxMl !== null && milkPerFeedMl !== null ? (
                  <div className="p-3.5 rounded-2xl bg-stone-50 dark:bg-stone-800/60 border border-stone-200 dark:border-stone-700 flex flex-wrap items-center justify-between gap-2 text-xs">
                    <div>
                      <span className="font-bold text-stone-800 dark:text-stone-200">
                        Estimated Milk Intake ({DEFAULT_MILK_FORMULA.minMlPerKg}–{DEFAULT_MILK_FORMULA.maxMlPerKg} mL/kg @ {DEFAULT_MILK_FORMULA.targetRangePct}%):
                      </span>
                      <span className="ml-2 font-mono font-bold text-emerald-700 dark:text-emerald-400">
                        {milkTargetMl} mL/day
                      </span>
                      <span className="ml-1.5 text-stone-500 dark:text-stone-400 font-mono">
                        ({milkMinMl}–{milkMaxMl} mL)
                      </span>
                    </div>
                    <div className="font-mono text-stone-700 dark:text-stone-300">
                      ~<strong>{milkPerFeedMl} mL</strong> / feed ({DEFAULT_MILK_FORMULA.feedsPerDay} feeds/day)
                    </div>
                  </div>
                ) : !isSandboxMilkTargetEligible ? (
                  <div className="p-3.5 rounded-2xl bg-stone-50 dark:bg-stone-800/60 border border-dashed border-stone-200 dark:border-stone-700 text-xs text-stone-500 dark:text-stone-400">
                    Weight-based recommended milk intake targets apply from <strong>Day {MIN_MILK_TARGET_AGE_DAYS}</strong> onwards.
                  </div>
                ) : null}
              </div>
            )}
          </>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between pt-4 mt-4 border-t border-stone-100 dark:border-stone-800 text-xs">
          <span className="text-stone-500 dark:text-stone-400">
            {isPregnancy ? (
              <>
                Active: <strong>{formulaSettings.fetalEfwFormula.toUpperCase()}</strong> ·{' '}
                {formulaSettings.gestationalMethod}
              </>
            ) : isBaby ? (
              <>
                Active: <strong>WHO 2006 LMS (0–60m)</strong> ·{' '}
                {activeProfile?.gender === 'girl' ? 'Girls' : 'Boys'} Standard
              </>
            ) : (
              'Select a profile to view clinical standards'
            )}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-semibold text-white bg-stone-900 hover:bg-stone-800 dark:bg-stone-100 dark:hover:bg-white dark:text-stone-900 rounded-xl transition-colors shadow-xs cursor-pointer"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
