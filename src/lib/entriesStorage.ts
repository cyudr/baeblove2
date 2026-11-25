import type { RealtimePostgresChangesPayload } from '@supabase/supabase-js';
import { supabase, ENTRIES_TABLE } from './supabase';
import type {
  ChildProfile,
  BabyMeasurement,
  FetalMeasurement,
  CompletedMilestone,
  KickSession,
  LoveNote,
  FormulaSettings,
  ThemeMode,
  UnitSystem,
} from '../types';

export type EntryType =
  | 'profile'
  | 'baby_measurement'
  | 'fetal_measurement'
  | 'completed_milestone'
  | 'kick_session'
  | 'love_note'
  | 'setting';

export type SettingKey = 'theme' | 'units' | 'formula_settings' | 'active_profile';

export interface EntryRow {
  id: string;
  entry_type: EntryType;
  profile_id: string | null;
  payload: unknown;
  created_at?: string;
  updated_at?: string;
}

export interface SettingPayload {
  key: SettingKey;
  value: ThemeMode | UnitSystem | FormulaSettings | string;
}

/**
 * Raw row stored in the user's Supabase "entries" table:
 *   id          int8 (primary key)
 *   created_at  timestamptz default now()
 *   profile_id  text default ''::text
 *   payload     json
 *   updated_at  timestamptz default now()
 */
interface RawDbEntryRow {
  id: number | string;
  created_at?: string;
  profile_id?: string | null;
  payload: unknown;
  updated_at?: string;
}

interface PayloadEnvelope {
  __entry_key: string;
  __entry_type: EntryType;
  data: unknown;
}

// Track numeric DB id <-> logical entry key so updates and realtime DELETE events resolve accurately
const numericIdToLogicalKey = new Map<number, string>();
const logicalKeyToNumericId = new Map<string, number>();

function registerIdMapping(numericId: number, logicalKey: string) {
  if (!Number.isNaN(numericId)) {
    numericIdToLogicalKey.set(numericId, logicalKey);
    logicalKeyToNumericId.set(logicalKey, numericId);
  }
}

function formatEntriesSupabaseError(
  error: { message: string; details?: string | null; hint?: string | null; code?: string | null } | null | undefined
): string {
  if (!error) {
    return 'Unable to save to the "entries" table.';
  }
  if (error.code === '42501') {
    return 'Row Level Security (RLS) blocked writes to the "entries" table. Add read/insert/update/delete policies in Supabase SQL Editor (see supabase/schema.sql).';
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

/**
 * Deterministic positive 52-bit safe integer hash for mapping logical string keys
 * (e.g. "profile:profile-123") onto Postgres `int8` primary keys without precision loss in JS.
 */
export function logicalKeyToInt8(logicalKey: string): number {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < logicalKey.length; i++) {
    const ch = logicalKey.charCodeAt(i);
    h1 ^= ch;
    h1 = Math.imul(h1, 0x01000193);
    h2 ^= ch + i;
    h2 = Math.imul(h2, 0x85ebca6b);
  }
  const high = (h1 >>> 0) & 0x000fffff; // 20 bits
  const low = h2 >>> 0; // 32 bits
  const combined = high * 4294967296 + low; // 52 bits (< Number.MAX_SAFE_INTEGER)
  return combined === 0 ? 1 : combined;
}

function isPayloadEnvelope(value: unknown): value is PayloadEnvelope {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.__entry_key === 'string' &&
    typeof candidate.__entry_type === 'string' &&
    'data' in candidate
  );
}

function buildEnvelope(row: EntryRow): PayloadEnvelope {
  return {
    __entry_key: row.id,
    __entry_type: row.entry_type,
    data: row.payload,
  };
}

function toDbEntryRow(row: EntryRow, updatedAt: string): RawDbEntryRow {
  const numericId = logicalKeyToNumericId.get(row.id) ?? logicalKeyToInt8(row.id);
  registerIdMapping(numericId, row.id);

  return {
    id: numericId,
    profile_id: row.profile_id ?? '',
    payload: buildEnvelope(row),
    updated_at: updatedAt,
  };
}

function fromDbEntryRow(raw: RawDbEntryRow): EntryRow | null {
  const numericId = Number(raw.id);
  let parsedPayload = raw.payload;

  if (typeof parsedPayload === 'string') {
    try {
      parsedPayload = JSON.parse(parsedPayload);
    } catch {
      return null;
    }
  }

  if (isPayloadEnvelope(parsedPayload)) {
    registerIdMapping(numericId, parsedPayload.__entry_key);
    return {
      id: parsedPayload.__entry_key,
      entry_type: parsedPayload.__entry_type,
      profile_id: raw.profile_id || null,
      payload: parsedPayload.data,
      created_at: raw.created_at,
      updated_at: raw.updated_at,
    };
  }

  // Fallback support for manually inserted raw ChildProfile JSON rows in entries.payload
  if (parsedPayload && typeof parsedPayload === 'object') {
    const obj = parsedPayload as Record<string, unknown>;
    if (
      typeof obj.name === 'string' &&
      (obj.type === 'baby' || obj.type === 'fetal') &&
      typeof obj.dateOfEvent === 'string'
    ) {
      const profileId =
        (typeof obj.id === 'string' && obj.id) ||
        (raw.profile_id && raw.profile_id.trim()) ||
        `profile-${raw.id}`;
      const logicalKey = makeProfileEntryId(profileId);
      registerIdMapping(numericId, logicalKey);
      const gender =
        obj.gender === 'boy' || obj.gender === 'girl' || obj.gender === 'undisclosed'
          ? obj.gender
          : 'undisclosed';
      const avatarColor =
        typeof obj.avatarColor === 'string' && obj.avatarColor
          ? obj.avatarColor
          : 'bg-emerald-600';
      const avatarIcon =
        typeof obj.avatarIcon === 'string' && obj.avatarIcon
          ? obj.avatarIcon
          : obj.type === 'fetal'
            ? 'HeartPulse'
            : 'Baby';
      return {
        id: logicalKey,
        entry_type: 'profile',
        profile_id: profileId,
        payload: {
          ...obj,
          id: profileId,
          gender,
          avatarColor,
          avatarIcon,
        } satisfies Partial<ChildProfile>,
        created_at: raw.created_at,
        updated_at: raw.updated_at,
      };
    }
  }

  return null;
}

export function makeProfileEntryId(profileId: string): string {
  return `profile:${profileId}`;
}

export function makeBabyMeasurementEntryId(id: string): string {
  return `baby_measurement:${id}`;
}

export function makeFetalMeasurementEntryId(id: string): string {
  return `fetal_measurement:${id}`;
}

export function makeMilestoneEntryId(profileId: string, milestoneId: string): string {
  return `completed_milestone:${profileId}:${milestoneId}`;
}

export function makeKickSessionEntryId(id: string): string {
  return `kick_session:${id}`;
}

export function makeLoveNoteEntryId(id: string): string {
  return `love_note:${id}`;
}

export function makeSettingEntryId(key: SettingKey): string {
  return `setting:${key}`;
}

export function toProfileRow(profile: ChildProfile): EntryRow {
  return {
    id: makeProfileEntryId(profile.id),
    entry_type: 'profile',
    profile_id: profile.id,
    payload: profile,
  };
}

export function toBabyMeasurementRow(measurement: BabyMeasurement): EntryRow {
  return {
    id: makeBabyMeasurementEntryId(measurement.id),
    entry_type: 'baby_measurement',
    profile_id: measurement.profileId,
    payload: measurement,
  };
}

export function toFetalMeasurementRow(measurement: FetalMeasurement): EntryRow {
  return {
    id: makeFetalMeasurementEntryId(measurement.id),
    entry_type: 'fetal_measurement',
    profile_id: measurement.profileId,
    payload: measurement,
  };
}

export function toMilestoneRow(milestone: CompletedMilestone): EntryRow {
  return {
    id: makeMilestoneEntryId(milestone.profileId, milestone.milestoneId),
    entry_type: 'completed_milestone',
    profile_id: milestone.profileId,
    payload: milestone,
  };
}

export function toKickSessionRow(session: KickSession): EntryRow {
  return {
    id: makeKickSessionEntryId(session.id),
    entry_type: 'kick_session',
    profile_id: session.profileId,
    payload: session,
  };
}

export function toLoveNoteRow(note: LoveNote): EntryRow {
  return {
    id: makeLoveNoteEntryId(note.id),
    entry_type: 'love_note',
    profile_id: note.profileId,
    payload: note,
  };
}

export function toSettingRow(
  key: SettingKey,
  value: ThemeMode | UnitSystem | FormulaSettings | string
): EntryRow {
  return {
    id: makeSettingEntryId(key),
    entry_type: 'setting',
    profile_id: null,
    payload: { key, value } satisfies SettingPayload,
  };
}

export interface ParsedEntryId {
  entryType: EntryType;
  itemId: string;
  secondaryId?: string;
}

export function parseEntryId(rowId: string): ParsedEntryId | null {
  const firstColon = rowId.indexOf(':');
  if (firstColon === -1) return null;

  const prefix = rowId.slice(0, firstColon) as EntryType;
  const rest = rowId.slice(firstColon + 1);

  if (prefix === 'completed_milestone') {
    const secondColon = rest.indexOf(':');
    if (secondColon === -1) return null;
    return {
      entryType: 'completed_milestone',
      itemId: rest.slice(0, secondColon), // profileId
      secondaryId: rest.slice(secondColon + 1), // milestoneId
    };
  }

  if (
    prefix === 'profile' ||
    prefix === 'baby_measurement' ||
    prefix === 'fetal_measurement' ||
    prefix === 'kick_session' ||
    prefix === 'love_note' ||
    prefix === 'setting'
  ) {
    return {
      entryType: prefix,
      itemId: rest,
    };
  }

  return null;
}

export async function fetchAllEntries(): Promise<EntryRow[] | null> {
  if (!supabase) return null;

  const { data, error } = await supabase
    .from(ENTRIES_TABLE)
    .select('*')
    .order('created_at', { ascending: true });

  if (error) {
    console.error('Failed to fetch entries from Supabase:', error.message);
    return null;
  }

  const parsed: EntryRow[] = [];
  for (const raw of (data as RawDbEntryRow[]) ?? []) {
    const normalized = fromDbEntryRow(raw);
    if (normalized) parsed.push(normalized);
  }
  return parsed;
}

export async function upsertEntry(row: EntryRow): Promise<{ error?: string }> {
  return upsertEntries([row]);
}

async function upsertEntriesWithGeneratedIdentity(
  rows: EntryRow[],
  updatedAt: string
): Promise<{ error?: string }> {
  if (!supabase) return { error: MISSING_SUPABASE_ERROR };

  const { data: existingRows, error: fetchError } = await supabase
    .from(ENTRIES_TABLE)
    .select('*');

  if (fetchError) {
    return { error: formatEntriesSupabaseError(fetchError) };
  }

  const existingByLogicalKey = new Map<string, number>();
  for (const raw of (existingRows as RawDbEntryRow[]) ?? []) {
    const normalized = fromDbEntryRow(raw);
    const numId = Number(raw.id);
    if (normalized && !Number.isNaN(numId)) {
      existingByLogicalKey.set(normalized.id, numId);
    }
  }

  const toInsert: Array<{ profile_id: string; payload: PayloadEnvelope; updated_at: string }> = [];

  for (const row of rows) {
    const existingId = existingByLogicalKey.get(row.id) ?? logicalKeyToNumericId.get(row.id);
    const body = {
      profile_id: row.profile_id ?? '',
      payload: buildEnvelope(row),
      updated_at: updatedAt,
    };

    if (existingId !== undefined && existingByLogicalKey.has(row.id)) {
      const { error: updateError } = await supabase
        .from(ENTRIES_TABLE)
        .update(body)
        .eq('id', existingId)
        .select('*');
      if (updateError) {
        return { error: formatEntriesSupabaseError(updateError) };
      }
    } else {
      toInsert.push(body);
    }
  }

  if (toInsert.length > 0) {
    const { data: inserted, error: insertError } = await supabase
      .from(ENTRIES_TABLE)
      .insert(toInsert)
      .select('*');

    if (insertError) {
      return { error: formatEntriesSupabaseError(insertError) };
    }

    for (const raw of (inserted as RawDbEntryRow[]) ?? []) {
      fromDbEntryRow(raw);
    }
  }

  return {};
}

export async function upsertEntries(rows: EntryRow[]): Promise<{ error?: string }> {
  if (rows.length === 0) return {};
  if (!supabase) {
    return { error: MISSING_SUPABASE_ERROR };
  }

  const now = new Date().toISOString();
  const dbRows = rows.map((row) => toDbEntryRow(row, now));

  const { data, error } = await supabase
    .from(ENTRIES_TABLE)
    .upsert(dbRows, { onConflict: 'id' })
    .select('*');

  if (!error) {
    if (Array.isArray(data) && data.length > 0) {
      for (const raw of data as RawDbEntryRow[]) {
        fromDbEntryRow(raw);
      }
      return {};
    }
    const msg =
      'Write to "entries" returned no rows. Check INSERT/UPDATE/SELECT Row Level Security (RLS) policies on the "entries" table.';
    console.error(msg);
    return { error: msg };
  }

  // Automatic fallback if entries.id is GENERATED ALWAYS AS IDENTITY (Postgres 428C9)
  if (
    error.code === '428C9' ||
    /non-DEFAULT value|identity/i.test(error.message)
  ) {
    return upsertEntriesWithGeneratedIdentity(rows, now);
  }

  const msg = formatEntriesSupabaseError(error);
  console.error('Failed to upsert entries in Supabase:', msg);
  return { error: msg };
}

export async function deleteEntryById(logicalId: string): Promise<{ error?: string }> {
  if (!supabase) return { error: MISSING_SUPABASE_ERROR };

  const numericId = logicalKeyToNumericId.get(logicalId) ?? logicalKeyToInt8(logicalId);
  numericIdToLogicalKey.delete(numericId);
  logicalKeyToNumericId.delete(logicalId);

  const { error } = await supabase.from(ENTRIES_TABLE).delete().eq('id', numericId);

  if (error) {
    const msg = formatEntriesSupabaseError(error);
    console.error(`Failed to delete entry "${logicalId}" from Supabase:`, msg);
    return { error: msg };
  }
  return {};
}

export async function deleteEntriesByProfileId(profileId: string): Promise<{ error?: string }> {
  if (!supabase) return { error: MISSING_SUPABASE_ERROR };

  const { error } = await supabase
    .from(ENTRIES_TABLE)
    .delete()
    .eq('profile_id', profileId);

  if (error) {
    const msg = formatEntriesSupabaseError(error);
    console.error(`Failed to delete entries for profile "${profileId}" from Supabase:`, msg);
    return { error: msg };
  }
  return {};
}

export async function replaceAllEntries(rows: EntryRow[]): Promise<{ error?: string }> {
  if (!supabase) return { error: MISSING_SUPABASE_ERROR };

  const { data: existing, error: fetchError } = await supabase
    .from(ENTRIES_TABLE)
    .select('id');

  if (fetchError) {
    const msg = formatEntriesSupabaseError(fetchError);
    console.error('Failed to list existing entries before replace:', msg);
    return { error: msg };
  }

  const nextIds = new Set(rows.map((r) => logicalKeyToNumericId.get(r.id) ?? logicalKeyToInt8(r.id)));
  const idsToDelete = ((existing as Array<{ id: number | string }>) ?? [])
    .map((r) => Number(r.id))
    .filter((id) => !Number.isNaN(id) && !nextIds.has(id));

  if (idsToDelete.length > 0) {
    const { error: deleteError } = await supabase
      .from(ENTRIES_TABLE)
      .delete()
      .in('id', idsToDelete);

    if (deleteError) {
      const msg = formatEntriesSupabaseError(deleteError);
      console.error('Failed to remove stale entries in Supabase:', msg);
      return { error: msg };
    }
  }

  return upsertEntries(rows);
}

export interface EntriesRealtimeHandlers {
  onUpsert: (row: EntryRow) => void;
  onDelete: (oldRow: Partial<EntryRow> & { id?: string }) => void;
}

export function subscribeToEntries(handlers: EntriesRealtimeHandlers): () => void {
  if (!supabase) {
    return () => {};
  }

  const client = supabase;
  const channel = client
    .channel('entries-realtime')
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: ENTRIES_TABLE,
      },
      (payload: RealtimePostgresChangesPayload<RawDbEntryRow>) => {
        if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
          const nextRow = payload.new as RawDbEntryRow;
          if (nextRow && 'id' in nextRow) {
            const normalized = fromDbEntryRow(nextRow);
            if (normalized) {
              handlers.onUpsert(normalized);
            }
          }
        } else if (payload.eventType === 'DELETE') {
          const oldRaw = payload.old as Partial<RawDbEntryRow>;
          let logicalKey: string | undefined;

          if (oldRaw?.payload && isPayloadEnvelope(oldRaw.payload)) {
            logicalKey = oldRaw.payload.__entry_key;
          } else if (oldRaw?.id !== undefined) {
            logicalKey = numericIdToLogicalKey.get(Number(oldRaw.id));
          }

          if (logicalKey) {
            if (oldRaw?.id !== undefined) {
              numericIdToLogicalKey.delete(Number(oldRaw.id));
            }
            handlers.onDelete({ id: logicalKey });
          }
        }
      }
    )
    .subscribe();

  return () => {
    void client.removeChannel(channel);
  };
}
