import {
  checkGeminiHealth,
  sendJson,
  type ApiRequest,
  type ApiResponse,
} from './_lib/gemini';

export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
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

  const health = await checkGeminiHealth();

  if (health.healthy) {
    sendJson(res, 200, {
      status: 'ok',
      api: 'healthy',
      gemini: 'connected',
      model: health.model,
      latencyMs: health.latencyMs,
      timestamp: new Date().toISOString(),
    });
    return;
  }

  sendJson(res, 503, {
    status: 'error',
    api: 'unhealthy',
    gemini: 'disconnected',
    model: health.model,
    latencyMs: health.latencyMs,
    error: health.error || 'Gemini API health check failed.',
    timestamp: new Date().toISOString(),
  });
}
