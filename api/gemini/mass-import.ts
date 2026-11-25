import { ThinkingLevel, Type } from '@google/genai';
import {
  GEMINI_MODEL,
  generateWithRetry,
  getGeminiClient,
  mapGeminiError,
  readJsonBody,
  sendJson,
  type ApiRequest,
  type ApiResponse,
} from '../_lib/gemini';

interface MassImportAttachment {
  mimeType: string;
  data: string;
  fileName?: string;
}

interface MassImportRequestBody {
  targetTable?: 'routine' | 'growth';
  rawText?: string;
  defaultDate?: string;
  defaultLogger?: string;
  attachment?: MassImportAttachment | null;
}

const ALLOWED_ATTACHMENT_MIMES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'application/pdf',
]);

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

export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  if (req.method === 'OPTIONS') {
    res.setHeader('Allow', 'POST, OPTIONS');
    res.statusCode = 204;
    res.end();
    return;
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, OPTIONS');
    sendJson(res, 405, {
      error: 'Method not allowed. Use POST /api/gemini/mass-import.',
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

  const targetTable = body.targetTable;
  const rawText = typeof body.rawText === 'string' ? body.rawText.trim() : '';
  const defaultDate = normalizeDateStr(body.defaultDate) ?? new Date().toISOString().slice(0, 10);
  const defaultLogger =
    typeof body.defaultLogger === 'string' && body.defaultLogger.trim()
      ? body.defaultLogger.trim()
      : '';
  const attachment = body.attachment ?? null;

  if (targetTable !== 'routine' && targetTable !== 'growth') {
    sendJson(res, 400, { error: 'targetTable must be either "routine" or "growth".' });
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

  const routineSystemInstruction = [
    'You are a precise data extraction engine for a baby care Routine table.',
    'Extract EVERY distinct feeding or diaper log entry from the provided text, CSV, table, chat log, screenshot, photo, or PDF into the rows array.',
    `Context: defaultDate="${defaultDate}", currentYear="${currentYear}", defaultLogger="${defaultLogger}".`,
    'Field mapping rules for each row:',
    '- date: YYYY-MM-DD format. If a row only gives month/day (e.g. "Nov 24" or "11/24"), infer the year from context or currentYear. If a row omits the date, carry forward the preceding date heading or use defaultDate.',
    '- time: 24-hour HH:MM format (e.g. "07:30", "19:45"). Convert AM/PM cleanly. Use null if no time is mentioned.',
    '- ebmMl: integer milliliters of Expressed Breast Milk (EBM / breast milk / BM / pumped milk). If given in fl oz, convert using 1 oz = 29.57 mL and round to nearest integer. Null if not present.',
    '- formulaMl: integer milliliters of infant formula (FM / formula). Convert fl oz to mL if needed. Null if not present.',
    '- feedDurationMin: integer minutes of feeding duration (breastfeeding/bottle duration). Null if not present.',
    '- diaper: normalize standard values to "Wet", "Dirty", "Mixed", or "Dry" when clearly matching (e.g. pee/urine -> "Wet", poop/stool/BM -> "Dirty", both/pee+poop -> "Mixed"), or keep a concise custom label. Null if no diaper change was logged.',
    '- name: person who logged the entry (e.g. "Mom", "Dad", "Caregiver"). Do NOT put the baby name here. Use defaultLogger if omitted in the source, or null if both are empty.',
    '- remark: concise additional notes or observations not captured in structured columns. Null if none.',
    'Populate every recognized row object with all fields (using null for absent fields). Do not fabricate rows or values not supported by the source. Skip header rows and empty lines.',
  ].join('\n');

  const growthSystemInstruction = [
    'You are a precise data extraction engine for a baby daily Growth & Vitals table.',
    'Extract EVERY distinct daily weight, length, or temperature measurement from the provided text, CSV, table, chat log, screenshot, photo, or PDF into the rows array.',
    `Context: defaultDate="${defaultDate}", currentYear="${currentYear}", defaultLogger="${defaultLogger}".`,
    'Field mapping rules for each row:',
    '- date: YYYY-MM-DD format. Infer year from context or currentYear if omitted; use defaultDate if no date is present.',
    '- dailyWeight: weight in kilograms (kg), decimal number (e.g. 4.52). Convert grams (e.g. 4520g -> 4.52) or lb/oz (1 lb = 0.453592 kg, 1 oz = 0.0283495 kg) to kg rounded to 2–3 decimals. Null if not present.',
    '- dailyLength: length/height in centimeters (cm), decimal number (e.g. 58.5). Convert inches (1 in = 2.54 cm) or mm to cm rounded to 1 decimal. Null if not present.',
    '- temperature: body temperature in Celsius (°C), decimal number (e.g. 36.8). If given in Fahrenheit (e.g. 98.6°F or values > 45), convert to °C using (F - 32) * 5 / 9 rounded to 1 decimal. Null if not present.',
    '- name: person who logged the entry (e.g. "Mom", "Dad", "Nurse"). Do NOT put the baby name here. Use defaultLogger if omitted in the source, or null if both are empty.',
    '- remark: concise additional notes (e.g. "before feed", "post-vaccine check"). Null if none.',
    'Populate every recognized row object with all fields (using null for absent fields). Do not fabricate rows or values not supported by the source. Skip header rows and empty lines.',
  ].join('\n');

  const routineResponseSchema = {
    type: Type.OBJECT,
    properties: {
      summary: {
        type: Type.STRING,
        description:
          'Short 1-sentence summary of recognized rows, detected columns, and any unit conversions performed.',
      },
      rows: {
        type: Type.ARRAY,
        description: 'All extracted routine rows.',
        items: {
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
        },
      },
    },
    required: ['summary', 'rows'],
  };

  const growthResponseSchema = {
    type: Type.OBJECT,
    properties: {
      summary: {
        type: Type.STRING,
        description:
          'Short 1-sentence summary of recognized rows, detected columns, and any unit conversions performed.',
      },
      rows: {
        type: Type.ARRAY,
        description: 'All extracted growth rows.',
        items: {
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
        },
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
    `Target table: "${targetTable}"`,
    `Default date if missing: ${defaultDate}`,
    defaultLogger ? `Default logger name if missing: ${defaultLogger}` : '',
    rawText
      ? `\nSource data to parse:\n${rawText}`
      : '\nExtract all tabular or written records from the attached document/image.',
  ].filter(Boolean);

  parts.push({ text: promptLines.join('\n') });

  try {
    const response = await generateWithRetry(() =>
      ai.models.generateContent({
        model: GEMINI_MODEL,
        contents: { parts },
        config: {
          systemInstruction:
            targetTable === 'routine' ? routineSystemInstruction : growthSystemInstruction,
          responseMimeType: 'application/json',
          responseSchema:
            targetTable === 'routine' ? routineResponseSchema : growthResponseSchema,
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        },
      })
    );

    const rawJson = stripJsonFence(response.text ?? '');
    if (!rawJson) {
      sendJson(res, 502, {
        error: 'Gemini returned an empty response. Please try again with clearer input.',
      });
      return;
    }

    let parsed: { summary?: unknown; rows?: unknown };
    try {
      parsed = JSON.parse(rawJson) as { summary?: unknown; rows?: unknown };
    } catch {
      sendJson(res, 502, {
        error: 'Gemini returned malformed JSON. Please retry the import.',
      });
      return;
    }

    const rawRows = Array.isArray(parsed.rows) ? parsed.rows : [];
    const summary =
      typeof parsed.summary === 'string' && parsed.summary.trim()
        ? parsed.summary.trim()
        : `Recognized ${rawRows.length} ${targetTable} row${rawRows.length === 1 ? '' : 's'}.`;

    if (targetTable === 'routine') {
      const normalizedRows = rawRows
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

      sendJson(res, 200, {
        targetTable: 'routine',
        summary,
        rows: normalizedRows,
      });
      return;
    }

    const normalizedRows = rawRows
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

    sendJson(res, 200, {
      targetTable: 'growth',
      summary,
      rows: normalizedRows,
    });
  } catch (err) {
    const mapped = mapGeminiError(err);
    console.error('Gemini mass-import failed:', err);
    sendJson(res, mapped.status, { error: mapped.message });
  }
}
