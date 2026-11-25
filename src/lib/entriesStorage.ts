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
    .select('id, entry_type, profile_id, payload, created_at, updated_at')
    .order('created_at', { ascending: true });

  if (error) {
    console.error('Failed to fetch entries from Supabase:', error.message);
    return null;
  }

  return (data as EntryRow[]) ?? [];
}

export async function upsertEntry(row: EntryRow): Promise<void> {
  if (!supabase) return;

  const { error } = await supabase.from(ENTRIES_TABLE).upsert(
    {
      ...row,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'id' }
  );

  if (error) {
    console.error(`Failed to upsert entry "${row.id}" in Supabase:`, error.message);
  }
}

export async function upsertEntries(rows: EntryRow[]): Promise<void> {
  if (!supabase || rows.length === 0) return;

  const now = new Date().toISOString();
  const stampedRows = rows.map((row) => ({
    ...row,
    updated_at: now,
  }));

  const { error } = await supabase
    .from(ENTRIES_TABLE)
    .upsert(stampedRows, { onConflict: 'id' });

  if (error) {
    console.error('Failed to batch upsert entries in Supabase:', error.message);
  }
}

export async function deleteEntryById(id: string): Promise<void> {
  if (!supabase) return;

  const { error } = await supabase.from(ENTRIES_TABLE).delete().eq('id', id);

  if (error) {
    console.error(`Failed to delete entry "${id}" from Supabase:`, error.message);
  }
}

export async function deleteEntriesByProfileId(profileId: string): Promise<void> {
  if (!supabase) return;

  const { error } = await supabase
    .from(ENTRIES_TABLE)
    .delete()
    .eq('profile_id', profileId);

  if (error) {
    console.error(
      `Failed to delete entries for profile "${profileId}" from Supabase:`,
      error.message
    );
  }
}

export async function replaceAllEntries(rows: EntryRow[]): Promise<void> {
  if (!supabase) return;

  const { data: existing, error: fetchError } = await supabase
    .from(ENTRIES_TABLE)
    .select('id');

  if (fetchError) {
    console.error('Failed to list existing entries before replace:', fetchError.message);
    return;
  }

  const nextIds = new Set(rows.map((r) => r.id));
  const idsToDelete = ((existing as Array<{ id: string }>) ?? [])
    .map((r) => r.id)
    .filter((id) => !nextIds.has(id));

  if (idsToDelete.length > 0) {
    const { error: deleteError } = await supabase
      .from(ENTRIES_TABLE)
      .delete()
      .in('id', idsToDelete);

    if (deleteError) {
      console.error('Failed to remove stale entries in Supabase:', deleteError.message);
    }
  }

  await upsertEntries(rows);
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
      (payload: RealtimePostgresChangesPayload<EntryRow>) => {
        if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
          const nextRow = payload.new as EntryRow;
          if (nextRow && nextRow.id && nextRow.entry_type) {
            handlers.onUpsert(nextRow);
          }
        } else if (payload.eventType === 'DELETE') {
          const oldRow = payload.old as Partial<EntryRow> & { id?: string };
          if (oldRow && oldRow.id) {
            handlers.onDelete(oldRow);
          }
        }
      }
    )
    .subscribe();

  return () => {
    void client.removeChannel(channel);
  };
}
