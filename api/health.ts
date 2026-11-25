import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import type { IncomingMessage, ServerResponse } from 'node:http';

interface ApiRequest extends IncomingMessage {
  body?: unknown;
  query?: Record<string, unknown>;
}

interface ApiResponse extends ServerResponse {
  status?: (statusCode: number) => ApiResponse;
  json?: (body: unknown) => void;
}

const GEMINI_MODEL = (process.env.GEMINI_MODEL || 'gemini-4-hydrogen').trim();

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

function getKeyInfo(): { apiKey: string; source: 'VITE_GEMINI_KEY' | 'GEMINI_API_KEY' | 'none' } {
  const viteKey = (process.env.VITE_GEMINI_KEY || '').trim();
  if (viteKey) return { apiKey: viteKey, source: 'VITE_GEMINI_KEY' };
  const geminiKey = (process.env.GEMINI_API_KEY || '').trim();
  if (geminiKey) return { apiKey: geminiKey, source: 'GEMINI_API_KEY' };
  return { apiKey: '', source: 'none' };
}

export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  const startedAt = Date.now();

  try {
    if (req.method === 'OPTIONS') {
      res.setHeader('Allow', 'GET, OPTIONS');
      res.statusCode = 204;
      res.end();
      return;
    }

    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET, OPTIONS');
      sendJson(res, 405, {
        status: 'error',
        error: 'Method not allowed. Use GET /api/health.',
      });
      return;
    }

    const { apiKey, source } = getKeyInfo();
    if (!apiKey) {
      sendJson(res, 503, {
        status: 'error',
        api: 'unhealthy',
        gemini: 'missing_key',
        keySource: source,
        model: GEMINI_MODEL,
        latencyMs: Date.now() - startedAt,
        error:
          'Gemini API key is not configured. Set VITE_GEMINI_KEY (or GEMINI_API_KEY) in your deployment environment variables.',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });

    const candidateModels =
      GEMINI_MODEL === 'gemini-3.1-flash-lite'
        ? [GEMINI_MODEL]
        : [GEMINI_MODEL, 'gemini-3.1-flash-lite'];

    let lastErr: unknown = null;
    for (const model of candidateModels) {
      try {
        await ai.models.get({ model });
        sendJson(res, 200, {
          status: 'ok',
          api: 'healthy',
          gemini: 'connected',
          keySource: source,
          model,
          latencyMs: Date.now() - startedAt,
          timestamp: new Date().toISOString(),
        });
        return;
      } catch (getErr) {
        try {
          const ping = await ai.models.generateContent({
            model,
            contents: 'Reply with OK',
            config: {
              thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
            },
          });
          if (typeof ping.text === 'string' && ping.text.trim().length > 0) {
            sendJson(res, 200, {
              status: 'ok',
              api: 'healthy',
              gemini: 'connected',
              keySource: source,
              model,
              latencyMs: Date.now() - startedAt,
              timestamp: new Date().toISOString(),
            });
            return;
          }
          lastErr = getErr;
        } catch (pingErr) {
          lastErr = pingErr;
        }
      }
    }

    const rawMessage =
      lastErr instanceof Error
        ? lastErr.message
        : typeof lastErr === 'object' && lastErr !== null && 'message' in lastErr
          ? String((lastErr as { message?: unknown }).message)
          : String(lastErr);

    sendJson(res, 503, {
      status: 'error',
      api: 'unhealthy',
      gemini: 'disconnected',
      keySource: source,
      model: GEMINI_MODEL,
      latencyMs: Date.now() - startedAt,
      error: rawMessage || 'Gemini API health check failed.',
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    sendJson(res, 500, {
      status: 'error',
      api: 'unhealthy',
      error: message || 'Unexpected error in /api/health.',
      timestamp: new Date().toISOString(),
    });
  }
}
