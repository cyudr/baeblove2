import { GoogleGenAI } from '@google/genai';

export type GeminiKeySource =
  | 'VITE_GEMINI_KEY_FREE'
  | 'VITE_GEMINI_KEY'
  | 'GEMINI_API_KEY'
  | 'none';

export interface GeminiKeyCandidate {
  apiKey: string;
  source: Exclude<GeminiKeySource, 'none'>;
  tier: 'free' | 'paid';
}

interface FreeKeyCooldownState {
  cooldownUntilMs: number;
  reason: string;
}

const DEFAULT_RPM_COOLDOWN_MS = 60_000;
const MIN_COOLDOWN_MS = 15_000;
const MAX_RPM_COOLDOWN_MS = 5 * 60_000;
const DAILY_QUOTA_COOLDOWN_MS = 10 * 60_000;

let freeKeyCooldown: FreeKeyCooldownState | null = null;

export function getErrorStatus(err: unknown): number {
  return typeof err === 'object' && err !== null && 'status' in err
    ? Number((err as { status?: unknown }).status)
    : 0;
}

export function extractReadableErrorMessage(err: unknown): string {
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

/**
 * Returns true when an error indicates the API key reached its rate limit or quota limit.
 */
export function isGeminiLimitError(err: unknown): boolean {
  const status = getErrorStatus(err);
  if (status === 429) return true;

  const rawText =
    err instanceof Error
      ? err.message
      : typeof err === 'object' && err !== null
        ? JSON.stringify(err)
        : String(err);
  const readable = extractReadableErrorMessage(err);
  const combined = `${rawText} ${readable}`.toLowerCase();

  return (
    combined.includes('resource_exhausted') ||
    combined.includes('quota exceeded') ||
    combined.includes('exceeded your current quota') ||
    combined.includes('rate limit') ||
    combined.includes('rate-limit') ||
    combined.includes('too many requests') ||
    combined.includes('requestsperday') ||
    combined.includes('requestsperminute') ||
    combined.includes('tokensperminute') ||
    combined.includes('free_tier')
  );
}

function computeLimitCooldownMs(err: unknown): { ms: number; reason: string } {
  const rawText =
    err instanceof Error
      ? err.message
      : typeof err === 'object' && err !== null
        ? JSON.stringify(err)
        : String(err);
  const combined = `${rawText} ${extractReadableErrorMessage(err)}`;
  const lower = combined.toLowerCase();

  const isDailyLimit =
    lower.includes('perday') ||
    lower.includes('per day') ||
    lower.includes('daily') ||
    lower.includes('limit: 0');

  if (isDailyLimit) {
    return { ms: DAILY_QUOTA_COOLDOWN_MS, reason: 'daily-quota' };
  }

  // Try parsing Google's retry hint (e.g., "Please retry in 34.2s." or "retryDelay":"45s")
  const retrySecMatch =
    combined.match(/retry\s+in\s+(\d+(?:\.\d+)?)\s*s/i) ||
    combined.match(/"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/i);

  if (retrySecMatch) {
    const parsedMs = Math.ceil(Number(retrySecMatch[1]) * 1000);
    if (Number.isFinite(parsedMs) && parsedMs > 0) {
      return {
        ms: Math.max(MIN_COOLDOWN_MS, Math.min(MAX_RPM_COOLDOWN_MS, parsedMs)),
        reason: 'rate-limit-retry-delay',
      };
    }
  }

  return { ms: DEFAULT_RPM_COOLDOWN_MS, reason: 'rate-limit' };
}

/**
 * Collects configured Gemini keys in strict priority order:
 * 1. VITE_GEMINI_KEY_FREE (always preferred first)
 * 2. VITE_GEMINI_KEY (fallback when free key reaches limit)
 * 3. GEMINI_API_KEY (fallback if neither VITE_ key is configured or as backup)
 */
export function getConfiguredGeminiKeys(): GeminiKeyCandidate[] {
  const candidates: GeminiKeyCandidate[] = [];
  const seen = new Set<string>();

  const pushIfPresent = (
    raw: string | undefined,
    source: Exclude<GeminiKeySource, 'none'>,
    tier: 'free' | 'paid'
  ) => {
    const key = (raw || '').trim();
    if (!key || seen.has(key)) return;
    seen.add(key);
    candidates.push({ apiKey: key, source, tier });
  };

  pushIfPresent(process.env.VITE_GEMINI_KEY_FREE, 'VITE_GEMINI_KEY_FREE', 'free');
  pushIfPresent(process.env.VITE_GEMINI_KEY, 'VITE_GEMINI_KEY', 'paid');
  if (!candidates.some((c) => c.source === 'VITE_GEMINI_KEY')) {
    pushIfPresent(process.env.GEMINI_API_KEY, 'GEMINI_API_KEY', 'paid');
  }

  return candidates;
}

export function createGeminiClient(apiKey: string): GoogleGenAI {
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

export function isFreeKeyInCooldown(now = Date.now()): boolean {
  if (!freeKeyCooldown) return false;
  if (now >= freeKeyCooldown.cooldownUntilMs) {
    freeKeyCooldown = null;
    return false;
  }
  return true;
}

export function getFreeKeyCooldownRemainingMs(now = Date.now()): number {
  if (!isFreeKeyInCooldown(now) || !freeKeyCooldown) return 0;
  return Math.max(0, freeKeyCooldown.cooldownUntilMs - now);
}

/**
 * Executes a Gemini operation using VITE_GEMINI_KEY_FREE first, automatically
 * toggling to VITE_GEMINI_KEY only when VITE_GEMINI_KEY_FREE hits its limit
 * (and automatically toggling back to VITE_GEMINI_KEY_FREE once the cooldown expires).
 */
export async function executeWithGeminiKeyFallback<T>(
  operation: (
    ai: GoogleGenAI,
    candidate: GeminiKeyCandidate,
    hasFallbackKey: boolean
  ) => Promise<T>
): Promise<{ result: T; keySource: Exclude<GeminiKeySource, 'none'>; usedFallback: boolean }> {
  const configured = getConfiguredGeminiKeys();
  if (configured.length === 0) {
    throw new Error('NO_GEMINI_KEY_CONFIGURED');
  }

  const freeCandidate = configured.find((c) => c.source === 'VITE_GEMINI_KEY_FREE');
  const paidCandidate = configured.find((c) => c.tier === 'paid');

  // Determine attempt order based on free-first rule + active limit cooldown
  const ordered: GeminiKeyCandidate[] = [];
  let startedOnFallback = false;

  if (freeCandidate && paidCandidate) {
    if (isFreeKeyInCooldown()) {
      // Free key recently hit its limit; temporarily route to paid key until cooldown expires.
      ordered.push(paidCandidate);
      startedOnFallback = true;
    } else {
      // Always try VITE_GEMINI_KEY_FREE first, falling back to VITE_GEMINI_KEY on limit.
      ordered.push(freeCandidate, paidCandidate);
    }
  } else {
    ordered.push(...configured);
  }

  let lastErr: unknown;

  for (let i = 0; i < ordered.length; i++) {
    const candidate = ordered[i];
    const hasNextFallback = i < ordered.length - 1;
    const ai = createGeminiClient(candidate.apiKey);

    try {
      const result = await operation(ai, candidate, hasNextFallback);
      if (candidate.source === 'VITE_GEMINI_KEY_FREE') {
        freeKeyCooldown = null;
      }
      return {
        result,
        keySource: candidate.source,
        usedFallback: startedOnFallback || i > 0,
      };
    } catch (err) {
      lastErr = err;

      // Only toggle from VITE_GEMINI_KEY_FREE -> VITE_GEMINI_KEY when the free key hits its limit.
      if (candidate.source === 'VITE_GEMINI_KEY_FREE' && hasNextFallback && isGeminiLimitError(err)) {
        const cooldown = computeLimitCooldownMs(err);
        freeKeyCooldown = {
          cooldownUntilMs: Date.now() + cooldown.ms,
          reason: cooldown.reason,
        };
        console.warn(
          `[Gemini] VITE_GEMINI_KEY_FREE reached limit (${cooldown.reason}); switching to ${ordered[i + 1].source} for ~${Math.round(cooldown.ms / 1000)}s.`
        );
        continue;
      }

      throw err;
    }
  }

  throw lastErr;
}
