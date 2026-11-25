import { GoogleGenAI, ThinkingLevel, type Schema } from '@google/genai';
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

interface GeminiAttachment {
  mimeType: string;
  data: string;
  fileName?: string;
}

interface GeminiInputPart {
  text?: string;
  inlineData?: {
    mimeType: string;
    data: string;
  };
}

interface GeminiChatMessage {
  role: 'user' | 'model';
  text: string;
}

interface GeminiRequestBody {
  prompt?: string;
  messages?: GeminiChatMessage[];
  parts?: GeminiInputPart[];
  attachment?: GeminiAttachment | null;
  attachments?: GeminiAttachment[] | null;
  systemInstruction?: string;
  responseMimeType?: string;
  responseSchema?: Schema;
  model?: string;
  thinkingLevel?: 'LOW' | 'MEDIUM' | 'HIGH';
}

const MAX_ATTACHMENTS = 12;

const DEFAULT_GEMINI_MODEL = (process.env.GEMINI_MODEL || 'gemini-4-hydrogen').trim();
const FALLBACK_GEMINI_MODEL = 'gemini-3.1-flash-lite';

const ALLOWED_MODELS = new Set([
  'gemini-4-hydrogen',
  'gemini-3.1-flash-lite',
  'gemini-4-neon',
  'gemini-4-carbon',
  'gemini-4-argon',
]);

const ALLOWED_ATTACHMENT_MIMES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'image/heic',
  'image/heif',
  'application/pdf',
  'text/plain',
  'text/csv',
  'audio/mpeg',
  'audio/wav',
  'audio/webm',
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

function mapGeminiError(err: unknown, modelName: string): { status: number; message: string } {
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
      message: `Gemini model "${modelName}" was not found or is unavailable for this API key.`,
    };
  }

  return {
    status: status >= 400 && status < 600 ? status : 500,
    message: rawMessage || 'Gemini API request failed.',
  };
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

function stripJsonFence(text: string): string {
  const trimmed = text.trim();
  const match = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return match ? match[1].trim() : trimmed;
}

function resolveThinkingLevel(level?: string): ThinkingLevel {
  switch (level) {
    case 'HIGH':
      return ThinkingLevel.HIGH;
    case 'MEDIUM':
      return ThinkingLevel.MEDIUM;
    case 'LOW':
    default:
      return ThinkingLevel.LOW;
  }
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
        error: 'Method not allowed. Use POST /api/gemini.',
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

    let body: GeminiRequestBody;
    try {
      body = await readJsonBody<GeminiRequestBody>(req);
    } catch {
      sendJson(res, 400, { error: 'Invalid JSON request payload.' });
      return;
    }

    const requestedModel =
      typeof body.model === 'string' && body.model.trim() ? body.model.trim() : DEFAULT_GEMINI_MODEL;
    const primaryModel = ALLOWED_MODELS.has(requestedModel) ? requestedModel : DEFAULT_GEMINI_MODEL;

    const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [];

    const incomingAttachments: GeminiAttachment[] = [];
    if (Array.isArray(body.attachments)) {
      for (const att of body.attachments) {
        if (att && typeof att === 'object') {
          incomingAttachments.push(att);
        }
      }
    }
    if (body.attachment && typeof body.attachment === 'object') {
      incomingAttachments.push(body.attachment);
    }

    if (incomingAttachments.length > MAX_ATTACHMENTS) {
      sendJson(res, 400, {
        error: `Too many attachments. Please upload at most ${MAX_ATTACHMENTS} files at once.`,
      });
      return;
    }

    for (let i = 0; i < incomingAttachments.length; i++) {
      const att = incomingAttachments[i];
      if (
        !att.mimeType ||
        !ALLOWED_ATTACHMENT_MIMES.has(att.mimeType) ||
        typeof att.data !== 'string' ||
        att.data.length === 0
      ) {
        sendJson(res, 400, {
          error: `Unsupported attachment format${att.fileName ? ` ("${att.fileName}")` : ''}. Upload PNG, JPEG, WEBP, GIF, HEIC, PDF, or plain text/CSV files.`,
        });
        return;
      }
      if (incomingAttachments.length > 1 || att.fileName) {
        parts.push({
          text: `Attachment ${i + 1}${att.fileName ? ` (${att.fileName})` : ''}:`,
        });
      }
      parts.push({
        inlineData: {
          mimeType: att.mimeType,
          data: att.data,
        },
      });
    }

    if (Array.isArray(body.parts)) {
      for (const part of body.parts) {
        if (!part || typeof part !== 'object') continue;
        if (typeof part.text === 'string' && part.text.trim().length > 0) {
          parts.push({ text: part.text });
        } else if (
          part.inlineData &&
          typeof part.inlineData.mimeType === 'string' &&
          ALLOWED_ATTACHMENT_MIMES.has(part.inlineData.mimeType) &&
          typeof part.inlineData.data === 'string' &&
          part.inlineData.data.length > 0
        ) {
          parts.push({
            inlineData: {
              mimeType: part.inlineData.mimeType,
              data: part.inlineData.data,
            },
          });
        }
      }
    }

    if (typeof body.prompt === 'string' && body.prompt.trim().length > 0) {
      parts.push({ text: body.prompt });
    }

    // Sanitize multi-turn chat messages if provided
    const chatMessages: GeminiChatMessage[] = [];
    if (Array.isArray(body.messages)) {
      for (const msg of body.messages) {
        if (!msg || typeof msg !== 'object') continue;
        const role = msg.role === 'model' ? 'model' : msg.role === 'user' ? 'user' : null;
        const text = typeof msg.text === 'string' ? msg.text.trim() : '';
        if (role && text) {
          chatMessages.push({ role, text });
        }
      }
    }

    if (parts.length === 0 && chatMessages.length === 0) {
      sendJson(res, 400, {
        error: 'Provide a prompt, messages, parts, or supported attachment for Gemini to process.',
      });
      return;
    }

    const systemInstruction =
      typeof body.systemInstruction === 'string' && body.systemInstruction.trim()
        ? body.systemInstruction.trim()
        : undefined;

    const responseMimeType =
      typeof body.responseMimeType === 'string' && body.responseMimeType.trim()
        ? body.responseMimeType.trim()
        : undefined;

    const responseSchema =
      body.responseSchema && typeof body.responseSchema === 'object'
        ? body.responseSchema
        : undefined;

    const thinkingLevel = resolveThinkingLevel(body.thinkingLevel);

    const runModel = (modelName: string) =>
      generateWithRetry(async () => {
        if (chatMessages.length > 0 && parts.length === 0) {
          const lastMsg = chatMessages[chatMessages.length - 1];
          const history = chatMessages.slice(0, -1).map((m) => ({
            role: m.role,
            parts: [{ text: m.text }],
          }));

          const chat = ai.chats.create({
            model: modelName,
            history,
            config: {
              ...(systemInstruction ? { systemInstruction } : {}),
              ...(responseMimeType ? { responseMimeType } : {}),
              ...(responseSchema ? { responseSchema } : {}),
              thinkingConfig: { thinkingLevel },
            },
          });

          return chat.sendMessage({ message: lastMsg.text });
        }

        return ai.models.generateContent({
          model: modelName,
          contents: { parts },
          config: {
            ...(systemInstruction ? { systemInstruction } : {}),
            ...(responseMimeType ? { responseMimeType } : {}),
            ...(responseSchema ? { responseSchema } : {}),
            thinkingConfig: { thinkingLevel },
          },
        });
      });

    let usedModel = primaryModel;
    let response;

    try {
      try {
        response = await runModel(primaryModel);
      } catch (primaryErr) {
        const primaryStatus = getErrorStatus(primaryErr);
        const primaryMsg = extractReadableErrorMessage(primaryErr);
        const shouldFallback =
          primaryModel !== FALLBACK_GEMINI_MODEL &&
          (primaryStatus === 503 ||
            primaryStatus === 404 ||
            primaryMsg.includes('UNAVAILABLE') ||
            primaryMsg.includes('NOT_FOUND') ||
            primaryMsg.includes('high demand'));

        if (!shouldFallback) {
          throw primaryErr;
        }
        usedModel = FALLBACK_GEMINI_MODEL;
        response = await runModel(FALLBACK_GEMINI_MODEL);
      }

      const rawText = (response.text ?? '').trim();
      if (!rawText) {
        sendJson(res, 502, {
          error: 'Gemini returned an empty response. Please try again with clearer input.',
        });
        return;
      }

      if (responseMimeType === 'application/json') {
        const cleanJson = stripJsonFence(rawText);
        try {
          const parsed = JSON.parse(cleanJson) as unknown;
          sendJson(res, 200, {
            model: usedModel,
            text: cleanJson,
            parsed,
          });
          return;
        } catch {
          sendJson(res, 502, {
            error: 'Gemini returned malformed JSON. Please retry the request.',
          });
          return;
        }
      }

      sendJson(res, 200, {
        model: usedModel,
        text: rawText,
      });
    } catch (err) {
      const mapped = mapGeminiError(err, usedModel);
      console.error('Gemini API request failed:', err);
      sendJson(res, mapped.status, { error: mapped.message });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('Unexpected error in /api/gemini:', err);
    sendJson(res, 500, {
      error: message || 'Unexpected server error in /api/gemini.',
    });
  }
}
