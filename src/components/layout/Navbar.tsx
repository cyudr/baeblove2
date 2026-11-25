import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { ChildProfile } from '../../types';
import {
  Baby,
  HeartPulse,
  Plus,
  FileText,
  ChevronDown,
  Sparkles,
  Check,
  BookOpen,
  Sun,
  Moon,
  Lock,
  MoreHorizontal,
  LayoutDashboard,
  LineChart,
  History,
  Trash2,
  Droplets,
  Pencil,
  RefreshCw,
} from 'lucide-react';
import { DeleteProfileModal } from '../modals/DeleteProfileModal';
import { GraduateFetalModal } from '../modals/GraduateFetalModal';
import { AttachedPrenatalHistoryModal } from '../modals/AttachedPrenatalHistoryModal';

interface NavbarProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  onOpenProfileModal: () => void;
  onOpenEditProfileModal: (profile: ChildProfile) => void;
  onOpenExportModal: () => void;
  onOpenFormulaModal: () => void;
  isPasswordProtected?: boolean;
  onLockPortal?: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  activeTab,
  setActiveTab,
  onOpenProfileModal,
  onOpenEditProfileModal,
  onOpenExportModal,
  onOpenFormulaModal,
  isPasswordProtected = false,
  onLockPortal,
}) => {
  const {
    profiles,
    activeProfileId,
    activeProfile,
    setActiveProfileId,
    formulaSettings,
    theme,
    toggleTheme,
    systemOrTimeTheme,
    isThemeOverridden,
    isEntriesLoading,
    isCareTablesLoading,
    refreshAllData,
  } = useApp();

  const isRefreshing = isEntriesLoading || isCareTablesLoading;

  const [profileDropdownOpen, setProfileDropdownOpen] = useState(false);
  const [toolsDropdownOpen, setToolsDropdownOpen] = useState(false);

  const [profileToDelete, setProfileToDelete] = useState<ChildProfile | null>(null);
  const [fetalProfileToGraduate, setFetalProfileToGraduate] = useState<ChildProfile | null>(null);
  const [babyProfileForHistory, setBabyProfileForHistory] = useState<ChildProfile | null>(null);

  const navItems = [
    { id: 'dashboard', label: 'Overview', icon: LayoutDashboard },
    { id: 'charts', label: 'Growth', icon: LineChart },
    { id: 'routine', label: 'Routine', icon: Droplets },
    { id: 'stages-milestones', label: 'Stages & Milestones', icon: Sparkles },
    { id: 'logs', label: 'History', icon: History },
  ];

  return (
    <>
      <header className="fixed top-0 left-0 right-0 z-40 w-full h-14 bg-white/92 dark:bg-stone-900/92 backdrop-blur-md border-b border-stone-200/80 dark:border-stone-800/80 shadow-xs transition-colors">
      <div className="max-w-7xl mx-auto h-full px-3 sm:px-5 lg:px-8 flex items-center justify-between gap-2">
        {/* Left: Brand & Compact Profile Pill */}
        <div className="flex items-center gap-2 sm:gap-3 shrink-0">
          <button
            onClick={() => setActiveTab('dashboard')}
            className="flex items-center gap-2 cursor-pointer text-left hover:opacity-90 transition-opacity"
            title="BaeLove Home"
          >
            <div className="w-8 h-8 rounded-xl bg-linear-to-tr from-emerald-700 via-teal-600 to-amber-600 flex items-center justify-center text-white shadow-xs">
              <Sparkles className="w-4 h-4 text-emerald-100" />
            </div>
            <div className="hidden xs:block">
              <span className="font-black text-stone-900 dark:text-white tracking-tight text-sm">
                BaeLove
              </span>
            </div>
          </button>

          {/* Compact Profile Switcher Pill */}
          <div className="relative">
            <button
              onClick={() => setProfileDropdownOpen(!profileDropdownOpen)}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl border border-stone-200 dark:border-stone-700 hover:border-emerald-400 dark:hover:border-emerald-600 bg-stone-50/90 dark:bg-stone-800/90 text-xs font-semibold text-stone-800 dark:text-stone-200 transition-all shadow-2xs hover:bg-stone-100 dark:hover:bg-stone-700/80"
              title="Switch or manage profiles"
            >
              {activeProfile?.type === 'fetal' ? (
                <HeartPulse className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 shrink-0" />
              ) : (
                <Baby className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
              )}
              <span className="max-w-[75px] sm:max-w-[130px] truncate">
                {activeProfile?.name?.split(' ')[0] || 'Add Profile'}
              </span>
              <ChevronDown className="w-3 h-3 text-stone-400 shrink-0" />
            </button>

            {profileDropdownOpen && (
              <>
                <div
                  className="fixed inset-0 z-10"
                  onClick={() => setProfileDropdownOpen(false)}
                />
                <div className="absolute left-0 mt-2 w-64 bg-white dark:bg-stone-800 rounded-2xl shadow-xl border border-stone-200 dark:border-stone-700 py-2 z-20 animate-in fade-in zoom-in-95 duration-150">
                  <div className="px-3.5 py-1 text-[10px] font-bold uppercase tracking-wider text-stone-400 dark:text-stone-500">
                    Switch Profile
                  </div>
                  {profiles.map((p) => {
                    const isActive = p.id === activeProfileId;
                    return (
                      <div
                        key={p.id}
                        className={`w-full px-3.5 py-1.5 flex items-center justify-between hover:bg-stone-50 dark:hover:bg-stone-700/60 transition-colors ${
                          isActive
                            ? 'font-bold text-stone-900 dark:text-white bg-emerald-50/60 dark:bg-emerald-950/40'
                            : 'text-stone-600 dark:text-stone-300'
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => {
                            setActiveProfileId(p.id);
                            setProfileDropdownOpen(false);
                          }}
                          className="flex items-center gap-2 truncate text-left flex-1 cursor-pointer py-1"
                        >
                          {p.type === 'baby' ? (
                            <Baby className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                          ) : (
                            <HeartPulse className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
                          )}
                          <div className="truncate">
                            <div className="text-xs truncate">{p.name}</div>
                            <div className="text-[10px] text-stone-400 dark:text-stone-500 font-normal">
                              {p.type === 'baby' ? 'Baby' : 'Pregnancy'} {p.attachedFetalProfileId ? '· Attached In-Womb' : ''}
                            </div>
                          </div>
                        </button>

                        <div className="flex items-center gap-1 shrink-0">
                          {isActive && (
                            <Check className="w-4 h-4 text-emerald-600 dark:text-emerald-400 mr-0.5" />
                          )}
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setProfileDropdownOpen(false);
                              onOpenEditProfileModal(p);
                            }}
                            className="p-1 rounded-lg text-stone-400 hover:text-stone-900 dark:hover:text-white hover:bg-stone-100 dark:hover:bg-stone-700 transition-colors cursor-pointer"
                            title={`Edit profile & birth data: ${p.name}`}
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setProfileDropdownOpen(false);
                              setProfileToDelete(p);
                            }}
                            className="p-1 rounded-lg text-stone-400 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/60 transition-colors cursor-pointer"
                            title={`Delete profile: ${p.name}`}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    );
                  })}

                  {/* Special Contextual Profile Actions */}
                  {activeProfile && (
                    <div className="px-2 pt-1 border-t border-stone-100 dark:border-stone-700 my-1 space-y-1">
                      <button
                        type="button"
                        onClick={() => {
                          setProfileDropdownOpen(false);
                          onOpenEditProfileModal(activeProfile);
                        }}
                        className="w-full px-2.5 py-1.5 rounded-xl bg-stone-50 dark:bg-stone-700/50 border border-stone-200 dark:border-stone-600 text-left text-xs font-bold text-stone-800 dark:text-stone-100 flex items-center gap-2 hover:bg-stone-100 dark:hover:bg-stone-700 transition-colors cursor-pointer"
                      >
                        <Pencil className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                        <span>
                          {activeProfile.type === 'baby'
                            ? 'Edit Birth Data & Profile'
                            : 'Edit Pregnancy Details'}
                        </span>
                      </button>

                      {activeProfile.type === 'fetal' && (
                        <button
                          onClick={() => {
                            setProfileDropdownOpen(false);
                            setFetalProfileToGraduate(activeProfile);
                          }}
                          className="w-full px-2.5 py-1.5 rounded-xl bg-linear-to-r from-emerald-500/15 to-teal-500/15 border border-emerald-300 dark:border-emerald-800 text-left text-xs font-bold text-emerald-950 dark:text-emerald-200 flex items-center gap-2 hover:bg-emerald-50 dark:hover:bg-emerald-950/60 transition-colors cursor-pointer"
                        >
                          <Sparkles className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                          <span>Celebrate Birth & Graduate to Baby</span>
                        </button>
                      )}

                      {activeProfile.type === 'baby' && activeProfile.attachedFetalProfileId && (
                        <button
                          onClick={() => {
                            setProfileDropdownOpen(false);
                            setBabyProfileForHistory(activeProfile);
                          }}
                          className="w-full px-2.5 py-1.5 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-left text-xs font-bold text-amber-900 dark:text-amber-200 flex items-center gap-2 hover:bg-amber-100 dark:hover:bg-amber-900/60 transition-colors cursor-pointer"
                        >
                          <History className="w-3.5 h-3.5 text-amber-700 dark:text-amber-400 shrink-0" />
                          <span>Review Attached In-Womb Journey</span>
                        </button>
                      )}
                    </div>
                  )}

                  <div className="border-t border-stone-100 dark:border-stone-700 my-1.5" />

                  <button
                    onClick={() => {
                      setProfileDropdownOpen(false);
                      onOpenProfileModal();
                    }}
                    className="w-full px-3.5 py-2 text-left text-xs text-stone-700 dark:text-stone-200 hover:text-stone-900 dark:hover:text-white hover:bg-stone-50 dark:hover:bg-stone-700/60 flex items-center gap-2 font-medium cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5 text-stone-500 dark:text-stone-400" />
                    <span>Add New Profile</span>
                  </button>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Center: Desktop Nav Pills (decluttered, compact, clean) */}
        <nav className="hidden md:flex items-center p-1 bg-stone-100/90 dark:bg-stone-800/90 rounded-2xl border border-stone-200/60 dark:border-stone-700/60 space-x-0.5">
          {navItems.map((item) => {
            const isActive = activeTab === item.id;
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id)}
                className={`px-3 py-1 text-xs font-semibold rounded-xl transition-all flex items-center gap-1.5 ${
                  isActive
                    ? 'bg-white dark:bg-stone-900 text-stone-900 dark:text-white shadow-2xs font-bold'
                    : 'text-stone-600 dark:text-stone-400 hover:text-stone-900 dark:hover:text-white hover:bg-white/50 dark:hover:bg-stone-700/50'
                }`}
              >
                <Icon className={`w-3.5 h-3.5 ${isActive ? 'text-emerald-700 dark:text-emerald-400' : 'text-stone-400'}`} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        {/* Right: Decluttered Action Controls */}
        <div className="flex items-center gap-1.5 sm:gap-2">
          {/* Global Refresh Button */}
          <button
            type="button"
            onClick={() => void refreshAllData()}
            disabled={isRefreshing}
            title="Refresh all profile, growth, routine, and notes data from Supabase"
            aria-label="Refresh all data"
            className="flex items-center justify-center gap-1 w-8 lg:w-auto lg:px-2.5 h-8 text-xs font-semibold text-stone-700 dark:text-stone-200 hover:text-emerald-800 dark:hover:text-emerald-300 bg-stone-50 dark:bg-stone-800 hover:bg-emerald-50 dark:hover:bg-stone-700 rounded-xl border border-stone-200 dark:border-stone-700 transition-colors cursor-pointer shadow-2xs disabled:opacity-60"
          >
            <RefreshCw
              className={`w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 ${
                isRefreshing ? 'animate-spin' : ''
              }`}
            />
            <span className="text-[11px] hidden lg:inline">Refresh</span>
          </button>

          {/* Light / Dark Mode Icon Toggle */}
          <button
            onClick={toggleTheme}
            title={
              isThemeOverridden
                ? `${theme === 'dark' ? 'Dark' : 'Light'} mode (Manual override · Auto by time is ${systemOrTimeTheme}). Click to toggle.`
                : `${theme === 'dark' ? 'Dark' : 'Light'} mode (Auto by system time). Click to override.`
            }
            aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
            className="w-8 h-8 rounded-xl border border-stone-200 dark:border-stone-700 bg-stone-50 dark:bg-stone-800 text-stone-700 dark:text-stone-200 hover:bg-stone-100 dark:hover:bg-stone-700 flex items-center justify-center transition-colors shadow-2xs cursor-pointer"
          >
            {theme === 'dark' ? (
              <Moon className="w-4 h-4 text-indigo-400 fill-indigo-400/20" />
            ) : (
              <Sun className="w-4 h-4 text-amber-500 fill-amber-500/20" />
            )}
          </button>

          {/* Quick Clinical Formulas Button */}
          <button
            onClick={onOpenFormulaModal}
            title={
              activeProfile?.type === 'fetal'
                ? `Fetal formulas: ${formulaSettings.fetalEfwFormula.toUpperCase()} & ${formulaSettings.gestationalMethod}`
                : activeProfile?.type === 'baby'
                  ? 'Pediatric formulas: WHO 2006 LMS & Feeding Targets'
                  : 'Clinical formulas & scientific sources'
            }
            className="hidden sm:flex items-center gap-1 px-2.5 h-8 text-xs font-semibold text-stone-700 dark:text-stone-300 hover:text-amber-900 dark:hover:text-amber-400 hover:bg-amber-50 dark:hover:bg-stone-800 rounded-xl border border-stone-200 dark:border-stone-700 transition-colors cursor-pointer shadow-2xs"
          >
            <BookOpen className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
            <span className="text-[11px] hidden lg:inline">Formulas</span>
          </button>

          {/* Quick Medical Report / Print Button */}
          <button
            onClick={onOpenExportModal}
            title="Export clinical report & data backup"
            className="hidden sm:flex items-center gap-1 px-2.5 h-8 text-xs font-semibold text-stone-700 dark:text-stone-300 hover:text-stone-900 dark:hover:text-white hover:bg-stone-100 dark:hover:bg-stone-800 rounded-xl border border-stone-200 dark:border-stone-700 transition-colors cursor-pointer shadow-2xs"
          >
            <FileText className="w-3.5 h-3.5 text-stone-500 dark:text-stone-400" />
            <span className="text-[11px] hidden lg:inline">Report</span>
          </button>

          {/* Lock Portal Button (if protected) */}
          {isPasswordProtected && onLockPortal && (
            <button
              onClick={onLockPortal}
              title="Lock site portal (Requires password to re-enter)"
              className="w-8 h-8 rounded-xl border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/60 text-amber-900 dark:text-amber-200 hover:bg-amber-100 dark:hover:bg-amber-900 flex items-center justify-center transition-colors shadow-2xs cursor-pointer"
            >
              <Lock className="w-4 h-4 text-amber-700 dark:text-amber-400" />
            </button>
          )}

          {/* Mobile More Tools Menu button (Formulas & Report on mobile) */}
          <div className="relative sm:hidden">
            <button
              onClick={() => setToolsDropdownOpen(!toolsDropdownOpen)}
              className="w-8 h-8 rounded-xl border border-stone-200 dark:border-stone-700 bg-stone-50 dark:bg-stone-800 text-stone-700 dark:text-stone-200 hover:bg-stone-100 dark:hover:bg-stone-700 flex items-center justify-center transition-colors shadow-2xs"
              title="More options"
            >
              <MoreHorizontal className="w-4 h-4" />
            </button>

            {toolsDropdownOpen && (
              <>
                <div
                  className="fixed inset-0 z-10"
                  onClick={() => setToolsDropdownOpen(false)}
                />
                <div className="absolute right-0 mt-2 w-48 bg-white dark:bg-stone-800 rounded-2xl shadow-xl border border-stone-200 dark:border-stone-700 py-1.5 z-20 animate-in fade-in duration-100">
                  <button
                    onClick={() => {
                      setToolsDropdownOpen(false);
                      onOpenFormulaModal();
                    }}
                    className="w-full px-3 py-2 text-left text-xs text-stone-700 dark:text-stone-200 hover:bg-stone-50 dark:hover:bg-stone-700 flex items-center gap-2 font-medium"
                  >
                    <BookOpen className="w-4 h-4 text-amber-600" />
                    <span>Clinical Formulas</span>
                  </button>
                  <button
                    onClick={() => {
                      setToolsDropdownOpen(false);
                      onOpenExportModal();
                    }}
                    className="w-full px-3 py-2 text-left text-xs text-stone-700 dark:text-stone-200 hover:bg-stone-50 dark:hover:bg-stone-700 flex items-center gap-2 font-medium"
                  >
                    <FileText className="w-4 h-4 text-emerald-600" />
                    <span>Clinical Report</span>
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </header>

    {/* Delete Profile Modal (Requirement 2) */}
    {profileToDelete && (
      <DeleteProfileModal
        isOpen={!!profileToDelete}
        onClose={() => setProfileToDelete(null)}
        profileToDelete={profileToDelete}
      />
    )}

    {/* Graduate Fetal Modal (Requirement 1 & 3) */}
    {fetalProfileToGraduate && (
      <GraduateFetalModal
        isOpen={!!fetalProfileToGraduate}
        onClose={() => setFetalProfileToGraduate(null)}
        fetalProfile={fetalProfileToGraduate}
        onGraduated={() => {
          setFetalProfileToGraduate(null);
          setActiveTab('dashboard');
        }}
      />
    )}

    {/* Attached Prenatal History Review Modal (Requirement 3) */}
    {babyProfileForHistory && (
      <AttachedPrenatalHistoryModal
        isOpen={!!babyProfileForHistory}
        onClose={() => setBabyProfileForHistory(null)}
        babyProfile={babyProfileForHistory}
      />
    )}
    </>
  );
};
