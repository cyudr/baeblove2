import React, { useState, useEffect } from 'react';
import { useApp } from '../../context/AppContext';
import { ChildProfile, ProfileType, Gender } from '../../types';
import { X, Baby, HeartPulse, Sparkles, Trash2, History } from 'lucide-react';
import { DeleteProfileModal } from './DeleteProfileModal';
import { GraduateFetalModal } from './GraduateFetalModal';
import { AttachedPrenatalHistoryModal } from './AttachedPrenatalHistoryModal';

interface ProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
  editingProfile?: ChildProfile;
}

export const ProfileModal: React.FC<ProfileModalProps> = ({
  isOpen,
  onClose,
  editingProfile,
}) => {
  const { addProfile, updateProfile } = useApp();

  const [type, setType] = useState<ProfileType>(editingProfile?.type || 'baby');
  const [name, setName] = useState(editingProfile?.name || '');
  const [gender, setGender] = useState<Gender>(editingProfile?.gender || 'boy');
  const [dateOfEvent, setDateOfEvent] = useState(
    editingProfile?.dateOfEvent || new Date().toISOString().split('T')[0]
  );
  const [birthWeightKg, setBirthWeightKg] = useState(
    editingProfile?.birthWeightKg !== undefined ? editingProfile.birthWeightKg.toString() : ''
  );
  const [birthLengthCm, setBirthLengthCm] = useState(
    editingProfile?.birthLengthCm !== undefined ? editingProfile.birthLengthCm.toString() : ''
  );
  const [birthHeadCircumferenceCm, setBirthHeadCircumferenceCm] = useState(
    editingProfile?.birthHeadCircumferenceCm !== undefined
      ? editingProfile.birthHeadCircumferenceCm.toString()
      : ''
  );
  const [prePregnancyWeightKg, setPrePregnancyWeightKg] = useState(
    editingProfile?.prePregnancyWeightKg !== undefined
      ? editingProfile.prePregnancyWeightKg.toString()
      : ''
  );
  const [maternalHeightCm, setMaternalHeightCm] = useState(
    editingProfile?.maternalHeightCm !== undefined ? editingProfile.maternalHeightCm.toString() : ''
  );
  const [notes, setNotes] = useState(editingProfile?.notes || '');
  const [loggedBy, setLoggedBy] = useState(editingProfile?.loggedBy || '');

  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [isGraduateModalOpen, setIsGraduateModalOpen] = useState(false);
  const [isHistoryModalOpen, setIsHistoryModalOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Sync form state whenever modal opens or target editingProfile changes
  useEffect(() => {
    if (!isOpen) return;
    setSaveError(null);
    setIsSaving(false);
    if (editingProfile) {
      setType(editingProfile.type);
      setName(editingProfile.name);
      setGender(editingProfile.gender);
      setDateOfEvent(editingProfile.dateOfEvent);
      setBirthWeightKg(
        editingProfile.birthWeightKg !== undefined ? editingProfile.birthWeightKg.toString() : ''
      );
      setBirthLengthCm(
        editingProfile.birthLengthCm !== undefined ? editingProfile.birthLengthCm.toString() : ''
      );
      setBirthHeadCircumferenceCm(
        editingProfile.birthHeadCircumferenceCm !== undefined
          ? editingProfile.birthHeadCircumferenceCm.toString()
          : ''
      );
      setPrePregnancyWeightKg(
        editingProfile.prePregnancyWeightKg !== undefined
          ? editingProfile.prePregnancyWeightKg.toString()
          : ''
      );
      setMaternalHeightCm(
        editingProfile.maternalHeightCm !== undefined
          ? editingProfile.maternalHeightCm.toString()
          : ''
      );
      setNotes(editingProfile.notes || '');
      setLoggedBy(editingProfile.loggedBy || '');
    } else {
      setType('baby');
      setName('');
      setGender('boy');
      setDateOfEvent(new Date().toISOString().split('T')[0]);
      setBirthWeightKg('');
      setBirthLengthCm('');
      setBirthHeadCircumferenceCm('');
      setPrePregnancyWeightKg('');
      setMaternalHeightCm('');
      setNotes('');
      setLoggedBy('');
    }
  }, [isOpen, editingProfile]);

  if (!isOpen) return null;

  const parseOptionalFloat = (val: string): number | undefined => {
    const trimmed = val.trim();
    if (!trimmed) return undefined;
    const parsed = parseFloat(trimmed);
    return Number.isNaN(parsed) ? undefined : parsed;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || isSaving) return;
    setSaveError(null);
    setIsSaving(true);

    const baseData: Partial<ChildProfile> = {
      name: name.trim(),
      type,
      gender,
      dateOfEvent,
      birthWeightKg: type === 'baby' ? parseOptionalFloat(birthWeightKg) : undefined,
      birthLengthCm: type === 'baby' ? parseOptionalFloat(birthLengthCm) : undefined,
      birthHeadCircumferenceCm:
        type === 'baby' ? parseOptionalFloat(birthHeadCircumferenceCm) : undefined,
      prePregnancyWeightKg: type === 'fetal' ? parseOptionalFloat(prePregnancyWeightKg) : undefined,
      maternalHeightCm: type === 'fetal' ? parseOptionalFloat(maternalHeightCm) : undefined,
      avatarColor:
        type === 'baby' ? (gender === 'girl' ? 'bg-rose-600' : 'bg-emerald-600') : 'bg-amber-600',
      avatarIcon: type === 'baby' ? 'Baby' : 'HeartPulse',
      notes: notes.trim() || undefined,
      loggedBy: loggedBy.trim() || undefined,
    };

    try {
      const res = editingProfile
        ? await updateProfile(editingProfile.id, baseData)
        : await addProfile(baseData as Omit<ChildProfile, 'id'>);

      if (res.error) {
        setSaveError(res.error);
        return;
      }

      onClose();
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-stone-900/60 dark:bg-black/75 backdrop-blur-xs overflow-y-auto">
        <div className="bg-white dark:bg-stone-900 rounded-3xl max-w-md w-full p-6 shadow-2xl border border-stone-200 dark:border-stone-800 relative transition-colors my-6">
          <div className="flex items-center justify-between pb-4 border-b border-stone-100 dark:border-stone-800">
            <div>
              <h3 className="text-lg font-bold text-stone-900 dark:text-white">
                {editingProfile
                  ? editingProfile.type === 'baby'
                    ? 'Edit Profile & Birth Data'
                    : 'Edit Pregnancy Profile'
                  : 'Add Child or Pregnancy'}
              </h3>
              {editingProfile && editingProfile.type === 'baby' && (
                <p className="text-[11px] text-stone-500 dark:text-stone-400 mt-0.5">
                  Updates automatically sync birth baseline stats and growth ages.
                </p>
              )}
            </div>
            <button
              onClick={onClose}
              className="p-1.5 text-stone-400 hover:text-stone-700 dark:hover:text-stone-200 rounded-lg hover:bg-stone-100 dark:hover:bg-stone-800 transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Quick Actions for Editing Profiles */}
          {editingProfile && (
            <div className="mt-3.5 space-y-2">
              {/* Natural progression: Fetus -> Baby */}
              {editingProfile.type === 'fetal' && (
                <div className="p-3 rounded-2xl bg-linear-to-r from-emerald-500/15 via-teal-500/10 to-amber-500/15 border border-emerald-300 dark:border-emerald-800 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                    <div>
                      <div className="text-xs font-bold text-stone-900 dark:text-white">Baby has arrived?</div>
                      <div className="text-[11px] text-stone-500 dark:text-stone-400">Celebrate birth &amp; transition to babyhood</div>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setIsGraduateModalOpen(true)}
                    className="px-2.5 py-1 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 dark:bg-emerald-500 dark:hover:bg-emerald-600 rounded-xl shadow-xs transition-colors shrink-0 cursor-pointer"
                  >
                    Graduate
                  </button>
                </div>
              )}

              {/* Review Attached Prenatal History if baby has one */}
              {editingProfile.type === 'baby' && editingProfile.attachedFetalProfileId && (
                <div className="p-3 rounded-2xl bg-amber-50/70 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/50 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <History className="w-4 h-4 text-amber-700 dark:text-amber-400" />
                    <div>
                      <div className="text-xs font-bold text-stone-900 dark:text-white">Attached Prenatal Journey</div>
                      <div className="text-[11px] text-stone-500 dark:text-stone-400">In-womb ultrasounds &amp; kicks preserved</div>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setIsHistoryModalOpen(true)}
                    className="px-2.5 py-1 text-xs font-bold text-stone-800 dark:text-stone-200 bg-amber-100 hover:bg-amber-200 dark:bg-amber-900/60 dark:hover:bg-amber-800 rounded-xl transition-colors shrink-0 cursor-pointer"
                  >
                    View History
                  </button>
                </div>
              )}
            </div>
          )}

          <form onSubmit={handleSubmit} className="mt-4 space-y-4">
            {/* Type selector */}
            {!editingProfile && (
              <div>
                <label className="block text-xs font-medium text-stone-700 dark:text-stone-300 mb-1.5">
                  Journey Stage
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setType('baby')}
                    className={`p-3 rounded-2xl border text-left flex items-start gap-2.5 transition-all cursor-pointer ${
                      type === 'baby'
                        ? 'border-emerald-600 bg-emerald-50/70 dark:bg-emerald-950/40 text-stone-900 dark:text-white font-semibold'
                        : 'border-stone-200 dark:border-stone-700 hover:border-stone-300 dark:hover:border-stone-600 text-stone-600 dark:text-stone-300 bg-white dark:bg-stone-800'
                    }`}
                  >
                    <Baby className="w-5 h-5 text-emerald-700 dark:text-emerald-400 mt-0.5 shrink-0" />
                    <div>
                      <div className="text-xs font-semibold">Baby / Toddler</div>
                      <div className="text-[11px] text-stone-500 dark:text-stone-400">Track 0–36+ months</div>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setType('fetal')}
                    className={`p-3 rounded-2xl border text-left flex items-start gap-2.5 transition-all cursor-pointer ${
                      type === 'fetal'
                        ? 'border-amber-600 bg-amber-50/70 dark:bg-amber-950/40 text-stone-900 dark:text-white font-semibold'
                        : 'border-stone-200 dark:border-stone-700 hover:border-stone-300 dark:hover:border-stone-600 text-stone-600 dark:text-stone-300 bg-white dark:bg-stone-800'
                    }`}
                  >
                    <HeartPulse className="w-5 h-5 text-amber-700 dark:text-amber-400 mt-0.5 shrink-0" />
                    <div>
                      <div className="text-xs font-semibold">Pregnancy</div>
                      <div className="text-[11px] text-stone-500 dark:text-stone-400">Track 4–40 weeks</div>
                    </div>
                  </button>
                </div>
              </div>
            )}

            {/* Profile / Baby Name & Logged By */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-stone-700 dark:text-stone-300 mb-1">
                  {type === 'baby' ? "Profile / Baby's Name" : 'Profile / Baby Nickname'}
                </label>
                <input
                  type="text"
                  required
                  placeholder={type === 'baby' ? 'e.g. Liam, Maya' : 'e.g. Little Peanut'}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-white dark:bg-stone-800 border border-stone-200 dark:border-stone-700 text-stone-900 dark:text-white rounded-xl focus:outline-hidden focus:border-stone-400"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-stone-700 dark:text-stone-300 mb-1">
                  Logged By
                </label>
                <input
                  type="text"
                  placeholder="e.g. Mom, Dad, Caregiver"
                  value={loggedBy}
                  onChange={(e) => setLoggedBy(e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-white dark:bg-stone-800 border border-stone-200 dark:border-stone-700 text-stone-900 dark:text-white rounded-xl focus:outline-hidden focus:border-stone-400"
                />
              </div>
            </div>

            {/* Gender */}
            <div>
              <label className="block text-xs font-medium text-stone-700 dark:text-stone-300 mb-1">Gender</label>
              <div className="grid grid-cols-3 gap-2">
                {(['boy', 'girl', 'undisclosed'] as Gender[]).map((g) => (
                  <button
                    key={g}
                    type="button"
                    onClick={() => setGender(g)}
                    className={`py-1.5 text-xs font-medium rounded-xl border capitalize transition-colors cursor-pointer ${
                      gender === g
                        ? 'bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900 border-stone-900 dark:border-stone-100 font-semibold'
                        : 'bg-white dark:bg-stone-800 text-stone-600 dark:text-stone-300 border-stone-200 dark:border-stone-700 hover:border-stone-300 dark:hover:border-stone-600'
                    }`}
                  >
                    {g === 'undisclosed' ? 'Surprise' : g}
                  </button>
                ))}
              </div>
            </div>

            {/* Date of Event */}
            <div>
              <label className="block text-xs font-medium text-stone-700 dark:text-stone-300 mb-1">
                {type === 'baby' ? 'Date of Birth' : 'Estimated Due Date (EDD)'}
              </label>
              <input
                type="date"
                required
                value={dateOfEvent}
                onChange={(e) => setDateOfEvent(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-white dark:bg-stone-800 border border-stone-200 dark:border-stone-700 text-stone-900 dark:text-white rounded-xl focus:outline-hidden focus:border-stone-400"
              />
            </div>

            {/* Birth or Pregnancy Baseline Stats */}
            {type === 'baby' ? (
              <div className="grid grid-cols-3 gap-2.5">
                <div>
                  <label className="block text-[11px] font-medium text-stone-700 dark:text-stone-300 mb-1">
                    Birth Weight (kg)
                  </label>
                  <input
                    type="number"
                    step="0.001"
                    min="0"
                    placeholder="e.g. 3.425"
                    value={birthWeightKg}
                    onChange={(e) => setBirthWeightKg(e.target.value)}
                    className="w-full px-2.5 py-2 text-sm bg-white dark:bg-stone-800 border border-stone-200 dark:border-stone-700 text-stone-900 dark:text-white rounded-xl focus:outline-hidden focus:border-stone-400 font-mono"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-stone-700 dark:text-stone-300 mb-1">
                    Birth Length (cm)
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    placeholder="e.g. 50.2"
                    value={birthLengthCm}
                    onChange={(e) => setBirthLengthCm(e.target.value)}
                    className="w-full px-2.5 py-2 text-sm bg-white dark:bg-stone-800 border border-stone-200 dark:border-stone-700 text-stone-900 dark:text-white rounded-xl focus:outline-hidden focus:border-stone-400 font-mono"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-stone-700 dark:text-stone-300 mb-1">
                    Birth Head (cm)
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    placeholder="e.g. 34.6"
                    value={birthHeadCircumferenceCm}
                    onChange={(e) => setBirthHeadCircumferenceCm(e.target.value)}
                    className="w-full px-2.5 py-2 text-sm bg-white dark:bg-stone-800 border border-stone-200 dark:border-stone-700 text-stone-900 dark:text-white rounded-xl focus:outline-hidden focus:border-stone-400 font-mono"
                  />
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-stone-700 dark:text-stone-300 mb-1">
                    Pre-pregnancy Weight (kg)
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    placeholder="e.g. 60.5"
                    value={prePregnancyWeightKg}
                    onChange={(e) => setPrePregnancyWeightKg(e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-white dark:bg-stone-800 border border-stone-200 dark:border-stone-700 text-stone-900 dark:text-white rounded-xl focus:outline-hidden focus:border-stone-400 font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-stone-700 dark:text-stone-300 mb-1">
                    Maternal Height (cm)
                  </label>
                  <input
                    type="number"
                    step="0.5"
                    min="0"
                    placeholder="e.g. 168"
                    value={maternalHeightCm}
                    onChange={(e) => setMaternalHeightCm(e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-white dark:bg-stone-800 border border-stone-200 dark:border-stone-700 text-stone-900 dark:text-white rounded-xl focus:outline-hidden focus:border-stone-400 font-mono"
                  />
                </div>
              </div>
            )}

            {/* Notes */}
            <div>
              <label className="block text-xs font-medium text-stone-700 dark:text-stone-300 mb-1">Notes</label>
              <input
                type="text"
                placeholder="e.g. Born at 39w2d; pediatrician name..."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-white dark:bg-stone-800 border border-stone-200 dark:border-stone-700 text-stone-900 dark:text-white rounded-xl focus:outline-hidden focus:border-stone-400"
              />
            </div>

            {/* Danger Zone: Delete Profile Option */}
            {editingProfile && (
              <div className="pt-2">
                <div className="p-3 rounded-2xl border border-rose-200/80 dark:border-rose-950/60 bg-rose-50/40 dark:bg-rose-950/20 flex items-center justify-between">
                  <div>
                    <div className="text-xs font-bold text-rose-800 dark:text-rose-400">
                      Delete Profile
                    </div>
                    <div className="text-[11px] text-stone-500 dark:text-stone-400">
                      Requires security password verification
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setIsDeleteModalOpen(true)}
                    className="px-3 py-1.5 text-xs font-semibold text-rose-600 dark:text-rose-400 hover:text-white hover:bg-rose-600 dark:hover:bg-rose-600 border border-rose-300 dark:border-rose-800 rounded-xl transition-colors flex items-center gap-1.5 cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Delete</span>
                  </button>
                </div>
              </div>
            )}

            {saveError && (
              <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-900/70 text-xs text-rose-700 dark:text-rose-300">
                {saveError}
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-stone-100 dark:border-stone-800">
              <button
                type="button"
                onClick={onClose}
                disabled={isSaving}
                className="px-4 py-2 text-xs font-medium text-stone-600 dark:text-stone-400 hover:text-stone-900 dark:hover:text-white rounded-xl transition-colors cursor-pointer disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSaving}
                className="px-4 py-2 text-xs font-semibold text-white bg-stone-900 hover:bg-stone-800 dark:bg-stone-100 dark:hover:bg-white dark:text-stone-900 rounded-xl shadow-xs transition-colors cursor-pointer disabled:opacity-50"
              >
                {isSaving
                  ? 'Saving...'
                  : editingProfile
                    ? 'Save Changes'
                    : 'Create Profile'}
              </button>
            </div>
          </form>
        </div>
      </div>

      {/* Delete Profile Modal */}
      {editingProfile && (
        <DeleteProfileModal
          isOpen={isDeleteModalOpen}
          onClose={() => setIsDeleteModalOpen(false)}
          profileToDelete={editingProfile}
          onDeleted={() => {
            setIsDeleteModalOpen(false);
            onClose();
          }}
        />
      )}

      {/* Graduate Fetal Modal */}
      {editingProfile && editingProfile.type === 'fetal' && (
        <GraduateFetalModal
          isOpen={isGraduateModalOpen}
          onClose={() => setIsGraduateModalOpen(false)}
          fetalProfile={editingProfile}
          onGraduated={() => {
            setIsGraduateModalOpen(false);
            onClose();
          }}
        />
      )}

      {/* Attached Prenatal History Review Modal */}
      {editingProfile && editingProfile.type === 'baby' && (
        <AttachedPrenatalHistoryModal
          isOpen={isHistoryModalOpen}
          onClose={() => setIsHistoryModalOpen(false)}
          babyProfile={editingProfile}
        />
      )}
    </>
  );
};
