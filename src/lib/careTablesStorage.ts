import type { RealtimePostgresChangesPayload } from '@supabase/supabase-js';
import { supabase, GROWTH_TABLE, ROUTINE_TABLE, NOTES_TABLE } from './supabase';
import type {
  GrowthRecord,
  NewGrowthRecordInput,
  RoutineRecord,
  NewRoutineRecordInput,
  NoteRecord,
  NewNoteRecordInput,
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

function toNullableDate(value: string | null | undefined): string | null {
  const cleaned = toNullableText(value);
  if (!cleaned) return null;
  const match = cleaned.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (
    dt.getUTCFullYear() !== y ||
    dt.getUTCMonth() !== m - 1 ||
    dt.getUTCDate() !== d
  ) {
    return null;
  }
  return `${match[1]}-${match[2]}-${match[3]}`;
}

function toNullableTime(value: string | null | undefined): string | null {
  const cleaned = toNullableText(value);
  if (!cleaned) return null;
  const match = cleaned.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (!match) return null;
  const hh = Number(match[1]);
  const mm = Number(match[2]);
  const ss = match[3] !== undefined ? Number(match[3]) : 0;
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59 || ss < 0 || ss > 59) return null;
  const hhStr = String(hh).padStart(2, '0');
  const mmStr = String(mm).padStart(2, '0');
  return match[3] !== undefined ? `${hhStr}:${mmStr}:${String(ss).padStart(2, '0')}` : `${hhStr}:${mmStr}`;
}

let lastFallbackId = 0;
function nextFallbackId(): number {
  const now = Date.now();
  lastFallbackId = now > lastFallbackId ? now : lastFallbackId + 1;
  return lastFallbackId;
}

function isNotNullColumnError(
  error: { message?: string; details?: string | null; code?: string | null } | null | undefined,
  columnName: string
): boolean {
  if (!error || error.code !== '23502') return false;
  const combined = `${error.message ?? ''} ${error.details ?? ''}`.toLowerCase();
  return combined.includes(`"${columnName.toLowerCase()}"`) || combined.includes(`column ${columnName.toLowerCase()}`);
}

function normalizeGrowthRow(raw: Record<string, unknown>): GrowthRecord {
  return {
    id: Number(raw.id),
    created_at: String(raw.created_at ?? new Date().toISOString()),
    profile_id: toNullableText(raw.profile_id !== null && raw.profile_id !== undefined ? String(raw.profile_id) : null),
    date: raw.date !== null && raw.date !== undefined ? String(raw.date) : null,
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
    profile_id: toNullableText(raw.profile_id !== null && raw.profile_id !== undefined ? String(raw.profile_id) : null),
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

function normalizeNoteRow(raw: Record<string, unknown>): NoteRecord {
  const rawProfileId = raw.profile_id;
  const parsedProfileId =
    rawProfileId !== null && rawProfileId !== undefined && String(rawProfileId).trim() !== ''
      ? Number(rawProfileId)
      : null;

  return {
    id: Number(raw.id),
    created_at: String(raw.created_at ?? new Date().toISOString()),
    name: raw.name !== null && raw.name !== undefined ? String(raw.name) : null,
    notes: raw.notes !== null && raw.notes !== undefined ? String(raw.notes) : null,
    profile_id:
      parsedProfileId !== null && !Number.isNaN(parsedProfileId) ? parsedProfileId : null,
  };
}

function formatSupabaseError(
  error: { message: string; details?: string | null; hint?: string | null; code?: string | null } | null | undefined,
  tableName: string
): string {
  if (!error) {
    return `Unable to save to "${tableName}".`;
  }
  if (error.code === '42501') {
    return `Row Level Security (RLS) blocked access to "${tableName}". Add read/insert/update/delete policies in Supabase SQL Editor (see supabase/schema.sql).`;
  }
  const parts = [error.message];
  if (error.details && !error.message.includes(error.details)) {
    parts.push(error.details);
  }
  if (error.hint) {
    parts.push(error.hint);
  }
  if (error.code) {
    parts.push(`(${error.code})`);
  }
  return parts.join(' — ');
}

const MISSING_SUPABASE_ERROR =
  'Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY (or VITE_SUPABASE_PUB_KEY).';

// ============================================================================
// GROWTH TABLE CRUD + REALTIME
// ============================================================================

export async function fetchGrowthRecords(): Promise<GrowthRecord[] | null> {
  if (!supabase) return null;

  const { data, error } = await supabase
    .from(GROWTH_TABLE)
    .select('*')
    .order('date', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Failed to fetch "growth" records from Supabase:', formatSupabaseError(error, GROWTH_TABLE));
    return null;
  }

  return ((data as Record<string, unknown>[]) ?? []).map(normalizeGrowthRow);
}

function buildGrowthPayload(input: NewGrowthRecordInput, nonNullProfileId = false) {
  const cleanedProfileId = toNullableText(input.profile_id);
  return {
    profile_id: nonNullProfileId ? (cleanedProfileId ?? '') : cleanedProfileId,
    date: toNullableDate(input.date),
    daily_weight: toNullableFloat(input.daily_weight),
    daily_length: toNullableFloat(input.daily_length),
    temperature: toNullableFloat(input.temperature),
    remark: toNullableText(input.remark),
    name: toNullableText(input.name),
  };
}

export async function insertGrowthRecord(
  input: NewGrowthRecordInput
): Promise<{ record: GrowthRecord | null; error?: string }> {
  const payload = buildGrowthPayload(input, false);

  if (!supabase) {
    return { record: null, error: MISSING_SUPABASE_ERROR };
  }

  const firstAttempt = await supabase
    .from(GROWTH_TABLE)
    .insert([payload])
    .select('*');

  const firstRow = Array.isArray(firstAttempt.data)
    ? (firstAttempt.data[0] as Record<string, unknown> | undefined)
    : undefined;

  if (!firstAttempt.error && firstRow) {
    return { record: normalizeGrowthRow(firstRow) };
  }

  // Fallback for NOT NULL constraints (e.g. int8 primary key without identity default, or non-null profile_id)
  if (firstAttempt.error?.code === '23502') {
    const needsNonNullProfile = isNotNullColumnError(firstAttempt.error, 'profile_id');
    const needsExplicitId =
      isNotNullColumnError(firstAttempt.error, 'id') || !needsNonNullProfile;
    const retryPayload = buildGrowthPayload(input, needsNonNullProfile || payload.profile_id === null);
    const retryRowInput = needsExplicitId
      ? { id: nextFallbackId(), ...retryPayload }
      : retryPayload;

    const retryAttempt = await supabase
      .from(GROWTH_TABLE)
      .insert([retryRowInput])
      .select('*');

    const retryRow = Array.isArray(retryAttempt.data)
      ? (retryAttempt.data[0] as Record<string, unknown> | undefined)
      : undefined;

    if (!retryAttempt.error && retryRow) {
      return { record: normalizeGrowthRow(retryRow) };
    }
    return {
      record: null,
      error: retryAttempt.error
        ? formatSupabaseError(retryAttempt.error, GROWTH_TABLE)
        : 'Saved to "growth", but no row was returned. Check SELECT RLS policy on "growth".',
    };
  }

  if (!firstAttempt.error && !firstRow) {
    return {
      record: null,
      error: 'Saved to "growth", but no row was returned. Check SELECT/INSERT RLS policies on "growth".',
    };
  }

  return { record: null, error: formatSupabaseError(firstAttempt.error, GROWTH_TABLE) };
}

export async function insertGrowthRecordsBulk(
  inputs: NewGrowthRecordInput[]
): Promise<{ records: GrowthRecord[]; error?: string }> {
  if (inputs.length === 0) return { records: [] };

  const payloads = inputs.map((input) => buildGrowthPayload(input, false));

  if (!supabase) {
    return { records: [], error: MISSING_SUPABASE_ERROR };
  }

  const firstAttempt = await supabase.from(GROWTH_TABLE).insert(payloads).select('*');
  if (!firstAttempt.error && Array.isArray(firstAttempt.data) && firstAttempt.data.length > 0) {
    return {
      records: (firstAttempt.data as Record<string, unknown>[]).map(normalizeGrowthRow),
    };
  }

  if (!firstAttempt.error && (!Array.isArray(firstAttempt.data) || firstAttempt.data.length === 0)) {
    return {
      records: [],
      error: 'Insert returned 0 rows from "growth". Check INSERT and SELECT RLS policies on "growth".',
    };
  }

  // Fallback if int8 primary key has no identity default or profile_id is NOT NULL
  if (firstAttempt.error?.code === '23502') {
    const needsNonNullProfile = isNotNullColumnError(firstAttempt.error, 'profile_id');
    const needsExplicitId =
      isNotNullColumnError(firstAttempt.error, 'id') || !needsNonNullProfile;
    const retryPayloads = inputs.map((input) => {
      const base = buildGrowthPayload(input, needsNonNullProfile || !toNullableText(input.profile_id));
      return needsExplicitId ? { id: nextFallbackId(), ...base } : base;
    });
    const retryAttempt = await supabase.from(GROWTH_TABLE).insert(retryPayloads).select('*');
    if (!retryAttempt.error && Array.isArray(retryAttempt.data) && retryAttempt.data.length > 0) {
      return {
        records: (retryAttempt.data as Record<string, unknown>[]).map(normalizeGrowthRow),
      };
    }
    if (retryAttempt.error?.code === '42501') {
      return { records: [], error: formatSupabaseError(retryAttempt.error, GROWTH_TABLE) };
    }
  }

  // If RLS explicitly blocked the table, fail fast with a clear message
  if (firstAttempt.error?.code === '42501') {
    return { records: [], error: formatSupabaseError(firstAttempt.error, GROWTH_TABLE) };
  }

  // Fallback for multi-row batches: save row-by-row via the proven single-row path so valid rows persist
  if (inputs.length > 1) {
    const saved: GrowthRecord[] = [];
    const rowErrors: string[] = [];
    for (let i = 0; i < inputs.length; i += 1) {
      const res = await insertGrowthRecord(inputs[i]);
      if (res.record) {
        saved.push(res.record);
      } else if (res.error) {
        rowErrors.push(`Row ${i + 1}: ${res.error}`);
      }
    }
    if (saved.length > 0 && rowErrors.length === 0) {
      return { records: saved };
    }
    return {
      records: saved,
      error:
        rowErrors.length > 0
          ? rowErrors.slice(0, 3).join(' | ')
          : formatSupabaseError(firstAttempt.error, GROWTH_TABLE),
    };
  }

  return {
    records: [],
    error: formatSupabaseError(firstAttempt.error, GROWTH_TABLE),
  };
}

export async function updateGrowthRecord(
  id: number,
  updates: NewGrowthRecordInput
): Promise<{ record: GrowthRecord | null; error?: string }> {
  const payload: Record<string, unknown> = {};
  if ('profile_id' in updates) payload.profile_id = toNullableText(updates.profile_id);
  if ('date' in updates) payload.date = toNullableText(updates.date);
  if ('daily_weight' in updates) payload.daily_weight = toNullableFloat(updates.daily_weight);
  if ('daily_length' in updates) payload.daily_length = toNullableFloat(updates.daily_length);
  if ('temperature' in updates) payload.temperature = toNullableFloat(updates.temperature);
  if ('remark' in updates) payload.remark = toNullableText(updates.remark);
  if ('name' in updates) payload.name = toNullableText(updates.name);

  if (!supabase) {
    return { record: null, error: MISSING_SUPABASE_ERROR };
  }

  const { data, error } = await supabase
    .from(GROWTH_TABLE)
    .update(payload)
    .eq('id', id)
    .select('*');

  if (error) {
    const msg = formatSupabaseError(error, GROWTH_TABLE);
    console.error(`Failed to update "growth" record ${id}:`, msg);
    return { record: null, error: msg };
  }

  const savedRow = Array.isArray(data) ? (data[0] as Record<string, unknown> | undefined) : undefined;
  return { record: savedRow ? normalizeGrowthRow(savedRow) : null };
}

export async function deleteGrowthRecord(id: number): Promise<{ error?: string }> {
  if (!supabase) {
    return { error: MISSING_SUPABASE_ERROR };
  }

  const { error } = await supabase.from(GROWTH_TABLE).delete().eq('id', id);
  if (error) {
    const msg = formatSupabaseError(error, GROWTH_TABLE);
    console.error(`Failed to delete "growth" record ${id}:`, msg);
    return { error: msg };
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
    .select('*')
    .order('date', { ascending: false, nullsFirst: false })
    .order('time', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Failed to fetch "routine" records from Supabase:', formatSupabaseError(error, ROUTINE_TABLE));
    return null;
  }

  return ((data as Record<string, unknown>[]) ?? []).map(normalizeRoutineRow);
}

function buildRoutinePayload(input: NewRoutineRecordInput, nonNullProfileId = false) {
  const cleanedProfileId = toNullableText(input.profile_id);
  return {
    profile_id: nonNullProfileId ? (cleanedProfileId ?? '') : cleanedProfileId,
    date: toNullableDate(input.date),
    time: toNullableTime(input.time),
    'EBM (mL)': toNullableInt(input['EBM (mL)']),
    'Formula (mL)': toNullableInt(input['Formula (mL)']),
    Diaper: toNullableText(input.Diaper),
    name: toNullableText(input.name),
    remark: toNullableText(input.remark),
    'feed duration (min)': toNullableInt(input['feed duration (min)']),
  };
}

export async function insertRoutineRecord(
  input: NewRoutineRecordInput
): Promise<{ record: RoutineRecord | null; error?: string }> {
  const payload = buildRoutinePayload(input, false);

  if (!supabase) {
    return { record: null, error: MISSING_SUPABASE_ERROR };
  }

  const firstAttempt = await supabase
    .from(ROUTINE_TABLE)
    .insert([payload])
    .select('*');

  const firstRow = Array.isArray(firstAttempt.data)
    ? (firstAttempt.data[0] as Record<string, unknown> | undefined)
    : undefined;

  if (!firstAttempt.error && firstRow) {
    return { record: normalizeRoutineRow(firstRow) };
  }

  // Fallback for NOT NULL constraints (e.g. int8 primary key without identity default, or non-null profile_id)
  if (firstAttempt.error?.code === '23502') {
    const needsNonNullProfile = isNotNullColumnError(firstAttempt.error, 'profile_id');
    const needsExplicitId =
      isNotNullColumnError(firstAttempt.error, 'id') || !needsNonNullProfile;
    const retryPayload = buildRoutinePayload(input, needsNonNullProfile || payload.profile_id === null);
    const retryRowInput = needsExplicitId
      ? { id: nextFallbackId(), ...retryPayload }
      : retryPayload;

    const retryAttempt = await supabase
      .from(ROUTINE_TABLE)
      .insert([retryRowInput])
      .select('*');

    const retryRow = Array.isArray(retryAttempt.data)
      ? (retryAttempt.data[0] as Record<string, unknown> | undefined)
      : undefined;

    if (!retryAttempt.error && retryRow) {
      return { record: normalizeRoutineRow(retryRow) };
    }
    return {
      record: null,
      error: retryAttempt.error
        ? formatSupabaseError(retryAttempt.error, ROUTINE_TABLE)
        : 'Saved to "routine", but no row was returned. Check SELECT RLS policy on "routine".',
    };
  }

  if (!firstAttempt.error && !firstRow) {
    return {
      record: null,
      error: 'Saved to "routine", but no row was returned. Check SELECT/INSERT RLS policies on "routine".',
    };
  }

  return { record: null, error: formatSupabaseError(firstAttempt.error, ROUTINE_TABLE) };
}

export async function insertRoutineRecordsBulk(
  inputs: NewRoutineRecordInput[]
): Promise<{ records: RoutineRecord[]; error?: string }> {
  if (inputs.length === 0) return { records: [] };

  const payloads = inputs.map((input) => buildRoutinePayload(input, false));

  if (!supabase) {
    return { records: [], error: MISSING_SUPABASE_ERROR };
  }

  const firstAttempt = await supabase.from(ROUTINE_TABLE).insert(payloads).select('*');
  if (!firstAttempt.error && Array.isArray(firstAttempt.data) && firstAttempt.data.length > 0) {
    return {
      records: (firstAttempt.data as Record<string, unknown>[]).map(normalizeRoutineRow),
    };
  }

  if (!firstAttempt.error && (!Array.isArray(firstAttempt.data) || firstAttempt.data.length === 0)) {
    return {
      records: [],
      error: 'Insert returned 0 rows from "routine". Check INSERT and SELECT RLS policies on "routine".',
    };
  }

  // Fallback if int8 primary key has no identity default or profile_id is NOT NULL
  if (firstAttempt.error?.code === '23502') {
    const needsNonNullProfile = isNotNullColumnError(firstAttempt.error, 'profile_id');
    const needsExplicitId =
      isNotNullColumnError(firstAttempt.error, 'id') || !needsNonNullProfile;
    const retryPayloads = inputs.map((input) => {
      const base = buildRoutinePayload(input, needsNonNullProfile || !toNullableText(input.profile_id));
      return needsExplicitId ? { id: nextFallbackId(), ...base } : base;
    });
    const retryAttempt = await supabase.from(ROUTINE_TABLE).insert(retryPayloads).select('*');
    if (!retryAttempt.error && Array.isArray(retryAttempt.data) && retryAttempt.data.length > 0) {
      return {
        records: (retryAttempt.data as Record<string, unknown>[]).map(normalizeRoutineRow),
      };
    }
    if (retryAttempt.error?.code === '42501') {
      return { records: [], error: formatSupabaseError(retryAttempt.error, ROUTINE_TABLE) };
    }
  }

  if (firstAttempt.error?.code === '42501') {
    return { records: [], error: formatSupabaseError(firstAttempt.error, ROUTINE_TABLE) };
  }

  // Fallback for multi-row batches: save row-by-row via the proven single-row path so valid rows persist
  if (inputs.length > 1) {
    const saved: RoutineRecord[] = [];
    const rowErrors: string[] = [];
    for (let i = 0; i < inputs.length; i += 1) {
      const res = await insertRoutineRecord(inputs[i]);
      if (res.record) {
        saved.push(res.record);
      } else if (res.error) {
        rowErrors.push(`Row ${i + 1}: ${res.error}`);
      }
    }
    if (saved.length > 0 && rowErrors.length === 0) {
      return { records: saved };
    }
    return {
      records: saved,
      error:
        rowErrors.length > 0
          ? rowErrors.slice(0, 3).join(' | ')
          : formatSupabaseError(firstAttempt.error, ROUTINE_TABLE),
    };
  }

  return {
    records: [],
    error: formatSupabaseError(firstAttempt.error, ROUTINE_TABLE),
  };
}

export async function updateRoutineRecord(
  id: number,
  updates: NewRoutineRecordInput
): Promise<{ record: RoutineRecord | null; error?: string }> {
  const payload: Record<string, unknown> = {};
  if ('profile_id' in updates) payload.profile_id = toNullableText(updates.profile_id);
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
    return { record: null, error: MISSING_SUPABASE_ERROR };
  }

  const { data, error } = await supabase
    .from(ROUTINE_TABLE)
    .update(payload)
    .eq('id', id)
    .select('*');

  if (error) {
    const msg = formatSupabaseError(error, ROUTINE_TABLE);
    console.error(`Failed to update "routine" record ${id}:`, msg);
    return { record: null, error: msg };
  }

  const savedRow = Array.isArray(data) ? (data[0] as Record<string, unknown> | undefined) : undefined;
  return { record: savedRow ? normalizeRoutineRow(savedRow) : null };
}

export async function deleteRoutineRecord(id: number): Promise<{ error?: string }> {
  if (!supabase) {
    return { error: MISSING_SUPABASE_ERROR };
  }

  const { error } = await supabase.from(ROUTINE_TABLE).delete().eq('id', id);
  if (error) {
    const msg = formatSupabaseError(error, ROUTINE_TABLE);
    console.error(`Failed to delete "routine" record ${id}:`, msg);
    return { error: msg };
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

// ============================================================================
// NOTES TABLE CRUD + REALTIME
// ============================================================================

export async function fetchNoteRecords(): Promise<NoteRecord[] | null> {
  if (!supabase) return null;

  const { data, error } = await supabase
    .from(NOTES_TABLE)
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Failed to fetch "notes" records from Supabase:', formatSupabaseError(error, NOTES_TABLE));
    return null;
  }

  return ((data as Record<string, unknown>[]) ?? []).map(normalizeNoteRow);
}

export async function insertNoteRecord(
  input: NewNoteRecordInput
): Promise<{ record: NoteRecord | null; error?: string }> {
  const payload = {
    name: toNullableText(input.name),
    notes: toNullableText(input.notes),
    profile_id: toNullableInt(input.profile_id),
  };

  if (!supabase) {
    return { record: null, error: MISSING_SUPABASE_ERROR };
  }

  const firstAttempt = await supabase
    .from(NOTES_TABLE)
    .insert([payload])
    .select('*');

  const firstRow = Array.isArray(firstAttempt.data)
    ? (firstAttempt.data[0] as Record<string, unknown> | undefined)
    : undefined;

  if (!firstAttempt.error && firstRow) {
    return { record: normalizeNoteRow(firstRow) };
  }

  // Fallback if the user's int8 primary key does not have an identity/sequence default
  if (firstAttempt.error?.code === '23502') {
    const retryAttempt = await supabase
      .from(NOTES_TABLE)
      .insert([{ id: Date.now(), ...payload }])
      .select('*');

    const retryRow = Array.isArray(retryAttempt.data)
      ? (retryAttempt.data[0] as Record<string, unknown> | undefined)
      : undefined;

    if (!retryAttempt.error && retryRow) {
      return { record: normalizeNoteRow(retryRow) };
    }
    return {
      record: null,
      error: retryAttempt.error
        ? formatSupabaseError(retryAttempt.error, NOTES_TABLE)
        : 'Saved to "notes", but no row was returned. Check SELECT RLS policy on "notes".',
    };
  }

  if (!firstAttempt.error && !firstRow) {
    return {
      record: null,
      error: 'Saved to "notes", but no row was returned. Check SELECT/INSERT RLS policies on "notes".',
    };
  }

  return { record: null, error: formatSupabaseError(firstAttempt.error, NOTES_TABLE) };
}

export async function updateNoteRecord(
  id: number,
  updates: NewNoteRecordInput
): Promise<{ record: NoteRecord | null; error?: string }> {
  const payload: Record<string, unknown> = {};
  if ('name' in updates) payload.name = toNullableText(updates.name);
  if ('notes' in updates) payload.notes = toNullableText(updates.notes);
  if ('profile_id' in updates) payload.profile_id = toNullableInt(updates.profile_id);

  if (!supabase) {
    return { record: null, error: MISSING_SUPABASE_ERROR };
  }

  const { data, error } = await supabase
    .from(NOTES_TABLE)
    .update(payload)
    .eq('id', id)
    .select('*');

  if (error) {
    const msg = formatSupabaseError(error, NOTES_TABLE);
    console.error(`Failed to update "notes" record ${id}:`, msg);
    return { record: null, error: msg };
  }

  const savedRow = Array.isArray(data) ? (data[0] as Record<string, unknown> | undefined) : undefined;
  return { record: savedRow ? normalizeNoteRow(savedRow) : null };
}

export async function deleteNoteRecord(id: number): Promise<{ error?: string }> {
  if (!supabase) {
    return { error: MISSING_SUPABASE_ERROR };
  }

  const { error } = await supabase.from(NOTES_TABLE).delete().eq('id', id);
  if (error) {
    const msg = formatSupabaseError(error, NOTES_TABLE);
    console.error(`Failed to delete "notes" record ${id}:`, msg);
    return { error: msg };
  }
  return {};
}

export function subscribeToNotes(handlers: {
  onUpsert: (record: NoteRecord) => void;
  onDelete: (id: number) => void;
}): () => void {
  if (!supabase) return () => {};

  const client = supabase;
  const channel = client
    .channel('notes-realtime')
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: NOTES_TABLE,
      },
      (payload: RealtimePostgresChangesPayload<Record<string, unknown>>) => {
        if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
          if (payload.new && 'id' in payload.new) {
            handlers.onUpsert(normalizeNoteRow(payload.new));
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
