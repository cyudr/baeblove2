import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export const ENTRIES_TABLE = 'entries' as const;
export const GROWTH_TABLE = 'growth' as const;
export const ROUTINE_TABLE = 'routine' as const;
export const NOTES_TABLE = 'notes' as const;

function stripWrappingQuotes(value: string | undefined): string {
  if (!value) return '';
  return value.trim().replace(/^['"]+|['"]+$/g, '').trim();
}

/**
 * Normalizes VITE_SUPABASE_URL to the bare project origin (https://<ref>.supabase.co).
 * Prevents PostgREST PGRST125 ("Invalid path specified in request URL") when a user
 * configures a URL containing `/rest/v1`, a trailing path, quotes, or a Supabase dashboard URL.
 */
function normalizeSupabaseUrl(raw: string | undefined): string {
  const cleaned = stripWrappingQuotes(raw);
  if (!cleaned) return '';

  const withScheme = /^https?:\/\//i.test(cleaned) ? cleaned : `https://${cleaned}`;

  try {
    const parsed = new URL(withScheme);

    // Handle pasted Supabase Dashboard URLs: https://supabase.com/dashboard/project/<ref>/...
    if (
      parsed.hostname === 'supabase.com' ||
      parsed.hostname === 'app.supabase.com' ||
      parsed.hostname.endsWith('.supabase.com')
    ) {
      const match = parsed.pathname.match(/\/(?:dashboard\/)?project\/([a-z0-9-]+)/i);
      if (match?.[1]) {
        return `https://${match[1]}.supabase.co`;
      }
    }

    // Always strip any path (such as /rest/v1 or /rest/v1/routine) so @supabase/supabase-js
    // appends /rest/v1/<table> cleanly without duplicating segments.
    return parsed.origin;
  } catch {
    return cleaned.replace(/\/+$/, '');
  }
}

const supabaseUrl = normalizeSupabaseUrl(import.meta.env.VITE_SUPABASE_URL as string | undefined);
const supabaseKey = stripWrappingQuotes(
  (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) ||
    (import.meta.env.VITE_SUPABASE_PUB_KEY as string | undefined)
);

const hasValidConfig = Boolean(
  supabaseUrl &&
    supabaseKey &&
    !supabaseUrl.includes('your-project-id') &&
    !supabaseKey.includes('your-supabase-anon-key') &&
    !supabaseKey.includes('your-supabase-publishable-key')
);

export const isSupabaseConfigured = hasValidConfig;

export const supabase: SupabaseClient | null = hasValidConfig
  ? createClient(supabaseUrl, supabaseKey, {
      realtime: {
        params: {
          eventsPerSecond: 10,
        },
      },
    })
  : null;
