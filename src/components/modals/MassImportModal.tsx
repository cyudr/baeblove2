import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useApp } from '../../context/AppContext';
import {
  classifyTemperature,
  doesRecordMatchProfile,
  getGrowthRecordDate,
} from '../../utils/careInterpreter';
import type {
  GrowthRecord,
  NewGrowthRecordInput,
  NewRoutineRecordInput,
  RoutineRecord,
} from '../../types';
import {
  Sparkles,
  Upload,
  X,
  Droplets,
  Scale,
  Loader2,
  Check,
  Trash2,
  Plus,
  FileText,
  Image as ImageIcon,
  AlertCircle,
  AlertTriangle,
  Table2,
  Camera,
  RotateCcw,
} from 'lucide-react';

export type MassImportTable = 'auto' | 'routine' | 'growth';
type ImportSourceMode = 'tabular' | 'camera' | 'photo' | 'file';

const DIAPER_PRESETS = ['Wet', 'Dirty', 'Mixed', 'Dry'] as const;

function tempBadgeClasses(severity: 'low' | 'normal' | 'elevated' | 'fever'): string {
  switch (severity) {
    case 'normal':
      return 'bg-emerald-100/80 dark:bg-emerald-950/70 text-emerald-800 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800';
    case 'elevated':
      return 'bg-amber-100/80 dark:bg-amber-950/70 text-amber-900 dark:text-amber-300 border-amber-200 dark:border-amber-800';
    case 'fever':
      return 'bg-rose-100/80 dark:bg-rose-950/70 text-rose-800 dark:text-rose-300 border-rose-200 dark:border-rose-800';
    case 'low':
      return 'bg-sky-100/80 dark:bg-sky-950/70 text-sky-800 dark:text-sky-300 border-sky-200 dark:border-sky-800';
  }
}

interface RoutineDraftRow {
  _key: string;
  selected: boolean;
  name: string;
  date: string;
  time: string;
  feedDurationMin: string;
  ebmMl: string;
  formulaMl: string;
  diaper: string;
  remark: string;
}

interface GrowthDraftRow {
  _key: string;
  selected: boolean;
  name: string;
  date: string;
  dailyWeight: string;
  dailyLength: string;
  temperature: string;
  remark: string;
}

interface BinaryAttachment {
  id: string;
  mimeType: string;
  data: string;
  fileName: string;
  previewUrl?: string;
}

interface UploadedFileItem {
  id: string;
  fileName: string;
  kind: 'text' | 'binary';
  textContent?: string;
  binary?: BinaryAttachment;
}

const MAX_MULTI_FILES = 12;

interface MassImportModalProps {
  isOpen: boolean;
  initialTable?: MassImportTable;
  onClose: () => void;
}

function getTodayStr(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function getCurrentTimeStr(): string {
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

function makeRowKey(prefix: string, idx: number): string {
  return `${prefix}-${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 7)}`;
}

function createEmptyRoutineRow(defaultDate: string, defaultLogger: string, idx = 0): RoutineDraftRow {
  return {
    _key: makeRowKey('rt', idx),
    selected: true,
    name: defaultLogger,
    date: defaultDate,
    time: getCurrentTimeStr(),
    feedDurationMin: '',
    ebmMl: '',
    formulaMl: '',
    diaper: '',
    remark: '',
  };
}

function createEmptyGrowthRow(defaultDate: string, defaultLogger: string, idx = 0): GrowthDraftRow {
  return {
    _key: makeRowKey('gr', idx),
    selected: true,
    name: defaultLogger,
    date: defaultDate,
    dailyWeight: '',
    dailyLength: '',
    temperature: '',
    remark: '',
  };
}

const IMAGE_MIMES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
const BINARY_FILE_MIMES = new Set(['application/pdf', ...IMAGE_MIMES]);

// ============================================================================
// Mass Import Gemini Prompts, Schemas, Normalizers & DB Duplicate Detection
// (All Mass Import prompt logic lives here; /api/gemini stays reusable)
// ============================================================================

const MASS_IMPORT_ROUTINE_ITEM_SCHEMA = {
  type: 'OBJECT',
  properties: {
    date: { type: 'STRING', nullable: true, description: 'YYYY-MM-DD date' },
    time: { type: 'STRING', nullable: true, description: '24-hour HH:MM time' },
    ebmMl: { type: 'INTEGER', nullable: true, description: 'Expressed breast milk in mL' },
    formulaMl: { type: 'INTEGER', nullable: true, description: 'Infant formula in mL' },
    feedDurationMin: { type: 'INTEGER', nullable: true, description: 'Feed duration in minutes' },
    diaper: { type: 'STRING', nullable: true, description: 'Wet, Dirty, Mixed, Dry, or custom' },
    name: { type: 'STRING', nullable: true, description: 'Caregiver who logged the entry' },
    remark: { type: 'STRING', nullable: true, description: 'Optional observation' },
  },
  required: [
    'date',
    'time',
    'ebmMl',
    'formulaMl',
    'feedDurationMin',
    'diaper',
    'name',
    'remark',
  ],
};

const MASS_IMPORT_GROWTH_ITEM_SCHEMA = {
  type: 'OBJECT',
  properties: {
    date: { type: 'STRING', nullable: true, description: 'YYYY-MM-DD date' },
    dailyWeight: { type: 'NUMBER', nullable: true, description: 'Weight in kg' },
    dailyLength: { type: 'NUMBER', nullable: true, description: 'Length in cm' },
    temperature: { type: 'NUMBER', nullable: true, description: 'Temperature in °C' },
    name: { type: 'STRING', nullable: true, description: 'Caregiver who logged the entry' },
    remark: { type: 'STRING', nullable: true, description: 'Optional notes' },
  },
  required: ['date', 'dailyWeight', 'dailyLength', 'temperature', 'name', 'remark'],
};

function buildMassImportGeminiPayload(params: {
  targetTable: MassImportTable;
  rawText: string;
  defaultDate: string;
  defaultLogger: string;
  attachments: Array<{ mimeType: string; data: string; fileName?: string }>;
}) {
  const { targetTable, rawText, defaultDate, defaultLogger, attachments } = params;
  const currentYear = defaultDate.slice(0, 4);
  const fileCount = attachments.length;

  const routineFieldRules = [
    'ROUTINE rows (feeding & diaper events):',
    '- date: YYYY-MM-DD format. Infer year from context or currentYear if only month/day is given; carry forward preceding date headings or use defaultDate.',
    '- time: 24-hour HH:MM format (e.g. "07:30", "19:45"). Convert AM/PM cleanly. Null if omitted.',
    '- ebmMl: integer milliliters of Expressed Breast Milk (EBM / breast milk / BM / pumped milk). Convert fl oz via 1 oz = 29.57 mL rounded to integer. Null if absent.',
    '- formulaMl: integer milliliters of infant formula (FM / formula). Convert fl oz to mL if needed. Null if absent.',
    '- feedDurationMin: integer minutes of feeding duration. Null if absent.',
    '- diaper: normalize to "Wet", "Dirty", "Mixed", or "Dry" when clearly matching (pee/urine -> "Wet", poop/stool/BM -> "Dirty", both -> "Mixed"), or keep a concise custom label. Null if absent.',
    '- name: person who logged the entry (e.g. "Mom", "Dad", "Caregiver"). Do NOT put the baby name here. Use defaultLogger if omitted, or null if both empty.',
    '- remark: concise additional feeding/diaper notes. Null if none.',
  ].join('\n');

  const growthFieldRules = [
    'GROWTH rows (daily weight, length, & body temperature):',
    '- date: YYYY-MM-DD format. Infer year from context or currentYear if omitted; use defaultDate if absent.',
    '- dailyWeight: weight in kilograms (kg), decimal (e.g. 4.52). Convert grams (4520g -> 4.52) or lb/oz (1 lb = 0.453592 kg, 1 oz = 0.0283495 kg) to kg rounded to 2–3 decimals. Null if absent.',
    '- dailyLength: length/height in centimeters (cm), decimal (e.g. 58.5). Convert inches (1 in = 2.54 cm) or mm to cm rounded to 1 decimal. Null if absent.',
    '- temperature: body temperature in Celsius (°C), decimal (e.g. 36.8). Convert Fahrenheit (e.g. 98.6°F or values > 45) via (F - 32) * 5 / 9 rounded to 1 decimal. Null if absent.',
    '- name: person who logged the entry (e.g. "Mom", "Dad", "Nurse"). Do NOT put the baby name here. Use defaultLogger if omitted, or null if both empty.',
    '- remark: concise growth/vitals notes (e.g. "before feed", "post-vaccine check"). Null if none.',
  ].join('\n');

  const multiFileNote =
    fileCount > 1
      ? `Multiple files/images (${fileCount}) are attached. Read EVERY attachment thoroughly, combine all distinct entries in chronological order, and deduplicate exact duplicates that overlap between consecutive screenshots or pages.`
      : 'Read the provided input thoroughly and extract every distinct record.';

  const systemInstruction =
    targetTable === 'auto'
      ? [
          'You are a precise baby-care data classification and extraction engine.',
          'The provided photo(s), handwritten sheet(s), screenshot(s), PDF(s), or text file(s) may contain BOTH Routine records (feeds, milk volumes, durations, diapers) AND Growth records (weight, length/height, temperature), or only one of the two.',
          multiFileNote,
          'Carefully classify and extract EVERY Routine event into `routineRows` AND EVERY Growth/Vitals measurement into `growthRows`.',
          'If a single line/card contains both a feed/diaper AND a weight/length/temperature, place the feed/diaper fields into `routineRows` and the weight/length/temperature fields into `growthRows` using the same date/logger.',
          `Context: defaultDate="${defaultDate}", currentYear="${currentYear}", defaultLogger="${defaultLogger}".`,
          routineFieldRules,
          growthFieldRules,
          'Populate every recognized row object with all schema keys (using null for absent fields). Return empty arrays when a category has no records. Do not fabricate data.',
        ].join('\n\n')
      : targetTable === 'routine'
        ? [
            'You are a precise data extraction engine for a baby care Routine table.',
            'Extract EVERY distinct feeding or diaper log entry from all provided text, CSV, tables, chat logs, screenshots, photos, or PDFs into the rows array.',
            multiFileNote,
            `Context: defaultDate="${defaultDate}", currentYear="${currentYear}", defaultLogger="${defaultLogger}".`,
            routineFieldRules,
            'Populate every recognized row object with all fields (using null for absent fields). Do not fabricate rows. Skip header rows and empty lines.',
          ].join('\n\n')
        : [
            'You are a precise data extraction engine for a baby daily Growth & Vitals table.',
            'Extract EVERY distinct daily weight, length, or temperature measurement from all provided text, CSV, tables, chat logs, screenshots, photos, or PDFs into the rows array.',
            multiFileNote,
            `Context: defaultDate="${defaultDate}", currentYear="${currentYear}", defaultLogger="${defaultLogger}".`,
            growthFieldRules,
            'Populate every recognized row object with all fields (using null for absent fields). Do not fabricate rows. Skip header rows and empty lines.',
          ].join('\n\n');

  const responseSchema =
    targetTable === 'auto'
      ? {
          type: 'OBJECT',
          properties: {
            summary: {
              type: 'STRING',
              description:
                'Short 1-sentence summary of recognized routine rows and growth rows, including any unit conversions performed.',
            },
            routineRows: {
              type: 'ARRAY',
              description: 'All extracted routine (feeding/diaper) rows.',
              items: MASS_IMPORT_ROUTINE_ITEM_SCHEMA,
            },
            growthRows: {
              type: 'ARRAY',
              description: 'All extracted growth/vitals (weight/length/temperature) rows.',
              items: MASS_IMPORT_GROWTH_ITEM_SCHEMA,
            },
          },
          required: ['summary', 'routineRows', 'growthRows'],
        }
      : {
          type: 'OBJECT',
          properties: {
            summary: {
              type: 'STRING',
              description:
                'Short 1-sentence summary of recognized rows, detected columns, and any unit conversions performed.',
            },
            rows: {
              type: 'ARRAY',
              description: `All extracted ${targetTable} rows.`,
              items:
                targetTable === 'routine'
                  ? MASS_IMPORT_ROUTINE_ITEM_SCHEMA
                  : MASS_IMPORT_GROWTH_ITEM_SCHEMA,
            },
          },
          required: ['summary', 'rows'],
        };

  const prompt = [
    targetTable === 'auto'
      ? `Mode: AUTO-RECOGNIZE both "routine" (feeds/diapers) and "growth" (weight/length/temperature) records across ${fileCount > 1 ? `all ${fileCount} attached files` : 'this input'}.`
      : `Target table: "${targetTable}"`,
    `Default date if missing: ${defaultDate}`,
    defaultLogger ? `Default logger name if missing: ${defaultLogger}` : '',
    rawText
      ? `\nSource text data to parse:\n${rawText}`
      : fileCount > 1
        ? `\nExtract and combine all tabular or written records from all ${fileCount} attached documents/images.`
        : '\nExtract all tabular or written records from the attached document/image.',
  ]
    .filter(Boolean)
    .join('\n');

  return {
    prompt,
    systemInstruction,
    responseMimeType: 'application/json',
    responseSchema,
    attachments: attachments.length > 0 ? attachments : null,
    thinkingLevel: 'LOW' as const,
  };
}

function normalizeDateStr(val: unknown, fallback?: string): string {
  if (typeof val === 'string') {
    const trimmed = val.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
    const match = trimmed.match(/(\d{4}-\d{2}-\d{2})/);
    if (match) return match[1];
  }
  if (fallback && /^\d{4}-\d{2}-\d{2}$/.test(fallback)) return fallback;
  return '';
}

function normalizeTimeStr(val: unknown): string {
  if (typeof val !== 'string') return '';
  const trimmed = val.trim();
  const match = trimmed.match(/^(\d{1,2}):(\d{2})/);
  if (!match) return '';
  const hh = Number(match[1]);
  const mm = Number(match[2]);
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return '';
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

function normalizeIntStr(val: unknown): string {
  if (val === null || val === undefined || val === '') return '';
  const n = Number(val);
  if (!Number.isFinite(n) || n < 0) return '';
  return String(Math.round(n));
}

function normalizeFloatStr(val: unknown, decimals = 2): string {
  if (val === null || val === undefined || val === '') return '';
  const n = Number(val);
  if (!Number.isFinite(n) || n <= 0) return '';
  const factor = Math.pow(10, decimals);
  return String(Math.round(n * factor) / factor);
}

function normalizeTextStr(val: unknown, fallback = ''): string {
  if (typeof val === 'string' && val.trim().length > 0) return val.trim();
  return fallback.trim();
}

function parseTimeToMinutes(timeStr: string | null | undefined): number | null {
  if (!timeStr) return null;
  const match = timeStr.trim().match(/^(\d{1,2}):(\d{2})/);
  if (!match) return null;
  const hh = Number(match[1]);
  const mm = Number(match[2]);
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  return hh * 60 + mm;
}

interface DuplicateMatch {
  level: 'exact' | 'possible';
  reason: string;
}

function formatRoutineSummary(rec: RoutineRecord): string {
  const parts: string[] = [];
  if (rec.date) parts.push(rec.date);
  if (rec.time) parts.push(rec.time.slice(0, 5));
  if (rec['EBM (mL)'] !== null) parts.push(`EBM ${rec['EBM (mL)']} mL`);
  if (rec['Formula (mL)'] !== null) parts.push(`Formula ${rec['Formula (mL)']} mL`);
  if (rec['feed duration (min)'] !== null) parts.push(`${rec['feed duration (min)']} min`);
  if (rec.Diaper) parts.push(rec.Diaper);
  return parts.join(' · ') || `Entry #${rec.id}`;
}

function findRoutineDuplicateMatch(
  row: RoutineDraftRow,
  existingRecords: RoutineRecord[]
): DuplicateMatch | null {
  const rowDate = normalizeDateStr(row.date);
  if (!rowDate) return null;

  const hasAnyMetric =
    row.ebmMl.trim() !== '' ||
    row.formulaMl.trim() !== '' ||
    row.feedDurationMin.trim() !== '' ||
    row.diaper.trim() !== '' ||
    row.remark.trim() !== '';
  if (!hasAnyMetric) return null;

  const rowMins = parseTimeToMinutes(row.time);
  const rowEbm = row.ebmMl.trim() !== '' ? parseInt(row.ebmMl, 10) : null;
  const rowFormula = row.formulaMl.trim() !== '' ? parseInt(row.formulaMl, 10) : null;
  const rowDur = row.feedDurationMin.trim() !== '' ? parseInt(row.feedDurationMin, 10) : null;
  const rowDiaper = row.diaper.trim().toLowerCase();

  let possibleMatch: DuplicateMatch | null = null;

  for (const rec of existingRecords) {
    const recDate = normalizeDateStr(rec.date || rec.created_at);
    if (recDate !== rowDate) continue;

    const recMins = parseTimeToMinutes(rec.time);
    const recEbm = rec['EBM (mL)'];
    const recFormula = rec['Formula (mL)'];
    const recDur = rec['feed duration (min)'];
    const recDiaper = (rec.Diaper || '').trim().toLowerCase();

    const sameEbm = rowEbm === recEbm;
    const sameFormula = rowFormula === recFormula;
    const sameDur = rowDur === recDur;
    const sameDiaper = rowDiaper === recDiaper;

    if (rowMins !== null && recMins !== null) {
      const diffMins = Math.abs(rowMins - recMins);
      if (diffMins <= 5 && sameEbm && sameFormula && (sameDur || rowDur === null || recDur === null) && (sameDiaper || !rowDiaper || !recDiaper)) {
        return {
          level: 'exact',
          reason: `Already in DB: ${formatRoutineSummary(rec)}`,
        };
      }
      if (diffMins <= 15 && !possibleMatch) {
        possibleMatch = {
          level: 'possible',
          reason: `Similar DB entry (${diffMins === 0 ? 'same time' : `within ${diffMins}m`}): ${formatRoutineSummary(rec)}`,
        };
      }
    } else if (
      (rowEbm !== null || rowFormula !== null || rowDiaper !== '') &&
      sameEbm &&
      sameFormula &&
      sameDiaper &&
      !possibleMatch
    ) {
      possibleMatch = {
        level: 'possible',
        reason: `Similar DB entry on ${rowDate}: ${formatRoutineSummary(rec)}`,
      };
    }
  }

  return possibleMatch;
}

function formatGrowthSummary(rec: GrowthRecord, recDate: string): string {
  const parts: string[] = [recDate];
  if (rec.daily_weight !== null) parts.push(`${rec.daily_weight} kg`);
  if (rec.daily_length !== null) parts.push(`${rec.daily_length} cm`);
  if (rec.temperature !== null) parts.push(`${rec.temperature}°C`);
  return parts.join(' · ');
}

function findGrowthDuplicateMatch(
  row: GrowthDraftRow,
  existingRecords: GrowthRecord[]
): DuplicateMatch | null {
  const rowDate = normalizeDateStr(row.date);
  if (!rowDate) return null;

  const hasAnyMetric =
    row.dailyWeight.trim() !== '' ||
    row.dailyLength.trim() !== '' ||
    row.temperature.trim() !== '' ||
    row.remark.trim() !== '';
  if (!hasAnyMetric) return null;

  const rowWeight = row.dailyWeight.trim() !== '' ? parseFloat(row.dailyWeight) : null;
  const rowLength = row.dailyLength.trim() !== '' ? parseFloat(row.dailyLength) : null;
  const rowTemp = row.temperature.trim() !== '' ? parseFloat(row.temperature) : null;

  let possibleMatch: DuplicateMatch | null = null;

  for (const rec of existingRecords) {
    const recDate = normalizeDateStr(getGrowthRecordDate(rec));
    if (recDate !== rowDate) continue;

    const compared: boolean[] = [];
    if (rowWeight !== null && Number.isFinite(rowWeight)) {
      compared.push(rec.daily_weight !== null && Math.abs(rec.daily_weight - rowWeight) <= 0.01);
    }
    if (rowLength !== null && Number.isFinite(rowLength)) {
      compared.push(rec.daily_length !== null && Math.abs(rec.daily_length - rowLength) <= 0.1);
    }
    if (rowTemp !== null && Number.isFinite(rowTemp)) {
      compared.push(rec.temperature !== null && Math.abs(rec.temperature - rowTemp) <= 0.1);
    }

    if (compared.length > 0 && compared.every(Boolean)) {
      return {
        level: 'exact',
        reason: `Already in DB: ${formatGrowthSummary(rec, recDate)}`,
      };
    }

    if (!possibleMatch) {
      possibleMatch = {
        level: 'possible',
        reason: `DB already has growth entry on ${recDate}: ${formatGrowthSummary(rec, recDate)}`,
      };
    }
  }

  return possibleMatch;
}

export const MassImportModal: React.FC<MassImportModalProps> = ({
  isOpen,
  initialTable = 'auto',
  onClose,
}) => {
  const {
    activeProfile,
    routineRecords,
    growthRecords,
    addRoutineRecordsBulk,
    addGrowthRecordsBulk,
  } = useApp();

  const profileRoutineRecords = useMemo(() => {
    if (!activeProfile) return routineRecords;
    return routineRecords.filter((r) => doesRecordMatchProfile(r, activeProfile));
  }, [routineRecords, activeProfile]);

  const profileGrowthRecords = useMemo(() => {
    if (!activeProfile) return growthRecords;
    return growthRecords.filter((g) => doesRecordMatchProfile(g, activeProfile));
  }, [growthRecords, activeProfile]);

  const [targetTable, setTargetTable] = useState<MassImportTable>(initialTable);
  const [entryMode, setEntryMode] = useState<ImportSourceMode>('tabular');

  const [defaultLogger, setDefaultLogger] = useState<string>('');
  const [defaultDate, setDefaultDate] = useState<string>(getTodayStr);

  // Direct Tabular Data Entry rows (the ONLY dataset written to Supabase)
  const [routineDrafts, setRoutineDrafts] = useState<RoutineDraftRow[]>(() => [
    createEmptyRoutineRow(getTodayStr(), '', 0),
  ]);
  const [growthDrafts, setGrowthDrafts] = useState<GrowthDraftRow[]>(() => [
    createEmptyGrowthRow(getTodayStr(), '', 0),
  ]);

  const modalUid = useId();
  const cameraInputId = `${modalUid}-camera`;
  const photoInputId = `${modalUid}-photo`;
  const fileInputId = `${modalUid}-file`;

  // Camera entry state (supports snapping multiple photos/pages)
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [cameraPhotos, setCameraPhotos] = useState<BinaryAttachment[]>([]);
  const [cameraInputKey, setCameraInputKey] = useState(0);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // Photo entry state (supports multiple photos/screenshots in one go)
  const [selectedPhotos, setSelectedPhotos] = useState<BinaryAttachment[]>([]);
  const [isDraggingPhoto, setIsDraggingPhoto] = useState(false);
  const [photoInputKey, setPhotoInputKey] = useState(0);

  // File upload entry state (supports multiple mixed text/PDF/image files + pasted notes)
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFileItem[]>([]);
  const [uploadedTextContent, setUploadedTextContent] = useState<string>('');
  const [isDraggingFiles, setIsDraggingFiles] = useState(false);
  const [fileInputKey, setFileInputKey] = useState(0);

  // Gemini & Database status
  const [isReadingFile, setIsReadingFile] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [aiSummary, setAiSummary] = useState<string | null>(null);

  const stopCameraStream = () => {
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) {
        track.stop();
      }
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setCameraActive(false);
  };

  useEffect(() => {
    if (isOpen) {
      setTargetTable(initialTable);
      setDefaultDate(getTodayStr());
      setErrorMessage(null);
      setSuccessMessage(null);
      setIsReadingFile(false);
    } else {
      stopCameraStream();
      setIsReadingFile(false);
    }
  }, [isOpen, initialTable]);

  useEffect(() => {
    if (entryMode !== 'camera') {
      stopCameraStream();
    }
  }, [entryMode]);

  useEffect(() => {
    return () => {
      stopCameraStream();
    };
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isAnalyzing && !isImporting) {
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, isAnalyzing, isImporting, onClose]);

  // Real-time duplicate detection against existing database records
  // (Must be declared before the conditional early return to satisfy React Rules of Hooks)
  const routineDupMap = useMemo(() => {
    const map = new Map<string, DuplicateMatch>();
    if (!isOpen) return map;
    for (const row of routineDrafts) {
      const match = findRoutineDuplicateMatch(row, profileRoutineRecords);
      if (match) map.set(row._key, match);
    }
    return map;
  }, [isOpen, routineDrafts, profileRoutineRecords]);

  const growthDupMap = useMemo(() => {
    const map = new Map<string, DuplicateMatch>();
    if (!isOpen) return map;
    for (const row of growthDrafts) {
      const match = findGrowthDuplicateMatch(row, profileGrowthRecords);
      if (match) map.set(row._key, match);
    }
    return map;
  }, [isOpen, growthDrafts, profileGrowthRecords]);

  if (!isOpen) return null;

  const handleSwitchTable = (next: MassImportTable) => {
    setTargetTable(next);
    setAiSummary(null);
    setErrorMessage(null);
    setSuccessMessage(null);
  };

  const handleSwitchMode = (next: ImportSourceMode) => {
    setEntryMode(next);
    setErrorMessage(null);
    setSuccessMessage(null);
  };

  // Start live camera stream for Camera Entry
  const startCamera = async () => {
    setCameraError(null);
    setErrorMessage(null);

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setCameraError(
        'Live camera preview is not supported in this browser. Use the "Capture / Device Camera" button below instead.'
      );
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1600 } },
        audio: false,
      });
      streamRef.current = stream;
      setCameraActive(true);
      requestAnimationFrame(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          void videoRef.current.play();
        }
      });
    } catch {
      setCameraError(
        'Camera access was blocked or unavailable. Allow camera permissions or use "Capture / Device Camera" below.'
      );
    }
  };

  const captureFromCamera = () => {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0 || video.videoHeight === 0) {
      setCameraError('Camera video is still loading. Please try capturing again.');
      return;
    }

    if (cameraPhotos.length >= MAX_MULTI_FILES) {
      setCameraError(`Maximum of ${MAX_MULTI_FILES} photos can be queued at once.`);
      return;
    }

    const maxDim = cameraPhotos.length >= 2 ? 1280 : 1500;
    const scale = Math.min(1, maxDim / Math.max(video.videoWidth, video.videoHeight));
    const width = Math.round(video.videoWidth * scale);
    const height = Math.round(video.videoHeight * scale);

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      setCameraError('Could not initialize capture canvas.');
      return;
    }
    ctx.drawImage(video, 0, 0, width, height);
    const dataUrl = canvas.toDataURL('image/jpeg', cameraPhotos.length >= 2 ? 0.78 : 0.85);
    const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);

    setCameraPhotos((prev) => [
      ...prev,
      {
        id: makeRowKey('cam', prev.length),
        mimeType: 'image/jpeg',
        data: base64,
        fileName: `camera-capture-${prev.length + 1}.jpg`,
        previewUrl: dataUrl,
      },
    ]);
  };

  const detectImageMime = (file: File): string => {
    const rawType = (file.type || '').toLowerCase().trim();
    if (rawType === 'image/jpg') return 'image/jpeg';
    if (
      IMAGE_MIMES.has(rawType) ||
      rawType === 'image/heic' ||
      rawType === 'image/heif'
    ) {
      return rawType;
    }
    const lower = (file.name || '').toLowerCase();
    if (lower.endsWith('.png')) return 'image/png';
    if (lower.endsWith('.webp')) return 'image/webp';
    if (lower.endsWith('.gif')) return 'image/gif';
    if (lower.endsWith('.heic')) return 'image/heic';
    if (lower.endsWith('.heif')) return 'image/heif';
    return 'image/jpeg';
  };

  const readSingleImageAsAttachment = (
    file: File,
    compact = false
  ): Promise<{ attachment?: BinaryAttachment; error?: string }> =>
    new Promise((resolve) => {
      if (file.size > 20 * 1024 * 1024) {
        resolve({ error: `"${file.name}" is larger than 20 MB.` });
        return;
      }

      let settled = false;
      const done = (result: { attachment?: BinaryAttachment; error?: string }) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(watchdog);
        resolve(result);
      };
      const watchdog = window.setTimeout(() => {
        done({ error: `Timed out reading "${file.name}".` });
      }, 15000);

      try {
        const reader = new FileReader();
        reader.onload = () => {
          const dataUrl = typeof reader.result === 'string' ? reader.result : '';
          const commaIdx = dataUrl.indexOf(',');
          const rawBase64 = commaIdx >= 0 ? dataUrl.slice(commaIdx + 1) : '';
          if (!rawBase64) {
            done({ error: `Failed to read "${file.name}".` });
            return;
          }
          const detectedMime = detectImageMime(file);
          const isStandardWebImage = IMAGE_MIMES.has(detectedMime);

          if (detectedMime !== 'image/gif') {
            const img = new Image();
            img.onload = () => {
              try {
                const maxDim = compact ? 1280 : 1550;
                const sizeThreshold = compact ? 450 * 1024 : 1.2 * 1024 * 1024;
                const needsResize =
                  img.width > maxDim ||
                  img.height > maxDim ||
                  file.size > sizeThreshold ||
                  !isStandardWebImage;
                if (!needsResize) {
                  done({
                    attachment: {
                      id: makeRowKey('img', 0),
                      mimeType: detectedMime,
                      data: rawBase64,
                      fileName: file.name || 'photo.jpg',
                      previewUrl: dataUrl,
                    },
                  });
                  return;
                }
                const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
                const width = Math.max(1, Math.round(img.width * scale));
                const height = Math.max(1, Math.round(img.height * scale));
                const canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                if (!ctx) {
                  done({
                    attachment: {
                      id: makeRowKey('img', 0),
                      mimeType: isStandardWebImage ? detectedMime : 'image/jpeg',
                      data: rawBase64,
                      fileName: file.name || 'photo.jpg',
                      previewUrl: isStandardWebImage ? dataUrl : undefined,
                    },
                  });
                  return;
                }
                ctx.drawImage(img, 0, 0, width, height);
                const compressedUrl = canvas.toDataURL('image/jpeg', compact ? 0.76 : 0.84);
                const compressedBase64 = compressedUrl.slice(compressedUrl.indexOf(',') + 1);
                done({
                  attachment: {
                    id: makeRowKey('img', 0),
                    mimeType: 'image/jpeg',
                    data: compressedBase64,
                    fileName: file.name || 'photo.jpg',
                    previewUrl: compressedUrl,
                  },
                });
              } catch {
                done({
                  attachment: {
                    id: makeRowKey('img', 0),
                    mimeType: detectedMime,
                    data: rawBase64,
                    fileName: file.name || 'photo.jpg',
                    previewUrl: isStandardWebImage ? dataUrl : undefined,
                  },
                });
              }
            };
            img.onerror = () => {
              done({
                attachment: {
                  id: makeRowKey('img', 0),
                  mimeType: detectedMime,
                  data: rawBase64,
                  fileName: file.name || 'photo.jpg',
                  previewUrl: isStandardWebImage ? dataUrl : undefined,
                },
              });
            };
            img.src = dataUrl;
            return;
          }

          done({
            attachment: {
              id: makeRowKey('img', 0),
              mimeType: detectedMime,
              data: rawBase64,
              fileName: file.name || 'photo.gif',
              previewUrl: dataUrl,
            },
          });
        };
        reader.onerror = () => {
          done({ error: `Unable to read "${file.name}".` });
        };
        reader.readAsDataURL(file);
      } catch {
        done({ error: `Unable to read "${file.name}".` });
      }
    });

  const appendImageFiles = async (
    files: File[],
    setter: React.Dispatch<React.SetStateAction<BinaryAttachment[]>>,
    existingCount: number,
    onDone?: () => void
  ) => {
    if (files.length === 0) {
      onDone?.();
      return;
    }

    const remainingSlots = MAX_MULTI_FILES - existingCount;
    if (remainingSlots <= 0) {
      setErrorMessage(`You can recognize up to ${MAX_MULTI_FILES} files in one go.`);
      onDone?.();
      return;
    }

    const filesToProcess = files.slice(0, remainingSlots);
    const skippedCount = files.length - filesToProcess.length;
    const compact = existingCount + filesToProcess.length > 2;

    setIsReadingFile(true);
    setErrorMessage(null);
    try {
      const results = await Promise.all(
        filesToProcess.map((f) => readSingleImageAsAttachment(f, compact))
      );
      const loaded = results
        .map((r) => r.attachment)
        .filter((a): a is BinaryAttachment => Boolean(a));
      const errors = results.map((r) => r.error).filter((e): e is string => Boolean(e));

      if (loaded.length > 0) {
        setter((prev) => [...prev, ...loaded].slice(0, MAX_MULTI_FILES));
      }
      if (skippedCount > 0) {
        errors.push(`Only the first ${MAX_MULTI_FILES} files were added.`);
      }
      if (errors.length > 0) {
        setErrorMessage(errors.join(' '));
      }
    } finally {
      setIsReadingFile(false);
      onDone?.();
    }
  };

  const handleCameraFallbackChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files ? Array.from(e.target.files) : [];
    if (files.length === 0) return;
    setCameraError(null);
    void appendImageFiles(files, setCameraPhotos, cameraPhotos.length, () =>
      setCameraInputKey((k) => k + 1)
    );
  };

  const handlePhotoFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files ? Array.from(e.target.files) : [];
    if (files.length === 0) return;
    void appendImageFiles(files, setSelectedPhotos, selectedPhotos.length, () =>
      setPhotoInputKey((k) => k + 1)
    );
  };

  const handlePhotoDrop = (e: React.DragEvent<HTMLElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingPhoto(false);
    const files = e.dataTransfer.files ? Array.from(e.dataTransfer.files) : [];
    if (files.length === 0) return;
    void appendImageFiles(files, setSelectedPhotos, selectedPhotos.length);
  };

  const handlePhotoPaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    const imageFiles: File[] = [];
    for (const item of Array.from(items)) {
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) imageFiles.push(file);
      }
    }
    if (imageFiles.length > 0) {
      e.preventDefault();
      void appendImageFiles(imageFiles, setSelectedPhotos, selectedPhotos.length);
    }
  };

  const readSingleUploadedFile = (
    file: File,
    compactImages: boolean
  ): Promise<{ item?: UploadedFileItem; error?: string }> =>
    new Promise((resolve) => {
      const lowerName = (file.name || '').toLowerCase();
      const isImageFile =
        file.type.startsWith('image/') ||
        /\.(png|jpe?g|webp|gif|heic|heif)$/i.test(lowerName);

      if (isImageFile) {
        void readSingleImageAsAttachment(file, compactImages).then((res) => {
          if (res.attachment) {
            resolve({
              item: {
                id: res.attachment.id,
                fileName: res.attachment.fileName,
                kind: 'binary',
                binary: res.attachment,
              },
            });
          } else {
            resolve({ error: res.error || `Failed to read "${file.name}".` });
          }
        });
        return;
      }

      if (file.size > 10 * 1024 * 1024) {
        resolve({ error: `"${file.name}" is larger than 10 MB.` });
        return;
      }

      const isTextLike =
        file.type.startsWith('text/') ||
        file.type === 'application/csv' ||
        file.type === 'application/json' ||
        lowerName.endsWith('.csv') ||
        lowerName.endsWith('.tsv') ||
        lowerName.endsWith('.txt') ||
        lowerName.endsWith('.md') ||
        lowerName.endsWith('.json');

      if (isTextLike) {
        const reader = new FileReader();
        reader.onload = () => {
          const content = typeof reader.result === 'string' ? reader.result : '';
          resolve({
            item: {
              id: makeRowKey('txt', 0),
              fileName: file.name,
              kind: 'text',
              textContent: content,
            },
          });
        };
        reader.onerror = () => resolve({ error: `Unable to read "${file.name}".` });
        reader.readAsText(file);
        return;
      }

      const isPdf = file.type === 'application/pdf' || lowerName.endsWith('.pdf');
      if (isPdf || BINARY_FILE_MIMES.has(file.type)) {
        const reader = new FileReader();
        reader.onload = () => {
          const dataUrl = typeof reader.result === 'string' ? reader.result : '';
          const commaIdx = dataUrl.indexOf(',');
          const base64 = commaIdx >= 0 ? dataUrl.slice(commaIdx + 1) : '';
          if (!base64) {
            resolve({ error: `Failed to encode "${file.name}".` });
            return;
          }
          const att: BinaryAttachment = {
            id: makeRowKey('bin', 0),
            mimeType: isPdf ? 'application/pdf' : file.type,
            data: base64,
            fileName: file.name,
            previewUrl: file.type.startsWith('image/') ? dataUrl : undefined,
          };
          resolve({
            item: {
              id: att.id,
              fileName: file.name,
              kind: 'binary',
              binary: att,
            },
          });
        };
        reader.onerror = () => resolve({ error: `Unable to read "${file.name}".` });
        reader.readAsDataURL(file);
        return;
      }

      resolve({
        error: `Unsupported file "${file.name}". Upload CSV, TSV, TXT, JSON, PDF, or image files.`,
      });
    });

  const appendUploadedFiles = async (files: File[], onDone?: () => void) => {
    if (files.length === 0) {
      onDone?.();
      return;
    }

    const remainingSlots = MAX_MULTI_FILES - uploadedFiles.length;
    if (remainingSlots <= 0) {
      setErrorMessage(`You can upload up to ${MAX_MULTI_FILES} files in one go.`);
      onDone?.();
      return;
    }

    const filesToProcess = files.slice(0, remainingSlots);
    const skippedCount = files.length - filesToProcess.length;
    const compactImages = uploadedFiles.length + filesToProcess.length > 2;

    setIsReadingFile(true);
    setErrorMessage(null);
    setSuccessMessage(null);
    try {
      const results = await Promise.all(
        filesToProcess.map((f) => readSingleUploadedFile(f, compactImages))
      );
      const loaded = results
        .map((r) => r.item)
        .filter((it): it is UploadedFileItem => Boolean(it));
      const errors = results.map((r) => r.error).filter((e): e is string => Boolean(e));

      if (loaded.length > 0) {
        setUploadedFiles((prev) => [...prev, ...loaded].slice(0, MAX_MULTI_FILES));
      }
      if (skippedCount > 0) {
        errors.push(`Only the first ${MAX_MULTI_FILES} files were added.`);
      }
      if (errors.length > 0) {
        setErrorMessage(errors.join(' '));
      }
    } finally {
      setIsReadingFile(false);
      onDone?.();
    }
  };

  const handleUploadFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files ? Array.from(e.target.files) : [];
    if (files.length === 0) return;
    void appendUploadedFiles(files, () => setFileInputKey((k) => k + 1));
  };

  const handleUploadFileDrop = (e: React.DragEvent<HTMLElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingFiles(false);
    const files = e.dataTransfer.files ? Array.from(e.dataTransfer.files) : [];
    if (files.length === 0) return;
    void appendUploadedFiles(files);
  };

  // Process Camera / Photo / File Upload through Gemini API (supports multiple files at once) and fit recognized data into Tabular Data Entry
  const handleRecognizeWithGemini = async (source: 'camera' | 'photo' | 'file') => {
    setErrorMessage(null);
    setSuccessMessage(null);

    let rawTextToSend = '';
    let attachmentsToSend: Array<{ mimeType: string; data: string; fileName?: string }> = [];

    if (source === 'camera') {
      if (cameraPhotos.length === 0) {
        setErrorMessage('Capture at least one photo from your camera first.');
        return;
      }
      attachmentsToSend = cameraPhotos.map((p) => ({
        mimeType: p.mimeType,
        data: p.data,
        fileName: p.fileName,
      }));
    } else if (source === 'photo') {
      if (selectedPhotos.length === 0) {
        setErrorMessage('Select at least one photo or screenshot first.');
        return;
      }
      attachmentsToSend = selectedPhotos.map((p) => ({
        mimeType: p.mimeType,
        data: p.data,
        fileName: p.fileName,
      }));
    } else {
      const textChunks: string[] = [];
      for (const item of uploadedFiles) {
        if (item.kind === 'text' && item.textContent && item.textContent.trim()) {
          textChunks.push(`--- File: ${item.fileName} ---\n${item.textContent.trim()}`);
        } else if (item.kind === 'binary' && item.binary) {
          attachmentsToSend.push({
            mimeType: item.binary.mimeType,
            data: item.binary.data,
            fileName: item.binary.fileName,
          });
        }
      }
      if (uploadedTextContent.trim()) {
        textChunks.push(
          textChunks.length > 0
            ? `--- Pasted Notes ---\n${uploadedTextContent.trim()}`
            : uploadedTextContent.trim()
        );
      }
      rawTextToSend = textChunks.join('\n\n');

      if (!rawTextToSend && attachmentsToSend.length === 0) {
        setErrorMessage('Upload one or more files, or paste text before recognizing with Gemini.');
        return;
      }
    }

    setIsAnalyzing(true);
    try {
      const geminiRequestBody = buildMassImportGeminiPayload({
        targetTable,
        rawText: rawTextToSend,
        defaultDate,
        defaultLogger: defaultLogger.trim(),
        attachments: attachmentsToSend,
      });

      const response = await fetch('/api/gemini', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(geminiRequestBody),
      });

      const rawResponseText = await response.text();
      let apiPayload: {
        error?: string;
        text?: string;
        parsed?: {
          summary?: unknown;
          rows?: unknown;
          routineRows?: unknown;
          growthRows?: unknown;
        };
      } = {};

      if (rawResponseText) {
        try {
          apiPayload = JSON.parse(rawResponseText) as typeof apiPayload;
        } catch {
          apiPayload = {};
        }
      }

      if (!response.ok) {
        const plainDetail = rawResponseText
          ? rawResponseText.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 180)
          : '';
        setErrorMessage(
          apiPayload.error ||
            (plainDetail
              ? `Gemini analysis failed (HTTP ${response.status}): ${plainDetail}`
              : `Gemini analysis failed (HTTP ${response.status}). Check /api/health to verify API connectivity.`)
        );
        return;
      }

      let parsedData = apiPayload.parsed;
      if (!parsedData && typeof apiPayload.text === 'string' && apiPayload.text.trim()) {
        try {
          parsedData = JSON.parse(apiPayload.text) as typeof parsedData;
        } catch {
          parsedData = undefined;
        }
      }

      if (!parsedData || typeof parsedData !== 'object') {
        setErrorMessage('Gemini returned an unexpected response format. Please retry.');
        return;
      }

      const rawRoutineItems = Array.isArray(parsedData.routineRows)
        ? parsedData.routineRows
        : targetTable === 'routine' && Array.isArray(parsedData.rows)
          ? parsedData.rows
          : [];

      const rawGrowthItems = Array.isArray(parsedData.growthRows)
        ? parsedData.growthRows
        : targetTable === 'growth' && Array.isArray(parsedData.rows)
          ? parsedData.rows
          : [];

      const loggerFallback = defaultLogger.trim();

      const recognizedRoutine: RoutineDraftRow[] = rawRoutineItems
        .map((item, idx) => {
          const obj = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
          const draft: RoutineDraftRow = {
            _key: makeRowKey('rt-ai', idx),
            selected: true,
            name: normalizeTextStr(obj.name, loggerFallback),
            date: normalizeDateStr(obj.date, defaultDate),
            time: normalizeTimeStr(obj.time),
            feedDurationMin: normalizeIntStr(
              obj.feedDurationMin ?? obj['feed duration (min)'] ?? obj.feed_duration_min
            ),
            ebmMl: normalizeIntStr(obj.ebmMl ?? obj['EBM (mL)'] ?? obj.ebm_ml),
            formulaMl: normalizeIntStr(obj.formulaMl ?? obj['Formula (mL)'] ?? obj.formula_ml),
            diaper: normalizeTextStr(obj.diaper ?? obj.Diaper),
            remark: normalizeTextStr(obj.remark),
          };
          const dup = findRoutineDuplicateMatch(draft, profileRoutineRecords);
          if (dup?.level === 'exact') {
            draft.selected = false;
          }
          return draft;
        })
        .filter(
          (r) =>
            r.ebmMl !== '' ||
            r.formulaMl !== '' ||
            r.feedDurationMin !== '' ||
            r.diaper !== '' ||
            r.remark !== ''
        );

      const recognizedGrowth: GrowthDraftRow[] = rawGrowthItems
        .map((item, idx) => {
          const obj = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
          const draft: GrowthDraftRow = {
            _key: makeRowKey('gr-ai', idx),
            selected: true,
            name: normalizeTextStr(obj.name, loggerFallback),
            date: normalizeDateStr(obj.date, defaultDate),
            dailyWeight: normalizeFloatStr(obj.dailyWeight ?? obj.daily_weight, 3),
            dailyLength: normalizeFloatStr(obj.dailyLength ?? obj.daily_length, 1),
            temperature: normalizeFloatStr(obj.temperature, 1),
            remark: normalizeTextStr(obj.remark),
          };
          const dup = findGrowthDuplicateMatch(draft, profileGrowthRecords);
          if (dup?.level === 'exact') {
            draft.selected = false;
          }
          return draft;
        })
        .filter(
          (r) =>
            r.dailyWeight !== '' ||
            r.dailyLength !== '' ||
            r.temperature !== '' ||
            r.remark !== ''
        );

      if (recognizedRoutine.length === 0 && recognizedGrowth.length === 0) {
        setErrorMessage(
          targetTable === 'auto'
            ? `Gemini could not recognize any Routine or Growth rows from this ${source}. Try a clearer capture or file.`
            : `Gemini could not recognize any ${targetTable} rows from this ${source}. Try a clearer capture or switch Target to Auto (Both).`
        );
        return;
      }

      if (recognizedRoutine.length > 0) {
        setRoutineDrafts((prev) => {
          const nonEmptyExisting = prev.filter(
            (row) =>
              row.ebmMl.trim() !== '' ||
              row.formulaMl.trim() !== '' ||
              row.feedDurationMin.trim() !== '' ||
              row.diaper.trim() !== '' ||
              row.remark.trim() !== ''
          );
          return [...nonEmptyExisting, ...recognizedRoutine];
        });
      }

      if (recognizedGrowth.length > 0) {
        setGrowthDrafts((prev) => {
          const nonEmptyExisting = prev.filter(
            (row) =>
              row.dailyWeight.trim() !== '' ||
              row.dailyLength.trim() !== '' ||
              row.temperature.trim() !== '' ||
              row.remark.trim() !== ''
          );
          return [...nonEmptyExisting, ...recognizedGrowth];
        });
      }

      const flaggedCount =
        recognizedRoutine.filter((r) => findRoutineDuplicateMatch(r, profileRoutineRecords) !== null)
          .length +
        recognizedGrowth.filter((r) => findGrowthDuplicateMatch(r, profileGrowthRecords) !== null)
          .length;

      const baseSummary =
        typeof parsedData.summary === 'string' && parsedData.summary.trim()
          ? parsedData.summary.trim()
          : targetTable === 'auto'
            ? `Auto-recognized ${recognizedRoutine.length} routine row${recognizedRoutine.length === 1 ? '' : 's'} and ${recognizedGrowth.length} growth row${recognizedGrowth.length === 1 ? '' : 's'}.`
            : `Gemini recognized ${recognizedRoutine.length + recognizedGrowth.length} ${targetTable} row${recognizedRoutine.length + recognizedGrowth.length === 1 ? '' : 's'}.`;

      setAiSummary(
        flaggedCount > 0
          ? `${baseSummary} (${flaggedCount} potential duplicate${flaggedCount === 1 ? '' : 's'} flagged against database.)`
          : baseSummary
      );
      // Automatically switch to Tabular Data Entry so user reviews/edits before writing to database
      setEntryMode('tabular');
    } catch (err) {
      setErrorMessage(
        err instanceof Error
          ? `Network error contacting /api/gemini: ${err.message}`
          : 'Network error contacting /api/gemini.'
      );
    } finally {
      setIsAnalyzing(false);
    }
  };

  const activeFlaggedCount =
    (targetTable === 'routine' || targetTable === 'auto' ? routineDupMap.size : 0) +
    (targetTable === 'growth' || targetTable === 'auto' ? growthDupMap.size : 0);

  const activeFlaggedSelectedCount =
    (targetTable === 'routine' || targetTable === 'auto'
      ? routineDrafts.filter((r) => r.selected && routineDupMap.has(r._key)).length
      : 0) +
    (targetTable === 'growth' || targetTable === 'auto'
      ? growthDrafts.filter((r) => r.selected && growthDupMap.has(r._key)).length
      : 0);

  const uncheckAllFlagged = () => {
    if (targetTable === 'routine' || targetTable === 'auto') {
      setRoutineDrafts((prev) =>
        prev.map((r) => (routineDupMap.has(r._key) ? { ...r, selected: false } : r))
      );
    }
    if (targetTable === 'growth' || targetTable === 'auto') {
      setGrowthDrafts((prev) =>
        prev.map((r) => (growthDupMap.has(r._key) ? { ...r, selected: false } : r))
      );
    }
  };

  // Tabular Data Entry helpers
  const routineValidSelectedCount = routineDrafts.filter(
    (r) =>
      r.selected &&
      (r.ebmMl.trim() !== '' ||
        r.formulaMl.trim() !== '' ||
        r.feedDurationMin.trim() !== '' ||
        r.diaper.trim() !== '' ||
        r.remark.trim() !== '')
  ).length;

  const growthValidSelectedCount = growthDrafts.filter(
    (r) =>
      r.selected &&
      (r.dailyWeight.trim() !== '' ||
        r.dailyLength.trim() !== '' ||
        r.temperature.trim() !== '' ||
        r.remark.trim() !== '')
  ).length;

  const activeValidSelectedCount =
    targetTable === 'auto'
      ? routineValidSelectedCount + growthValidSelectedCount
      : targetTable === 'routine'
        ? routineValidSelectedCount
        : growthValidSelectedCount;

  const toggleAllSelected = (checked: boolean, scope: 'routine' | 'growth' | 'all' = 'all') => {
    if (scope === 'routine' || (scope === 'all' && (targetTable === 'routine' || targetTable === 'auto'))) {
      setRoutineDrafts((prev) => prev.map((r) => ({ ...r, selected: checked })));
    }
    if (scope === 'growth' || (scope === 'all' && (targetTable === 'growth' || targetTable === 'auto'))) {
      setGrowthDrafts((prev) => prev.map((r) => ({ ...r, selected: checked })));
    }
  };

  const addBlankRows = (count = 1, which?: 'routine' | 'growth') => {
    const target = which ?? (targetTable === 'growth' ? 'growth' : 'routine');
    if (target === 'routine') {
      setRoutineDrafts((prev) => [
        ...prev,
        ...Array.from({ length: count }, (_, i) =>
          createEmptyRoutineRow(defaultDate, defaultLogger.trim(), prev.length + i)
        ),
      ]);
    } else {
      setGrowthDrafts((prev) => [
        ...prev,
        ...Array.from({ length: count }, (_, i) =>
          createEmptyGrowthRow(defaultDate, defaultLogger.trim(), prev.length + i)
        ),
      ]);
    }
  };

  const clearTabularRows = () => {
    setAiSummary(null);
    setErrorMessage(null);
    setSuccessMessage(null);
    if (targetTable === 'routine' || targetTable === 'auto') {
      setRoutineDrafts([createEmptyRoutineRow(defaultDate, defaultLogger.trim(), 0)]);
    }
    if (targetTable === 'growth' || targetTable === 'auto') {
      setGrowthDrafts([createEmptyGrowthRow(defaultDate, defaultLogger.trim(), 0)]);
    }
  };

  const parseSafeInt = (raw: string): number | null => {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    const n = Number(trimmed);
    return Number.isFinite(n) ? Math.round(n) : null;
  };

  const parseSafeFloat = (raw: string): number | null => {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    const n = Number(trimmed);
    return Number.isFinite(n) ? n : null;
  };

  // Direct write to Supabase ONLY from Tabular Data Entry
  const handleSaveTabularToDatabase = async () => {
    setErrorMessage(null);
    setSuccessMessage(null);

    if (activeValidSelectedCount === 0) {
      setErrorMessage(
        targetTable === 'auto'
          ? 'Enter at least one selected Routine or Growth row before saving to the database.'
          : targetTable === 'routine'
            ? 'Enter at least one selected routine row with EBM, Formula, Feed Duration, Diaper, or Remark.'
            : 'Enter at least one selected growth row with Daily Weight, Daily Length, Temperature, or Remark.'
      );
      return;
    }

    setIsImporting(true);
    try {
      const shouldSaveRoutine = targetTable === 'routine' || targetTable === 'auto';
      const shouldSaveGrowth = targetTable === 'growth' || targetTable === 'auto';

      const routineToInsert: NewRoutineRecordInput[] = shouldSaveRoutine
        ? routineDrafts
            .filter((r) => r.selected)
            .map((r) => ({
              profile_id: activeProfile?.id ?? null,
              name: r.name.trim() || null,
              date: r.date.trim() || null,
              time: r.time.trim() || null,
              'feed duration (min)': parseSafeInt(r.feedDurationMin),
              'EBM (mL)': parseSafeInt(r.ebmMl),
              'Formula (mL)': parseSafeInt(r.formulaMl),
              Diaper: r.diaper.trim() || null,
              remark: r.remark.trim() || null,
            }))
            .filter(
              (r) =>
                r['EBM (mL)'] !== null ||
                r['Formula (mL)'] !== null ||
                r['feed duration (min)'] !== null ||
                r.Diaper !== null ||
                r.remark !== null
            )
        : [];

      const growthToInsert: NewGrowthRecordInput[] = shouldSaveGrowth
        ? growthDrafts
            .filter((r) => r.selected)
            .map((r) => ({
              profile_id: activeProfile?.id ?? null,
              name: r.name.trim() || null,
              date: r.date.trim() || null,
              daily_weight: parseSafeFloat(r.dailyWeight),
              daily_length: parseSafeFloat(r.dailyLength),
              temperature: parseSafeFloat(r.temperature),
              remark: r.remark.trim() || null,
            }))
            .filter(
              (r) =>
                r.daily_weight !== null ||
                r.daily_length !== null ||
                r.temperature !== null ||
                r.remark !== null
            )
        : [];

      if (routineToInsert.length === 0 && growthToInsert.length === 0) {
        setErrorMessage('No valid selected rows contain saveable data. Check row values and try again.');
        return;
      }

      let savedRoutineCount = 0;
      let savedGrowthCount = 0;
      const errors: string[] = [];

      if (routineToInsert.length > 0) {
        const res = await addRoutineRecordsBulk(routineToInsert);
        savedRoutineCount = res.records.length;
        if (res.error) {
          errors.push(`Routine: ${res.error}`);
        } else if (savedRoutineCount === 0) {
          errors.push('Routine: Supabase returned 0 saved rows. Please verify table permissions.');
        }
        if (!res.error && savedRoutineCount > 0) {
          setRoutineDrafts([createEmptyRoutineRow(defaultDate, defaultLogger.trim(), 0)]);
        }
      }

      if (growthToInsert.length > 0) {
        const res = await addGrowthRecordsBulk(growthToInsert);
        savedGrowthCount = res.records.length;
        if (res.error) {
          errors.push(`Growth: ${res.error}`);
        } else if (savedGrowthCount === 0) {
          errors.push('Growth: Supabase returned 0 saved rows. Please verify table permissions.');
        }
        if (!res.error && savedGrowthCount > 0) {
          setGrowthDrafts([createEmptyGrowthRow(defaultDate, defaultLogger.trim(), 0)]);
        }
      }

      if (errors.length > 0) {
        setErrorMessage(errors.join(' | '));
      }

      if (savedRoutineCount > 0 || savedGrowthCount > 0) {
        const parts: string[] = [];
        if (savedRoutineCount > 0) {
          parts.push(
            `${savedRoutineCount} row${savedRoutineCount === 1 ? '' : 's'} into "routine"`
          );
        }
        if (savedGrowthCount > 0) {
          parts.push(
            `${savedGrowthCount} row${savedGrowthCount === 1 ? '' : 's'} into "growth"`
          );
        }
        setSuccessMessage(`Saved ${parts.join(' and ')} in Supabase.`);
        if (errors.length === 0) {
          setAiSummary(null);
        }
      }
    } catch (err) {
      setErrorMessage(
        err instanceof Error
          ? `Failed to save rows to Supabase: ${err.message}`
          : 'Failed to save rows to Supabase.'
      );
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-stone-950/55 backdrop-blur-xs flex items-center justify-center p-3 sm:p-5"
      onClick={() => {
        if (!isAnalyzing && !isImporting) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="mass-import-modal-title"
    >
      <div
        className="w-full max-w-6xl bg-white dark:bg-stone-900 rounded-3xl border border-stone-200 dark:border-stone-800 shadow-2xl overflow-hidden max-h-[92vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Persistent off-screen file inputs paired natively with htmlFor labels (never display:none, never nested inside labels) */}
        <input
          key={`camera-file-${cameraInputKey}`}
          id={cameraInputId}
          type="file"
          accept="image/*"
          capture="environment"
          onChange={handleCameraFallbackChange}
          tabIndex={-1}
          className="fixed -top-24 -left-24 w-1 h-1 opacity-0"
          aria-hidden="true"
        />
        <input
          key={`photo-file-${photoInputKey}`}
          id={photoInputId}
          type="file"
          accept="image/*"
          multiple
          onChange={handlePhotoFileChange}
          tabIndex={-1}
          className="fixed -top-24 -left-24 w-1 h-1 opacity-0"
          aria-hidden="true"
        />
        <input
          key={`upload-file-${fileInputKey}`}
          id={fileInputId}
          type="file"
          accept=".csv,.tsv,.txt,.md,.json,.pdf,image/*,text/csv,text/plain,application/json,application/pdf"
          multiple
          onChange={handleUploadFileChange}
          tabIndex={-1}
          className="fixed -top-24 -left-24 w-1 h-1 opacity-0"
          aria-hidden="true"
        />
        {/* Header */}
        <div className="px-5 py-4 border-b border-stone-100 dark:border-stone-800 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-2xl bg-emerald-100 dark:bg-emerald-950/70 text-emerald-700 dark:text-emerald-300 flex items-center justify-center shrink-0">
              <Sparkles className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h3
                  id="mass-import-modal-title"
                  className="text-sm sm:text-base font-bold text-stone-900 dark:text-white"
                >
                  Mass Import
                </h3>
                {activeProfile && (
                  <span className="text-[11px] font-semibold px-2 py-0.5 rounded-lg bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300">
                    Profile: {activeProfile.name}
                  </span>
                )}
              </div>
              <p className="text-[11px] text-stone-500 dark:text-stone-400">
                Enter rows directly in Tabular Entry, or use Camera, Photo, or File Upload to let Gemini recognize and load rows into Tabular Entry before saving.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            disabled={isAnalyzing || isImporting}
            className="p-1.5 rounded-xl text-stone-400 hover:text-stone-700 dark:hover:text-stone-200 hover:bg-stone-100 dark:hover:bg-stone-800 transition-colors cursor-pointer disabled:opacity-40"
            aria-label="Close mass import window"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4 overflow-y-auto flex-1">
          {/* Top Bar: Target Table + Defaults */}
          <div className="grid grid-cols-2 md:grid-cols-12 gap-2.5 sm:gap-3 items-end">
            <div className="col-span-2 md:col-span-6">
              <label className="block text-[11px] font-semibold text-stone-600 dark:text-stone-300 mb-1.5">
                Target Table
              </label>
              <div className="grid grid-cols-3 gap-1 p-1 bg-stone-100 dark:bg-stone-800 rounded-xl border border-stone-200 dark:border-stone-700">
                <button
                  type="button"
                  onClick={() => handleSwitchTable('auto')}
                  className={`px-2 py-1.5 text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-1 cursor-pointer ${
                    targetTable === 'auto'
                      ? 'bg-white dark:bg-stone-900 text-indigo-700 dark:text-indigo-400 shadow-2xs'
                      : 'text-stone-600 dark:text-stone-400 hover:text-stone-900 dark:hover:text-white'
                  }`}
                >
                  <Sparkles className="w-3.5 h-3.5 shrink-0" />
                  <span className="truncate">Auto (Both)</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleSwitchTable('routine')}
                  className={`px-2 py-1.5 text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-1 cursor-pointer ${
                    targetTable === 'routine'
                      ? 'bg-white dark:bg-stone-900 text-emerald-700 dark:text-emerald-400 shadow-2xs'
                      : 'text-stone-600 dark:text-stone-400 hover:text-stone-900 dark:hover:text-white'
                  }`}
                >
                  <Droplets className="w-3.5 h-3.5 shrink-0" />
                  <span>Routine</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleSwitchTable('growth')}
                  className={`px-2 py-1.5 text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-1 cursor-pointer ${
                    targetTable === 'growth'
                      ? 'bg-white dark:bg-stone-900 text-amber-700 dark:text-amber-400 shadow-2xs'
                      : 'text-stone-600 dark:text-stone-400 hover:text-stone-900 dark:hover:text-white'
                  }`}
                >
                  <Scale className="w-3.5 h-3.5 shrink-0" />
                  <span>Growth</span>
                </button>
              </div>
            </div>

            <div className="min-w-0 col-span-1 md:col-span-3">
              <label className="block text-[11px] font-semibold text-stone-600 dark:text-stone-300 mb-1.5">
                Default Logged By
              </label>
              <input
                type="text"
                value={defaultLogger}
                onChange={(e) => setDefaultLogger(e.target.value)}
                placeholder="e.g. Mom, Dad..."
                className="w-full min-w-0 px-2.5 sm:px-3 py-2 text-xs bg-stone-50 dark:bg-stone-800 border border-stone-200 dark:border-stone-700 text-stone-900 dark:text-white rounded-xl focus:outline-hidden focus:border-emerald-500"
              />
            </div>

            <div className="min-w-0 col-span-1 md:col-span-3">
              <label className="block text-[11px] font-semibold text-stone-600 dark:text-stone-300 mb-1.5">
                Default Date
              </label>
              <input
                type="date"
                value={defaultDate}
                onChange={(e) => setDefaultDate(e.target.value)}
                className="w-full min-w-0 px-2.5 sm:px-3 py-2 text-xs bg-stone-50 dark:bg-stone-800 border border-stone-200 dark:border-stone-700 text-stone-900 dark:text-white rounded-xl focus:outline-hidden focus:border-emerald-500"
              />
            </div>
          </div>

          {/* 4 Entry Mode Tabs */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 p-1.5 bg-stone-100 dark:bg-stone-850 rounded-2xl border border-stone-200 dark:border-stone-800">
            <button
              type="button"
              onClick={() => handleSwitchMode('tabular')}
              className={`px-3 py-2 text-xs font-semibold rounded-xl transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                entryMode === 'tabular'
                  ? 'bg-white dark:bg-stone-900 text-stone-900 dark:text-white shadow-xs font-bold'
                  : 'text-stone-600 dark:text-stone-400 hover:text-stone-900 dark:hover:text-white'
              }`}
            >
              <Table2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
              <span>Tabular Entry</span>
              {activeValidSelectedCount > 0 && (
                <span className="text-[10px] font-mono px-1.5 py-0.2 rounded-md bg-emerald-100 dark:bg-emerald-950/70 text-emerald-800 dark:text-emerald-300">
                  {activeValidSelectedCount}
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={() => handleSwitchMode('camera')}
              className={`px-3 py-2 text-xs font-semibold rounded-xl transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                entryMode === 'camera'
                  ? 'bg-white dark:bg-stone-900 text-stone-900 dark:text-white shadow-xs font-bold'
                  : 'text-stone-600 dark:text-stone-400 hover:text-stone-900 dark:hover:text-white'
              }`}
            >
              <Camera className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400" />
              <span>Camera Entry</span>
              {cameraPhotos.length > 0 && (
                <span className="text-[10px] font-mono px-1.5 py-0.2 rounded-md bg-sky-100 dark:bg-sky-950/70 text-sky-800 dark:text-sky-300">
                  {cameraPhotos.length}
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={() => handleSwitchMode('photo')}
              className={`px-3 py-2 text-xs font-semibold rounded-xl transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                entryMode === 'photo'
                  ? 'bg-white dark:bg-stone-900 text-stone-900 dark:text-white shadow-xs font-bold'
                  : 'text-stone-600 dark:text-stone-400 hover:text-stone-900 dark:hover:text-white'
              }`}
            >
              <ImageIcon className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
              <span>Photo Entry</span>
              {selectedPhotos.length > 0 && (
                <span className="text-[10px] font-mono px-1.5 py-0.2 rounded-md bg-amber-100 dark:bg-amber-950/70 text-amber-800 dark:text-amber-300">
                  {selectedPhotos.length}
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={() => handleSwitchMode('file')}
              className={`px-3 py-2 text-xs font-semibold rounded-xl transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                entryMode === 'file'
                  ? 'bg-white dark:bg-stone-900 text-stone-900 dark:text-white shadow-xs font-bold'
                  : 'text-stone-600 dark:text-stone-400 hover:text-stone-900 dark:hover:text-white'
              }`}
            >
              <Upload className="w-3.5 h-3.5 text-teal-600 dark:text-teal-400" />
              <span>File Upload</span>
              {uploadedFiles.length > 0 && (
                <span className="text-[10px] font-mono px-1.5 py-0.2 rounded-md bg-teal-100 dark:bg-teal-950/70 text-teal-800 dark:text-teal-300">
                  {uploadedFiles.length}
                </span>
              )}
            </button>
          </div>

          {/* Global Alerts */}
          {errorMessage && (
            <div className="px-3.5 py-2.5 rounded-2xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/60 text-xs text-rose-800 dark:text-rose-300 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{errorMessage}</span>
            </div>
          )}

          {successMessage && (
            <div className="px-3.5 py-2.5 rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900/60 text-xs text-emerald-800 dark:text-emerald-300 flex items-center gap-2 font-semibold">
              <Check className="w-4 h-4 shrink-0" />
              <span>{successMessage}</span>
            </div>
          )}

          {/* MODE 1: CAMERA ENTRY (supports snapping multiple photos -> Gemini -> fills Tabular Entry) */}
          {entryMode === 'camera' && (
            <div className="rounded-2xl border border-stone-200 dark:border-stone-800 p-4 sm:p-5 space-y-4 bg-stone-50/50 dark:bg-stone-800/30">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h4 className="text-xs font-bold text-stone-900 dark:text-white">
                    Camera Entry (Gemini Recognition — Multiple Pages Supported)
                  </h4>
                  <p className="text-[11px] text-stone-500 dark:text-stone-400">
                    Snap one or more photos (up to {MAX_MULTI_FILES}) of handwritten logs, clinic charts, or feeding sheets. Gemini recognizes all photos together into Tabular Entry.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {!cameraActive && (
                    <button
                      type="button"
                      onClick={() => void startCamera()}
                      className="px-3 py-1.5 text-xs font-bold text-white bg-stone-900 hover:bg-stone-800 dark:bg-stone-100 dark:hover:bg-white dark:text-stone-900 rounded-xl flex items-center gap-1.5 cursor-pointer"
                    >
                      <Camera className="w-3.5 h-3.5" />
                      <span>Start Live Camera</span>
                    </button>
                  )}
                  <label
                    htmlFor={cameraInputId}
                    className="px-3 py-1.5 text-xs font-semibold text-stone-700 dark:text-stone-200 bg-white dark:bg-stone-800 hover:bg-stone-100 dark:hover:bg-stone-700 border border-stone-200 dark:border-stone-700 rounded-xl flex items-center gap-1.5 cursor-pointer select-none"
                  >
                    <Camera className="w-3.5 h-3.5" />
                    <span>
                      {cameraPhotos.length > 0 ? 'Add Device Capture' : 'Capture / Device Camera'}
                    </span>
                  </label>
                </div>
              </div>

              {cameraError && (
                <div className="px-3 py-2 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900/60 text-xs text-amber-900 dark:text-amber-200">
                  {cameraError}
                </div>
              )}

              {cameraActive && (
                <div className="space-y-3">
                  <div className="relative rounded-2xl overflow-hidden bg-black aspect-video max-h-80 mx-auto">
                    <video
                      ref={videoRef}
                      playsInline
                      muted
                      className="w-full h-full object-contain"
                    />
                  </div>
                  <div className="flex items-center justify-center gap-2">
                    <button
                      type="button"
                      onClick={captureFromCamera}
                      disabled={cameraPhotos.length >= MAX_MULTI_FILES}
                      className="px-4 py-2 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                    >
                      <Camera className="w-3.5 h-3.5" />
                      <span>
                        {cameraPhotos.length > 0
                          ? `Take Snapshot #${cameraPhotos.length + 1}`
                          : 'Take Snapshot'}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={stopCameraStream}
                      className="px-3.5 py-2 text-xs font-semibold text-stone-700 dark:text-stone-200 bg-white dark:bg-stone-800 border border-stone-200 dark:border-stone-700 rounded-xl cursor-pointer"
                    >
                      Done Capturing
                    </button>
                  </div>
                </div>
              )}

              {cameraPhotos.length > 0 && (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2.5">
                    {cameraPhotos.map((photo, idx) => (
                      <div
                        key={photo.id}
                        className="relative group rounded-xl overflow-hidden border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900"
                      >
                        {photo.previewUrl ? (
                          <img
                            src={photo.previewUrl}
                            alt={`Camera capture ${idx + 1}`}
                            className="w-full h-28 object-cover"
                          />
                        ) : (
                          <div className="w-full h-28 flex flex-col items-center justify-center gap-1 p-2 text-[11px] text-stone-500">
                            <ImageIcon className="w-5 h-5 text-emerald-600" />
                            <span className="truncate max-w-full">{photo.fileName}</span>
                          </div>
                        )}
                        <div className="px-2 py-1 text-[10px] font-medium text-stone-600 dark:text-stone-300 truncate bg-stone-50 dark:bg-stone-800/80 border-t border-stone-200 dark:border-stone-700">
                          #{idx + 1} · {photo.fileName}
                        </div>
                        <button
                          type="button"
                          onClick={() =>
                            setCameraPhotos((prev) => prev.filter((item) => item.id !== photo.id))
                          }
                          className="absolute top-1.5 right-1.5 p-1 rounded-lg bg-stone-900/75 text-white hover:bg-rose-600 transition-colors cursor-pointer"
                          title="Remove photo"
                          aria-label={`Remove camera photo ${idx + 1}`}
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => setCameraPhotos([])}
                      className="px-3 py-1.5 text-xs font-semibold text-stone-600 dark:text-stone-300 bg-white dark:bg-stone-800 border border-stone-200 dark:border-stone-700 rounded-xl flex items-center gap-1.5 cursor-pointer"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      <span>Clear All ({cameraPhotos.length})</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleRecognizeWithGemini('camera')}
                      disabled={isAnalyzing || isReadingFile}
                      className="px-4 py-2 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 dark:bg-emerald-500 dark:hover:bg-emerald-400 dark:text-stone-950 rounded-xl shadow-xs flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                    >
                      {isAnalyzing ? (
                        <>
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          <span>Recognizing {cameraPhotos.length} photo{cameraPhotos.length === 1 ? '' : 's'}...</span>
                        </>
                      ) : (
                        <>
                          <Sparkles className="w-3.5 h-3.5" />
                          <span>
                            Recognize {cameraPhotos.length} Photo{cameraPhotos.length === 1 ? '' : 's'} &amp; Fill Tabular Entry
                          </span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* MODE 2: PHOTO ENTRY (multiple photos/screenshots -> Gemini -> fills Tabular Entry) */}
          {entryMode === 'photo' && (
            <div
              onPaste={handlePhotoPaste}
              onDragOver={(e) => {
                e.preventDefault();
                setIsDraggingPhoto(true);
              }}
              onDragLeave={() => setIsDraggingPhoto(false)}
              onDrop={handlePhotoDrop}
              className={`rounded-2xl border p-4 sm:p-5 space-y-4 transition-colors ${
                isDraggingPhoto
                  ? 'border-emerald-500 bg-emerald-50/40 dark:bg-emerald-950/30'
                  : 'border-stone-200 dark:border-stone-800 bg-stone-50/50 dark:bg-stone-800/30'
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h4 className="text-xs font-bold text-stone-900 dark:text-white">
                    Photo Entry (Gemini Recognition — Multiple Photos Supported)
                  </h4>
                  <p className="text-[11px] text-stone-500 dark:text-stone-400">
                    Choose, drop, or paste one or more photos/screenshots (up to {MAX_MULTI_FILES}). Gemini recognizes all photos in one go and populates Tabular Entry.
                  </p>
                </div>
                <label
                  htmlFor={photoInputId}
                  className="px-3.5 py-2 text-xs font-bold text-white bg-stone-900 hover:bg-stone-800 dark:bg-stone-100 dark:hover:bg-white dark:text-stone-900 rounded-xl inline-flex items-center gap-1.5 cursor-pointer select-none"
                >
                  <ImageIcon className="w-3.5 h-3.5" />
                  <span>
                    {isReadingFile
                      ? 'Loading Photos...'
                      : selectedPhotos.length > 0
                        ? 'Add More Photos'
                        : 'Select Photos / Screenshots'}
                  </span>
                </label>
              </div>

              {selectedPhotos.length > 0 ? (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2.5">
                    {selectedPhotos.map((photo, idx) => (
                      <div
                        key={photo.id}
                        className="relative group rounded-xl overflow-hidden border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900"
                      >
                        {photo.previewUrl ? (
                          <img
                            src={photo.previewUrl}
                            alt={photo.fileName}
                            className="w-full h-28 object-cover"
                          />
                        ) : (
                          <div className="w-full h-28 flex flex-col items-center justify-center gap-1 p-2 text-[11px] text-stone-500 dark:text-stone-400 text-center">
                            <ImageIcon className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
                            <span className="truncate max-w-full font-medium">{photo.fileName}</span>
                            <span className="text-[10px]">{photo.mimeType}</span>
                          </div>
                        )}
                        <div className="px-2 py-1 text-[10px] font-medium text-stone-600 dark:text-stone-300 truncate bg-stone-50 dark:bg-stone-800/80 border-t border-stone-200 dark:border-stone-700">
                          #{idx + 1} · {photo.fileName}
                        </div>
                        <button
                          type="button"
                          onClick={() =>
                            setSelectedPhotos((prev) => prev.filter((item) => item.id !== photo.id))
                          }
                          className="absolute top-1.5 right-1.5 p-1 rounded-lg bg-stone-900/75 text-white hover:bg-rose-600 transition-colors cursor-pointer"
                          title="Remove photo"
                          aria-label={`Remove ${photo.fileName}`}
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => setSelectedPhotos([])}
                      className="px-3 py-1.5 text-xs font-semibold text-stone-600 dark:text-stone-300 bg-white dark:bg-stone-800 border border-stone-200 dark:border-stone-700 rounded-xl flex items-center gap-1.5 cursor-pointer"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      <span>Clear All ({selectedPhotos.length})</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleRecognizeWithGemini('photo')}
                      disabled={isAnalyzing || isReadingFile}
                      className="px-4 py-2 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 dark:bg-emerald-500 dark:hover:bg-emerald-400 dark:text-stone-950 rounded-xl shadow-xs flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                    >
                      {isAnalyzing ? (
                        <>
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          <span>Recognizing {selectedPhotos.length} photo{selectedPhotos.length === 1 ? '' : 's'}...</span>
                        </>
                      ) : (
                        <>
                          <Sparkles className="w-3.5 h-3.5" />
                          <span>
                            Recognize {selectedPhotos.length} Photo{selectedPhotos.length === 1 ? '' : 's'} &amp; Fill Tabular Entry
                          </span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              ) : (
                <label
                  htmlFor={photoInputId}
                  className={`w-full py-10 rounded-2xl border-2 border-dashed transition-colors flex flex-col items-center justify-center gap-2 text-xs text-stone-500 dark:text-stone-400 cursor-pointer select-none ${
                    isDraggingPhoto
                      ? 'border-emerald-500 bg-emerald-50/50 dark:bg-emerald-950/30'
                      : 'border-stone-200 dark:border-stone-700 hover:border-emerald-400 dark:hover:border-emerald-600'
                  }`}
                >
                  {isReadingFile ? (
                    <>
                      <Loader2 className="w-7 h-7 text-emerald-500 animate-spin" />
                      <span className="font-semibold text-stone-700 dark:text-stone-300">
                        Preparing photos...
                      </span>
                    </>
                  ) : (
                    <>
                      <ImageIcon className="w-7 h-7 text-stone-400" />
                      <span className="font-semibold text-stone-700 dark:text-stone-300">
                        Tap or drop multiple photos / screenshots (PNG, JPG, HEIC, WEBP)
                      </span>
                      <span className="text-[11px]">
                        Up to {MAX_MULTI_FILES} photos recognized in a single Gemini call
                      </span>
                    </>
                  )}
                </label>
              )}
            </div>
          )}

          {/* MODE 3: FILE UPLOAD ENTRY (multiple files -> Gemini -> fills Tabular Entry) */}
          {entryMode === 'file' && (
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setIsDraggingFiles(true);
              }}
              onDragLeave={() => setIsDraggingFiles(false)}
              onDrop={handleUploadFileDrop}
              className={`rounded-2xl border p-4 sm:p-5 space-y-3.5 transition-colors ${
                isDraggingFiles
                  ? 'border-emerald-500 bg-emerald-50/40 dark:bg-emerald-950/30'
                  : 'border-stone-200 dark:border-stone-800 bg-stone-50/50 dark:bg-stone-800/30'
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h4 className="text-xs font-bold text-stone-900 dark:text-white">
                    File Upload Entry (Gemini Recognition — Multiple Files Supported)
                  </h4>
                  <p className="text-[11px] text-stone-500 dark:text-stone-400">
                    Upload or drop multiple CSV, TSV, TXT, JSON, PDF, or photo files (up to {MAX_MULTI_FILES}) — or paste raw notes below. Gemini parses everything together into Tabular Entry.
                  </p>
                </div>
                <label
                  htmlFor={fileInputId}
                  className="px-3.5 py-2 text-xs font-bold text-white bg-stone-900 hover:bg-stone-800 dark:bg-stone-100 dark:hover:bg-white dark:text-stone-900 rounded-xl inline-flex items-center gap-1.5 cursor-pointer select-none"
                >
                  <Upload className="w-3.5 h-3.5" />
                  <span>
                    {isReadingFile
                      ? 'Loading Files...'
                      : uploadedFiles.length > 0
                        ? 'Add More Files'
                        : 'Choose Files'}
                  </span>
                </label>
              </div>

              {uploadedFiles.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-[11px] text-stone-600 dark:text-stone-400">
                    <span className="font-semibold">
                      Queued Files ({uploadedFiles.length}/{MAX_MULTI_FILES})
                    </span>
                    <button
                      type="button"
                      onClick={() => setUploadedFiles([])}
                      className="text-stone-500 hover:text-rose-600 dark:hover:text-rose-400 font-semibold cursor-pointer"
                    >
                      Clear All Files
                    </button>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {uploadedFiles.map((item) => (
                      <div
                        key={item.id}
                        className="flex items-center justify-between gap-2 px-3 py-2 rounded-xl bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-700 text-xs"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          {item.binary?.previewUrl ? (
                            <img
                              src={item.binary.previewUrl}
                              alt={item.fileName}
                              className="w-7 h-7 rounded-lg object-cover shrink-0 border border-stone-200 dark:border-stone-700"
                            />
                          ) : item.kind === 'binary' && item.binary?.mimeType.startsWith('image/') ? (
                            <ImageIcon className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
                          ) : (
                            <FileText className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                          )}
                          <div className="min-w-0">
                            <div className="font-semibold text-stone-800 dark:text-stone-200 truncate">
                              {item.fileName}
                            </div>
                            <div className="text-[10px] text-stone-500 dark:text-stone-400">
                              {item.kind === 'text'
                                ? `${(item.textContent?.length ?? 0).toLocaleString()} chars`
                                : item.binary?.mimeType === 'application/pdf'
                                  ? 'PDF document'
                                  : item.binary?.mimeType || 'Binary attachment'}
                            </div>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() =>
                            setUploadedFiles((prev) => prev.filter((f) => f.id !== item.id))
                          }
                          className="text-stone-400 hover:text-rose-600 cursor-pointer p-1 shrink-0"
                          title="Remove file"
                          aria-label={`Remove ${item.fileName}`}
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <textarea
                rows={uploadedFiles.length > 0 ? 3 : 5}
                value={uploadedTextContent}
                onChange={(e) => setUploadedTextContent(e.target.value)}
                placeholder={
                  targetTable === 'auto'
                    ? 'Optional: paste additional mixed Routine & Growth notes or CSV rows here:\n2026-11-24 07:30 Mom, 20min, EBM 90ml, Wet diaper\n2026-11-24 Mom, Weight 5.21 kg, Length 59 cm, Temp 36.7C'
                    : targetTable === 'routine'
                      ? 'Optional: paste additional Routine rows or chat logs here:\n2026-11-24 07:30 Mom, 20min, EBM 90ml, Formula 30ml, Wet diaper\n2026-11-24 10:45 Dad, 15min, EBM 110ml, Mixed, burped well'
                      : 'Optional: paste additional Growth logs here:\n2026-11-22 Mom, 5.12 kg, 58.5 cm, 36.7C, morning check\n2026-11-24 Dad, 5210g, 59cm, 98.4F, before feed'
                }
                className="w-full px-3.5 py-2.5 text-xs font-mono bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-700 text-stone-900 dark:text-white rounded-2xl focus:outline-hidden focus:border-emerald-500 resize-y"
              />

              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-[11px] text-stone-500 dark:text-stone-400">
                  {targetTable === 'auto'
                    ? 'Auto-splits Routine (feeds/diapers) & Growth (weight/length/temp) across all uploaded files.'
                    : targetTable === 'routine'
                      ? 'Auto-maps to Routine fields (converts oz → mL, 12h → 24h time).'
                      : 'Auto-maps to Growth fields (converts g/lb → kg, in → cm, °F → °C).'}
                </span>
                <button
                  type="button"
                  onClick={() => void handleRecognizeWithGemini('file')}
                  disabled={
                    isAnalyzing ||
                    isReadingFile ||
                    (uploadedFiles.length === 0 && !uploadedTextContent.trim())
                  }
                  className="px-4 py-2 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 dark:bg-emerald-500 dark:hover:bg-emerald-400 dark:text-stone-950 rounded-xl shadow-xs flex items-center gap-1.5 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isAnalyzing ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>
                        Recognizing
                        {uploadedFiles.length > 0
                          ? ` ${uploadedFiles.length} file${uploadedFiles.length === 1 ? '' : 's'}...`
                          : ' with Gemini...'}
                      </span>
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-3.5 h-3.5" />
                      <span>
                        {uploadedFiles.length > 1
                          ? `Recognize ${uploadedFiles.length} Files & Fill Tabular Entry`
                          : 'Recognize & Fill Tabular Entry'}
                      </span>
                    </>
                  )}
                </button>
              </div>
            </div>
          )}

          {/* MODE 4: DIRECT TABULAR DATA ENTRY (sole direct writer to Supabase, matching Routine & Growth logging grids) */}
          {entryMode === 'tabular' && (
            <div className="rounded-2xl border border-stone-200 dark:border-stone-800 overflow-hidden bg-stone-50/50 dark:bg-stone-950/30">
              <div className="px-4 py-3 bg-stone-50 dark:bg-stone-800/70 border-b border-stone-200 dark:border-stone-800 flex flex-wrap items-center justify-between gap-2">
                <div className="space-y-0.5">
                  <div className="text-xs font-bold text-stone-900 dark:text-white">
                    Direct Tabular Data Entry —{' '}
                    <span className="font-mono">
                      {targetTable === 'auto' ? 'routine + growth' : targetTable}
                    </span>{' '}
                    ({activeValidSelectedCount} ready to save)
                  </div>
                  {aiSummary ? (
                    <div className="text-[11px] text-emerald-700 dark:text-emerald-400 font-medium">
                      Gemini: {aiSummary}
                    </div>
                  ) : (
                    <div className="text-[11px] text-stone-500 dark:text-stone-400">
                      Only rows here are written to the database. Layout matches the{' '}
                      {targetTable === 'auto'
                        ? 'Routine & Growth'
                        : targetTable === 'routine'
                          ? 'Routine'
                          : 'Growth'}{' '}
                      logging grid.
                    </div>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                  <label className="px-2.5 py-1.5 text-[11px] font-semibold text-stone-700 dark:text-stone-200 bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-700 rounded-lg inline-flex items-center gap-1.5 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      aria-label="Select all rows"
                      checked={
                        targetTable === 'auto'
                          ? routineDrafts.every((r) => r.selected) &&
                            growthDrafts.every((r) => r.selected)
                          : targetTable === 'routine'
                            ? routineDrafts.length > 0 && routineDrafts.every((r) => r.selected)
                            : growthDrafts.length > 0 && growthDrafts.every((r) => r.selected)
                      }
                      onChange={(e) => toggleAllSelected(e.target.checked, 'all')}
                      className={
                        targetTable === 'growth'
                          ? 'accent-amber-600 cursor-pointer'
                          : 'accent-emerald-600 cursor-pointer'
                      }
                    />
                    <span>All</span>
                  </label>
                  {targetTable === 'auto' ? (
                    <>
                      <button
                        type="button"
                        onClick={() => addBlankRows(1, 'routine')}
                        className="px-2.5 py-1.5 text-[11px] font-semibold text-emerald-700 dark:text-emerald-300 bg-white dark:bg-stone-900 hover:bg-emerald-50 dark:hover:bg-stone-800 border border-stone-200 dark:border-stone-700 rounded-lg flex items-center gap-1 cursor-pointer"
                      >
                        <Plus className="w-3 h-3" />
                        <span>Routine</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => addBlankRows(1, 'growth')}
                        className="px-2.5 py-1.5 text-[11px] font-semibold text-amber-700 dark:text-amber-300 bg-white dark:bg-stone-900 hover:bg-amber-50 dark:hover:bg-stone-800 border border-stone-200 dark:border-stone-700 rounded-lg flex items-center gap-1 cursor-pointer"
                      >
                        <Plus className="w-3 h-3" />
                        <span>Growth</span>
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => addBlankRows(1)}
                        className="px-2.5 py-1.5 text-[11px] font-semibold text-stone-700 dark:text-stone-200 bg-white dark:bg-stone-900 hover:bg-stone-100 dark:hover:bg-stone-800 border border-stone-200 dark:border-stone-700 rounded-lg flex items-center gap-1 cursor-pointer"
                      >
                        <Plus className="w-3 h-3" />
                        <span>Add Row</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => addBlankRows(5)}
                        className="px-2.5 py-1.5 text-[11px] font-semibold text-stone-700 dark:text-stone-200 bg-white dark:bg-stone-900 hover:bg-stone-100 dark:hover:bg-stone-800 border border-stone-200 dark:border-stone-700 rounded-lg cursor-pointer"
                      >
                        +5 Rows
                      </button>
                    </>
                  )}
                  <button
                    type="button"
                    onClick={clearTabularRows}
                    className="px-2.5 py-1.5 text-[11px] font-semibold text-stone-500 hover:text-rose-600 dark:text-stone-400 dark:hover:text-rose-400 rounded-lg cursor-pointer"
                  >
                    Clear
                  </button>
                </div>
              </div>

              {activeFlaggedCount > 0 && (
                <div className="px-4 py-2.5 bg-amber-50/90 dark:bg-amber-950/40 border-b border-amber-200/80 dark:border-amber-900/60 flex flex-wrap items-center justify-between gap-2 text-xs text-amber-900 dark:text-amber-200">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
                    <span>
                      <strong>
                        {activeFlaggedCount} {activeFlaggedCount === 1 ? 'entry' : 'entries'}
                      </strong>{' '}
                      may already exist in your database. Exact matches are unchecked by default — review or check to import anyway.
                    </span>
                  </div>
                  {activeFlaggedSelectedCount > 0 && (
                    <button
                      type="button"
                      onClick={uncheckAllFlagged}
                      className="px-2.5 py-1 text-[11px] font-bold text-amber-900 dark:text-amber-200 bg-white dark:bg-stone-900 hover:bg-amber-100 dark:hover:bg-amber-900/50 border border-amber-300 dark:border-amber-800 rounded-lg cursor-pointer"
                    >
                      Uncheck All Flagged ({activeFlaggedSelectedCount})
                    </button>
                  )}
                </div>
              )}

              <div className="p-3 sm:p-4 space-y-4 max-h-[50vh] overflow-y-auto">
                {(targetTable === 'routine' || targetTable === 'auto') && (
                  <div className="space-y-3">
                    {targetTable === 'auto' && (
                      <div className="flex items-center justify-between gap-2 px-1">
                        <div className="flex items-center gap-1.5 text-xs font-bold text-emerald-700 dark:text-emerald-400">
                          <Droplets className="w-3.5 h-3.5" />
                          <span>Routine Entries ({routineValidSelectedCount} ready)</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => addBlankRows(1, 'routine')}
                          className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-400 hover:underline cursor-pointer"
                        >
                          + Add Routine Row
                        </button>
                      </div>
                    )}
                    {/* Exact RoutineView logging grid: grid-cols-2 lg:grid-cols-4 (Logged By, Date, Time, Feed Duration, EBM, Formula, Diaper col-span-2) + Remark */}
                    {routineDrafts.map((row, idx) => {
                      const dupMatch = routineDupMap.get(row._key);
                      return (
                    <div
                      key={row._key}
                      className={`rounded-2xl border p-3 sm:p-4 space-y-3 transition-opacity ${
                        dupMatch
                          ? row.selected
                            ? 'bg-amber-50/35 dark:bg-amber-950/20 border-amber-300 dark:border-amber-800 shadow-2xs'
                            : 'bg-amber-50/20 dark:bg-amber-950/15 border-amber-200/80 dark:border-amber-900/60 opacity-75'
                          : row.selected
                            ? 'bg-white dark:bg-stone-900 border-stone-200 dark:border-stone-800 shadow-2xs'
                            : 'bg-stone-100/70 dark:bg-stone-900/40 border-stone-200/70 dark:border-stone-800/60 opacity-60'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2 pb-2 border-b border-stone-100 dark:border-stone-800">
                        <div className="flex items-center gap-2 flex-wrap min-w-0">
                          <label className="inline-flex items-center gap-2 text-xs font-bold text-stone-800 dark:text-stone-200 cursor-pointer select-none">
                            <input
                              type="checkbox"
                              checked={row.selected}
                              onChange={(e) =>
                                setRoutineDrafts((prev) =>
                                  prev.map((item) =>
                                    item._key === row._key
                                      ? { ...item, selected: e.target.checked }
                                      : item
                                  )
                                )
                              }
                              className="accent-emerald-600 cursor-pointer"
                            />
                            <span>Routine Row #{idx + 1}</span>
                          </label>
                          {dupMatch && (
                            <span
                              className={`inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-bold rounded-md border ${
                                dupMatch.level === 'exact'
                                  ? 'bg-rose-100/90 dark:bg-rose-950/70 text-rose-800 dark:text-rose-300 border-rose-200 dark:border-rose-800'
                                  : 'bg-amber-100/90 dark:bg-amber-950/70 text-amber-900 dark:text-amber-300 border-amber-200 dark:border-amber-800'
                              }`}
                            >
                              <AlertTriangle className="w-3 h-3 shrink-0" />
                              <span>
                                {dupMatch.level === 'exact' ? 'Already in DB' : 'Possible Duplicate'}
                              </span>
                            </span>
                          )}
                        </div>

                        <button
                          type="button"
                          onClick={() =>
                            setRoutineDrafts((prev) =>
                              prev.length > 1
                                ? prev.filter((item) => item._key !== row._key)
                                : [createEmptyRoutineRow(defaultDate, defaultLogger.trim(), 0)]
                            )
                          }
                          className="p-1.5 rounded-lg text-stone-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors cursor-pointer"
                          title="Remove row"
                          aria-label={`Remove routine row ${idx + 1}`}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>

                      {dupMatch && (
                        <div className="px-2.5 py-1.5 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200/80 dark:border-amber-900/60 text-[11px] text-amber-900 dark:text-amber-200">
                          {dupMatch.reason}
                        </div>
                      )}

                      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-3">
                        <div className="min-w-0">
                          <label className="block text-[11px] font-semibold text-stone-600 dark:text-stone-300 mb-1">
                            Logged By
                          </label>
                          <input
                            type="text"
                            value={row.name}
                            onChange={(e) =>
                              setRoutineDrafts((prev) =>
                                prev.map((item) =>
                                  item._key === row._key
                                    ? { ...item, name: e.target.value }
                                    : item
                                )
                              )
                            }
                            placeholder="e.g. Mom, Dad, Caregiver"
                            className="w-full min-w-0 px-2.5 sm:px-3 py-2 text-xs bg-stone-50 dark:bg-stone-800 border border-stone-200 dark:border-stone-700 text-stone-900 dark:text-white rounded-xl focus:outline-hidden focus:border-emerald-500"
                          />
                        </div>

                        <div className="min-w-0">
                          <label className="block text-[11px] font-semibold text-stone-600 dark:text-stone-300 mb-1">
                            Date
                          </label>
                          <input
                            type="date"
                            value={row.date}
                            onChange={(e) =>
                              setRoutineDrafts((prev) =>
                                prev.map((item) =>
                                  item._key === row._key
                                    ? { ...item, date: e.target.value }
                                    : item
                                )
                              )
                            }
                            className="w-full min-w-0 px-2.5 sm:px-3 py-2 text-xs bg-stone-50 dark:bg-stone-800 border border-stone-200 dark:border-stone-700 text-stone-900 dark:text-white rounded-xl focus:outline-hidden focus:border-emerald-500"
                          />
                        </div>

                        <div className="min-w-0">
                          <label className="block text-[11px] font-semibold text-stone-600 dark:text-stone-300 mb-1">
                            Time
                          </label>
                          <input
                            type="time"
                            value={row.time}
                            onChange={(e) =>
                              setRoutineDrafts((prev) =>
                                prev.map((item) =>
                                  item._key === row._key
                                    ? { ...item, time: e.target.value }
                                    : item
                                )
                              )
                            }
                            className="w-full min-w-0 px-2.5 sm:px-3 py-2 text-xs bg-stone-50 dark:bg-stone-800 border border-stone-200 dark:border-stone-700 text-stone-900 dark:text-white rounded-xl focus:outline-hidden focus:border-emerald-500"
                          />
                        </div>

                        <div className="min-w-0">
                          <label className="block text-[11px] font-semibold text-stone-600 dark:text-stone-300 mb-1">
                            Feed Duration (min)
                          </label>
                          <input
                            type="number"
                            min="0"
                            step="1"
                            value={row.feedDurationMin}
                            onChange={(e) =>
                              setRoutineDrafts((prev) =>
                                prev.map((item) =>
                                  item._key === row._key
                                    ? { ...item, feedDurationMin: e.target.value }
                                    : item
                                )
                              )
                            }
                            placeholder="e.g. 20"
                            className="w-full min-w-0 px-2.5 sm:px-3 py-2 text-xs font-mono bg-stone-50 dark:bg-stone-800 border border-stone-200 dark:border-stone-700 text-stone-900 dark:text-white rounded-xl focus:outline-hidden focus:border-emerald-500"
                          />
                        </div>

                        <div className="min-w-0">
                          <label className="block text-[11px] font-semibold text-stone-600 dark:text-stone-300 mb-1">
                            EBM (mL)
                          </label>
                          <input
                            type="number"
                            min="0"
                            step="5"
                            value={row.ebmMl}
                            onChange={(e) =>
                              setRoutineDrafts((prev) =>
                                prev.map((item) =>
                                  item._key === row._key
                                    ? { ...item, ebmMl: e.target.value }
                                    : item
                                )
                              )
                            }
                            placeholder="e.g. 90"
                            className="w-full min-w-0 px-2.5 sm:px-3 py-2 text-xs font-mono bg-stone-50 dark:bg-stone-800 border border-stone-200 dark:border-stone-700 text-stone-900 dark:text-white rounded-xl focus:outline-hidden focus:border-emerald-500"
                          />
                        </div>

                        <div className="min-w-0">
                          <label className="block text-[11px] font-semibold text-stone-600 dark:text-stone-300 mb-1">
                            Formula (mL)
                          </label>
                          <input
                            type="number"
                            min="0"
                            step="5"
                            value={row.formulaMl}
                            onChange={(e) =>
                              setRoutineDrafts((prev) =>
                                prev.map((item) =>
                                  item._key === row._key
                                    ? { ...item, formulaMl: e.target.value }
                                    : item
                                )
                              )
                            }
                            placeholder="e.g. 60"
                            className="w-full min-w-0 px-2.5 sm:px-3 py-2 text-xs font-mono bg-stone-50 dark:bg-stone-800 border border-stone-200 dark:border-stone-700 text-stone-900 dark:text-white rounded-xl focus:outline-hidden focus:border-emerald-500"
                          />
                        </div>

                        <div className="min-w-0 col-span-2">
                          <label className="block text-[11px] font-semibold text-stone-600 dark:text-stone-300 mb-1">
                            Diaper
                          </label>
                          <div className="flex flex-wrap items-center gap-1.5">
                            {DIAPER_PRESETS.map((preset) => (
                              <button
                                key={preset}
                                type="button"
                                onClick={() =>
                                  setRoutineDrafts((prev) =>
                                    prev.map((item) =>
                                      item._key === row._key
                                        ? {
                                            ...item,
                                            diaper: item.diaper === preset ? '' : preset,
                                          }
                                        : item
                                    )
                                  )
                                }
                                className={`px-2.5 py-1.5 text-xs font-semibold rounded-xl border transition-colors cursor-pointer ${
                                  row.diaper === preset
                                    ? 'bg-emerald-600 text-white border-emerald-600'
                                    : 'bg-stone-50 dark:bg-stone-800 text-stone-700 dark:text-stone-300 border-stone-200 dark:border-stone-700 hover:bg-stone-100 dark:hover:bg-stone-700'
                                }`}
                              >
                                {preset}
                              </button>
                            ))}
                            <input
                              type="text"
                              value={row.diaper}
                              onChange={(e) =>
                                setRoutineDrafts((prev) =>
                                  prev.map((item) =>
                                    item._key === row._key
                                      ? { ...item, diaper: e.target.value }
                                      : item
                                  )
                                )
                              }
                              placeholder="Or custom..."
                              className="flex-1 min-w-[110px] px-2.5 sm:px-3 py-1.5 text-xs bg-stone-50 dark:bg-stone-800 border border-stone-200 dark:border-stone-700 text-stone-900 dark:text-white rounded-xl focus:outline-hidden focus:border-emerald-500"
                            />
                          </div>
                        </div>
                      </div>

                      <div className="min-w-0">
                        <label className="block text-[11px] font-semibold text-stone-600 dark:text-stone-300 mb-1">
                          Remark
                        </label>
                        <input
                          type="text"
                          value={row.remark}
                          onChange={(e) =>
                            setRoutineDrafts((prev) =>
                              prev.map((item) =>
                                item._key === row._key
                                  ? { ...item, remark: e.target.value }
                                  : item
                              )
                            )
                          }
                          placeholder="Optional observation (e.g. burped well, sleepy after feed)"
                          className="w-full min-w-0 px-2.5 sm:px-3 py-2 text-xs bg-stone-50 dark:bg-stone-800 border border-stone-200 dark:border-stone-700 text-stone-900 dark:text-white rounded-xl focus:outline-hidden focus:border-emerald-500"
                        />
                      </div>
                      </div>
                      );
                    })}
                  </div>
                )}

                {(targetTable === 'growth' || targetTable === 'auto') && (
                  <div className="space-y-3">
                    {targetTable === 'auto' && (
                      <div className="flex items-center justify-between gap-2 px-1 pt-2 border-t border-stone-200/80 dark:border-stone-800">
                        <div className="flex items-center gap-1.5 text-xs font-bold text-amber-700 dark:text-amber-400">
                          <Scale className="w-3.5 h-3.5" />
                          <span>Growth Entries ({growthValidSelectedCount} ready)</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => addBlankRows(1, 'growth')}
                          className="text-[11px] font-semibold text-amber-700 dark:text-amber-400 hover:underline cursor-pointer"
                        >
                          + Add Growth Row
                        </button>
                      </div>
                    )}
                    {/* Exact GrowthTabView logging grid: grid-cols-2 lg:grid-cols-5 (Logged By, Date, Daily Weight, Daily Length, Temperature col-span-2 lg:col-span-1) + Remark */}
                    {growthDrafts.map((row, idx) => {
                    const parsedTemp = parseFloat(row.temperature);
                    const liveTempPreview =
                      row.temperature.trim() !== '' && Number.isFinite(parsedTemp)
                        ? classifyTemperature(parsedTemp)
                        : null;
                    const dupMatch = growthDupMap.get(row._key);

                    return (
                      <div
                        key={row._key}
                        className={`rounded-2xl border p-3 sm:p-4 space-y-3 transition-opacity ${
                          dupMatch
                            ? row.selected
                              ? 'bg-amber-50/35 dark:bg-amber-950/20 border-amber-300 dark:border-amber-800 shadow-2xs'
                              : 'bg-amber-50/20 dark:bg-amber-950/15 border-amber-200/80 dark:border-amber-900/60 opacity-75'
                            : row.selected
                              ? 'bg-white dark:bg-stone-900 border-stone-200 dark:border-stone-800 shadow-2xs'
                              : 'bg-stone-100/70 dark:bg-stone-900/40 border-stone-200/70 dark:border-stone-800/60 opacity-60'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2 pb-2 border-b border-stone-100 dark:border-stone-800">
                          <div className="flex items-center gap-2 flex-wrap min-w-0">
                            <label className="inline-flex items-center gap-2 text-xs font-bold text-stone-800 dark:text-stone-200 cursor-pointer select-none">
                              <input
                                type="checkbox"
                                checked={row.selected}
                                onChange={(e) =>
                                  setGrowthDrafts((prev) =>
                                    prev.map((item) =>
                                      item._key === row._key
                                        ? { ...item, selected: e.target.checked }
                                        : item
                                    )
                                  )
                                }
                                className="accent-amber-600 cursor-pointer"
                              />
                              <span>Growth Row #{idx + 1}</span>
                            </label>
                            {dupMatch && (
                              <span
                                className={`inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-bold rounded-md border ${
                                  dupMatch.level === 'exact'
                                    ? 'bg-rose-100/90 dark:bg-rose-950/70 text-rose-800 dark:text-rose-300 border-rose-200 dark:border-rose-800'
                                    : 'bg-amber-100/90 dark:bg-amber-950/70 text-amber-900 dark:text-amber-300 border-amber-200 dark:border-amber-800'
                                }`}
                              >
                                <AlertTriangle className="w-3 h-3 shrink-0" />
                                <span>
                                  {dupMatch.level === 'exact' ? 'Already in DB' : 'Possible Duplicate'}
                                </span>
                              </span>
                            )}
                          </div>

                          <button
                            type="button"
                            onClick={() =>
                              setGrowthDrafts((prev) =>
                                prev.length > 1
                                  ? prev.filter((item) => item._key !== row._key)
                                  : [createEmptyGrowthRow(defaultDate, defaultLogger.trim(), 0)]
                              )
                            }
                            className="p-1.5 rounded-lg text-stone-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors cursor-pointer"
                            title="Remove row"
                            aria-label={`Remove growth row ${idx + 1}`}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>

                        {dupMatch && (
                          <div className="px-2.5 py-1.5 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200/80 dark:border-amber-900/60 text-[11px] text-amber-900 dark:text-amber-200">
                            {dupMatch.reason}
                          </div>
                        )}

                        <div className="grid grid-cols-2 lg:grid-cols-5 gap-2.5 sm:gap-3">
                          <div className="min-w-0">
                            <label className="block text-[11px] font-semibold text-stone-600 dark:text-stone-300 mb-1">
                              Logged By
                            </label>
                            <input
                              type="text"
                              value={row.name}
                              onChange={(e) =>
                                setGrowthDrafts((prev) =>
                                  prev.map((item) =>
                                    item._key === row._key
                                      ? { ...item, name: e.target.value }
                                      : item
                                  )
                                )
                              }
                              placeholder="e.g. Mom, Dad, Caregiver"
                              className="w-full min-w-0 px-2.5 sm:px-3 py-2 text-xs bg-stone-50 dark:bg-stone-800 border border-stone-200 dark:border-stone-700 text-stone-900 dark:text-white rounded-xl focus:outline-hidden focus:border-amber-500"
                            />
                          </div>

                          <div className="min-w-0">
                            <label className="block text-[11px] font-semibold text-stone-600 dark:text-stone-300 mb-1">
                              Date
                            </label>
                            <input
                              type="date"
                              value={row.date}
                              onChange={(e) =>
                                setGrowthDrafts((prev) =>
                                  prev.map((item) =>
                                    item._key === row._key
                                      ? { ...item, date: e.target.value }
                                      : item
                                  )
                                )
                              }
                              className="w-full min-w-0 px-2.5 sm:px-3 py-2 text-xs bg-stone-50 dark:bg-stone-800 border border-stone-200 dark:border-stone-700 text-stone-900 dark:text-white rounded-xl focus:outline-hidden focus:border-amber-500"
                            />
                          </div>

                          <div className="min-w-0">
                            <label className="block text-[11px] font-semibold text-stone-600 dark:text-stone-300 mb-1">
                              Daily Weight (kg)
                            </label>
                            <input
                              type="number"
                              step="0.01"
                              min="0"
                              value={row.dailyWeight}
                              onChange={(e) =>
                                setGrowthDrafts((prev) =>
                                  prev.map((item) =>
                                    item._key === row._key
                                      ? { ...item, dailyWeight: e.target.value }
                                      : item
                                  )
                                )
                              }
                              placeholder="e.g. 6.45"
                              className="w-full min-w-0 px-2.5 sm:px-3 py-2 text-xs font-mono bg-stone-50 dark:bg-stone-800 border border-stone-200 dark:border-stone-700 text-stone-900 dark:text-white rounded-xl focus:outline-hidden focus:border-amber-500"
                            />
                          </div>

                          <div className="min-w-0">
                            <label className="block text-[11px] font-semibold text-stone-600 dark:text-stone-300 mb-1">
                              Daily Length (cm)
                            </label>
                            <input
                              type="number"
                              step="0.1"
                              min="0"
                              value={row.dailyLength}
                              onChange={(e) =>
                                setGrowthDrafts((prev) =>
                                  prev.map((item) =>
                                    item._key === row._key
                                      ? { ...item, dailyLength: e.target.value }
                                      : item
                                  )
                                )
                              }
                              placeholder="e.g. 62.5"
                              className="w-full min-w-0 px-2.5 sm:px-3 py-2 text-xs font-mono bg-stone-50 dark:bg-stone-800 border border-stone-200 dark:border-stone-700 text-stone-900 dark:text-white rounded-xl focus:outline-hidden focus:border-amber-500"
                            />
                          </div>

                          <div className="min-w-0 col-span-2 lg:col-span-1">
                            <div className="flex items-center justify-between mb-1">
                              <label className="block text-[11px] font-semibold text-stone-600 dark:text-stone-300">
                                Temperature (°C)
                              </label>
                              {liveTempPreview && (
                                <span
                                  className={`text-[10px] font-bold px-1.5 py-0.2 rounded-full border ${tempBadgeClasses(
                                    liveTempPreview.severity
                                  )}`}
                                >
                                  {liveTempPreview.label}
                                </span>
                              )}
                            </div>
                            <input
                              type="number"
                              step="0.1"
                              min="30"
                              max="45"
                              value={row.temperature}
                              onChange={(e) =>
                                setGrowthDrafts((prev) =>
                                  prev.map((item) =>
                                    item._key === row._key
                                      ? { ...item, temperature: e.target.value }
                                      : item
                                  )
                                )
                              }
                              placeholder="e.g. 36.8"
                              className="w-full min-w-0 px-2.5 sm:px-3 py-2 text-xs font-mono bg-stone-50 dark:bg-stone-800 border border-stone-200 dark:border-stone-700 text-stone-900 dark:text-white rounded-xl focus:outline-hidden focus:border-amber-500"
                            />
                          </div>
                        </div>

                        <div className="min-w-0">
                          <label className="block text-[11px] font-semibold text-stone-600 dark:text-stone-300 mb-1">
                            Remark
                          </label>
                          <input
                            type="text"
                            value={row.remark}
                            onChange={(e) =>
                              setGrowthDrafts((prev) =>
                                prev.map((item) =>
                                  item._key === row._key
                                    ? { ...item, remark: e.target.value }
                                    : item
                                )
                              )
                            }
                            placeholder="Optional notes (e.g. morning weigh-in before feed, post-vaccine check)"
                            className="w-full min-w-0 px-2.5 sm:px-3 py-2 text-xs bg-stone-50 dark:bg-stone-800 border border-stone-200 dark:border-stone-700 text-stone-900 dark:text-white rounded-xl focus:outline-hidden focus:border-amber-500"
                          />
                        </div>
                      </div>
                    );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Always-visible Save/Error feedback above sticky footer */}
        {(errorMessage || successMessage) && (
          <div className="px-5 py-2.5 border-t border-stone-100 dark:border-stone-800 bg-white dark:bg-stone-900">
            {errorMessage && (
              <div className="px-3 py-2 rounded-xl bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-900/60 text-xs text-rose-800 dark:text-rose-300 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{errorMessage}</span>
              </div>
            )}
            {successMessage && (
              <div className="px-3 py-2 rounded-xl bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-900/60 text-xs text-emerald-800 dark:text-emerald-300 flex items-center gap-2 font-semibold">
                <Check className="w-4 h-4 shrink-0" />
                <span>{successMessage}</span>
              </div>
            )}
          </div>
        )}

        {/* Footer */}
        <div className="px-5 py-3.5 border-t border-stone-100 dark:border-stone-800 bg-stone-50/70 dark:bg-stone-900/80 flex flex-wrap items-center justify-between gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={isAnalyzing || isImporting}
            className="px-3.5 py-2 text-xs font-semibold text-stone-600 dark:text-stone-300 bg-white dark:bg-stone-800 hover:bg-stone-100 dark:hover:bg-stone-700 border border-stone-200 dark:border-stone-700 rounded-xl transition-colors cursor-pointer disabled:opacity-40"
          >
            Close
          </button>

          {entryMode === 'tabular' ? (
            <button
              type="button"
              onClick={() => void handleSaveTabularToDatabase()}
              disabled={isImporting || isAnalyzing || activeValidSelectedCount === 0}
              className="px-5 py-2 text-xs font-bold text-white bg-stone-900 hover:bg-stone-800 dark:bg-stone-100 dark:hover:bg-white dark:text-stone-900 rounded-xl shadow-xs transition-colors flex items-center gap-1.5 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {isImporting ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Saving {activeValidSelectedCount} rows...</span>
                </>
              ) : (
                <>
                  <Check className="w-3.5 h-3.5" />
                  <span>
                    {targetTable === 'auto'
                      ? `Save ${
                          routineValidSelectedCount > 0 && growthValidSelectedCount > 0
                            ? `${routineValidSelectedCount} Routine + ${growthValidSelectedCount} Growth`
                            : routineValidSelectedCount > 0
                              ? `${routineValidSelectedCount} Routine`
                              : `${growthValidSelectedCount} Growth`
                        } Row${activeValidSelectedCount === 1 ? '' : 's'} to Database`
                      : `Save ${activeValidSelectedCount} ${
                          targetTable === 'routine' ? 'Routine' : 'Growth'
                        } Row${activeValidSelectedCount === 1 ? '' : 's'} to Database`}
                  </span>
                </>
              )}
            </button>
          ) : (
            <div className="text-[11px] text-stone-500 dark:text-stone-400">
              Process via Gemini first to review rows in{' '}
              <button
                type="button"
                onClick={() => handleSwitchMode('tabular')}
                className="font-bold text-stone-800 dark:text-stone-200 underline cursor-pointer"
              >
                Tabular Entry
              </button>{' '}
              before saving to database.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
