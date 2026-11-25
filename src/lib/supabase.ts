import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export const ENTRIES_TABLE = 'entries' as const;
export const GROWTH_TABLE = 'growth' as const;
export const ROUTINE_TABLE = 'routine' as const;

const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim();
const supabaseAnonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim();

const hasValidConfig = Boolean(
  supabaseUrl &&
    supabaseAnonKey &&
    !supabaseUrl.includes('your-project-id') &&
    !supabaseAnonKey.includes('your-supabase-anon-key')
);

export const isSupabaseConfigured = hasValidConfig;

export const supabase: SupabaseClient | null = hasValidConfig
  ? createClient(supabaseUrl!, supabaseAnonKey!, {
      realtime: {
        params: {
          eventsPerSecond: 10,
        },
      },
    })
  : null;
