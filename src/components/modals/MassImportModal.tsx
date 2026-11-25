import React, { useEffect, useRef, useState } from 'react';
import { useApp } from '../../context/AppContext';
import type { NewGrowthRecordInput, NewRoutineRecordInput } from '../../types';
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
  Table2,
  Camera,
  RotateCcw,
} from 'lucide-react';

export type MassImportTable = 'routine' | 'growth';
type ImportSourceMode = 'tabular' | 'camera' | 'photo' | 'file';

const DIAPER_PRESETS = ['Wet', 'Dirty', 'Mixed', 'Dry'] as const;

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
  mimeType: string;
  data: string;
  fileName: string;
  previewUrl?: string;
}

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

export const MassImportModal: React.FC<MassImportModalProps> = ({
  isOpen,
  initialTable = 'routine',
  onClose,
}) => {
  const { activeProfile, addRoutineRecordsBulk, addGrowthRecordsBulk } = useApp();

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

  // Camera entry state
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [cameraPhoto, setCameraPhoto] = useState<BinaryAttachment | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const cameraFallbackInputRef = useRef<HTMLInputElement | null>(null);

  // Photo entry state
  const [selectedPhoto, setSelectedPhoto] = useState<BinaryAttachment | null>(null);
  const photoInputRef = useRef<HTMLInputElement | null>(null);

  // File upload entry state
  const [uploadedFileName, setUploadedFileName] = useState<string | null>(null);
  const [uploadedTextContent, setUploadedTextContent] = useState<string>('');
  const [uploadedBinaryFile, setUploadedBinaryFile] = useState<BinaryAttachment | null>(null);
  const fileUploadInputRef = useRef<HTMLInputElement | null>(null);

  // Gemini & Database status
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
    } else {
      stopCameraStream();
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
    setCameraPhoto(null);

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setCameraError(
        'Live camera preview is not supported in this browser. Use the "Capture / Take Photo" button below instead.'
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
        'Camera access was blocked or unavailable. Allow camera permissions or use "Capture / Take Photo" below.'
      );
    }
  };

  const captureFromCamera = () => {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0 || video.videoHeight === 0) {
      setCameraError('Camera video is still loading. Please try capturing again.');
      return;
    }

    const maxDim = 1600;
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
    const dataUrl = canvas.toDataURL('image/jpeg', 0.88);
    const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);

    setCameraPhoto({
      mimeType: 'image/jpeg',
      data: base64,
      fileName: `camera-capture-${Date.now()}.jpg`,
      previewUrl: dataUrl,
    });
    stopCameraStream();
  };

  const readImageFileAsAttachment = (
    file: File,
    onLoaded: (att: BinaryAttachment) => void
  ) => {
    if (file.size > 10 * 1024 * 1024) {
      setErrorMessage('Image is too large. Please choose an image smaller than 10 MB.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = typeof reader.result === 'string' ? reader.result : '';
      const commaIdx = dataUrl.indexOf(',');
      const base64 = commaIdx >= 0 ? dataUrl.slice(commaIdx + 1) : '';
      if (!base64) {
        setErrorMessage('Failed to read the selected image.');
        return;
      }
      const mimeType = IMAGE_MIMES.has(file.type) ? file.type : 'image/jpeg';
      onLoaded({
        mimeType,
        data: base64,
        fileName: file.name,
        previewUrl: dataUrl,
      });
    };
    reader.onerror = () => setErrorMessage('Unable to read the selected image file.');
    reader.readAsDataURL(file);
  };

  const handleCameraFallbackChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setErrorMessage(null);
    setCameraError(null);
    readImageFileAsAttachment(file, (att) => setCameraPhoto(att));
  };

  const handlePhotoFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setErrorMessage(null);
    readImageFileAsAttachment(file, (att) => setSelectedPhoto(att));
  };

  const handleUploadFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    setErrorMessage(null);
    setSuccessMessage(null);

    if (file.size > 10 * 1024 * 1024) {
      setErrorMessage('File is too large. Please upload a file smaller than 10 MB.');
      return;
    }

    const lowerName = file.name.toLowerCase();
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
        setUploadedFileName(file.name);
        setUploadedTextContent(content);
        setUploadedBinaryFile(null);
      };
      reader.onerror = () => setErrorMessage('Unable to read the selected file.');
      reader.readAsText(file);
      return;
    }

    if (BINARY_FILE_MIMES.has(file.type)) {
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = typeof reader.result === 'string' ? reader.result : '';
        const commaIdx = dataUrl.indexOf(',');
        const base64 = commaIdx >= 0 ? dataUrl.slice(commaIdx + 1) : '';
        if (!base64) {
          setErrorMessage('Failed to encode the uploaded file.');
          return;
        }
        setUploadedFileName(file.name);
        setUploadedBinaryFile({
          mimeType: file.type,
          data: base64,
          fileName: file.name,
          previewUrl: file.type.startsWith('image/') ? dataUrl : undefined,
        });
      };
      reader.onerror = () => setErrorMessage('Unable to read the selected file.');
      reader.readAsDataURL(file);
      return;
    }

    setErrorMessage(
      'Unsupported file type. Upload a CSV, TSV, TXT, JSON, PDF, or image file.'
    );
  };

  // Process Camera / Photo / File Upload through Gemini API and fit recognized data into Tabular Data Entry
  const handleRecognizeWithGemini = async (source: 'camera' | 'photo' | 'file') => {
    setErrorMessage(null);
    setSuccessMessage(null);

    let rawTextToSend = '';
    let attachmentToSend: { mimeType: string; data: string; fileName?: string } | null = null;

    if (source === 'camera') {
      if (!cameraPhoto) {
        setErrorMessage('Capture a photo from your camera first.');
        return;
      }
      attachmentToSend = {
        mimeType: cameraPhoto.mimeType,
        data: cameraPhoto.data,
        fileName: cameraPhoto.fileName,
      };
    } else if (source === 'photo') {
      if (!selectedPhoto) {
        setErrorMessage('Select a photo or screenshot first.');
        return;
      }
      attachmentToSend = {
        mimeType: selectedPhoto.mimeType,
        data: selectedPhoto.data,
        fileName: selectedPhoto.fileName,
      };
    } else {
      rawTextToSend = uploadedTextContent.trim();
      if (uploadedBinaryFile) {
        attachmentToSend = {
          mimeType: uploadedBinaryFile.mimeType,
          data: uploadedBinaryFile.data,
          fileName: uploadedBinaryFile.fileName,
        };
      }
      if (!rawTextToSend && !attachmentToSend) {
        setErrorMessage('Upload a file or paste file contents before recognizing with Gemini.');
        return;
      }
    }

    setIsAnalyzing(true);
    try {
      const response = await fetch('/api/gemini/mass-import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetTable,
          rawText: rawTextToSend,
          defaultDate,
          defaultLogger: defaultLogger.trim(),
          attachment: attachmentToSend,
        }),
      });

      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
        summary?: string;
        rows?: Record<string, unknown>[];
      };

      if (!response.ok) {
        setErrorMessage(payload.error || `Gemini analysis failed (HTTP ${response.status}).`);
        return;
      }

      const rows = Array.isArray(payload.rows) ? payload.rows : [];
      if (rows.length === 0) {
        setErrorMessage(
          `Gemini could not recognize any ${targetTable} rows from this ${source}. Try a clearer capture or verify the target table.`
        );
        return;
      }

      if (targetTable === 'routine') {
        const recognized: RoutineDraftRow[] = rows.map((r, idx) => ({
          _key: makeRowKey('rt-ai', idx),
          selected: true,
          name: typeof r.name === 'string' ? r.name : defaultLogger.trim(),
          date: typeof r.date === 'string' ? r.date : defaultDate,
          time: typeof r.time === 'string' ? r.time : '',
          feedDurationMin:
            r['feed duration (min)'] !== null && r['feed duration (min)'] !== undefined
              ? String(r['feed duration (min)'])
              : '',
          ebmMl: r['EBM (mL)'] !== null && r['EBM (mL)'] !== undefined ? String(r['EBM (mL)']) : '',
          formulaMl:
            r['Formula (mL)'] !== null && r['Formula (mL)'] !== undefined
              ? String(r['Formula (mL)'])
              : '',
          diaper: typeof r.Diaper === 'string' ? r.Diaper : '',
          remark: typeof r.remark === 'string' ? r.remark : '',
        }));

        // Keep any non-empty user rows already in tabular entry, replace pure blank placeholder row
        setRoutineDrafts((prev) => {
          const nonEmptyExisting = prev.filter(
            (row) =>
              row.ebmMl.trim() !== '' ||
              row.formulaMl.trim() !== '' ||
              row.feedDurationMin.trim() !== '' ||
              row.diaper.trim() !== '' ||
              row.remark.trim() !== ''
          );
          return [...nonEmptyExisting, ...recognized];
        });
      } else {
        const recognized: GrowthDraftRow[] = rows.map((r, idx) => ({
          _key: makeRowKey('gr-ai', idx),
          selected: true,
          name: typeof r.name === 'string' ? r.name : defaultLogger.trim(),
          date: typeof r.date === 'string' ? r.date : defaultDate,
          dailyWeight:
            r.daily_weight !== null && r.daily_weight !== undefined ? String(r.daily_weight) : '',
          dailyLength:
            r.daily_length !== null && r.daily_length !== undefined ? String(r.daily_length) : '',
          temperature:
            r.temperature !== null && r.temperature !== undefined ? String(r.temperature) : '',
          remark: typeof r.remark === 'string' ? r.remark : '',
        }));

        setGrowthDrafts((prev) => {
          const nonEmptyExisting = prev.filter(
            (row) =>
              row.dailyWeight.trim() !== '' ||
              row.dailyLength.trim() !== '' ||
              row.temperature.trim() !== '' ||
              row.remark.trim() !== ''
          );
          return [...nonEmptyExisting, ...recognized];
        });
      }

      setAiSummary(
        payload.summary ||
          `Gemini recognized ${rows.length} ${targetTable} row${rows.length === 1 ? '' : 's'} and loaded them into Tabular Data Entry.`
      );
      // Automatically switch to Tabular Data Entry so user reviews/edits before writing to database
      setEntryMode('tabular');
    } catch (err) {
      setErrorMessage(
        err instanceof Error
          ? `Network error contacting server: ${err.message}`
          : 'Network error contacting the Gemini import endpoint.'
      );
    } finally {
      setIsAnalyzing(false);
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
    targetTable === 'routine' ? routineValidSelectedCount : growthValidSelectedCount;

  const toggleAllSelected = (checked: boolean) => {
    if (targetTable === 'routine') {
      setRoutineDrafts((prev) => prev.map((r) => ({ ...r, selected: checked })));
    } else {
      setGrowthDrafts((prev) => prev.map((r) => ({ ...r, selected: checked })));
    }
  };

  const addBlankRows = (count = 1) => {
    if (targetTable === 'routine') {
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
    if (targetTable === 'routine') {
      setRoutineDrafts([createEmptyRoutineRow(defaultDate, defaultLogger.trim(), 0)]);
    } else {
      setGrowthDrafts([createEmptyGrowthRow(defaultDate, defaultLogger.trim(), 0)]);
    }
  };

  // Direct write to Supabase ONLY from Tabular Data Entry
  const handleSaveTabularToDatabase = async () => {
    setErrorMessage(null);
    setSuccessMessage(null);

    if (activeValidSelectedCount === 0) {
      setErrorMessage(
        targetTable === 'routine'
          ? 'Enter at least one selected routine row with EBM, Formula, Feed Duration, Diaper, or Remark.'
          : 'Enter at least one selected growth row with Daily Weight, Daily Length, Temperature, or Remark.'
      );
      return;
    }

    setIsImporting(true);
    try {
      if (targetTable === 'routine') {
        const toInsert: NewRoutineRecordInput[] = routineDrafts
          .filter((r) => r.selected)
          .map((r) => ({
            profile_id: activeProfile?.id ?? null,
            name: r.name.trim() || null,
            date: r.date.trim() || null,
            time: r.time.trim() || null,
            'feed duration (min)':
              r.feedDurationMin.trim() !== '' ? parseInt(r.feedDurationMin, 10) : null,
            'EBM (mL)': r.ebmMl.trim() !== '' ? parseInt(r.ebmMl, 10) : null,
            'Formula (mL)': r.formulaMl.trim() !== '' ? parseInt(r.formulaMl, 10) : null,
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
          );

        const res = await addRoutineRecordsBulk(toInsert);
        if (res.error) {
          setErrorMessage(res.error);
          return;
        }

        setSuccessMessage(
          `Saved ${res.records.length} row${res.records.length === 1 ? '' : 's'} into the "routine" table.`
        );
        setRoutineDrafts([createEmptyRoutineRow(defaultDate, defaultLogger.trim(), 0)]);
        setAiSummary(null);
      } else {
        const toInsert: NewGrowthRecordInput[] = growthDrafts
          .filter((r) => r.selected)
          .map((r) => ({
            profile_id: activeProfile?.id ?? null,
            name: r.name.trim() || null,
            date: r.date.trim() || null,
            daily_weight: r.dailyWeight.trim() !== '' ? parseFloat(r.dailyWeight) : null,
            daily_length: r.dailyLength.trim() !== '' ? parseFloat(r.dailyLength) : null,
            temperature: r.temperature.trim() !== '' ? parseFloat(r.temperature) : null,
            remark: r.remark.trim() || null,
          }))
          .filter(
            (r) =>
              r.daily_weight !== null ||
              r.daily_length !== null ||
              r.temperature !== null ||
              r.remark !== null
          );

        const res = await addGrowthRecordsBulk(toInsert);
        if (res.error) {
          setErrorMessage(res.error);
          return;
        }

        setSuccessMessage(
          `Saved ${res.records.length} row${res.records.length === 1 ? '' : 's'} into the "growth" table.`
        );
        setGrowthDrafts([createEmptyGrowthRow(defaultDate, defaultLogger.trim(), 0)]);
        setAiSummary(null);
      }
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
          <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
            <div className="md:col-span-5">
              <label className="block text-[11px] font-semibold text-stone-600 dark:text-stone-300 mb-1.5">
                Target Table
              </label>
              <div className="grid grid-cols-2 gap-1.5 p-1 bg-stone-100 dark:bg-stone-800 rounded-xl border border-stone-200 dark:border-stone-700">
                <button
                  type="button"
                  onClick={() => handleSwitchTable('routine')}
                  className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                    targetTable === 'routine'
                      ? 'bg-white dark:bg-stone-900 text-emerald-700 dark:text-emerald-400 shadow-2xs'
                      : 'text-stone-600 dark:text-stone-400 hover:text-stone-900 dark:hover:text-white'
                  }`}
                >
                  <Droplets className="w-3.5 h-3.5" />
                  <span>Routine</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleSwitchTable('growth')}
                  className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                    targetTable === 'growth'
                      ? 'bg-white dark:bg-stone-900 text-amber-700 dark:text-amber-400 shadow-2xs'
                      : 'text-stone-600 dark:text-stone-400 hover:text-stone-900 dark:hover:text-white'
                  }`}
                >
                  <Scale className="w-3.5 h-3.5" />
                  <span>Growth</span>
                </button>
              </div>
            </div>

            <div className="md:col-span-4">
              <label className="block text-[11px] font-semibold text-stone-600 dark:text-stone-300 mb-1.5">
                Default Logged By <span className="text-stone-400 font-normal">(optional)</span>
              </label>
              <input
                type="text"
                value={defaultLogger}
                onChange={(e) => setDefaultLogger(e.target.value)}
                placeholder="e.g. Mom, Dad, Caregiver"
                className="w-full px-3 py-2 text-xs bg-stone-50 dark:bg-stone-800 border border-stone-200 dark:border-stone-700 text-stone-900 dark:text-white rounded-xl focus:outline-hidden focus:border-emerald-500"
              />
            </div>

            <div className="md:col-span-3">
              <label className="block text-[11px] font-semibold text-stone-600 dark:text-stone-300 mb-1.5">
                Default Date
              </label>
              <input
                type="date"
                value={defaultDate}
                onChange={(e) => setDefaultDate(e.target.value)}
                className="w-full px-3 py-2 text-xs bg-stone-50 dark:bg-stone-800 border border-stone-200 dark:border-stone-700 text-stone-900 dark:text-white rounded-xl focus:outline-hidden focus:border-emerald-500"
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

          {/* MODE 1: CAMERA ENTRY (processed via Gemini -> fills Tabular Entry) */}
          {entryMode === 'camera' && (
            <div className="rounded-2xl border border-stone-200 dark:border-stone-800 p-4 sm:p-5 space-y-4 bg-stone-50/50 dark:bg-stone-800/30">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h4 className="text-xs font-bold text-stone-900 dark:text-white">
                    Camera Entry (Gemini Recognition)
                  </h4>
                  <p className="text-[11px] text-stone-500 dark:text-stone-400">
                    Snap a photo of handwritten logs, clinic charts, or feeding sheets. Gemini will extract rows into Tabular Entry for your review.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    ref={cameraFallbackInputRef}
                    type="file"
                    accept="image/*"
                    capture="environment"
                    onChange={handleCameraFallbackChange}
                    className="hidden"
                  />
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
                  <button
                    type="button"
                    onClick={() => cameraFallbackInputRef.current?.click()}
                    className="px-3 py-1.5 text-xs font-semibold text-stone-700 dark:text-stone-200 bg-white dark:bg-stone-800 hover:bg-stone-100 dark:hover:bg-stone-700 border border-stone-200 dark:border-stone-700 rounded-xl flex items-center gap-1.5 cursor-pointer"
                  >
                    <Camera className="w-3.5 h-3.5" />
                    <span>Capture / Device Camera</span>
                  </button>
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
                      className="px-4 py-2 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl flex items-center gap-1.5 cursor-pointer"
                    >
                      <Camera className="w-3.5 h-3.5" />
                      <span>Take Snapshot</span>
                    </button>
                    <button
                      type="button"
                      onClick={stopCameraStream}
                      className="px-3.5 py-2 text-xs font-semibold text-stone-700 dark:text-stone-200 bg-white dark:bg-stone-800 border border-stone-200 dark:border-stone-700 rounded-xl cursor-pointer"
                    >
                      Stop Camera
                    </button>
                  </div>
                </div>
              )}

              {cameraPhoto && (
                <div className="space-y-3">
                  {cameraPhoto.previewUrl && (
                    <div className="rounded-2xl overflow-hidden border border-stone-200 dark:border-stone-700 bg-stone-950/5 max-h-72 flex items-center justify-center">
                      <img
                        src={cameraPhoto.previewUrl}
                        alt="Captured camera preview"
                        className="max-h-72 object-contain"
                      />
                    </div>
                  )}
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => setCameraPhoto(null)}
                      className="px-3 py-1.5 text-xs font-semibold text-stone-600 dark:text-stone-300 bg-white dark:bg-stone-800 border border-stone-200 dark:border-stone-700 rounded-xl flex items-center gap-1.5 cursor-pointer"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      <span>Retake</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleRecognizeWithGemini('camera')}
                      disabled={isAnalyzing}
                      className="px-4 py-2 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 dark:bg-emerald-500 dark:hover:bg-emerald-400 dark:text-stone-950 rounded-xl shadow-xs flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                    >
                      {isAnalyzing ? (
                        <>
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          <span>Recognizing with Gemini...</span>
                        </>
                      ) : (
                        <>
                          <Sparkles className="w-3.5 h-3.5" />
                          <span>Recognize &amp; Fill Tabular Entry</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* MODE 2: PHOTO ENTRY (processed via Gemini -> fills Tabular Entry) */}
          {entryMode === 'photo' && (
            <div className="rounded-2xl border border-stone-200 dark:border-stone-800 p-4 sm:p-5 space-y-4 bg-stone-50/50 dark:bg-stone-800/30">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h4 className="text-xs font-bold text-stone-900 dark:text-white">
                    Photo Entry (Gemini Recognition)
                  </h4>
                  <p className="text-[11px] text-stone-500 dark:text-stone-400">
                    Choose a photo or screenshot of feeding logs, baby tracker apps, or growth charts. Gemini will recognize the fields and populate Tabular Entry.
                  </p>
                </div>
                <div>
                  <input
                    ref={photoInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/gif"
                    onChange={handlePhotoFileChange}
                    className="hidden"
                  />
                  <button
                    type="button"
                    onClick={() => photoInputRef.current?.click()}
                    className="px-3.5 py-2 text-xs font-bold text-white bg-stone-900 hover:bg-stone-800 dark:bg-stone-100 dark:hover:bg-white dark:text-stone-900 rounded-xl flex items-center gap-1.5 cursor-pointer"
                  >
                    <ImageIcon className="w-3.5 h-3.5" />
                    <span>{selectedPhoto ? 'Choose Another Photo' : 'Select Photo / Screenshot'}</span>
                  </button>
                </div>
              </div>

              {selectedPhoto ? (
                <div className="space-y-3">
                  {selectedPhoto.previewUrl && (
                    <div className="rounded-2xl overflow-hidden border border-stone-200 dark:border-stone-700 bg-stone-950/5 max-h-72 flex items-center justify-center">
                      <img
                        src={selectedPhoto.previewUrl}
                        alt={selectedPhoto.fileName}
                        className="max-h-72 object-contain"
                      />
                    </div>
                  )}
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-stone-700 dark:text-stone-300 truncate">
                      {selectedPhoto.fileName}
                    </span>
                    <button
                      type="button"
                      onClick={() => void handleRecognizeWithGemini('photo')}
                      disabled={isAnalyzing}
                      className="px-4 py-2 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 dark:bg-emerald-500 dark:hover:bg-emerald-400 dark:text-stone-950 rounded-xl shadow-xs flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                    >
                      {isAnalyzing ? (
                        <>
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          <span>Recognizing with Gemini...</span>
                        </>
                      ) : (
                        <>
                          <Sparkles className="w-3.5 h-3.5" />
                          <span>Recognize &amp; Fill Tabular Entry</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => photoInputRef.current?.click()}
                  className="w-full py-10 rounded-2xl border-2 border-dashed border-stone-200 dark:border-stone-700 hover:border-emerald-400 dark:hover:border-emerald-600 transition-colors flex flex-col items-center justify-center gap-2 text-xs text-stone-500 dark:text-stone-400 cursor-pointer"
                >
                  <ImageIcon className="w-7 h-7 text-stone-400" />
                  <span className="font-semibold text-stone-700 dark:text-stone-300">
                    Click to choose a PNG, JPG, or WEBP photo
                  </span>
                  <span className="text-[11px]">Processed via Gemini API into Tabular Entry</span>
                </button>
              )}
            </div>
          )}

          {/* MODE 3: FILE UPLOAD ENTRY (processed via Gemini -> fills Tabular Entry) */}
          {entryMode === 'file' && (
            <div className="rounded-2xl border border-stone-200 dark:border-stone-800 p-4 sm:p-5 space-y-3.5 bg-stone-50/50 dark:bg-stone-800/30">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h4 className="text-xs font-bold text-stone-900 dark:text-white">
                    File Upload Entry (Gemini Recognition)
                  </h4>
                  <p className="text-[11px] text-stone-500 dark:text-stone-400">
                    Upload a CSV, TSV, TXT, JSON, or PDF file (or paste raw notes/sheets below). Gemini will parse and fit the data into Tabular Entry.
                  </p>
                </div>
                <div>
                  <input
                    ref={fileUploadInputRef}
                    type="file"
                    accept=".csv,.tsv,.txt,.md,.json,.pdf,text/csv,text/plain,application/json,application/pdf,image/png,image/jpeg,image/webp"
                    onChange={handleUploadFileChange}
                    className="hidden"
                  />
                  <button
                    type="button"
                    onClick={() => fileUploadInputRef.current?.click()}
                    className="px-3.5 py-2 text-xs font-bold text-white bg-stone-900 hover:bg-stone-800 dark:bg-stone-100 dark:hover:bg-white dark:text-stone-900 rounded-xl flex items-center gap-1.5 cursor-pointer"
                  >
                    <Upload className="w-3.5 h-3.5" />
                    <span>Choose File</span>
                  </button>
                </div>
              </div>

              {uploadedFileName && (
                <div className="flex items-center justify-between gap-2 px-3 py-2 rounded-xl bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-700 text-xs">
                  <div className="flex items-center gap-2 min-w-0">
                    <FileText className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                    <span className="font-semibold text-stone-800 dark:text-stone-200 truncate">
                      {uploadedFileName}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setUploadedFileName(null);
                      setUploadedTextContent('');
                      setUploadedBinaryFile(null);
                    }}
                    className="text-stone-400 hover:text-rose-600 cursor-pointer p-1"
                    title="Clear uploaded file"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}

              {!uploadedBinaryFile && (
                <textarea
                  rows={5}
                  value={uploadedTextContent}
                  onChange={(e) => setUploadedTextContent(e.target.value)}
                  placeholder={
                    targetTable === 'routine'
                      ? 'Uploaded CSV/TXT content appears here — or paste spreadsheet rows / chat logs directly:\n2026-11-24 07:30 Mom, 20min, EBM 90ml, Formula 30ml, Wet diaper\n2026-11-24 10:45 Dad, 15min, EBM 110ml, Mixed, burped well'
                      : 'Uploaded CSV/TXT content appears here — or paste growth logs directly:\n2026-11-22 Mom, 5.12 kg, 58.5 cm, 36.7C, morning check\n2026-11-24 Dad, 5210g, 59cm, 98.4F, before feed'
                  }
                  className="w-full px-3.5 py-2.5 text-xs font-mono bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-700 text-stone-900 dark:text-white rounded-2xl focus:outline-hidden focus:border-emerald-500 resize-y"
                />
              )}

              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-[11px] text-stone-500 dark:text-stone-400">
                  {targetTable === 'routine'
                    ? 'Auto-maps to Routine fields (converts oz → mL, 12h → 24h time).'
                    : 'Auto-maps to Growth fields (converts g/lb → kg, in → cm, °F → °C).'}
                </span>
                <button
                  type="button"
                  onClick={() => void handleRecognizeWithGemini('file')}
                  disabled={isAnalyzing || (!uploadedTextContent.trim() && !uploadedBinaryFile)}
                  className="px-4 py-2 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 dark:bg-emerald-500 dark:hover:bg-emerald-400 dark:text-stone-950 rounded-xl shadow-xs flex items-center gap-1.5 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isAnalyzing ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Recognizing with Gemini...</span>
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-3.5 h-3.5" />
                      <span>Recognize &amp; Fill Tabular Entry</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          )}

          {/* MODE 4: DIRECT TABULAR DATA ENTRY (sole direct writer to Supabase, matching Routine & Growth input formats) */}
          {entryMode === 'tabular' && (
            <div className="rounded-2xl border border-stone-200 dark:border-stone-800 overflow-hidden">
              <div className="px-4 py-3 bg-stone-50 dark:bg-stone-800/70 border-b border-stone-200 dark:border-stone-800 flex flex-wrap items-center justify-between gap-2">
                <div className="space-y-0.5">
                  <div className="text-xs font-bold text-stone-900 dark:text-white">
                    Direct Tabular Data Entry —{' '}
                    <span className="font-mono">{targetTable}</span> ({activeValidSelectedCount}{' '}
                    ready to save)
                  </div>
                  {aiSummary ? (
                    <div className="text-[11px] text-emerald-700 dark:text-emerald-400 font-medium">
                      Gemini: {aiSummary}
                    </div>
                  ) : (
                    <div className="text-[11px] text-stone-500 dark:text-stone-400">
                      Only rows in this table are written to the database. Formats match the{' '}
                      {targetTable === 'routine' ? 'Routine' : 'Growth'} tab.
                    </div>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
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
                  <button
                    type="button"
                    onClick={clearTabularRows}
                    className="px-2.5 py-1.5 text-[11px] font-semibold text-stone-500 hover:text-rose-600 dark:text-stone-400 dark:hover:text-rose-400 rounded-lg cursor-pointer"
                  >
                    Clear
                  </button>
                </div>
              </div>

              <datalist id="mass-import-diaper-presets">
                {DIAPER_PRESETS.map((p) => (
                  <option key={p} value={p} />
                ))}
              </datalist>

              <div className="overflow-x-auto max-h-80 overflow-y-auto">
                {targetTable === 'routine' ? (
                  /* Exact RoutineView field order: Logged By, Date, Time, Feed Duration (min), EBM (mL), Formula (mL), Diaper, Remark */
                  <table className="w-full text-left text-xs border-collapse">
                    <thead className="sticky top-0 z-10 bg-stone-50 dark:bg-stone-850 border-b border-stone-200 dark:border-stone-800 text-[11px] text-stone-500 dark:text-stone-400">
                      <tr>
                        <th className="py-2.5 px-2.5 w-8">
                          <input
                            type="checkbox"
                            aria-label="Select all routine rows"
                            checked={
                              routineDrafts.length > 0 &&
                              routineDrafts.every((r) => r.selected)
                            }
                            onChange={(e) => toggleAllSelected(e.target.checked)}
                            className="accent-emerald-600 cursor-pointer"
                          />
                        </th>
                        <th className="py-2.5 px-2">Logged By</th>
                        <th className="py-2.5 px-2">Date</th>
                        <th className="py-2.5 px-2">Time</th>
                        <th className="py-2.5 px-2">Feed Duration (min)</th>
                        <th className="py-2.5 px-2">EBM (mL)</th>
                        <th className="py-2.5 px-2">Formula (mL)</th>
                        <th className="py-2.5 px-2">Diaper</th>
                        <th className="py-2.5 px-2">Remark</th>
                        <th className="py-2.5 px-2 w-8" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-stone-100 dark:divide-stone-800">
                      {routineDrafts.map((row) => (
                        <tr
                          key={row._key}
                          className={
                            row.selected
                              ? 'bg-white dark:bg-stone-900'
                              : 'bg-stone-50/60 dark:bg-stone-900/40 opacity-50'
                          }
                        >
                          <td className="py-1.5 px-2.5">
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
                          </td>
                          <td className="py-1.5 px-1.5">
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
                              placeholder="Mom, Dad..."
                              className="w-28 px-2 py-1.5 text-[11px] bg-stone-50 dark:bg-stone-800 border border-stone-200 dark:border-stone-700 rounded-lg text-stone-900 dark:text-white focus:outline-hidden focus:border-emerald-500"
                            />
                          </td>
                          <td className="py-1.5 px-1.5">
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
                              className="w-32 px-2 py-1.5 text-[11px] font-mono bg-stone-50 dark:bg-stone-800 border border-stone-200 dark:border-stone-700 rounded-lg text-stone-900 dark:text-white focus:outline-hidden focus:border-emerald-500"
                            />
                          </td>
                          <td className="py-1.5 px-1.5">
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
                              className="w-24 px-2 py-1.5 text-[11px] font-mono bg-stone-50 dark:bg-stone-800 border border-stone-200 dark:border-stone-700 rounded-lg text-stone-900 dark:text-white focus:outline-hidden focus:border-emerald-500"
                            />
                          </td>
                          <td className="py-1.5 px-1.5">
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
                              className="w-24 px-2 py-1.5 text-[11px] font-mono bg-stone-50 dark:bg-stone-800 border border-stone-200 dark:border-stone-700 rounded-lg text-stone-900 dark:text-white focus:outline-hidden focus:border-emerald-500"
                            />
                          </td>
                          <td className="py-1.5 px-1.5">
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
                              className="w-20 px-2 py-1.5 text-[11px] font-mono bg-stone-50 dark:bg-stone-800 border border-stone-200 dark:border-stone-700 rounded-lg text-stone-900 dark:text-white focus:outline-hidden focus:border-emerald-500"
                            />
                          </td>
                          <td className="py-1.5 px-1.5">
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
                              className="w-20 px-2 py-1.5 text-[11px] font-mono bg-stone-50 dark:bg-stone-800 border border-stone-200 dark:border-stone-700 rounded-lg text-stone-900 dark:text-white focus:outline-hidden focus:border-emerald-500"
                            />
                          </td>
                          <td className="py-1.5 px-1.5">
                            <input
                              type="text"
                              list="mass-import-diaper-presets"
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
                              placeholder="Wet/Dirty/Mixed"
                              className="w-28 px-2 py-1.5 text-[11px] bg-stone-50 dark:bg-stone-800 border border-stone-200 dark:border-stone-700 rounded-lg text-stone-900 dark:text-white focus:outline-hidden focus:border-emerald-500"
                            />
                          </td>
                          <td className="py-1.5 px-1.5">
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
                              placeholder="Optional observation"
                              className="w-40 px-2 py-1.5 text-[11px] bg-stone-50 dark:bg-stone-800 border border-stone-200 dark:border-stone-700 rounded-lg text-stone-900 dark:text-white focus:outline-hidden focus:border-emerald-500"
                            />
                          </td>
                          <td className="py-1.5 px-1.5 text-right">
                            <button
                              type="button"
                              onClick={() =>
                                setRoutineDrafts((prev) =>
                                  prev.length > 1
                                    ? prev.filter((item) => item._key !== row._key)
                                    : [createEmptyRoutineRow(defaultDate, defaultLogger.trim(), 0)]
                                )
                              }
                              className="p-1 text-stone-400 hover:text-rose-600 cursor-pointer"
                              title="Remove row"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  /* Exact GrowthTabView field order: Logged By, Date, Daily Weight (kg), Daily Length (cm), Temperature (°C), Remark */
                  <table className="w-full text-left text-xs border-collapse">
                    <thead className="sticky top-0 z-10 bg-stone-50 dark:bg-stone-850 border-b border-stone-200 dark:border-stone-800 text-[11px] text-stone-500 dark:text-stone-400">
                      <tr>
                        <th className="py-2.5 px-2.5 w-8">
                          <input
                            type="checkbox"
                            aria-label="Select all growth rows"
                            checked={
                              growthDrafts.length > 0 &&
                              growthDrafts.every((r) => r.selected)
                            }
                            onChange={(e) => toggleAllSelected(e.target.checked)}
                            className="accent-amber-600 cursor-pointer"
                          />
                        </th>
                        <th className="py-2.5 px-2">Logged By</th>
                        <th className="py-2.5 px-2">Date</th>
                        <th className="py-2.5 px-2">Daily Weight (kg)</th>
                        <th className="py-2.5 px-2">Daily Length (cm)</th>
                        <th className="py-2.5 px-2">Temperature (°C)</th>
                        <th className="py-2.5 px-2">Remark</th>
                        <th className="py-2.5 px-2 w-8" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-stone-100 dark:divide-stone-800">
                      {growthDrafts.map((row) => (
                        <tr
                          key={row._key}
                          className={
                            row.selected
                              ? 'bg-white dark:bg-stone-900'
                              : 'bg-stone-50/60 dark:bg-stone-900/40 opacity-50'
                          }
                        >
                          <td className="py-1.5 px-2.5">
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
                          </td>
                          <td className="py-1.5 px-1.5">
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
                              placeholder="Mom, Dad..."
                              className="w-32 px-2 py-1.5 text-[11px] bg-stone-50 dark:bg-stone-800 border border-stone-200 dark:border-stone-700 rounded-lg text-stone-900 dark:text-white focus:outline-hidden focus:border-amber-500"
                            />
                          </td>
                          <td className="py-1.5 px-1.5">
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
                              className="w-32 px-2 py-1.5 text-[11px] font-mono bg-stone-50 dark:bg-stone-800 border border-stone-200 dark:border-stone-700 rounded-lg text-stone-900 dark:text-white focus:outline-hidden focus:border-amber-500"
                            />
                          </td>
                          <td className="py-1.5 px-1.5">
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
                              className="w-28 px-2 py-1.5 text-[11px] font-mono bg-stone-50 dark:bg-stone-800 border border-stone-200 dark:border-stone-700 rounded-lg text-stone-900 dark:text-white focus:outline-hidden focus:border-amber-500"
                            />
                          </td>
                          <td className="py-1.5 px-1.5">
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
                              className="w-28 px-2 py-1.5 text-[11px] font-mono bg-stone-50 dark:bg-stone-800 border border-stone-200 dark:border-stone-700 rounded-lg text-stone-900 dark:text-white focus:outline-hidden focus:border-amber-500"
                            />
                          </td>
                          <td className="py-1.5 px-1.5">
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
                              className="w-28 px-2 py-1.5 text-[11px] font-mono bg-stone-50 dark:bg-stone-800 border border-stone-200 dark:border-stone-700 rounded-lg text-stone-900 dark:text-white focus:outline-hidden focus:border-amber-500"
                            />
                          </td>
                          <td className="py-1.5 px-1.5">
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
                              placeholder="Optional notes"
                              className="w-48 px-2 py-1.5 text-[11px] bg-stone-50 dark:bg-stone-800 border border-stone-200 dark:border-stone-700 rounded-lg text-stone-900 dark:text-white focus:outline-hidden focus:border-amber-500"
                            />
                          </td>
                          <td className="py-1.5 px-1.5 text-right">
                            <button
                              type="button"
                              onClick={() =>
                                setGrowthDrafts((prev) =>
                                  prev.length > 1
                                    ? prev.filter((item) => item._key !== row._key)
                                    : [createEmptyGrowthRow(defaultDate, defaultLogger.trim(), 0)]
                                )
                              }
                              className="p-1 text-stone-400 hover:text-rose-600 cursor-pointer"
                              title="Remove row"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          )}
        </div>

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
                    Save {activeValidSelectedCount}{' '}
                    {targetTable === 'routine' ? 'Routine' : 'Growth'} Row
                    {activeValidSelectedCount === 1 ? '' : 's'} to Database
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
