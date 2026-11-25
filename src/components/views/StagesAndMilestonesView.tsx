import React, { useMemo, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { doesNoteMatchProfile } from '../../utils/careInterpreter';
import { StagesAndWishesView } from './StagesAndWishesView';
import { MilestonesView } from './MilestonesView';
import { FetalHubView } from './FetalHubView';
import { EditAuthModal } from '../modals/EditAuthModal';
import type { NoteRecord } from '../../types';
import {
  Sparkles,
  CheckSquare,
  HeartPulse,
  Plus,
  StickyNote,
  RefreshCw,
  Pencil,
  Trash2,
  Check,
  X,
  User,
} from 'lucide-react';

export type StagesMilestonesSubTab = 'stages' | 'milestones' | 'notes';

function formatNoteTimestamp(iso: string): string {
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
  const {
    activeProfile,
    isEntriesLoading,
    noteRecords,
    isCareTablesLoading,
    refreshCareTables,
    addNoteRecord,
    editNoteRecord,
    removeNoteRecord,
  } = useApp();

  // Ad hoc note composer state (linked to Supabase public."notes" table)
  const [showQuickComposer, setShowQuickComposer] = useState(false);
  const [editingNoteId, setEditingNoteId] = useState<number | null>(null);
  const [noteAuthor, setNoteAuthor] = useState('');
  const [noteBody, setNoteBody] = useState('');
  const [noteError, setNoteError] = useState<string | null>(null);
  const [isSavingNote, setIsSavingNote] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<number | null>(null);
  const [pendingAuthNote, setPendingAuthNote] = useState<NoteRecord | null>(null);

  const profileNotes = useMemo(() => {
    if (!activeProfile) return noteRecords;
    return noteRecords.filter((n) => doesNoteMatchProfile(n, activeProfile));
  }, [noteRecords, activeProfile]);

  const resetNoteForm = (preserveAuthor = false) => {
    setEditingNoteId(null);
    if (!preserveAuthor) setNoteAuthor('');
    setNoteBody('');
    setNoteError(null);
  };

  const handleSaveNote = async (e: React.FormEvent) => {
    e.preventDefault();
    setNoteError(null);

    if (!noteBody.trim()) {
      setNoteError('Please enter a note before saving.');
      return;
    }

    setIsSavingNote(true);
    try {
      const payload = {
        name: noteAuthor.trim() || null,
        notes: noteBody.trim(),
      };

      const res =
        editingNoteId !== null
          ? await editNoteRecord(editingNoteId, payload)
          : await addNoteRecord(payload);

      if (res.error) {
        setNoteError(res.error);
      } else {
        resetNoteForm(editingNoteId === null);
      }
    } finally {
      setIsSavingNote(false);
    }
  };

  const applyEditNote = (note: NoteRecord) => {
    setEditingNoteId(note.id);
    setNoteAuthor(note.name ?? '');
    setNoteBody(note.notes ?? '');
    setNoteError(null);
    setShowQuickComposer(true);
    setSubTab('notes');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const renderAdHocNoteForm = (compact = false) => (
    <form
      onSubmit={handleSaveNote}
      className="bg-white dark:bg-stone-900 rounded-3xl border border-stone-200 dark:border-stone-800 p-5 shadow-xs space-y-3.5"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="w-8 h-8 rounded-2xl bg-sky-100 dark:bg-sky-950/70 text-sky-700 dark:text-sky-300 flex items-center justify-center shrink-0">
            <StickyNote className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-stone-900 dark:text-white">
              {editingNoteId !== null ? `Edit Note #${editingNoteId}` : 'Log Ad Hoc Note'}
            </h3>
            <p className="text-[11px] text-stone-500 dark:text-stone-400">
              Saved directly to the Supabase &ldquo;notes&rdquo; table
              {activeProfile ? ` for ${activeProfile.name}` : ''}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          {editingNoteId !== null && (
            <button
              type="button"
              onClick={() => resetNoteForm(false)}
              className="px-2.5 py-1.5 text-xs font-semibold text-stone-500 hover:text-stone-800 dark:hover:text-stone-200 flex items-center gap-1 cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
              <span>Cancel edit</span>
            </button>
          )}
          {compact && editingNoteId === null && (
            <button
              type="button"
              onClick={() => setShowQuickComposer(false)}
              className="p-1.5 text-stone-400 hover:text-stone-700 dark:hover:text-stone-200 rounded-lg hover:bg-stone-100 dark:hover:bg-stone-800 transition-colors cursor-pointer"
              title="Close quick note composer"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div>
          <label className="block text-[11px] font-semibold text-stone-600 dark:text-stone-300 mb-1">
            Logged By
          </label>
          <input
            type="text"
            value={noteAuthor}
            onChange={(e) => setNoteAuthor(e.target.value)}
            placeholder="e.g. Mom, Dad, Caregiver"
            className="w-full px-3 py-2 text-xs bg-stone-50 dark:bg-stone-800 border border-stone-200 dark:border-stone-700 text-stone-900 dark:text-white rounded-xl focus:outline-hidden focus:border-sky-500"
          />
        </div>

        <div className="sm:col-span-2">
          <label className="block text-[11px] font-semibold text-stone-600 dark:text-stone-300 mb-1">
            Note
          </label>
          <textarea
            rows={compact ? 2 : 3}
            required
            value={noteBody}
            onChange={(e) => setNoteBody(e.target.value)}
            placeholder="Jot down an observation, doctor question, funny moment, sleep cue, or reminder..."
            className="w-full px-3 py-2 text-xs bg-stone-50 dark:bg-stone-800 border border-stone-200 dark:border-stone-700 text-stone-900 dark:text-white rounded-xl focus:outline-hidden focus:border-sky-500"
          />
        </div>
      </div>

      {noteError && (
        <div className="p-2.5 rounded-xl bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-900/70 text-xs text-rose-700 dark:text-rose-300">
          {noteError}
        </div>
      )}

      <div className="flex items-center justify-between gap-2 pt-1">
        {compact ? (
          <button
            type="button"
            onClick={() => setSubTab('notes')}
            className="text-xs font-semibold text-sky-700 dark:text-sky-400 hover:underline cursor-pointer"
          >
            View all {profileNotes.length} note{profileNotes.length === 1 ? '' : 's'}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void refreshCareTables()}
            disabled={isCareTablesLoading}
            className="px-3 py-1.5 text-xs font-semibold text-stone-600 dark:text-stone-300 bg-stone-100 dark:bg-stone-800 hover:bg-stone-200 dark:hover:bg-stone-700 rounded-xl transition-colors flex items-center gap-1.5 cursor-pointer disabled:opacity-60"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isCareTablesLoading ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>
        )}

        <button
          type="submit"
          disabled={isSavingNote}
          className="px-4 py-2 text-xs font-bold text-white bg-stone-900 hover:bg-stone-800 dark:bg-stone-100 dark:hover:bg-white dark:text-stone-900 rounded-xl shadow-xs transition-colors flex items-center gap-1.5 cursor-pointer disabled:opacity-60"
        >
          {editingNoteId !== null ? <Check className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
          <span>
            {isSavingNote
              ? 'Saving...'
              : editingNoteId !== null
                ? 'Update Note'
                : 'Save Note'}
          </span>
        </button>
      </div>
    </form>
  );

  const renderNotesList = () => (
    <div className="bg-white dark:bg-stone-900 rounded-3xl border border-stone-200 dark:border-stone-800 shadow-xs overflow-hidden">
      <div className="px-5 py-3.5 border-b border-stone-100 dark:border-stone-800 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <StickyNote className="w-4 h-4 text-sky-600 dark:text-sky-400" />
          <h3 className="text-xs font-bold text-stone-800 dark:text-stone-200 uppercase tracking-wider">
            Ad Hoc Notes ({profileNotes.length})
          </h3>
        </div>
      </div>

      {profileNotes.length === 0 ? (
        <div className="p-10 text-center text-xs text-stone-500 dark:text-stone-400">
          No ad hoc notes logged yet. Use the form above to record a quick observation or reminder.
        </div>
      ) : (
        <div className="divide-y divide-stone-100 dark:divide-stone-800">
          {profileNotes.map((note) => (
            <div
              key={note.id}
              className="p-4 sm:px-5 hover:bg-stone-50/70 dark:hover:bg-stone-800/40 transition-colors flex items-start justify-between gap-4"
            >
              <div className="min-w-0 flex-1 space-y-1.5">
                <div className="flex flex-wrap items-center gap-2 text-[11px] text-stone-500 dark:text-stone-400">
                  <span className="inline-flex items-center gap-1 font-semibold text-stone-800 dark:text-stone-200">
                    <User className="w-3 h-3 text-sky-600 dark:text-sky-400" />
                    <span>{note.name || 'Unnamed logger'}</span>
                  </span>
                  <span>·</span>
                  <span>{formatNoteTimestamp(note.created_at)}</span>
                </div>
                <p className="text-xs sm:text-sm text-stone-800 dark:text-stone-100 whitespace-pre-wrap break-words leading-relaxed">
                  {note.notes || '—'}
                </p>
              </div>

              <div className="inline-flex items-center gap-1 shrink-0">
                <button
                  type="button"
                  onClick={() => setPendingAuthNote(note)}
                  className="p-1.5 text-stone-400 hover:text-stone-800 dark:hover:text-white rounded-lg hover:bg-stone-100 dark:hover:bg-stone-800 transition-colors cursor-pointer"
                  title="Authenticate with bae_Key to edit note"
                >
                  <Pencil className="w-3.5 h-3.5" />
                </button>
                {pendingDeleteId === note.id ? (
                  <button
                    type="button"
                    onClick={() => {
                      setPendingDeleteId(null);
                      void removeNoteRecord(note.id);
                    }}
                    className="px-2 py-1 text-[10px] font-bold text-white bg-rose-600 hover:bg-rose-700 rounded-lg cursor-pointer"
                  >
                    Confirm
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => setPendingDeleteId(note.id)}
                    className="p-1.5 text-stone-400 hover:text-rose-600 dark:hover:text-rose-400 rounded-lg hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors cursor-pointer"
                    title="Delete note"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  if (isEntriesLoading && !activeProfile) {
    return (
      <div className="bg-white dark:bg-stone-900 rounded-3xl border border-stone-200 dark:border-stone-800 p-10 text-center text-xs text-stone-500 dark:text-stone-400">
        Loading profiles and stages from Supabase...
      </div>
    );
  }

  if (!activeProfile) {
    return (
      <div className="space-y-6">
        <div className="bg-white dark:bg-stone-900 rounded-3xl border border-stone-200 dark:border-stone-800 p-8 md:p-10 text-center space-y-4">
          <div className="w-12 h-12 mx-auto rounded-2xl bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 flex items-center justify-center">
            <Sparkles className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-stone-900 dark:text-white">
              Add a Child or Pregnancy Profile
            </h2>
            <p className="text-xs text-stone-500 dark:text-stone-400 mt-1 max-w-md mx-auto">
              Create a profile in Supabase with birth date or due date to unlock stage expectations, family wishes, and milestone tracking. You can still log ad hoc notes below.
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

        {renderAdHocNoteForm(false)}
        {renderNotesList()}

        <EditAuthModal
          isOpen={Boolean(pendingAuthNote)}
          title="Authenticate to Edit Note"
          description={
            pendingAuthNote
              ? `Enter your bae_Key passkey to edit note #${pendingAuthNote.id}.`
              : undefined
          }
          onClose={() => setPendingAuthNote(null)}
          onAuthenticated={() => {
            if (pendingAuthNote) {
              const target = pendingAuthNote;
              setPendingAuthNote(null);
              applyEditNote(target);
            }
          }}
        />
      </div>
    );
  }

  const isFetal = activeProfile.type === 'fetal';

  return (
    <div className="space-y-6">
      {/* Unified Sub-Tab Switcher */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 bg-white dark:bg-stone-900 rounded-3xl border border-stone-200 dark:border-stone-800 p-4 sm:px-5 shadow-xs transition-colors">
        <div>
          <h2 className="text-lg font-bold text-stone-900 dark:text-white">
            {isFetal ? 'Stages, Wishes & Pregnancy Hub' : 'Stages, Wishes & Milestones'}
          </h2>
          <p className="text-xs text-stone-500 dark:text-stone-400 mt-0.5">
            {isFetal
              ? 'Explore weekly pregnancy stages, family wishes, ad hoc notes, and prenatal guides in one place.'
              : 'Track developmental stages, family love notes, ad hoc notes, and CDC milestone checklists together.'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 self-start lg:self-auto shrink-0">
          {subTab !== 'notes' && (
            <button
              type="button"
              onClick={() => setShowQuickComposer((v) => !v)}
              className="px-3 py-1.5 text-xs font-bold rounded-xl border border-sky-200 dark:border-sky-800 bg-sky-50 dark:bg-sky-950/60 hover:bg-sky-100 dark:hover:bg-sky-900 text-sky-900 dark:text-sky-200 transition-colors flex items-center gap-1.5 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Quick Note</span>
            </button>
          )}

          <div className="flex items-center gap-1 p-1 bg-stone-100 dark:bg-stone-800 rounded-2xl border border-stone-200/80 dark:border-stone-700/80">
            <button
              type="button"
              onClick={() => setSubTab('stages')}
              className={`px-3 py-1.5 text-xs font-bold rounded-xl transition-all flex items-center gap-1.5 cursor-pointer ${
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
              className={`px-3 py-1.5 text-xs font-bold rounded-xl transition-all flex items-center gap-1.5 cursor-pointer ${
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

            <button
              type="button"
              onClick={() => setSubTab('notes')}
              className={`px-3 py-1.5 text-xs font-bold rounded-xl transition-all flex items-center gap-1.5 cursor-pointer ${
                subTab === 'notes'
                  ? 'bg-white dark:bg-stone-900 text-stone-900 dark:text-white shadow-xs'
                  : 'text-stone-600 dark:text-stone-400 hover:text-stone-900 dark:hover:text-white'
              }`}
            >
              <StickyNote className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400" />
              <span>Notes ({profileNotes.length})</span>
            </button>
          </div>
        </div>
      </div>

      {/* Inline Quick Ad Hoc Note Composer when toggled from Stages or Milestones */}
      {subTab !== 'notes' && showQuickComposer && renderAdHocNoteForm(true)}

      {/* Active Sub-View */}
      {subTab === 'notes' ? (
        <div className="space-y-6">
          {renderAdHocNoteForm(false)}
          {renderNotesList()}
        </div>
      ) : subTab === 'stages' ? (
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

      {/* bae_Key Authentication Modal for Editing Ad Hoc Notes */}
      <EditAuthModal
        isOpen={Boolean(pendingAuthNote)}
        title="Authenticate to Edit Note"
        description={
          pendingAuthNote
            ? `Enter your bae_Key passkey to edit note #${pendingAuthNote.id}.`
            : undefined
        }
        onClose={() => setPendingAuthNote(null)}
        onAuthenticated={() => {
          if (pendingAuthNote) {
            const target = pendingAuthNote;
            setPendingAuthNote(null);
            applyEditNote(target);
          }
        }}
      />
    </div>
  );
};
