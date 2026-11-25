import type { RealtimePostgresChangesPayload } from '@supabase/supabase-js';
import { supabase, GROWTH_TABLE, ROUTINE_TABLE } from './supabase';
import type {
  GrowthRecord,
  NewGrowthRecordInput,
  RoutineRecord,
  NewRoutineRecordInput,
} from '../types';

function toNullableFloat(value: number | null | undefined): number | null {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return null;
  }
  return Number(value);
}

function toNullableInt(value: number | null | undefined): number | null {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return null;
  }
  return Math.round(Number(value));
}

function toNullableText(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeGrowthRow(raw: Record<string, unknown>): GrowthRecord {
  return {
    id: Number(raw.id),
    created_at: String(raw.created_at ?? new Date().toISOString()),
    daily_weight: raw.daily_weight !== null && raw.daily_weight !== undefined ? Number(raw.daily_weight) : null,
    daily_length: raw.daily_length !== null && raw.daily_length !== undefined ? Number(raw.daily_length) : null,
    temperature: raw.temperature !== null && raw.temperature !== undefined ? Number(raw.temperature) : null,
    remark: raw.remark !== null && raw.remark !== undefined ? String(raw.remark) : null,
    name: raw.name !== null && raw.name !== undefined ? String(raw.name) : null,
  };
}

function normalizeRoutineRow(raw: Record<string, unknown>): RoutineRecord {
  return {
    id: Number(raw.id),
    created_at: String(raw.created_at ?? new Date().toISOString()),
    date: raw.date !== null && raw.date !== undefined ? String(raw.date) : null,
    time: raw.time !== null && raw.time !== undefined ? String(raw.time) : null,
    'EBM (mL)':
      raw['EBM (mL)'] !== null && raw['EBM (mL)'] !== undefined ? Number(raw['EBM (mL)']) : null,
    'Formula (mL)':
      raw['Formula (mL)'] !== null && raw['Formula (mL)'] !== undefined
        ? Number(raw['Formula (mL)'])
        : null,
    Diaper: raw.Diaper !== null && raw.Diaper !== undefined ? String(raw.Diaper) : null,
    name: raw.name !== null && raw.name !== undefined ? String(raw.name) : null,
    remark: raw.remark !== null && raw.remark !== undefined ? String(raw.remark) : null,
    'feed duration (min)':
      raw['feed duration (min)'] !== null && raw['feed duration (min)'] !== undefined
        ? Number(raw['feed duration (min)'])
        : null,
  };
}

// ============================================================================
// GROWTH TABLE CRUD + REALTIME
// ============================================================================

export async function fetchGrowthRecords(): Promise<GrowthRecord[] | null> {
  if (!supabase) return null;

  const { data, error } = await supabase
    .from(GROWTH_TABLE)
    .select('id, created_at, daily_weight, daily_length, temperature, remark, name')
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Failed to fetch "growth" records from Supabase:', error.message);
    return null;
  }

  return ((data as Record<string, unknown>[]) ?? []).map(normalizeGrowthRow);
}

export async function insertGrowthRecord(
  input: NewGrowthRecordInput
): Promise<{ record: GrowthRecord | null; error?: string }> {
  const payload = {
    daily_weight: toNullableFloat(input.daily_weight),
    daily_length: toNullableFloat(input.daily_length),
    temperature: toNullableFloat(input.temperature),
    remark: toNullableText(input.remark),
    name: toNullableText(input.name),
  };

  if (!supabase) {
    return {
      record: null,
      error: 'Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.',
    };
  }

  const firstAttempt = await supabase
    .from(GROWTH_TABLE)
    .insert(payload)
    .select('id, created_at, daily_weight, daily_length, temperature, remark, name')
    .single();

  if (!firstAttempt.error && firstAttempt.data) {
    return { record: normalizeGrowthRow(firstAttempt.data as Record<string, unknown>) };
  }

  // Fallback if the user's int8 primary key does not have an identity/sequence default
  if (firstAttempt.error?.code === '23502') {
    const retryAttempt = await supabase
      .from(GROWTH_TABLE)
      .insert({ id: Date.now(), ...payload })
      .select('id, created_at, daily_weight, daily_length, temperature, remark, name')
      .single();

    if (!retryAttempt.error && retryAttempt.data) {
      return { record: normalizeGrowthRow(retryAttempt.data as Record<string, unknown>) };
    }
    return { record: null, error: retryAttempt.error?.message };
  }

  return { record: null, error: firstAttempt.error?.message };
}

export async function updateGrowthRecord(
  id: number,
  updates: NewGrowthRecordInput
): Promise<{ record: GrowthRecord | null; error?: string }> {
  const payload: Record<string, unknown> = {};
  if ('daily_weight' in updates) payload.daily_weight = toNullableFloat(updates.daily_weight);
  if ('daily_length' in updates) payload.daily_length = toNullableFloat(updates.daily_length);
  if ('temperature' in updates) payload.temperature = toNullableFloat(updates.temperature);
  if ('remark' in updates) payload.remark = toNullableText(updates.remark);
  if ('name' in updates) payload.name = toNullableText(updates.name);

  if (!supabase) {
    return {
      record: null,
      error: 'Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.',
    };
  }

  const { data, error } = await supabase
    .from(GROWTH_TABLE)
    .update(payload)
    .eq('id', id)
    .select('id, created_at, daily_weight, daily_length, temperature, remark, name')
    .single();

  if (error) {
    console.error(`Failed to update "growth" record ${id}:`, error.message);
    return { record: null, error: error.message };
  }

  return { record: data ? normalizeGrowthRow(data as Record<string, unknown>) : null };
}

export async function deleteGrowthRecord(id: number): Promise<{ error?: string }> {
  if (!supabase) {
    return { error: 'Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.' };
  }

  const { error } = await supabase.from(GROWTH_TABLE).delete().eq('id', id);
  if (error) {
    console.error(`Failed to delete "growth" record ${id}:`, error.message);
    return { error: error.message };
  }
  return {};
}

export function subscribeToGrowth(handlers: {
  onUpsert: (record: GrowthRecord) => void;
  onDelete: (id: number) => void;
}): () => void {
  if (!supabase) return () => {};

  const client = supabase;
  const channel = client
    .channel('growth-realtime')
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: GROWTH_TABLE,
      },
      (payload: RealtimePostgresChangesPayload<Record<string, unknown>>) => {
        if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
          if (payload.new && 'id' in payload.new) {
            handlers.onUpsert(normalizeGrowthRow(payload.new));
          }
        } else if (payload.eventType === 'DELETE') {
          if (payload.old && 'id' in payload.old) {
            handlers.onDelete(Number(payload.old.id));
          }
        }
      }
    )
    .subscribe();

  return () => {
    void client.removeChannel(channel);
  };
}

// ============================================================================
// ROUTINE TABLE CRUD + REALTIME
// ============================================================================

export async function fetchRoutineRecords(): Promise<RoutineRecord[] | null> {
  if (!supabase) return null;

  const { data, error } = await supabase
    .from(ROUTINE_TABLE)
    .select(
      'id, created_at, date, time, "EBM (mL)", "Formula (mL)", "Diaper", name, remark, "feed duration (min)"'
    )
    .order('date', { ascending: false, nullsFirst: false })
    .order('time', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Failed to fetch "routine" records from Supabase:', error.message);
    return null;
  }

  return ((data as Record<string, unknown>[]) ?? []).map(normalizeRoutineRow);
}

export async function insertRoutineRecord(
  input: NewRoutineRecordInput
): Promise<{ record: RoutineRecord | null; error?: string }> {
  const payload = {
    date: toNullableText(input.date),
    time: toNullableText(input.time),
    'EBM (mL)': toNullableInt(input['EBM (mL)']),
    'Formula (mL)': toNullableInt(input['Formula (mL)']),
    Diaper: toNullableText(input.Diaper),
    name: toNullableText(input.name),
    remark: toNullableText(input.remark),
    'feed duration (min)': toNullableInt(input['feed duration (min)']),
  };

  if (!supabase) {
    return {
      record: null,
      error: 'Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.',
    };
  }

  const selectCols =
    'id, created_at, date, time, "EBM (mL)", "Formula (mL)", "Diaper", name, remark, "feed duration (min)"';

  const firstAttempt = await supabase
    .from(ROUTINE_TABLE)
    .insert(payload)
    .select(selectCols)
    .single();

  if (!firstAttempt.error && firstAttempt.data) {
    return { record: normalizeRoutineRow(firstAttempt.data as Record<string, unknown>) };
  }

  // Fallback if the user's int8 primary key does not have an identity/sequence default
  if (firstAttempt.error?.code === '23502') {
    const retryAttempt = await supabase
      .from(ROUTINE_TABLE)
      .insert({ id: Date.now(), ...payload })
      .select(selectCols)
      .single();

    if (!retryAttempt.error && retryAttempt.data) {
      return { record: normalizeRoutineRow(retryAttempt.data as Record<string, unknown>) };
    }
    return { record: null, error: retryAttempt.error?.message };
  }

  return { record: null, error: firstAttempt.error?.message };
}

export async function updateRoutineRecord(
  id: number,
  updates: NewRoutineRecordInput
): Promise<{ record: RoutineRecord | null; error?: string }> {
  const payload: Record<string, unknown> = {};
  if ('date' in updates) payload.date = toNullableText(updates.date);
  if ('time' in updates) payload.time = toNullableText(updates.time);
  if ('EBM (mL)' in updates) payload['EBM (mL)'] = toNullableInt(updates['EBM (mL)']);
  if ('Formula (mL)' in updates) payload['Formula (mL)'] = toNullableInt(updates['Formula (mL)']);
  if ('Diaper' in updates) payload.Diaper = toNullableText(updates.Diaper);
  if ('name' in updates) payload.name = toNullableText(updates.name);
  if ('remark' in updates) payload.remark = toNullableText(updates.remark);
  if ('feed duration (min)' in updates) {
    payload['feed duration (min)'] = toNullableInt(updates['feed duration (min)']);
  }

  if (!supabase) {
    return {
      record: null,
      error: 'Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.',
    };
  }

  const { data, error } = await supabase
    .from(ROUTINE_TABLE)
    .update(payload)
    .eq('id', id)
    .select(
      'id, created_at, date, time, "EBM (mL)", "Formula (mL)", "Diaper", name, remark, "feed duration (min)"'
    )
    .single();

  if (error) {
    console.error(`Failed to update "routine" record ${id}:`, error.message);
    return { record: null, error: error.message };
  }

  return { record: data ? normalizeRoutineRow(data as Record<string, unknown>) : null };
}

export async function deleteRoutineRecord(id: number): Promise<{ error?: string }> {
  if (!supabase) {
    return { error: 'Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.' };
  }

  const { error } = await supabase.from(ROUTINE_TABLE).delete().eq('id', id);
  if (error) {
    console.error(`Failed to delete "routine" record ${id}:`, error.message);
    return { error: error.message };
  }
  return {};
}

export function subscribeToRoutine(handlers: {
  onUpsert: (record: RoutineRecord) => void;
  onDelete: (id: number) => void;
}): () => void {
  if (!supabase) return () => {};

  const client = supabase;
  const channel = client
    .channel('routine-realtime')
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: ROUTINE_TABLE,
      },
      (payload: RealtimePostgresChangesPayload<Record<string, unknown>>) => {
        if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
          if (payload.new && 'id' in payload.new) {
            handlers.onUpsert(normalizeRoutineRow(payload.new));
          }
        } else if (payload.eventType === 'DELETE') {
          if (payload.old && 'id' in payload.old) {
            handlers.onDelete(Number(payload.old.id));
          }
        }
      }
    )
    .subscribe();

  return () => {
    void client.removeChannel(channel);
  };
}
