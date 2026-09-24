// Fitness markers Garmin computes across activities: personal records and VO2max.

import { array, assertRange, child, epochToIso, isRecord, type Json, num, str } from '../parse.js';
import type { Get } from './get.js';

// Garmin's `typeId`, mapped by other clients; unknown ids are kept with `kind: null`.
const RECORD_KINDS: Readonly<Record<number, RecordKind>> = {
  1: 'fastest_1k',
  2: 'fastest_mile',
  3: 'fastest_5k',
  4: 'fastest_10k',
  5: 'fastest_half_marathon',
  6: 'fastest_marathon',
  7: 'longest_run',
  8: 'longest_ride',
  9: 'biggest_climb',
  12: 'most_steps_day',
  13: 'most_steps_week',
  14: 'most_steps_month',
  15: 'longest_step_goal_streak',
};

export type RecordKind =
  | 'fastest_1k'
  | 'fastest_mile'
  | 'fastest_5k'
  | 'fastest_10k'
  | 'fastest_half_marathon'
  | 'fastest_marathon'
  | 'longest_run'
  | 'longest_ride'
  | 'biggest_climb'
  | 'most_steps_day'
  | 'most_steps_week'
  | 'most_steps_month'
  | 'longest_step_goal_streak';

export interface PersonalRecord {
  typeId: number;
  kind: RecordKind | null;
  /**
   * Seconds for `fastest_*`, metres for `longest_run`, `longest_ride` and `biggest_climb`, a count
   * for `most_steps_*`, days for streaks. Unknown kinds: Garmin's raw value.
   */
  value: number;
  /** The activity that set it; `null` for records spanning days (steps, streaks). */
  activityId: number | null;
  activityType: string | null;
  /** ISO 8601, UTC. */
  achievedAt: string | null;
}

export interface Vo2Max {
  date: string;
  /** Garmin's "generic" estimate, from runs (and outdoor walks) with heart rate. */
  running: number | null;
  cycling: number | null;
}

export async function fetchPersonalRecords(
  get: Get,
  displayName: string,
): Promise<PersonalRecord[]> {
  const body = await get(
    'personal records',
    `/personalrecord-service/personalrecord/prs/${encodeURIComponent(displayName)}`,
  );
  if (body === null) return [];
  const records: PersonalRecord[] = [];
  for (const raw of array(body, 'personal records')) {
    if (!isRecord(raw)) continue;
    const typeId = num(raw['typeId']);
    const value = num(raw['value']);
    if (typeId === null || value === null) continue;
    records.push({
      typeId,
      kind: RECORD_KINDS[typeId] ?? null,
      value,
      // Records spanning days carry no activity, sometimes as 0.
      activityId: num(raw['activityId']) || null,
      activityType: str(raw['activityType']),
      achievedAt: epochToIso(raw['prStartTimeGmt']),
    });
  }
  return records.sort((a, b) => a.typeId - b.typeId);
}

/** VO2max on the days Garmin updated it, oldest first. */
export async function fetchVo2Max(get: Get, from: string, to: string): Promise<Vo2Max[]> {
  assertRange(from, to);
  const body = await get('vo2max', `/metrics-service/metrics/maxmet/daily/${from}/${to}`);
  if (body === null) return [];
  const days: Vo2Max[] = [];
  for (const raw of array(body, 'vo2max')) {
    if (!isRecord(raw)) continue;
    const generic = child(raw, 'generic');
    const cycling = child(raw, 'cycling');
    const date = str(generic['calendarDate']) ?? str(cycling['calendarDate']);
    const running = precise(generic);
    const bike = precise(cycling);
    if (date === null || (running === null && bike === null)) continue;
    days.push({ date, running, cycling: bike });
  }
  return days.sort((a, b) => a.date.localeCompare(b.date));
}

function precise(metric: Json): number | null {
  return num(metric['vo2MaxPreciseValue']) ?? num(metric['vo2MaxValue']);
}
