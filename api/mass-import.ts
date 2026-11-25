import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import type { IncomingMessage, ServerResponse } from 'node:http';

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '15mb',
    },
  },
};

interface ApiRequest extends IncomingMessage {
  body?: unknown;
  query?: Record<string, unknown>;
}

interface ApiResponse extends ServerResponse {
  status?: (statusCode: number) => ApiResponse;
  json?: (body: unknown) => void;
}

interface MassImportAttachment {
  mimeType: string;
  data: string;
  fileName?: string;
}

interface MassImportRequestBody {
  targetTable?: 'auto' | 'routine' | 'growth';
  rawText?: string;
  defaultDate?: string;
  defaultLogger?: string;
  attachment?: MassImportAttachment | null;
}

const GEMINI_MODEL = (process.env.GEMINI_MODEL || 'gemini-4-hydrogen').trim();
const FALLBACK_GEMINI_MODEL = 'gemini-3.1-flash-lite';

const ALLOWED_ATTACHMENT_MIMES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'application/pdf',
]);

function sendJson(res: ApiResponse, statusCode: number, payload: unknown): void {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (typeof res.status === 'function' && typeof res.json === 'function') {
    const target = res.status(statusCode);
    if (typeof target.json === 'function') {
      target.json(payload);
      return;
    }
  }
  res.statusCode = statusCode;
  res.end(JSON.stringify(payload));
}

async function readJsonBody<T = Record<string, unknown>>(req: ApiRequest): Promise<T> {
  if (req.body !== undefined && req.body !== null) {
    if (typeof req.body === 'string') {
      return (req.body.trim() ? JSON.parse(req.body) : {}) as T;
    }
    if (Buffer.isBuffer(req.body)) {
      const text = req.body.toString('utf8').trim();
      return (text ? JSON.parse(text) : {}) as T;
    }
    return req.body as T;
  }

  return new Promise<T>((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer | string) => {
      chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8').trim();
      if (!raw) {
        resolve({} as T);
        return;
      }
      try {
        resolve(JSON.parse(raw) as T);
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

function getGeminiApiKey(): string {
  return (process.env.VITE_GEMINI_KEY || process.env.GEMINI_API_KEY || '').trim();
}

function getGeminiClient(): GoogleGenAI | null {
  const apiKey = getGeminiApiKey();
  if (!apiKey) return null;
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function getErrorStatus(err: unknown): number {
  return typeof err === 'object' && err !== null && 'status' in err
    ? Number((err as { status?: unknown }).status)
    : 0;
}

async function generateWithRetry<T>(fn: () => Promise<T>, maxRetries = 1): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const status = getErrorStatus(err);
      if (status === 400 || status === 401 || status === 403 || status === 404) {
        throw err;
      }
      if (attempt < maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)));
      }
    }
  }
  throw lastErr;
}

function extractReadableErrorMessage(err: unknown): string {
  const raw =
    err instanceof Error
      ? err.message
      : typeof err === 'object' && err !== null && 'message' in err
        ? String((err as { message?: unknown }).message)
        : String(err);

  try {
    const parsed = JSON.parse(raw) as { error?: { message?: string } };
    if (parsed?.error?.message) return parsed.error.message;
  } catch {
    // Not a JSON-encoded error message
  }
  return raw;
}

function mapGeminiError(err: unknown): { status: number; message: string } {
  const rawMessage = extractReadableErrorMessage(err);
  const status = getErrorStatus(err) || 500;

  if (
    status === 403 ||
    status === 401 ||
    rawMessage.includes('PERMISSION_DENIED') ||
    rawMessage.includes('API_KEY_INVALID') ||
    rawMessage.includes('API key not valid')
  ) {
    return {
      status: 403,
      message:
        'Gemini API key was rejected (invalid or missing permissions). Please verify VITE_GEMINI_KEY in your environment variables or Settings > Secrets panel.',
    };
  }

  if (status === 429 || rawMessage.includes('RESOURCE_EXHAUSTED')) {
    return {
      status: 429,
      message:
        'Gemini API quota exceeded (429). Please wait a moment and retry, or check your key quota.',
    };
  }

  if (status === 503 || rawMessage.includes('UNAVAILABLE') || rawMessage.includes('high demand')) {
    return {
      status: 503,
      message: 'Gemini is temporarily experiencing high demand. Please retry in a few seconds.',
    };
  }

  if (status === 404 || rawMessage.includes('NOT_FOUND')) {
    return {
      status: 404,
      message: `Gemini model "${GEMINI_MODEL}" was not found or is unavailable for this API key.`,
    };
  }

  return {
    status: status >= 400 && status < 600 ? status : 500,
    message: rawMessage || 'Failed to analyze data with Gemini.',
  };
}

function normalizeDateStr(val: unknown, fallback?: string): string | null {
  if (typeof val === 'string') {
    const trimmed = val.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
    const match = trimmed.match(/(\d{4}-\d{2}-\d{2})/);
    if (match) return match[1];
  }
  if (fallback && /^\d{4}-\d{2}-\d{2}$/.test(fallback)) return fallback;
  return null;
}

function normalizeTimeStr(val: unknown): string | null {
  if (typeof val !== 'string') return null;
  const trimmed = val.trim();
  const match = trimmed.match(/^(\d{1,2}):(\d{2})/);
  if (!match) return null;
  const hh = Number(match[1]);
  const mm = Number(match[2]);
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

function normalizeNullableInt(val: unknown): number | null {
  if (val === null || val === undefined || val === '') return null;
  const n = Number(val);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n);
}

function normalizeNullableFloat(val: unknown, decimals = 2): number | null {
  if (val === null || val === undefined || val === '') return null;
  const n = Number(val);
  if (!Number.isFinite(n) || n <= 0) return null;
  const factor = Math.pow(10, decimals);
  return Math.round(n * factor) / factor;
}

function normalizeNullableText(val: unknown, fallback?: string): string | null {
  if (typeof val === 'string') {
    const trimmed = val.trim();
    if (trimmed.length > 0) return trimmed;
  }
  if (fallback && fallback.trim().length > 0) return fallback.trim();
  return null;
}

function stripJsonFence(text: string): string {
  const trimmed = text.trim();
  const match = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return match ? match[1].trim() : trimmed;
}

const ROUTINE_ITEM_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    date: { type: Type.STRING, nullable: true, description: 'YYYY-MM-DD date' },
    time: { type: Type.STRING, nullable: true, description: '24-hour HH:MM time' },
    ebmMl: { type: Type.INTEGER, nullable: true, description: 'Expressed breast milk in mL' },
    formulaMl: { type: Type.INTEGER, nullable: true, description: 'Infant formula in mL' },
    feedDurationMin: { type: Type.INTEGER, nullable: true, description: 'Feed duration in minutes' },
    diaper: { type: Type.STRING, nullable: true, description: 'Wet, Dirty, Mixed, Dry, or custom' },
    name: { type: Type.STRING, nullable: true, description: 'Caregiver who logged the entry' },
    remark: { type: Type.STRING, nullable: true, description: 'Optional observation' },
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

const GROWTH_ITEM_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    date: { type: Type.STRING, nullable: true, description: 'YYYY-MM-DD date' },
    dailyWeight: { type: Type.NUMBER, nullable: true, description: 'Weight in kg' },
    dailyLength: { type: Type.NUMBER, nullable: true, description: 'Length in cm' },
    temperature: { type: Type.NUMBER, nullable: true, description: 'Temperature in °C' },
    name: { type: Type.STRING, nullable: true, description: 'Caregiver who logged the entry' },
    remark: { type: Type.STRING, nullable: true, description: 'Optional notes' },
  },
  required: ['date', 'dailyWeight', 'dailyLength', 'temperature', 'name', 'remark'],
};

function normalizeRoutineRows(rawRows: unknown[], defaultDate: string, defaultLogger: string) {
  return rawRows
    .map((item) => {
      const obj = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
      return {
        date: normalizeDateStr(obj.date, defaultDate),
        time: normalizeTimeStr(obj.time),
        'EBM (mL)': normalizeNullableInt(obj.ebmMl ?? obj['EBM (mL)'] ?? obj.ebm_ml),
        'Formula (mL)': normalizeNullableInt(
          obj.formulaMl ?? obj['Formula (mL)'] ?? obj.formula_ml
        ),
        'feed duration (min)': normalizeNullableInt(
          obj.feedDurationMin ?? obj['feed duration (min)'] ?? obj.feed_duration_min
        ),
        Diaper: normalizeNullableText(obj.diaper ?? obj.Diaper),
        name: normalizeNullableText(obj.name, defaultLogger),
        remark: normalizeNullableText(obj.remark),
      };
    })
    .filter(
      (row) =>
        row['EBM (mL)'] !== null ||
        row['Formula (mL)'] !== null ||
        row['feed duration (min)'] !== null ||
        row.Diaper !== null ||
        row.remark !== null
    );
}

function normalizeGrowthRows(rawRows: unknown[], defaultDate: string, defaultLogger: string) {
  return rawRows
    .map((item) => {
      const obj = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
      return {
        date: normalizeDateStr(obj.date, defaultDate),
        daily_weight: normalizeNullableFloat(obj.dailyWeight ?? obj.daily_weight, 3),
        daily_length: normalizeNullableFloat(obj.dailyLength ?? obj.daily_length, 1),
        temperature: normalizeNullableFloat(obj.temperature, 1),
        name: normalizeNullableText(obj.name, defaultLogger),
        remark: normalizeNullableText(obj.remark),
      };
    })
    .filter(
      (row) =>
        row.daily_weight !== null ||
        row.daily_length !== null ||
        row.temperature !== null ||
        row.remark !== null
    );
}

export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  try {
    if (req.method === 'OPTIONS') {
      res.setHeader('Allow', 'POST, OPTIONS');
      res.statusCode = 204;
      res.end();
      return;
    }

    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST, OPTIONS');
      sendJson(res, 405, {
        error: 'Method not allowed. Use POST /api/mass-import.',
      });
      return;
    }

    const ai = getGeminiClient();
    if (!ai) {
      sendJson(res, 500, {
        error:
          'Gemini API key is not configured. Please set VITE_GEMINI_KEY in your environment variables or Settings > Secrets panel.',
      });
      return;
    }

    let body: MassImportRequestBody;
    try {
      body = await readJsonBody<MassImportRequestBody>(req);
    } catch {
      sendJson(res, 400, { error: 'Invalid JSON request payload.' });
      return;
    }

    const targetTable = body.targetTable ?? 'auto';
    const rawText = typeof body.rawText === 'string' ? body.rawText.trim() : '';
    const defaultDate = normalizeDateStr(body.defaultDate) ?? new Date().toISOString().slice(0, 10);
    const defaultLogger =
      typeof body.defaultLogger === 'string' && body.defaultLogger.trim()
        ? body.defaultLogger.trim()
        : '';
    const attachment = body.attachment ?? null;

    if (targetTable !== 'auto' && targetTable !== 'routine' && targetTable !== 'growth') {
      sendJson(res, 400, {
        error: 'targetTable must be "auto", "routine", or "growth".',
      });
      return;
    }

    if (!rawText && !attachment) {
      sendJson(res, 400, {
        error: 'Provide pasted text/CSV data or upload a supported image/PDF file to analyze.',
      });
      return;
    }

    if (attachment) {
      if (
        !attachment.mimeType ||
        !ALLOWED_ATTACHMENT_MIMES.has(attachment.mimeType) ||
        typeof attachment.data !== 'string' ||
        attachment.data.length === 0
      ) {
        sendJson(res, 400, {
          error:
            'Unsupported attachment format. Upload a PNG, JPEG, WEBP, GIF, PDF, or plain text/CSV file.',
        });
        return;
      }
    }

    const currentYear = defaultDate.slice(0, 4);

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

    const systemInstruction =
      targetTable === 'auto'
        ? [
            'You are a precise baby-care data classification and extraction engine.',
            'A single photo, handwritten sheet, screenshot, PDF, or text file may contain BOTH Routine records (feeds, milk volumes, durations, diapers) AND Growth records (weight, length/height, temperature), or only one of the two.',
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
              'Extract EVERY distinct feeding or diaper log entry from the provided text, CSV, table, chat log, screenshot, photo, or PDF into the rows array.',
              `Context: defaultDate="${defaultDate}", currentYear="${currentYear}", defaultLogger="${defaultLogger}".`,
              routineFieldRules,
              'Populate every recognized row object with all fields (using null for absent fields). Do not fabricate rows. Skip header rows and empty lines.',
            ].join('\n\n')
          : [
              'You are a precise data extraction engine for a baby daily Growth & Vitals table.',
              'Extract EVERY distinct daily weight, length, or temperature measurement from the provided text, CSV, table, chat log, screenshot, photo, or PDF into the rows array.',
              `Context: defaultDate="${defaultDate}", currentYear="${currentYear}", defaultLogger="${defaultLogger}".`,
              growthFieldRules,
              'Populate every recognized row object with all fields (using null for absent fields). Do not fabricate rows. Skip header rows and empty lines.',
            ].join('\n\n');

    const responseSchema =
      targetTable === 'auto'
        ? {
            type: Type.OBJECT,
            properties: {
              summary: {
                type: Type.STRING,
                description:
                  'Short 1-sentence summary of recognized routine rows and growth rows, including any unit conversions performed.',
              },
              routineRows: {
                type: Type.ARRAY,
                description: 'All extracted routine (feeding/diaper) rows.',
                items: ROUTINE_ITEM_SCHEMA,
              },
              growthRows: {
                type: Type.ARRAY,
                description: 'All extracted growth/vitals (weight/length/temperature) rows.',
                items: GROWTH_ITEM_SCHEMA,
              },
            },
            required: ['summary', 'routineRows', 'growthRows'],
          }
        : {
            type: Type.OBJECT,
            properties: {
              summary: {
                type: Type.STRING,
                description:
                  'Short 1-sentence summary of recognized rows, detected columns, and any unit conversions performed.',
              },
              rows: {
                type: Type.ARRAY,
                description: `All extracted ${targetTable} rows.`,
                items: targetTable === 'routine' ? ROUTINE_ITEM_SCHEMA : GROWTH_ITEM_SCHEMA,
              },
            },
            required: ['summary', 'rows'],
          };

    const parts: Array<
      { text: string } | { inlineData: { mimeType: string; data: string } }
    > = [];

    if (attachment) {
      parts.push({
        inlineData: {
          mimeType: attachment.mimeType,
          data: attachment.data,
        },
      });
    }

    const promptLines = [
      targetTable === 'auto'
        ? 'Mode: AUTO-RECOGNIZE both "routine" (feeds/diapers) and "growth" (weight/length/temperature) records from this single input.'
        : `Target table: "${targetTable}"`,
      `Default date if missing: ${defaultDate}`,
      defaultLogger ? `Default logger name if missing: ${defaultLogger}` : '',
      rawText
        ? `\nSource data to parse:\n${rawText}`
        : '\nExtract all tabular or written records from the attached document/image.',
    ].filter(Boolean);

    parts.push({ text: promptLines.join('\n') });

    try {
      const runModel = (modelName: string) =>
        generateWithRetry(() =>
          ai.models.generateContent({
            model: modelName,
            contents: { parts },
            config: {
              systemInstruction,
              responseMimeType: 'application/json',
              responseSchema,
              thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
            },
          })
        );

      let response;
      try {
        response = await runModel(GEMINI_MODEL);
      } catch (primaryErr) {
        const primaryStatus = getErrorStatus(primaryErr);
        const primaryMsg = extractReadableErrorMessage(primaryErr);
        const shouldFallback =
          GEMINI_MODEL !== FALLBACK_GEMINI_MODEL &&
          (primaryStatus === 503 ||
            primaryStatus === 404 ||
            primaryMsg.includes('UNAVAILABLE') ||
            primaryMsg.includes('NOT_FOUND') ||
            primaryMsg.includes('high demand'));

        if (!shouldFallback) {
          throw primaryErr;
        }
        response = await runModel(FALLBACK_GEMINI_MODEL);
      }

      const rawJson = stripJsonFence(response.text ?? '');
      if (!rawJson) {
        sendJson(res, 502, {
          error: 'Gemini returned an empty response. Please try again with clearer input.',
        });
        return;
      }

      let parsed: {
        summary?: unknown;
        rows?: unknown;
        routineRows?: unknown;
        growthRows?: unknown;
      };
      try {
        parsed = JSON.parse(rawJson) as typeof parsed;
      } catch {
        sendJson(res, 502, {
          error: 'Gemini returned malformed JSON. Please retry the import.',
        });
        return;
      }

      if (targetTable === 'auto') {
        const rawRoutine = Array.isArray(parsed.routineRows) ? parsed.routineRows : [];
        const rawGrowth = Array.isArray(parsed.growthRows) ? parsed.growthRows : [];
        const routineRows = normalizeRoutineRows(rawRoutine, defaultDate, defaultLogger);
        const growthRows = normalizeGrowthRows(rawGrowth, defaultDate, defaultLogger);

        const summary =
          typeof parsed.summary === 'string' && parsed.summary.trim()
            ? parsed.summary.trim()
            : `Auto-recognized ${routineRows.length} routine row${routineRows.length === 1 ? '' : 's'} and ${growthRows.length} growth row${growthRows.length === 1 ? '' : 's'}.`;

        sendJson(res, 200, {
          targetTable: 'auto',
          summary,
          routineRows,
          growthRows,
        });
        return;
      }

      const rawRows = Array.isArray(parsed.rows) ? parsed.rows : [];
      const summary =
        typeof parsed.summary === 'string' && parsed.summary.trim()
          ? parsed.summary.trim()
          : `Recognized ${rawRows.length} ${targetTable} row${rawRows.length === 1 ? '' : 's'}.`;

      if (targetTable === 'routine') {
        const routineRows = normalizeRoutineRows(rawRows, defaultDate, defaultLogger);
        sendJson(res, 200, {
          targetTable: 'routine',
          summary,
          rows: routineRows,
          routineRows,
          growthRows: [],
        });
        return;
      }

      const growthRows = normalizeGrowthRows(rawRows, defaultDate, defaultLogger);
      sendJson(res, 200, {
        targetTable: 'growth',
        summary,
        rows: growthRows,
        routineRows: [],
        growthRows,
      });
    } catch (err) {
      const mapped = mapGeminiError(err);
      console.error('Gemini mass-import failed:', err);
      sendJson(res, mapped.status, { error: mapped.message });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('Unexpected error in /api/mass-import:', err);
    sendJson(res, 500, {
      error: message || 'Unexpected server error in /api/mass-import.',
    });
  }
}
