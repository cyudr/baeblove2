import { ThinkingLevel } from '@google/genai';
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  executeWithGeminiKeyFallback,
  extractReadableErrorMessage,
  getConfiguredGeminiKeys,
  getFreeKeyCooldownRemainingMs,
} from './_geminiKeys.ts';

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

    const configuredKeys = getConfiguredGeminiKeys();
    if (configuredKeys.length === 0) {
      sendJson(res, 503, {
        status: 'error',
        api: 'unhealthy',
        gemini: 'missing_key',
        keySource: 'none',
        configuredKeys: [],
        model: GEMINI_MODEL,
        latencyMs: Date.now() - startedAt,
        error:
          'Gemini API key is not configured. Set VITE_GEMINI_KEY_FREE and/or VITE_GEMINI_KEY (or GEMINI_API_KEY) in your deployment environment variables.',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    const candidateModels =
      GEMINI_MODEL === 'gemini-3.1-flash-lite'
        ? [GEMINI_MODEL]
        : [GEMINI_MODEL, 'gemini-3.1-flash-lite'];

    let lastErr: unknown = null;
    for (const model of candidateModels) {
      try {
        const execution = await executeWithGeminiKeyFallback(async (ai) => {
          try {
            await ai.models.get({ model });
            return true;
          } catch (getErr) {
            const ping = await ai.models.generateContent({
              model,
              contents: 'Reply with OK',
              config: {
                thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
              },
            });
            if (typeof ping.text === 'string' && ping.text.trim().length > 0) {
              return true;
            }
            throw getErr;
          }
        });

        sendJson(res, 200, {
          status: 'ok',
          api: 'healthy',
          gemini: 'connected',
          keySource: execution.keySource,
          usedFallback: execution.usedFallback,
          configuredKeys: configuredKeys.map((k) => k.source),
          freeKeyCooldownRemainingSec: Math.ceil(getFreeKeyCooldownRemainingMs() / 1000),
          model,
          latencyMs: Date.now() - startedAt,
          timestamp: new Date().toISOString(),
        });
        return;
      } catch (err) {
        lastErr = err;
      }
    }

    const rawMessage = extractReadableErrorMessage(lastErr);

    sendJson(res, 503, {
      status: 'error',
      api: 'unhealthy',
      gemini: 'disconnected',
      keySource: configuredKeys[0]?.source ?? 'none',
      configuredKeys: configuredKeys.map((k) => k.source),
      freeKeyCooldownRemainingSec: Math.ceil(getFreeKeyCooldownRemainingMs() / 1000),
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
