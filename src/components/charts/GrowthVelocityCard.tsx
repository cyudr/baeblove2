import React from 'react';
import { BabyMeasurement, UnitSystem } from '../../types';
import {
  DAYS_PER_MONTH,
  formatAdaptiveAgeFromDays,
  parseCalendarDateUTC,
} from '../../utils/ageCalculator';
import { Activity, ArrowUpRight, Scale, Ruler } from 'lucide-react';

interface GrowthVelocityCardProps {
  measurements: BabyMeasurement[];
  unitSystem: UnitSystem;
}

export const GrowthVelocityCard: React.FC<GrowthVelocityCardProps> = ({
  measurements,
  unitSystem,
}) => {
  const sorted = [...measurements].sort((a, b) => {
    const aDays = a.ageInDays ?? a.ageInMonths * DAYS_PER_MONTH;
    const bDays = b.ageInDays ?? b.ageInMonths * DAYS_PER_MONTH;
    return aDays - bDays;
  });

  if (sorted.length < 2) {
    return (
      <div className="bg-white dark:bg-stone-900 rounded-xl border border-stone-200 dark:border-stone-800 p-5 shadow-xs transition-colors">
        <div className="flex items-center gap-2 mb-2">
          <Activity className="w-4 h-4 text-emerald-700 dark:text-emerald-400" />
          <h4 className="text-sm font-semibold text-stone-900 dark:text-white">Growth Velocity</h4>
        </div>
        <p className="text-xs text-stone-500 dark:text-stone-400 leading-relaxed">
          Log at least two pediatric checkup measurements to calculate weight gain velocity (grams/day) and length growth velocity.
        </p>
      </div>
    );
  }

  const latest = sorted[sorted.length - 1];
  const previous = sorted[sorted.length - 2];

  const latestUtc = parseCalendarDateUTC(latest.date);
  const prevUtc = parseCalendarDateUTC(previous.date);
  const diffDays =
    latestUtc !== null && prevUtc !== null
      ? Math.max(1, Math.round((latestUtc - prevUtc) / 86_400_000))
      : Math.max(
          1,
          Math.round(
            (latest.ageInDays ?? latest.ageInMonths * DAYS_PER_MONTH) -
              (previous.ageInDays ?? previous.ageInMonths * DAYS_PER_MONTH)
          )
        );
  const diffMonths = diffDays / DAYS_PER_MONTH;

  // Weight gain
  let weightVelocityGramsPerDay = 0;
  let totalWeightGainGrams = 0;
  if (latest.weightKg && previous.weightKg) {
    totalWeightGainGrams = (latest.weightKg - previous.weightKg) * 1000;
    weightVelocityGramsPerDay = Math.round((totalWeightGainGrams / diffDays) * 10) / 10;
  }

  // Length gain
  let lengthVelocityCmPerMonth = 0;
  if (latest.lengthCm && previous.lengthCm) {
    const diffLength = latest.lengthCm - previous.lengthCm;
    lengthVelocityCmPerMonth = Math.round((diffLength / diffMonths) * 10) / 10;
  }

  // Pediatric clinical norms
  const currentAge = latest.ageInMonths;
  let expectedGainStr = '10 – 15 g/day (typical for 6–12 months)';
  if (currentAge < 3) {
    expectedGainStr = '25 – 30 g/day (rapid newborn growth)';
  } else if (currentAge < 6) {
    expectedGainStr = '15 – 20 g/day (steady infant growth)';
  } else if (currentAge >= 12) {
    expectedGainStr = '6 – 10 g/day (toddler stabilization)';
  }

  return (
    <div className="bg-white dark:bg-stone-900 rounded-xl border border-stone-200 dark:border-stone-800 p-5 shadow-xs transition-colors">
      <div className="flex items-center justify-between pb-3 border-b border-stone-100 dark:border-stone-800">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-emerald-700 dark:text-emerald-400" />
          <h4 className="text-sm font-semibold text-stone-900 dark:text-white">Growth Velocity Rate</h4>
        </div>
        <span className="text-xs text-stone-500 dark:text-stone-400">
          Between {formatAdaptiveAgeFromDays(previous.ageInDays ?? previous.ageInMonths * DAYS_PER_MONTH, { compact: true })} and{' '}
          {formatAdaptiveAgeFromDays(latest.ageInDays ?? latest.ageInMonths * DAYS_PER_MONTH, { compact: true })} ({diffDays} days)
        </span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
        {/* Weight gain stat */}
        <div className="p-3.5 bg-stone-50 dark:bg-stone-800/60 rounded-lg border border-stone-200/60 dark:border-stone-700/60 transition-colors">
          <div className="flex items-center justify-between text-xs text-stone-500 dark:text-stone-400 mb-1">
            <span className="flex items-center gap-1 font-medium">
              <Scale className="w-3.5 h-3.5 text-emerald-700 dark:text-emerald-400" />
              Weight Gain Rate
            </span>
            <span className="text-emerald-800 dark:text-emerald-400 font-semibold flex items-center">
              <ArrowUpRight className="w-3.5 h-3.5" />
              {weightVelocityGramsPerDay > 0 ? `+${weightVelocityGramsPerDay}` : weightVelocityGramsPerDay} g/day
            </span>
          </div>
          <div className="text-lg font-bold text-stone-900 dark:text-white">
            {unitSystem === 'metric'
              ? `${(totalWeightGainGrams / 1000).toFixed(2)} kg gained`
              : `${((totalWeightGainGrams / 1000) * 2.20462).toFixed(2)} lb gained`}
          </div>
          <p className="text-[11px] text-stone-500 dark:text-stone-400 mt-1">
            Expected: {expectedGainStr}
          </p>
        </div>

        {/* Length growth stat */}
        <div className="p-3.5 bg-stone-50 dark:bg-stone-800/60 rounded-lg border border-stone-200/60 dark:border-stone-700/60 transition-colors">
          <div className="flex items-center justify-between text-xs text-stone-500 dark:text-stone-400 mb-1">
            <span className="flex items-center gap-1 font-medium">
              <Ruler className="w-3.5 h-3.5 text-sky-700 dark:text-sky-400" />
              Length Velocity
            </span>
            <span className="text-sky-800 dark:text-sky-400 font-semibold flex items-center">
              <ArrowUpRight className="w-3.5 h-3.5" />
              +{lengthVelocityCmPerMonth} cm/mo
            </span>
          </div>
          <div className="text-lg font-bold text-stone-900 dark:text-white">
            {latest.lengthCm && previous.lengthCm
              ? unitSystem === 'metric'
                ? `+${(latest.lengthCm - previous.lengthCm).toFixed(1)} cm total`
                : `+${((latest.lengthCm - previous.lengthCm) / 2.54).toFixed(1)} in total`
              : 'N/A'}
          </div>
          <p className="text-[11px] text-stone-500 dark:text-stone-400 mt-1">
            Linear skeletal elongation following normal percentile trajectory.
          </p>
        </div>
      </div>
    </div>
  );
};
