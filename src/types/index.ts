export type ProfileType = 'fetal' | 'baby';
export type Gender = 'boy' | 'girl' | 'undisclosed';
export type UnitSystem = 'metric' | 'imperial';
export type ThemeMode = 'light' | 'dark';

export interface PrenatalSnapshot {
  fetalProfileId: string;
  fetalName: string;
  dueDate: string;
  totalUltrasoundScans: number;
  totalKickSessions: number;
  totalKicksLogged: number;
  lastGestationalWeeks?: number;
  lastGestationalDays?: number;
  lastEfwGrams?: number;
  scanLocation?: string;
  notes?: string;
}

export interface ChildProfile {
  id: string;
  name: string;
  type: ProfileType;
  gender: Gender;
  // For baby: birthDate; for fetal: dueDate
  dateOfEvent: string; 
  prePregnancyWeightKg?: number;
  maternalHeightCm?: number;
  birthWeightKg?: number;
  birthLengthCm?: number;
  birthHeadCircumferenceCm?: number;
  notes?: string;
  loggedBy?: string; // Person who created/logged this profile entry (`entries.name`)
  avatarColor: string;
  avatarIcon: string;
  // Attached fetal profile linkage
  attachedFetalProfileId?: string; // Present on baby profiles that graduated from a pregnancy
  attachedToBabyId?: string;       // Present on fetal profiles that graduated into a baby profile
  isArchivedFetus?: boolean;       // Set to true when graduated so it acts as an in-womb history archive
  graduatedAt?: string;            // Timestamp of when graduation occurred
  prenatalSnapshot?: PrenatalSnapshot; // Quick summary snapshot of the in-womb journey
}

export interface BabyMeasurement {
  id: string;
  profileId: string;
  date: string;
  ageInDays?: number;
  ageInMonths: number;
  ageInWeeks?: number;
  weightKg?: number;
  lengthCm?: number;
  headCircumferenceCm?: number;
  pediatricianVisit?: boolean;
  notes?: string;
  loggedBy?: string;
}

export type FetalFormulaId = 'hadlock4' | 'hadlock3' | 'shepard' | 'intergrowth21' | 'custom';
export type GestationalMethodId = 'naegele' | 'mittendorf' | 'customDays';
export type GrowthStandardId = 'who' | 'cdc';

export interface CustomFormulaConfig {
  name: string;
  equationDescription: string;
  baseIntercept: number;
  acCoeff: number;
  flCoeff: number;
  hcCoeff: number;
  bpdCoeff: number;
  acFlInteractionCoeff: number;
}

export interface FormulaSettings {
  fetalEfwFormula: FetalFormulaId;
  gestationalMethod: GestationalMethodId;
  customGestationalDays: number;
  growthStandard: GrowthStandardId;
  customFormula: CustomFormulaConfig;
}

export interface FetalMeasurement {
  id: string;
  profileId: string;
  date: string;
  gestationalWeeks: number;
  gestationalDays: number;
  efwGrams?: number; // Estimated Fetal Weight
  crlMm?: number; // Crown-Rump Length
  bpdMm?: number; // Biparietal Diameter
  hcMm?: number;  // Head Circumference
  acMm?: number;  // Abdominal Circumference
  flMm?: number;  // Femur Length
  fundalHeightCm?: number;
  maternalWeightKg?: number;
  notes?: string;
  scanLocation?: string;
  loggedBy?: string;
}

export type MilestoneCategory = 'social' | 'language' | 'cognitive' | 'movement';

export interface MilestoneItem {
  id: string;
  category: MilestoneCategory;
  ageMonthBracket: number; // 2, 4, 6, 9, 12, 15, 18, 24, 30, 36
  title: string;
  description: string;
  tips?: string;
  recommendation?: string;
  whenToConsult?: string;
}

export interface CompletedMilestone {
  milestoneId: string;
  profileId: string;
  dateAchieved: string;
  notes?: string;
  photoUrl?: string;
  isCustom?: boolean;
  customTitle?: string;
  customCategory?: MilestoneCategory;
  loggedBy?: string;
}

export interface KickSession {
  id: string;
  profileId: string;
  date: string;
  startTime: string;
  durationSeconds: number;
  kicksCount: number;
  targetReached: boolean;
  notes?: string;
  loggedBy?: string;
}

export interface GrowthPercentiles {
  p3: number;
  p15: number;
  p50: number;
  p85: number;
  p97: number;
}

export interface LoveNote {
  id: string;
  profileId: string;
  date: string;
  stageLabel: string; // e.g. "Week 28", "Month 6", "Birth Day"
  author: string; // e.g. "Mama & Papa"
  content: string;
  emoji?: string;
}

/**
 * Matches Supabase Postgres table: public."growth"
 * `profile_id` links to the active profile from `entries`; `name` is the person logging the entry.
 */
export interface GrowthRecord {
  id: number;
  created_at: string;
  profile_id: string | null;
  date: string | null;
  time: string | null;
  daily_weight: number | null;
  daily_length: number | null;
  temperature: number | null;
  remark: string | null;
  name: string | null;
}

export interface NewGrowthRecordInput {
  profile_id?: string | null;
  date?: string | null;
  time?: string | null;
  daily_weight?: number | null;
  daily_length?: number | null;
  temperature?: number | null;
  remark?: string | null;
  name?: string | null;
}

/**
 * Matches Supabase Postgres table: public."routine"
 * `profile_id` links to the active profile from `entries`; `name` is the person logging the entry.
 */
export interface RoutineRecord {
  id: number;
  created_at: string;
  profile_id: string | null;
  date: string | null;
  time: string | null;
  emb_mL: number | null;
  formula_mL: number | null;
  diaper: string | null;
  'diaper load': number | null;
  stool: string | null;
  name: string | null;
  remark: string | null;
  feed_duration_min: number | null;
  feeding_method: string | null;
}

export interface NewRoutineRecordInput {
  profile_id?: string | null;
  date?: string | null;
  time?: string | null;
  emb_mL?: number | null;
  formula_mL?: number | null;
  diaper?: string | null;
  'diaper load'?: number | null;
  stool?: string | null;
  name?: string | null;
  remark?: string | null;
  feed_duration_min?: number | null;
  feeding_method?: string | null;
}

/**
 * Matches Supabase Postgres table: public."notes"
 * `profile_id` is int8 linking to the active profile's `entries.id`;
 * `name` is the person logging the note; `notes` is the note body.
 */
export interface NoteRecord {
  id: number;
  created_at: string;
  name: string | null;
  notes: string | null;
  remark: string | null;
  profile_id: number | null;
}

export interface NewNoteRecordInput {
  name?: string | null;
  notes?: string | null;
  remark?: string | null;
  profile_id?: number | null;
}

