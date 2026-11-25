import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import {
  ChildProfile,
  Gender,
  BabyMeasurement,
  FetalMeasurement,
  CompletedMilestone,
  KickSession,
  UnitSystem,
  LoveNote,
  FormulaSettings,
  ThemeMode,
  GrowthRecord,
  NewGrowthRecordInput,
  RoutineRecord,
  NewRoutineRecordInput,
} from '../types';
import { DEFAULT_FORMULA_SETTINGS } from '../data/formulaSources';
import {
  fetchGrowthRecords,
  insertGrowthRecord,
  updateGrowthRecord,
  deleteGrowthRecord,
  subscribeToGrowth,
  fetchRoutineRecords,
  insertRoutineRecord,
  updateRoutineRecord,
  deleteRoutineRecord,
  subscribeToRoutine,
} from '../lib/careTablesStorage';
import {
  type EntryRow,
  type SettingPayload,
  fetchAllEntries,
  upsertEntry,
  upsertEntries,
  deleteEntryById,
  deleteEntriesByProfileId,
  replaceAllEntries,
  subscribeToEntries,
  parseEntryId,
  toProfileRow,
  toBabyMeasurementRow,
  toFetalMeasurementRow,
  toMilestoneRow,
  toKickSessionRow,
  toLoveNoteRow,
  toSettingRow,
  makeBabyMeasurementEntryId,
  makeFetalMeasurementEntryId,
  makeMilestoneEntryId,
  makeKickSessionEntryId,
  makeLoveNoteEntryId,
} from '../lib/entriesStorage';

export function getSystemOrTimeTheme(): ThemeMode {
  const hour = new Date().getHours();
  // Daytime is 6:00 AM (06:00) to 6:59 PM (18:59). Nighttime is 7:00 PM (19:00) to 5:59 AM.
  return hour >= 6 && hour < 19 ? 'light' : 'dark';
}

interface AppContextType {
  profiles: ChildProfile[];
  activeProfileId: string;
  activeProfile: ChildProfile | undefined;
  setActiveProfileId: (id: string) => void;
  addProfile: (profile: Omit<ChildProfile, 'id'>) => string;
  updateProfile: (id: string, updates: Partial<ChildProfile>) => void;
  deleteProfile: (id: string) => void;
  progressFetusToBaby: (params: {
    fetalProfileId: string;
    babyName: string;
    gender: Gender;
    birthDate: string;
    birthWeightKg?: number;
    birthLengthCm?: number;
    birthHeadCircumferenceCm?: number;
    notes?: string;
    attachFetalHistory: boolean;
  }) => string;
  getAttachedFetalProfile: (babyProfileId: string) => ChildProfile | undefined;
  getAttachedFetalMeasurements: (babyProfileId: string) => FetalMeasurement[];
  getAttachedKickSessions: (babyProfileId: string) => KickSession[];
  getAttachedFetalLoveNotes: (babyProfileId: string) => LoveNote[];

  theme: ThemeMode;
  setTheme: (theme: ThemeMode) => void;
  toggleTheme: () => void;
  systemOrTimeTheme: ThemeMode;

  unitSystem: UnitSystem;
  setUnitSystem: (system: UnitSystem) => void;

  formulaSettings: FormulaSettings;
  updateFormulaSettings: (updates: Partial<FormulaSettings>) => void;

  babyMeasurements: BabyMeasurement[];
  activeBabyMeasurements: BabyMeasurement[];
  addBabyMeasurement: (measurement: Omit<BabyMeasurement, 'id' | 'profileId'>) => void;
  updateBabyMeasurement: (id: string, updates: Partial<BabyMeasurement>) => void;
  deleteBabyMeasurement: (id: string) => void;

  fetalMeasurements: FetalMeasurement[];
  activeFetalMeasurements: FetalMeasurement[];
  addFetalMeasurement: (measurement: Omit<FetalMeasurement, 'id' | 'profileId'>) => void;
  updateFetalMeasurement: (id: string, updates: Partial<FetalMeasurement>) => void;
  deleteFetalMeasurement: (id: string) => void;

  completedMilestones: CompletedMilestone[];
  activeCompletedMilestones: CompletedMilestone[];
  toggleMilestone: (milestoneId: string, notes?: string, photoUrl?: string) => void;
  addCustomMilestone: (milestone: {
    title: string;
    category: CompletedMilestone['customCategory'];
    dateAchieved: string;
    notes?: string;
  }) => void;
  removeCompletedMilestone: (milestoneId: string) => void;

  kickSessions: KickSession[];
  activeKickSessions: KickSession[];
  addKickSession: (session: Omit<KickSession, 'id' | 'profileId'>) => void;
  deleteKickSession: (id: string) => void;

  loveNotes: LoveNote[];
  activeLoveNotes: LoveNote[];
  addLoveNote: (note: Omit<LoveNote, 'id' | 'profileId'>) => void;
  deleteLoveNote: (id: string) => void;

  growthRecords: GrowthRecord[];
  routineRecords: RoutineRecord[];
  isCareTablesLoading: boolean;
  refreshCareTables: () => Promise<void>;
  addGrowthRecord: (input: NewGrowthRecordInput) => Promise<{ record: GrowthRecord | null; error?: string }>;
  editGrowthRecord: (
    id: number,
    updates: NewGrowthRecordInput
  ) => Promise<{ record: GrowthRecord | null; error?: string }>;
  removeGrowthRecord: (id: number) => Promise<{ error?: string }>;
  addRoutineRecord: (input: NewRoutineRecordInput) => Promise<{ record: RoutineRecord | null; error?: string }>;
  editRoutineRecord: (
    id: number,
    updates: NewRoutineRecordInput
  ) => Promise<{ record: RoutineRecord | null; error?: string }>;
  removeRoutineRecord: (id: number) => Promise<{ error?: string }>;

  isEntriesLoading: boolean;
  exportDataJSON: () => string;
  importDataJSON: (jsonStr: string) => boolean;
  isCookieStorageEnabled: boolean;
}



function upsertById<T extends { id: string }>(
  items: T[],
  item: T,
  prependOnInsert = false
): T[] {
  const existingIndex = items.findIndex((existing) => existing.id === item.id);
  if (existingIndex >= 0) {
    const next = [...items];
    next[existingIndex] = item;
    return next;
  }
  return prependOnInsert ? [item, ...items] : [...items, item];
}

function upsertMilestone(
  items: CompletedMilestone[],
  item: CompletedMilestone
): CompletedMilestone[] {
  const existingIndex = items.findIndex(
    (m) => m.profileId === item.profileId && m.milestoneId === item.milestoneId
  );
  if (existingIndex >= 0) {
    const next = [...items];
    next[existingIndex] = item;
    return next;
  }
  return [...items, item];
}

function buildEntryRows(data: {
  profiles: ChildProfile[];
  babyMeasurements: BabyMeasurement[];
  fetalMeasurements: FetalMeasurement[];
  completedMilestones: CompletedMilestone[];
  kickSessions: KickSession[];
  loveNotes: LoveNote[];
  unitSystem: UnitSystem;
  formulaSettings: FormulaSettings;
  theme: ThemeMode;
  activeProfileId: string;
}): EntryRow[] {
  return [
    ...data.profiles.map(toProfileRow),
    ...data.babyMeasurements.map(toBabyMeasurementRow),
    ...data.fetalMeasurements.map(toFetalMeasurementRow),
    ...data.completedMilestones.map(toMilestoneRow),
    ...data.kickSessions.map(toKickSessionRow),
    ...data.loveNotes.map(toLoveNoteRow),
    toSettingRow('units', data.unitSystem),
    toSettingRow('formula_settings', data.formulaSettings),
    toSettingRow('theme', data.theme),
    toSettingRow('active_profile', data.activeProfileId),
  ];
}

const AppContext = createContext<AppContextType | undefined>(undefined);

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [profiles, setProfiles] = useState<ChildProfile[]>([]);
  const [activeProfileId, setActiveProfileIdState] = useState<string>('');

  // Theme detection: daytime (6am-7pm) = light, night (7pm-6am) = dark
  const systemOrTimeTheme = getSystemOrTimeTheme();
  const [theme, setThemeState] = useState<ThemeMode>(() => getSystemOrTimeTheme());

  const [unitSystem, setUnitSystemState] = useState<UnitSystem>('metric');
  const [formulaSettings, setFormulaSettings] = useState<FormulaSettings>(DEFAULT_FORMULA_SETTINGS);
  const [babyMeasurements, setBabyMeasurements] = useState<BabyMeasurement[]>([]);
  const [fetalMeasurements, setFetalMeasurements] = useState<FetalMeasurement[]>([]);
  const [completedMilestones, setCompletedMilestones] = useState<CompletedMilestone[]>([]);
  const [kickSessions, setKickSessions] = useState<KickSession[]>([]);
  const [loveNotes, setLoveNotes] = useState<LoveNote[]>([]);
  const [growthRecords, setGrowthRecords] = useState<GrowthRecord[]>([]);
  const [routineRecords, setRoutineRecords] = useState<RoutineRecord[]>([]);
  const [isEntriesLoading, setIsEntriesLoading] = useState<boolean>(true);
  const [isCareTablesLoading, setIsCareTablesLoading] = useState<boolean>(false);

  useEffect(() => {
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [theme]);

  const applyRemoteUpsert = useCallback((row: EntryRow) => {
    switch (row.entry_type) {
      case 'profile': {
        const profile = row.payload as ChildProfile;
        if (profile?.id) {
          setProfiles((prev) => upsertById(prev, profile));
        }
        break;
      }
      case 'baby_measurement': {
        const measurement = row.payload as BabyMeasurement;
        if (measurement?.id) {
          setBabyMeasurements((prev) => upsertById(prev, measurement));
        }
        break;
      }
      case 'fetal_measurement': {
        const measurement = row.payload as FetalMeasurement;
        if (measurement?.id) {
          setFetalMeasurements((prev) => upsertById(prev, measurement));
        }
        break;
      }
      case 'completed_milestone': {
        const milestone = row.payload as CompletedMilestone;
        if (milestone?.profileId && milestone?.milestoneId) {
          setCompletedMilestones((prev) => upsertMilestone(prev, milestone));
        }
        break;
      }
      case 'kick_session': {
        const session = row.payload as KickSession;
        if (session?.id) {
          setKickSessions((prev) => upsertById(prev, session, true));
        }
        break;
      }
      case 'love_note': {
        const note = row.payload as LoveNote;
        if (note?.id) {
          setLoveNotes((prev) => upsertById(prev, note, true));
        }
        break;
      }
      case 'setting': {
        const setting = row.payload as SettingPayload | undefined;
        if (!setting) break;
        if (setting.key === 'units' && (setting.value === 'metric' || setting.value === 'imperial')) {
          setUnitSystemState(setting.value);
        } else if (setting.key === 'formula_settings' && setting.value && typeof setting.value === 'object') {
          setFormulaSettings(setting.value as FormulaSettings);
        }
        break;
      }
    }
  }, []);

  const applyRemoteDelete = useCallback((oldRow: Partial<EntryRow> & { id?: string }) => {
    if (!oldRow.id) return;
    const parsed = parseEntryId(oldRow.id);
    if (!parsed) return;

    switch (parsed.entryType) {
      case 'profile': {
        const deletedProfileId = parsed.itemId;
        setProfiles((prev) => {
          const remaining = prev.filter((p) => p.id !== deletedProfileId);
          setActiveProfileIdState((currentActive) =>
            currentActive === deletedProfileId ? remaining[0]?.id || '' : currentActive
          );
          return remaining;
        });
        break;
      }
      case 'baby_measurement': {
        setBabyMeasurements((prev) => prev.filter((m) => m.id !== parsed.itemId));
        break;
      }
      case 'fetal_measurement': {
        setFetalMeasurements((prev) => prev.filter((m) => m.id !== parsed.itemId));
        break;
      }
      case 'completed_milestone': {
        setCompletedMilestones((prev) =>
          prev.filter(
            (m) => !(m.profileId === parsed.itemId && m.milestoneId === parsed.secondaryId)
          )
        );
        break;
      }
      case 'kick_session': {
        setKickSessions((prev) => prev.filter((k) => k.id !== parsed.itemId));
        break;
      }
      case 'love_note': {
        setLoveNotes((prev) => prev.filter((n) => n.id !== parsed.itemId));
        break;
      }
      case 'setting':
        break;
    }
  }, []);

  // Load initial state from Supabase "entries" table and subscribe to live realtime updates
  useEffect(() => {
    let isMounted = true;

    const hydrateFromSupabase = async () => {
      setIsEntriesLoading(true);
      try {
        const rows = await fetchAllEntries();
        if (!isMounted || rows === null) return;

        const loadedProfiles: ChildProfile[] = [];
        const loadedBabyMeasurements: BabyMeasurement[] = [];
        const loadedFetalMeasurements: FetalMeasurement[] = [];
        const loadedMilestones: CompletedMilestone[] = [];
        const loadedKicks: KickSession[] = [];
        const loadedLoveNotes: LoveNote[] = [];
        let loadedTheme: ThemeMode | null = null;
        let loadedUnits: UnitSystem | null = null;
        let loadedFormulaSettings: FormulaSettings | null = null;
        let loadedActiveProfileId: string | null = null;

        for (const row of rows) {
          switch (row.entry_type) {
            case 'profile':
              if (row.payload) loadedProfiles.push(row.payload as ChildProfile);
              break;
            case 'baby_measurement':
              if (row.payload) loadedBabyMeasurements.push(row.payload as BabyMeasurement);
              break;
            case 'fetal_measurement':
              if (row.payload) loadedFetalMeasurements.push(row.payload as FetalMeasurement);
              break;
            case 'completed_milestone':
              if (row.payload) loadedMilestones.push(row.payload as CompletedMilestone);
              break;
            case 'kick_session':
              if (row.payload) loadedKicks.push(row.payload as KickSession);
              break;
            case 'love_note':
              if (row.payload) loadedLoveNotes.push(row.payload as LoveNote);
              break;
            case 'setting': {
              const setting = row.payload as SettingPayload | undefined;
              if (!setting) break;
              if (setting.key === 'theme' && (setting.value === 'light' || setting.value === 'dark')) {
                loadedTheme = setting.value;
              } else if (setting.key === 'units' && (setting.value === 'metric' || setting.value === 'imperial')) {
                loadedUnits = setting.value;
              } else if (setting.key === 'formula_settings' && setting.value && typeof setting.value === 'object') {
                loadedFormulaSettings = setting.value as FormulaSettings;
              } else if (setting.key === 'active_profile' && typeof setting.value === 'string') {
                loadedActiveProfileId = setting.value;
              }
              break;
            }
          }
        }

        if (!isMounted) return;

        setProfiles(loadedProfiles);
        setBabyMeasurements(loadedBabyMeasurements);
        setFetalMeasurements(loadedFetalMeasurements);
        setCompletedMilestones(loadedMilestones);
        setKickSessions(loadedKicks.reverse());
        setLoveNotes(loadedLoveNotes.reverse());

        if (loadedTheme) setThemeState(loadedTheme);
        if (loadedUnits) setUnitSystemState(loadedUnits);
        if (loadedFormulaSettings) setFormulaSettings(loadedFormulaSettings);

        if (loadedActiveProfileId && loadedProfiles.some((p) => p.id === loadedActiveProfileId)) {
          setActiveProfileIdState(loadedActiveProfileId);
        } else {
          setActiveProfileIdState(loadedProfiles[0]?.id || '');
        }
      } finally {
        if (isMounted) setIsEntriesLoading(false);
      }
    };

    const loadCareTables = async () => {
      setIsCareTablesLoading(true);
      try {
        const [loadedGrowth, loadedRoutine] = await Promise.all([
          fetchGrowthRecords(),
          fetchRoutineRecords(),
        ]);
        if (!isMounted) return;
        if (loadedGrowth !== null) setGrowthRecords(loadedGrowth);
        if (loadedRoutine !== null) setRoutineRecords(loadedRoutine);
      } finally {
        if (isMounted) setIsCareTablesLoading(false);
      }
    };

    void hydrateFromSupabase();
    void loadCareTables();

    const unsubscribeEntries = subscribeToEntries({
      onUpsert: applyRemoteUpsert,
      onDelete: applyRemoteDelete,
    });

    const unsubscribeGrowth = subscribeToGrowth({
      onUpsert: (record) => {
        setGrowthRecords((prev) => {
          const exists = prev.some((r) => r.id === record.id);
          const next = exists
            ? prev.map((r) => (r.id === record.id ? record : r))
            : [record, ...prev];
          return next.sort(
            (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
          );
        });
      },
      onDelete: (id) => {
        setGrowthRecords((prev) => prev.filter((r) => r.id !== id));
      },
    });

    const unsubscribeRoutine = subscribeToRoutine({
      onUpsert: (record) => {
        setRoutineRecords((prev) => {
          const exists = prev.some((r) => r.id === record.id);
          const next = exists
            ? prev.map((r) => (r.id === record.id ? record : r))
            : [record, ...prev];
          return next.sort((a, b) => {
            const aKey = `${a.date ?? a.created_at.slice(0, 10)}T${a.time ?? a.created_at.slice(11, 19)}`;
            const bKey = `${b.date ?? b.created_at.slice(0, 10)}T${b.time ?? b.created_at.slice(11, 19)}`;
            return bKey.localeCompare(aKey);
          });
        });
      },
      onDelete: (id) => {
        setRoutineRecords((prev) => prev.filter((r) => r.id !== id));
      },
    });

    return () => {
      isMounted = false;
      unsubscribeEntries();
      unsubscribeGrowth();
      unsubscribeRoutine();
    };
  }, [applyRemoteUpsert, applyRemoteDelete]);

  const setActiveProfileId = (id: string) => {
    setActiveProfileIdState(id);
    void upsertEntry(toSettingRow('active_profile', id));
  };

  const setTheme = (newTheme: ThemeMode) => {
    setThemeState(newTheme);
    void upsertEntry(toSettingRow('theme', newTheme));
  };

  const toggleTheme = () => {
    setTheme(theme === 'dark' ? 'light' : 'dark');
  };

  const activeProfile = profiles.find((p) => p.id === activeProfileId) || profiles[0];

  const activeBabyMeasurements = babyMeasurements
    .filter((m) => m.profileId === activeProfileId)
    .sort((a, b) => a.ageInMonths - b.ageInMonths);

  const activeFetalMeasurements = fetalMeasurements
    .filter((m) => m.profileId === activeProfileId)
    .sort((a, b) => a.gestationalWeeks * 7 + a.gestationalDays - (b.gestationalWeeks * 7 + b.gestationalDays));

  const activeCompletedMilestones = completedMilestones.filter((m) => m.profileId === activeProfileId);
  const activeKickSessions = kickSessions.filter((k) => k.profileId === activeProfileId);
  const activeLoveNotes = loveNotes.filter((n) => n.profileId === activeProfileId);

  const setUnitSystem = (system: UnitSystem) => {
    setUnitSystemState(system);
    void upsertEntry(toSettingRow('units', system));
  };

  const updateFormulaSettings = (updates: Partial<FormulaSettings>) => {
    const nextSettings: FormulaSettings = { ...formulaSettings, ...updates };
    setFormulaSettings(nextSettings);
    void upsertEntry(toSettingRow('formula_settings', nextSettings));
  };

  const addProfile = (profileData: Omit<ChildProfile, 'id'>): string => {
    const newId = `profile-${Date.now()}`;
    const newProfile: ChildProfile = { ...profileData, id: newId };
    const rowsToUpsert: EntryRow[] = [
      toProfileRow(newProfile),
      toSettingRow('active_profile', newId),
    ];

    setProfiles((prev) => upsertById(prev, newProfile));
    setActiveProfileIdState(newId);

    if (
      newProfile.type === 'baby' &&
      (newProfile.birthWeightKg !== undefined ||
        newProfile.birthLengthCm !== undefined ||
        newProfile.birthHeadCircumferenceCm !== undefined)
    ) {
      const birthMeasurement: BabyMeasurement = {
        id: `bm-birth-${Date.now()}`,
        profileId: newId,
        date: newProfile.dateOfEvent,
        ageInMonths: 0,
        ageInWeeks: 0,
        weightKg: newProfile.birthWeightKg,
        lengthCm: newProfile.birthLengthCm,
        headCircumferenceCm: newProfile.birthHeadCircumferenceCm,
        pediatricianVisit: true,
        notes: 'Birth measurement',
      };
      setBabyMeasurements((prev) => upsertById(prev, birthMeasurement));
      rowsToUpsert.push(toBabyMeasurementRow(birthMeasurement));
    }

    void upsertEntries(rowsToUpsert);
    return newId;
  };

  const updateProfile = (id: string, updates: Partial<ChildProfile>) => {
    const existing = profiles.find((p) => p.id === id);
    if (!existing) return;
    const updated: ChildProfile = { ...existing, ...updates };
    setProfiles((prev) => prev.map((p) => (p.id === id ? updated : p)));

    const rowsToUpsert: EntryRow[] = [toProfileRow(updated)];

    if (updated.type === 'baby') {
      const birthDateChanged =
        updates.dateOfEvent !== undefined && updates.dateOfEvent !== existing.dateOfEvent;
      const birthStatsChanged =
        'birthWeightKg' in updates ||
        'birthLengthCm' in updates ||
        'birthHeadCircumferenceCm' in updates;

      if (birthDateChanged || birthStatsChanged) {
        const profileMeasurements = babyMeasurements.filter((m) => m.profileId === id);
        const existingBirthRecord = profileMeasurements.find((m) => m.ageInMonths === 0);
        const updatedMeasurementsById = new Map<string, BabyMeasurement>();

        if (existingBirthRecord) {
          const syncedBirth: BabyMeasurement = {
            ...existingBirthRecord,
            date: updated.dateOfEvent,
            weightKg:
              'birthWeightKg' in updates ? updated.birthWeightKg : existingBirthRecord.weightKg,
            lengthCm:
              'birthLengthCm' in updates ? updated.birthLengthCm : existingBirthRecord.lengthCm,
            headCircumferenceCm:
              'birthHeadCircumferenceCm' in updates
                ? updated.birthHeadCircumferenceCm
                : existingBirthRecord.headCircumferenceCm,
          };
          updatedMeasurementsById.set(syncedBirth.id, syncedBirth);
          rowsToUpsert.push(toBabyMeasurementRow(syncedBirth));
        } else if (
          updated.birthWeightKg !== undefined ||
          updated.birthLengthCm !== undefined ||
          updated.birthHeadCircumferenceCm !== undefined
        ) {
          const newBirthRecord: BabyMeasurement = {
            id: `bm-birth-${Date.now()}`,
            profileId: id,
            date: updated.dateOfEvent,
            ageInMonths: 0,
            ageInWeeks: 0,
            weightKg: updated.birthWeightKg,
            lengthCm: updated.birthLengthCm,
            headCircumferenceCm: updated.birthHeadCircumferenceCm,
            pediatricianVisit: true,
            notes: 'Birth measurement',
          };
          updatedMeasurementsById.set(newBirthRecord.id, newBirthRecord);
          rowsToUpsert.push(toBabyMeasurementRow(newBirthRecord));
        }

        if (birthDateChanged) {
          const birthMs = new Date(updated.dateOfEvent).getTime();
          if (!Number.isNaN(birthMs)) {
            for (const m of profileMeasurements) {
              if (existingBirthRecord && m.id === existingBirthRecord.id) continue;
              const measMs = new Date(m.date).getTime();
              if (Number.isNaN(measMs)) continue;
              const diffDays = Math.max(0, Math.floor((measMs - birthMs) / (1000 * 60 * 60 * 24)));
              const recalculated: BabyMeasurement = {
                ...m,
                ageInMonths: Math.round((diffDays / 30.4375) * 10) / 10,
                ageInWeeks: Math.round((diffDays / 7) * 10) / 10,
              };
              updatedMeasurementsById.set(recalculated.id, recalculated);
              rowsToUpsert.push(toBabyMeasurementRow(recalculated));
            }
          }
        }

        if (updatedMeasurementsById.size > 0) {
          setBabyMeasurements((prev) => {
            const next = prev.map((m) => updatedMeasurementsById.get(m.id) ?? m);
            for (const [mId, record] of updatedMeasurementsById.entries()) {
              if (!next.some((m) => m.id === mId)) {
                next.push(record);
              }
            }
            return next;
          });
        }
      }
    }

    void upsertEntries(rowsToUpsert);
  };

  const deleteProfile = (id: string) => {
    const remaining = profiles.filter((p) => p.id !== id);
    setProfiles(remaining);

    const nextActiveId = activeProfileId === id ? remaining[0]?.id || '' : activeProfileId;
    if (activeProfileId === id) {
      setActiveProfileIdState(nextActiveId);
    }

    // Clean up stored records associated with this profile
    setBabyMeasurements((prev) => prev.filter((m) => m.profileId !== id));
    setFetalMeasurements((prev) => prev.filter((m) => m.profileId !== id));
    setCompletedMilestones((prev) => prev.filter((m) => m.profileId !== id));
    setKickSessions((prev) => prev.filter((k) => k.profileId !== id));
    setLoveNotes((prev) => prev.filter((n) => n.profileId !== id));

    void deleteEntriesByProfileId(id).then(() => {
      if (activeProfileId === id) {
        return upsertEntry(toSettingRow('active_profile', nextActiveId));
      }
      return undefined;
    });
  };

  const progressFetusToBaby = (params: {
    fetalProfileId: string;
    babyName: string;
    gender: Gender;
    birthDate: string;
    birthWeightKg?: number;
    birthLengthCm?: number;
    birthHeadCircumferenceCm?: number;
    notes?: string;
    attachFetalHistory: boolean;
  }): string => {
    const fetus = profiles.find((p) => p.id === params.fetalProfileId);
    const newBabyId = `baby-${Date.now()}`;

    // Compute prenatal snapshot from fetal measurements & kicks
    const fMeasurements = fetalMeasurements.filter((m) => m.profileId === params.fetalProfileId);
    const fKicks = kickSessions.filter((k) => k.profileId === params.fetalProfileId);
    const lastScan = fMeasurements.length > 0 ? fMeasurements[fMeasurements.length - 1] : undefined;
    const totalKicksLogged = fKicks.reduce((acc, k) => acc + (k.kicksCount || 0), 0);

    const snapshot =
      params.attachFetalHistory && fetus
        ? {
            fetalProfileId: fetus.id,
            fetalName: fetus.name,
            dueDate: fetus.dateOfEvent,
            totalUltrasoundScans: fMeasurements.length,
            totalKickSessions: fKicks.length,
            totalKicksLogged,
            lastGestationalWeeks: lastScan?.gestationalWeeks,
            lastGestationalDays: lastScan?.gestationalDays,
            lastEfwGrams: lastScan?.efwGrams,
            scanLocation: lastScan?.scanLocation,
            notes: fetus.notes,
          }
        : undefined;

    const newBaby: ChildProfile = {
      id: newBabyId,
      name: params.babyName.trim(),
      type: 'baby',
      gender: params.gender,
      dateOfEvent: params.birthDate,
      birthWeightKg: params.birthWeightKg,
      birthLengthCm: params.birthLengthCm,
      birthHeadCircumferenceCm: params.birthHeadCircumferenceCm,
      notes: params.notes?.trim() || undefined,
      avatarColor: params.gender === 'girl' ? 'bg-rose-600' : 'bg-emerald-600',
      avatarIcon: 'Baby',
      attachedFetalProfileId: params.attachFetalHistory ? params.fetalProfileId : undefined,
      prenatalSnapshot: snapshot,
    };

    const rowsToUpsert: EntryRow[] = [
      toProfileRow(newBaby),
      toSettingRow('active_profile', newBabyId),
    ];

    const updatedFetus: ChildProfile | null =
      fetus && params.attachFetalHistory
        ? {
            ...fetus,
            attachedToBabyId: newBabyId,
            isArchivedFetus: true,
            graduatedAt: new Date().toISOString(),
          }
        : null;

    if (updatedFetus) {
      rowsToUpsert.push(toProfileRow(updatedFetus));
    }

    // Update profiles: add new baby, and if attached, update fetus with attachedToBabyId & isArchivedFetus
    setProfiles((prev) => {
      const updatedPrev = prev.map((p) => (updatedFetus && p.id === updatedFetus.id ? updatedFetus : p));
      return upsertById(updatedPrev, newBaby);
    });

    // Add baseline newborn measurement if values provided
    if (params.birthWeightKg || params.birthLengthCm || params.birthHeadCircumferenceCm) {
      const birthMeasurement: BabyMeasurement = {
        id: `bm-${Date.now()}`,
        profileId: newBabyId,
        date: params.birthDate,
        ageInMonths: 0,
        ageInWeeks: 0,
        weightKg: params.birthWeightKg,
        lengthCm: params.birthLengthCm,
        headCircumferenceCm: params.birthHeadCircumferenceCm,
        pediatricianVisit: true,
        notes: 'Birth checkup recorded upon delivery',
      };
      setBabyMeasurements((prev) => upsertById(prev, birthMeasurement));
      rowsToUpsert.push(toBabyMeasurementRow(birthMeasurement));
    }

    // Add welcome love note
    const welcomeNote: LoveNote = {
      id: `note-${Date.now()}`,
      profileId: newBabyId,
      date: params.birthDate,
      stageLabel: 'Birth Day 🎉',
      author: 'Family',
      emoji: '🌟',
      content: `Welcome to the world, precious ${params.babyName.trim()}! You arrived safely on ${params.birthDate}, filling all our hearts with boundless love and joy.`,
    };
    setLoveNotes((prev) => upsertById(prev, welcomeNote, true));
    rowsToUpsert.push(toLoveNoteRow(welcomeNote));

    // Set active profile to the newborn baby
    setActiveProfileIdState(newBabyId);
    void upsertEntries(rowsToUpsert);

    return newBabyId;
  };

  const getAttachedFetalProfile = (babyProfileId: string): ChildProfile | undefined => {
    const baby = profiles.find((p) => p.id === babyProfileId);
    if (!baby?.attachedFetalProfileId) return undefined;
    return profiles.find((p) => p.id === baby.attachedFetalProfileId);
  };

  const getAttachedFetalMeasurements = (babyProfileId: string): FetalMeasurement[] => {
    const baby = profiles.find((p) => p.id === babyProfileId);
    if (!baby?.attachedFetalProfileId) return [];
    return fetalMeasurements
      .filter((m) => m.profileId === baby.attachedFetalProfileId)
      .sort((a, b) => a.gestationalWeeks * 7 + a.gestationalDays - (b.gestationalWeeks * 7 + b.gestationalDays));
  };

  const getAttachedKickSessions = (babyProfileId: string): KickSession[] => {
    const baby = profiles.find((p) => p.id === babyProfileId);
    if (!baby?.attachedFetalProfileId) return [];
    return kickSessions.filter((k) => k.profileId === baby.attachedFetalProfileId);
  };

  const getAttachedFetalLoveNotes = (babyProfileId: string): LoveNote[] => {
    const baby = profiles.find((p) => p.id === babyProfileId);
    if (!baby?.attachedFetalProfileId) return [];
    return loveNotes.filter((n) => n.profileId === baby.attachedFetalProfileId);
  };

  const addBabyMeasurement = (measurement: Omit<BabyMeasurement, 'id' | 'profileId'>) => {
    const newM: BabyMeasurement = {
      ...measurement,
      id: `bm-${Date.now()}`,
      profileId: activeProfileId,
    };
    setBabyMeasurements((prev) => upsertById(prev, newM));
    void upsertEntry(toBabyMeasurementRow(newM));
  };

  const updateBabyMeasurement = (id: string, updates: Partial<BabyMeasurement>) => {
    const existing = babyMeasurements.find((m) => m.id === id);
    if (!existing) return;
    const updated: BabyMeasurement = { ...existing, ...updates };
    setBabyMeasurements((prev) => prev.map((m) => (m.id === id ? updated : m)));
    void upsertEntry(toBabyMeasurementRow(updated));
  };

  const deleteBabyMeasurement = (id: string) => {
    setBabyMeasurements((prev) => prev.filter((m) => m.id !== id));
    void deleteEntryById(makeBabyMeasurementEntryId(id));
  };

  const addFetalMeasurement = (measurement: Omit<FetalMeasurement, 'id' | 'profileId'>) => {
    const newM: FetalMeasurement = {
      ...measurement,
      id: `fm-${Date.now()}`,
      profileId: activeProfileId,
    };
    setFetalMeasurements((prev) => upsertById(prev, newM));
    void upsertEntry(toFetalMeasurementRow(newM));
  };

  const updateFetalMeasurement = (id: string, updates: Partial<FetalMeasurement>) => {
    const existing = fetalMeasurements.find((m) => m.id === id);
    if (!existing) return;
    const updated: FetalMeasurement = { ...existing, ...updates };
    setFetalMeasurements((prev) => prev.map((m) => (m.id === id ? updated : m)));
    void upsertEntry(toFetalMeasurementRow(updated));
  };

  const deleteFetalMeasurement = (id: string) => {
    setFetalMeasurements((prev) => prev.filter((m) => m.id !== id));
    void deleteEntryById(makeFetalMeasurementEntryId(id));
  };

  const toggleMilestone = (milestoneId: string, notes?: string, photoUrl?: string) => {
    const exists = completedMilestones.find(
      (m) => m.profileId === activeProfileId && m.milestoneId === milestoneId
    );
    if (exists) {
      setCompletedMilestones((prev) =>
        prev.filter((m) => !(m.profileId === activeProfileId && m.milestoneId === milestoneId))
      );
      void deleteEntryById(makeMilestoneEntryId(activeProfileId, milestoneId));
    } else {
      const todayStr = new Date().toISOString().split('T')[0];
      const newMilestone: CompletedMilestone = {
        milestoneId,
        profileId: activeProfileId,
        dateAchieved: todayStr,
        notes,
        photoUrl,
      };
      setCompletedMilestones((prev) => upsertMilestone(prev, newMilestone));
      void upsertEntry(toMilestoneRow(newMilestone));
    }
  };

  const addCustomMilestone = (milestone: {
    title: string;
    category: CompletedMilestone['customCategory'];
    dateAchieved: string;
    notes?: string;
  }) => {
    const customId = `custom-${Date.now()}`;
    const newMilestone: CompletedMilestone = {
      milestoneId: customId,
      profileId: activeProfileId,
      dateAchieved: milestone.dateAchieved,
      isCustom: true,
      customTitle: milestone.title,
      customCategory: milestone.category,
      notes: milestone.notes,
    };
    setCompletedMilestones((prev) => upsertMilestone(prev, newMilestone));
    void upsertEntry(toMilestoneRow(newMilestone));
  };

  const removeCompletedMilestone = (milestoneId: string) => {
    setCompletedMilestones((prev) =>
      prev.filter((m) => !(m.profileId === activeProfileId && m.milestoneId === milestoneId))
    );
    void deleteEntryById(makeMilestoneEntryId(activeProfileId, milestoneId));
  };

  const addKickSession = (session: Omit<KickSession, 'id' | 'profileId'>) => {
    const newSession: KickSession = {
      ...session,
      id: `kick-${Date.now()}`,
      profileId: activeProfileId,
    };
    setKickSessions((prev) => upsertById(prev, newSession, true));
    void upsertEntry(toKickSessionRow(newSession));
  };

  const deleteKickSession = (id: string) => {
    setKickSessions((prev) => prev.filter((k) => k.id !== id));
    void deleteEntryById(makeKickSessionEntryId(id));
  };

  const addLoveNote = (note: Omit<LoveNote, 'id' | 'profileId'>) => {
    const newNote: LoveNote = {
      ...note,
      id: `note-${Date.now()}`,
      profileId: activeProfileId,
    };
    setLoveNotes((prev) => upsertById(prev, newNote, true));
    void upsertEntry(toLoveNoteRow(newNote));
  };

  const deleteLoveNote = (id: string) => {
    setLoveNotes((prev) => prev.filter((n) => n.id !== id));
    void deleteEntryById(makeLoveNoteEntryId(id));
  };



  const refreshCareTables = useCallback(async () => {
    setIsCareTablesLoading(true);
    try {
      const [loadedGrowth, loadedRoutine] = await Promise.all([
        fetchGrowthRecords(),
        fetchRoutineRecords(),
      ]);
      if (loadedGrowth !== null) setGrowthRecords(loadedGrowth);
      if (loadedRoutine !== null) setRoutineRecords(loadedRoutine);
    } finally {
      setIsCareTablesLoading(false);
    }
  }, []);

  const addGrowthRecord = async (
    input: NewGrowthRecordInput
  ): Promise<{ record: GrowthRecord | null; error?: string }> => {
    const result = await insertGrowthRecord(input);
    if (result.record) {
      const created = result.record;
      setGrowthRecords((prev) => {
        const exists = prev.some((r) => r.id === created.id);
        const next = exists ? prev.map((r) => (r.id === created.id ? created : r)) : [created, ...prev];
        return next.sort(
          (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        );
      });
    }
    return result;
  };

  const editGrowthRecord = async (
    id: number,
    updates: NewGrowthRecordInput
  ): Promise<{ record: GrowthRecord | null; error?: string }> => {
    const result = await updateGrowthRecord(id, updates);
    if (result.record) {
      const updated = result.record;
      setGrowthRecords((prev) => prev.map((r) => (r.id === id ? updated : r)));
    } else if (!result.error) {
      setGrowthRecords((prev) =>
        prev.map((r) =>
          r.id === id
            ? {
                ...r,
                daily_weight: 'daily_weight' in updates ? (updates.daily_weight ?? null) : r.daily_weight,
                daily_length: 'daily_length' in updates ? (updates.daily_length ?? null) : r.daily_length,
                temperature: 'temperature' in updates ? (updates.temperature ?? null) : r.temperature,
                remark: 'remark' in updates ? (updates.remark ?? null) : r.remark,
                name: 'name' in updates ? (updates.name ?? null) : r.name,
              }
            : r
        )
      );
    }
    return result;
  };

  const removeGrowthRecord = async (id: number): Promise<{ error?: string }> => {
    setGrowthRecords((prev) => prev.filter((r) => r.id !== id));
    return deleteGrowthRecord(id);
  };

  const addRoutineRecord = async (
    input: NewRoutineRecordInput
  ): Promise<{ record: RoutineRecord | null; error?: string }> => {
    const result = await insertRoutineRecord(input);
    if (result.record) {
      const created = result.record;
      setRoutineRecords((prev) => {
        const exists = prev.some((r) => r.id === created.id);
        const next = exists ? prev.map((r) => (r.id === created.id ? created : r)) : [created, ...prev];
        return next.sort((a, b) => {
          const aKey = `${a.date ?? a.created_at.slice(0, 10)}T${a.time ?? a.created_at.slice(11, 19)}`;
          const bKey = `${b.date ?? b.created_at.slice(0, 10)}T${b.time ?? b.created_at.slice(11, 19)}`;
          return bKey.localeCompare(aKey);
        });
      });
    }
    return result;
  };

  const editRoutineRecord = async (
    id: number,
    updates: NewRoutineRecordInput
  ): Promise<{ record: RoutineRecord | null; error?: string }> => {
    const result = await updateRoutineRecord(id, updates);
    if (result.record) {
      const updated = result.record;
      setRoutineRecords((prev) => prev.map((r) => (r.id === id ? updated : r)));
    } else if (!result.error) {
      setRoutineRecords((prev) =>
        prev.map((r) =>
          r.id === id
            ? {
                ...r,
                date: 'date' in updates ? (updates.date ?? null) : r.date,
                time: 'time' in updates ? (updates.time ?? null) : r.time,
                'EBM (mL)': 'EBM (mL)' in updates ? (updates['EBM (mL)'] ?? null) : r['EBM (mL)'],
                'Formula (mL)':
                  'Formula (mL)' in updates ? (updates['Formula (mL)'] ?? null) : r['Formula (mL)'],
                Diaper: 'Diaper' in updates ? (updates.Diaper ?? null) : r.Diaper,
                name: 'name' in updates ? (updates.name ?? null) : r.name,
                remark: 'remark' in updates ? (updates.remark ?? null) : r.remark,
                'feed duration (min)':
                  'feed duration (min)' in updates
                    ? (updates['feed duration (min)'] ?? null)
                    : r['feed duration (min)'],
              }
            : r
        )
      );
    }
    return result;
  };

  const removeRoutineRecord = async (id: number): Promise<{ error?: string }> => {
    setRoutineRecords((prev) => prev.filter((r) => r.id !== id));
    return deleteRoutineRecord(id);
  };

  const exportDataJSON = (): string => {
    const fullData = {
      version: '1.0.0',
      exportedAt: new Date().toISOString(),
      profiles,
      babyMeasurements,
      fetalMeasurements,
      completedMilestones,
      kickSessions,
      loveNotes,
      growthRecords,
      routineRecords,
      unitSystem,
    };
    return JSON.stringify(fullData, null, 2);
  };

  const importDataJSON = (jsonStr: string): boolean => {
    try {
      const data = JSON.parse(jsonStr);
      const nextProfiles = Array.isArray(data.profiles) ? data.profiles : profiles;
      const nextBaby = Array.isArray(data.babyMeasurements) ? data.babyMeasurements : babyMeasurements;
      const nextFetal = Array.isArray(data.fetalMeasurements) ? data.fetalMeasurements : fetalMeasurements;
      const nextMilestones = Array.isArray(data.completedMilestones)
        ? data.completedMilestones
        : completedMilestones;
      const nextKicks = Array.isArray(data.kickSessions) ? data.kickSessions : kickSessions;
      const nextNotes = Array.isArray(data.loveNotes) ? data.loveNotes : loveNotes;
      const nextUnits: UnitSystem =
        data.unitSystem === 'imperial' || data.unitSystem === 'metric'
          ? data.unitSystem
          : unitSystem;
      const nextActiveId = data.profiles?.[0]?.id || activeProfileId;

      setProfiles(nextProfiles);
      setBabyMeasurements(nextBaby);
      setFetalMeasurements(nextFetal);
      setCompletedMilestones(nextMilestones);
      setKickSessions(nextKicks);
      setLoveNotes(nextNotes);
      setUnitSystemState(nextUnits);
      setActiveProfileIdState(nextActiveId);

      const rows = buildEntryRows({
        profiles: nextProfiles,
        babyMeasurements: nextBaby,
        fetalMeasurements: nextFetal,
        completedMilestones: nextMilestones,
        kickSessions: nextKicks,
        loveNotes: nextNotes,
        unitSystem: nextUnits,
        formulaSettings,
        theme,
        activeProfileId: nextActiveId,
      });
      void replaceAllEntries(rows);
      return true;
    } catch (e) {
      console.error('Import failed', e);
      return false;
    }
  };

  return (
    <AppContext.Provider
      value={{
        profiles,
        activeProfileId,
        activeProfile,
        setActiveProfileId,
        addProfile,
        updateProfile,
        deleteProfile,
        progressFetusToBaby,
        getAttachedFetalProfile,
        getAttachedFetalMeasurements,
        getAttachedKickSessions,
        getAttachedFetalLoveNotes,
        theme,
        setTheme,
        toggleTheme,
        systemOrTimeTheme,
        unitSystem,
        setUnitSystem,
        formulaSettings,
        updateFormulaSettings,
        babyMeasurements,
        activeBabyMeasurements,
        addBabyMeasurement,
        updateBabyMeasurement,
        deleteBabyMeasurement,
        fetalMeasurements,
        activeFetalMeasurements,
        addFetalMeasurement,
        updateFetalMeasurement,
        deleteFetalMeasurement,
        completedMilestones,
        activeCompletedMilestones,
        toggleMilestone,
        addCustomMilestone,
        removeCompletedMilestone,
        kickSessions,
        activeKickSessions,
        addKickSession,
        deleteKickSession,
        loveNotes,
        activeLoveNotes,
        addLoveNote,
        deleteLoveNote,
        growthRecords,
        routineRecords,
        isCareTablesLoading,
        refreshCareTables,
        addGrowthRecord,
        editGrowthRecord,
        removeGrowthRecord,
        addRoutineRecord,
        editRoutineRecord,
        removeRoutineRecord,
        isEntriesLoading,
        exportDataJSON,
        importDataJSON,
        isCookieStorageEnabled: false,
      }}
    >
      {children}
    </AppContext.Provider>
  );
};

export const useApp = () => {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useApp must be used within an AppProvider');
  }
  return context;
};
