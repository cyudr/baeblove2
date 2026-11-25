import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import type { IncomingMessage, ServerResponse } from 'node:http';

export const GEMINI_MODEL = (process.env.GEMINI_MODEL || 'gemini-4-hydrogen').trim();

export interface ApiRequest extends IncomingMessage {
  body?: unknown;
  query?: Record<string, string | string[] | undefined>;
}

export interface ApiResponse extends ServerResponse {
  status?: (statusCode: number) => ApiResponse;
  json?: (body: unknown) => void;
  send?: (body: unknown) => void;
}

export function getGeminiApiKey(): string {
  return (process.env.VITE_GEMINI_KEY || process.env.GEMINI_API_KEY || '').trim();
}

export function getGeminiClient(): GoogleGenAI | null {
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

export function sendJson(res: ApiResponse, statusCode: number, payload: unknown): void {
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

export async function readJsonBody<T = Record<string, unknown>>(req: ApiRequest): Promise<T> {
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

export async function generateWithRetry<T>(fn: () => Promise<T>, maxRetries = 2): Promise<T> {
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
      if (status === 400 || status === 401 || status === 403 || status === 404) {
        throw err;
      }
      if (attempt < maxRetries) {
        const delayMs = 500 * Math.pow(2, attempt);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }
  throw lastErr;
}

export function mapGeminiError(err: unknown): { status: number; message: string } {
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

export interface GeminiHealthResult {
  healthy: boolean;
  status: 'ok' | 'error';
  model: string;
  latencyMs: number;
  error?: string;
}

export async function checkGeminiHealth(): Promise<GeminiHealthResult> {
  const startedAt = Date.now();
  const ai = getGeminiClient();
  if (!ai) {
    return {
      healthy: false,
      status: 'error',
      model: GEMINI_MODEL,
      latencyMs: Date.now() - startedAt,
      error:
        'Gemini API key is not configured. Set VITE_GEMINI_KEY or GEMINI_API_KEY in your server environment.',
    };
  }

  try {
    // Lightweight metadata check first (zero token usage)
    await ai.models.get({ model: GEMINI_MODEL });
    return {
      healthy: true,
      status: 'ok',
      model: GEMINI_MODEL,
      latencyMs: Date.now() - startedAt,
    };
  } catch (getErr) {
    // Fallback to a minimal generateContent ping in case the key restricts models.get
    try {
      const ping = await ai.models.generateContent({
        model: GEMINI_MODEL,
        contents: 'Reply with OK',
        config: {
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        },
      });
      if (typeof ping.text === 'string' && ping.text.trim().length > 0) {
        return {
          healthy: true,
          status: 'ok',
          model: GEMINI_MODEL,
          latencyMs: Date.now() - startedAt,
        };
      }
      throw getErr;
    } catch (pingErr) {
      const mapped = mapGeminiError(pingErr);
      return {
        healthy: false,
        status: 'error',
        model: GEMINI_MODEL,
        latencyMs: Date.now() - startedAt,
        error: mapped.message,
      };
    }
  }
}
