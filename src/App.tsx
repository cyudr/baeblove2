/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { AppProvider, useApp } from './context/AppContext';
import type {
  BabyMeasurement,
  ChildProfile,
  FetalMeasurement,
  GrowthRecord,
  RoutineRecord,
} from './types';
import { Navbar } from './components/layout/Navbar';
import { MobileTabBar } from './components/layout/MobileTabBar';
import { GrowthDashboardView } from './components/views/GrowthDashboardView';
import {
  StagesAndMilestonesView,
  type StagesMilestonesSubTab,
} from './components/views/StagesAndMilestonesView';
import { GrowthTabView } from './components/views/GrowthTabView';
import { RoutineView } from './components/views/RoutineView';
import { HistoryLogsView } from './components/views/HistoryLogsView';
import { LogMeasurementModal } from './components/modals/LogMeasurementModal';
import { ProfileModal } from './components/modals/ProfileModal';
import { ExportReportModal } from './components/modals/ExportReportModal';
import { AddMilestoneModal } from './components/modals/AddMilestoneModal';
import { AddLoveNoteModal } from './components/modals/AddLoveNoteModal';
import { FormulaSourceModal } from './components/modals/FormulaSourceModal';
import { PasswordGate } from './components/auth/PasswordGate';
import {
  isPasswordProtectionEnabled,
  isUserAuthenticated,
  logoutUser,
} from './utils/authConfig';

interface AppContentProps {
  isPasswordProtected: boolean;
  onLockPortal: () => void;
}

function AppContent({ isPasswordProtected, onLockPortal }: AppContentProps) {
  const { activeProfile } = useApp();

  const [activeTab, setActiveTab] = useState<string>('dashboard');
  const [stagesMilestonesSubTab, setStagesMilestonesSubTab] =
    useState<StagesMilestonesSubTab>('stages');
  const [isLogModalOpen, setIsLogModalOpen] = useState(false);
  const [editingBabyMeasurement, setEditingBabyMeasurement] = useState<BabyMeasurement | null>(null);
  const [editingFetalMeasurement, setEditingFetalMeasurement] = useState<FetalMeasurement | null>(null);
  const [editingRoutineRecord, setEditingRoutineRecord] = useState<RoutineRecord | null>(null);
  const [editingGrowthRecord, setEditingGrowthRecord] = useState<GrowthRecord | null>(null);
  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);
  const [editingProfile, setEditingProfile] = useState<ChildProfile | undefined>(undefined);
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [isCustomMilestoneModalOpen, setIsCustomMilestoneModalOpen] = useState(false);
  const [isLoveNoteModalOpen, setIsLoveNoteModalOpen] = useState(false);
  const [isFormulaModalOpen, setIsFormulaModalOpen] = useState(false);
  const [loveNoteStageLabel, setLoveNoteStageLabel] = useState('Today');

  const navigateToTab = (tab: string) => {
    if (tab === 'stages') {
      setStagesMilestonesSubTab('stages');
      setActiveTab('stages-milestones');
      return;
    }
    if (tab === 'milestones' || tab === 'fetal-hub') {
      setStagesMilestonesSubTab('milestones');
      setActiveTab('stages-milestones');
      return;
    }
    if (tab === 'daily-care') {
      setActiveTab('routine');
      return;
    }
    setActiveTab(tab);
  };

  const openNewProfileModal = () => {
    setEditingProfile(undefined);
    setIsProfileModalOpen(true);
  };

  const openEditProfileModal = (profile?: ChildProfile) => {
    setEditingProfile(profile ?? activeProfile);
    setIsProfileModalOpen(true);
  };

  const openNewLogModal = () => {
    setEditingBabyMeasurement(null);
    setEditingFetalMeasurement(null);
    setIsLogModalOpen(true);
  };

  const openEditBabyMeasurementModal = (measurement: BabyMeasurement) => {
    setEditingFetalMeasurement(null);
    setEditingBabyMeasurement(measurement);
    setIsLogModalOpen(true);
  };

  const openEditFetalMeasurementModal = (measurement: FetalMeasurement) => {
    setEditingBabyMeasurement(null);
    setEditingFetalMeasurement(measurement);
    setIsLogModalOpen(true);
  };

  const handleEditRoutineFromHistory = (record: RoutineRecord) => {
    setEditingRoutineRecord(record);
    setActiveTab('routine');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleEditGrowthFromHistory = (record: GrowthRecord) => {
    setEditingGrowthRecord(record);
    setActiveTab('charts');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleOpenLoveNoteModal = (stageLabel: string) => {
    setLoveNoteStageLabel(stageLabel);
    setIsLoveNoteModalOpen(true);
  };

  return (
    <div className="min-h-[100dvh] w-full bg-stone-100 dark:bg-stone-950 text-stone-900 dark:text-stone-100 flex flex-col font-sans transition-colors relative selection:bg-emerald-500 selection:text-white">
      {/* Fixed Decluttered Top Navigation Bar */}
      <Navbar
        activeTab={activeTab}
        setActiveTab={navigateToTab}
        onOpenProfileModal={openNewProfileModal}
        onOpenEditProfileModal={(profile) => openEditProfileModal(profile)}
        onOpenExportModal={() => setIsExportModalOpen(true)}
        onOpenFormulaModal={() => setIsFormulaModalOpen(true)}
        isPasswordProtected={isPasswordProtected}
        onLockPortal={onLockPortal}
      />

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-2.5 sm:px-5 lg:px-8 pt-16 pb-24 md:pb-10 transition-all">
        {activeTab === 'dashboard' && (
          <GrowthDashboardView
            onOpenLogModal={openNewLogModal}
            onNavigateTab={navigateToTab}
            onOpenProfileModal={openNewProfileModal}
            onOpenEditProfileModal={() => openEditProfileModal(activeProfile)}
            onOpenFormulaModal={() => setIsFormulaModalOpen(true)}
            onOpenLoveNoteModal={handleOpenLoveNoteModal}
            onOpenCustomMilestoneModal={() => setIsCustomMilestoneModalOpen(true)}
            onOpenExportModal={() => setIsExportModalOpen(true)}
          />
        )}

        {activeTab === 'charts' && (
          <GrowthTabView
            onOpenLogModal={openNewLogModal}
            onOpenFormulaModal={() => setIsFormulaModalOpen(true)}
            onOpenProfileModal={openNewProfileModal}
            initialEditRecord={editingGrowthRecord}
            onClearInitialEdit={() => setEditingGrowthRecord(null)}
          />
        )}

        {activeTab === 'routine' && (
          <RoutineView
            initialEditRecord={editingRoutineRecord}
            onClearInitialEdit={() => setEditingRoutineRecord(null)}
          />
        )}

        {activeTab === 'stages-milestones' && (
          <StagesAndMilestonesView
            subTab={stagesMilestonesSubTab}
            setSubTab={setStagesMilestonesSubTab}
            onOpenLoveNoteModal={handleOpenLoveNoteModal}
            onOpenFormulaModal={() => setIsFormulaModalOpen(true)}
            onOpenCustomMilestoneModal={() => setIsCustomMilestoneModalOpen(true)}
            onOpenLogModal={openNewLogModal}
            onOpenProfileModal={openNewProfileModal}
          />
        )}

        {activeTab === 'logs' && (
          <HistoryLogsView
            onOpenLogModal={openNewLogModal}
            onEditBabyMeasurement={openEditBabyMeasurementModal}
            onEditFetalMeasurement={openEditFetalMeasurementModal}
            onEditRoutineRecord={handleEditRoutineFromHistory}
            onEditGrowthRecord={handleEditGrowthFromHistory}
            onNavigateTab={navigateToTab}
            onOpenEditProfileModal={() => openEditProfileModal(activeProfile)}
            onOpenExportModal={() => setIsExportModalOpen(true)}
          />
        )}
      </main>

      {/* Mobile Bottom Tab Bar */}
      <MobileTabBar activeTab={activeTab} setActiveTab={navigateToTab} />

      {/* Modals */}
      <LogMeasurementModal
        isOpen={isLogModalOpen}
        onClose={() => {
          setIsLogModalOpen(false);
          setEditingBabyMeasurement(null);
          setEditingFetalMeasurement(null);
        }}
        onOpenFormulaModal={() => setIsFormulaModalOpen(true)}
        editingBabyMeasurement={editingBabyMeasurement}
        editingFetalMeasurement={editingFetalMeasurement}
      />

      <ProfileModal
        isOpen={isProfileModalOpen}
        onClose={() => {
          setIsProfileModalOpen(false);
          setEditingProfile(undefined);
        }}
        editingProfile={editingProfile}
      />

      <ExportReportModal
        isOpen={isExportModalOpen}
        onClose={() => setIsExportModalOpen(false)}
      />

      <AddMilestoneModal
        isOpen={isCustomMilestoneModalOpen}
        onClose={() => setIsCustomMilestoneModalOpen(false)}
      />

      <AddLoveNoteModal
        isOpen={isLoveNoteModalOpen}
        onClose={() => setIsLoveNoteModalOpen(false)}
        defaultStageLabel={loveNoteStageLabel}
      />

      <FormulaSourceModal
        isOpen={isFormulaModalOpen}
        onClose={() => setIsFormulaModalOpen(false)}
      />
    </div>
  );
}

export default function App() {
  const isProtected = isPasswordProtectionEnabled();
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(() => isUserAuthenticated());

  const handleAuthenticated = () => {
    setIsAuthenticated(true);
  };

  const handleLockPortal = () => {
    logoutUser();
    setIsAuthenticated(false);
  };

  if (isProtected && !isAuthenticated) {
    return <PasswordGate onAuthenticated={handleAuthenticated} />;
  }

  return (
    <AppProvider>
      <AppContent
        isPasswordProtected={isProtected}
        onLockPortal={handleLockPortal}
      />
    </AppProvider>
  );
}
