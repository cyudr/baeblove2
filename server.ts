import dotenv from 'dotenv';
import express, { type Request, type Response } from 'express';
import fs from 'fs';
import path from 'path';
import { GoogleGenAI, Type } from '@google/genai';

// Load local .env files if present without overriding runtime environment variables
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const PORT = Number(process.env.PORT || 3000);
const GEMINI_MODEL = 'gemini-4-hydrogen';

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

async function generateWithRetry<T>(fn: () => Promise<T>, maxRetries = 2): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const status =
        typeof err === 'object' && err !== null && 'status' in err
          ? Number((err as { status?: unknown }).status)
          : 0;
      // Do not retry auth, invalid request, or not found errors
      if (status === 400 || status === 401 || status === 403 || status === 404) {
        throw err;
      }
      if (attempt < maxRetries) {
        const delayMs = 600 * Math.pow(2, attempt);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }
  throw lastErr;
}

function mapGeminiError(err: unknown): { status: number; message: string } {
  const rawMessage =
    err instanceof Error
      ? err.message
      : typeof err === 'object' && err !== null && 'message' in err
        ? String((err as { message?: unknown }).message)
        : String(err);

  const status =
    typeof err === 'object' && err !== null && 'status' in err
      ? Number((err as { status?: unknown }).status)
      : 500;

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
        'Gemini API key was rejected (invalid or missing permissions). Please verify VITE_GEMINI_KEY in your Settings > Secrets panel.',
    };
  }

  if (status === 429 || rawMessage.includes('RESOURCE_EXHAUSTED')) {
    return {
      status: 429,
      message:
        'Gemini API quota exceeded (429). Please wait a moment and retry, or check your key quota in Settings > Secrets.',
    };
  }

  if (status === 404 || rawMessage.includes('NOT_FOUND')) {
    return {
      status: 404,
      message: `Gemini model "${GEMINI_MODEL}" was not found or is unavailable for this key.`,
    };
  }

  return {
    status: status >= 400 && status < 600 ? status : 500,
    message: rawMessage || 'Failed to analyze data with Gemini.',
  };
}

async function createApp() {
  const app = express();
  app.use(express.json({ limit: '15mb' }));

  app.post('/api/gemini/mass-import', async (req: Request, res: Response) => {
    const ai = getGeminiClient();
    if (!ai) {
      res.status(500).json({
        error:
          'Gemini API key is not configured. Please set VITE_GEMINI_KEY in your environment variables or Settings > Secrets panel.',
      });
      return;
    }

    const body = (req.body ?? {}) as MassImportRequestBody;
    const targetTable = body.targetTable;
    const rawText = typeof body.rawText === 'string' ? body.rawText.trim() : '';
    const defaultDate = normalizeDateStr(body.defaultDate) ?? new Date().toISOString().slice(0, 10);
    const defaultLogger =
      typeof body.defaultLogger === 'string' && body.defaultLogger.trim()
        ? body.defaultLogger.trim()
        : '';
    const attachment = body.attachment ?? null;

    if (targetTable !== 'routine' && targetTable !== 'growth') {
      res.status(400).json({ error: 'targetTable must be either "routine" or "growth".' });
      return;
    }

    if (!rawText && !attachment) {
      res.status(400).json({
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
        res.status(400).json({
          error:
            'Unsupported attachment format. Upload a PNG, JPEG, WEBP, GIF, PDF, or plain text/CSV file.',
        });
        return;
      }
    }

    const currentYear = defaultDate.slice(0, 4);

    const routineSystemInstruction = [
      'You are a precise data extraction engine for a baby care Routine table.',
      'Extract EVERY distinct feeding or diaper log entry from the provided text, CSV, table, chat log, screenshot, or PDF into structured rows.',
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
      'Do not fabricate rows or values not supported by the source. Skip header rows and empty lines.',
    ].join('\n');

    const growthSystemInstruction = [
      'You are a precise data extraction engine for a baby daily Growth & Vitals table.',
      'Extract EVERY distinct daily weight, length, or temperature measurement from the provided text, CSV, table, chat log, screenshot, or PDF into structured rows.',
      `Context: defaultDate="${defaultDate}", currentYear="${currentYear}", defaultLogger="${defaultLogger}".`,
      'Field mapping rules for each row:',
      '- date: YYYY-MM-DD format. Infer year from context or currentYear if omitted; use defaultDate if no date is present.',
      '- dailyWeight: weight in kilograms (kg), decimal number (e.g. 4.52). Convert grams (e.g. 4520g -> 4.52) or lb/oz (1 lb = 0.453592 kg, 1 oz = 0.0283495 kg) to kg rounded to 2–3 decimals. Null if not present.',
      '- dailyLength: length/height in centimeters (cm), decimal number (e.g. 58.5). Convert inches (1 in = 2.54 cm) or mm to cm rounded to 1 decimal. Null if not present.',
      '- temperature: body temperature in Celsius (°C), decimal number (e.g. 36.8). If given in Fahrenheit (e.g. 98.6°F or values > 45), convert to °C using (F - 32) * 5 / 9 rounded to 1 decimal. Null if not present.',
      '- name: person who logged the entry (e.g. "Mom", "Dad", "Nurse"). Do NOT put the baby name here. Use defaultLogger if omitted in the source, or null if both are empty.',
      '- remark: concise additional notes (e.g. "before feed", "post-vaccine check"). Null if none.',
      'Do not fabricate rows or values not supported by the source. Skip header rows and empty lines.',
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
          items: {
            type: Type.OBJECT,
            properties: {
              date: { type: Type.STRING, nullable: true },
              time: { type: Type.STRING, nullable: true },
              ebmMl: { type: Type.INTEGER, nullable: true },
              formulaMl: { type: Type.INTEGER, nullable: true },
              feedDurationMin: { type: Type.INTEGER, nullable: true },
              diaper: { type: Type.STRING, nullable: true },
              name: { type: Type.STRING, nullable: true },
              remark: { type: Type.STRING, nullable: true },
            },
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
          items: {
            type: Type.OBJECT,
            properties: {
              date: { type: Type.STRING, nullable: true },
              dailyWeight: { type: Type.NUMBER, nullable: true },
              dailyLength: { type: Type.NUMBER, nullable: true },
              temperature: { type: Type.NUMBER, nullable: true },
              name: { type: Type.STRING, nullable: true },
              remark: { type: Type.STRING, nullable: true },
            },
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
          },
        })
      );

      const rawJson = (response.text ?? '').trim();
      if (!rawJson) {
        res.status(502).json({
          error: 'Gemini returned an empty response. Please try again with clearer input.',
        });
        return;
      }

      let parsed: { summary?: unknown; rows?: unknown };
      try {
        parsed = JSON.parse(rawJson) as { summary?: unknown; rows?: unknown };
      } catch {
        res.status(502).json({
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
              'EBM (mL)': normalizeNullableInt(obj.ebmMl),
              'Formula (mL)': normalizeNullableInt(obj.formulaMl),
              'feed duration (min)': normalizeNullableInt(obj.feedDurationMin),
              Diaper: normalizeNullableText(obj.diaper),
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

        res.json({
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
            daily_weight: normalizeNullableFloat(obj.dailyWeight, 3),
            daily_length: normalizeNullableFloat(obj.dailyLength, 1),
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

      res.json({
        targetTable: 'growth',
        summary,
        rows: normalizedRows,
      });
    } catch (err) {
      const mapped = mapGeminiError(err);
      console.error('Gemini mass-import failed:', err);
      res.status(mapped.status).json({ error: mapped.message });
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      const indexPath = path.join(distDir, 'index.html');
      if (fs.existsSync(indexPath)) {
        res.sendFile(indexPath);
      } else {
        res.status(404).send('Build output not found. Run npm run build first.');
      }
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server listening on http://0.0.0.0:${PORT}`);
  });
}

createApp().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
