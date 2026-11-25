import React from 'react';
import { useApp } from '../../context/AppContext';
import { StagesAndWishesView } from './StagesAndWishesView';
import { MilestonesView } from './MilestonesView';
import { FetalHubView } from './FetalHubView';
import { Sparkles, CheckSquare, HeartPulse, Plus } from 'lucide-react';

export type StagesMilestonesSubTab = 'stages' | 'milestones';

interface StagesAndMilestonesViewProps {
  subTab: StagesMilestonesSubTab;
  setSubTab: (subTab: StagesMilestonesSubTab) => void;
  onOpenLoveNoteModal: (stageLabel: string) => void;
  onOpenFormulaModal: () => void;
  onOpenCustomMilestoneModal: () => void;
  onOpenLogModal: () => void;
  onOpenProfileModal?: () => void;
}

export const StagesAndMilestonesView: React.FC<StagesAndMilestonesViewProps> = ({
  subTab,
  setSubTab,
  onOpenLoveNoteModal,
  onOpenFormulaModal,
  onOpenCustomMilestoneModal,
  onOpenLogModal,
  onOpenProfileModal,
}) => {
  const { activeProfile, isEntriesLoading } = useApp();

  if (isEntriesLoading && !activeProfile) {
    return (
      <div className="bg-white dark:bg-stone-900 rounded-3xl border border-stone-200 dark:border-stone-800 p-10 text-center text-xs text-stone-500 dark:text-stone-400">
        Loading profiles and stages from Supabase...
      </div>
    );
  }

  if (!activeProfile) {
    return (
      <div className="bg-white dark:bg-stone-900 rounded-3xl border border-stone-200 dark:border-stone-800 p-8 md:p-10 text-center space-y-4">
        <div className="w-12 h-12 mx-auto rounded-2xl bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 flex items-center justify-center">
          <Sparkles className="w-6 h-6" />
        </div>
        <div>
          <h2 className="text-lg font-bold text-stone-900 dark:text-white">
            Add a Child or Pregnancy Profile
          </h2>
          <p className="text-xs text-stone-500 dark:text-stone-400 mt-1 max-w-md mx-auto">
            Create a profile in Supabase with birth date or due date to unlock stage expectations, family wishes, and milestone tracking.
          </p>
        </div>
        {onOpenProfileModal && (
          <button
            type="button"
            onClick={onOpenProfileModal}
            className="inline-flex items-center gap-1.5 px-4 py-2.5 text-xs font-bold text-white bg-stone-900 hover:bg-stone-800 dark:bg-stone-100 dark:hover:bg-white dark:text-stone-900 rounded-xl shadow-xs transition-colors cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Add New Profile</span>
          </button>
        )}
      </div>
    );
  }

  const isFetal = activeProfile.type === 'fetal';

  return (
    <div className="space-y-6">
      {/* Unified Sub-Tab Switcher */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white dark:bg-stone-900 rounded-3xl border border-stone-200 dark:border-stone-800 p-4 sm:px-5 shadow-xs transition-colors">
        <div>
          <h2 className="text-lg font-bold text-stone-900 dark:text-white">
            {isFetal ? 'Stages, Wishes & Pregnancy Hub' : 'Stages, Wishes & Milestones'}
          </h2>
          <p className="text-xs text-stone-500 dark:text-stone-400 mt-0.5">
            {isFetal
              ? 'Explore weekly pregnancy stages, family wishes, kick counting, and prenatal guides in one place.'
              : 'Track developmental stages, family love notes, and CDC milestone checklists together.'}
          </p>
        </div>

        <div className="flex items-center gap-1 p-1 bg-stone-100 dark:bg-stone-800 rounded-2xl border border-stone-200/80 dark:border-stone-700/80 self-start sm:self-auto shrink-0">
          <button
            type="button"
            onClick={() => setSubTab('stages')}
            className={`px-3.5 py-1.5 text-xs font-bold rounded-xl transition-all flex items-center gap-1.5 cursor-pointer ${
              subTab === 'stages'
                ? 'bg-white dark:bg-stone-900 text-stone-900 dark:text-white shadow-xs'
                : 'text-stone-600 dark:text-stone-400 hover:text-stone-900 dark:hover:text-white'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
            <span>Stages &amp; Wishes</span>
          </button>

          <button
            type="button"
            onClick={() => setSubTab('milestones')}
            className={`px-3.5 py-1.5 text-xs font-bold rounded-xl transition-all flex items-center gap-1.5 cursor-pointer ${
              subTab === 'milestones'
                ? 'bg-white dark:bg-stone-900 text-stone-900 dark:text-white shadow-xs'
                : 'text-stone-600 dark:text-stone-400 hover:text-stone-900 dark:hover:text-white'
            }`}
          >
            {isFetal ? (
              <HeartPulse className="w-3.5 h-3.5 text-rose-600 dark:text-rose-400" />
            ) : (
              <CheckSquare className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
            )}
            <span>{isFetal ? 'Pregnancy Hub' : 'Milestones'}</span>
          </button>
        </div>
      </div>

      {/* Active Sub-View */}
      {subTab === 'stages' ? (
        <StagesAndWishesView
          onOpenLoveNoteModal={onOpenLoveNoteModal}
          onOpenFormulaModal={onOpenFormulaModal}
        />
      ) : isFetal ? (
        <FetalHubView
          onOpenLogModal={onOpenLogModal}
          onOpenFormulaModal={onOpenFormulaModal}
        />
      ) : (
        <MilestonesView onOpenCustomMilestoneModal={onOpenCustomMilestoneModal} />
      )}
    </div>
  );
};
