import {
  array,
  assertRange,
  epochToIso,
  isRecord,
  num,
  record,
  str,
  type WithRaw,
} from '../parse.js';
import type { Get } from './get.js';

export interface BodyComposition {
  /** Local date of the weigh-in. */
  date: string;
  /** ISO 8601, UTC. */
  time: string | null;
  weightKg: number | null;
  bmi: number | null;
  bodyFatPercent: number | null;
  bodyWaterPercent: number | null;
  boneMassKg: number | null;
  muscleMassKg: number | null;
  /** Visceral fat rating, as the scale reports it (unitless). */
  visceralFat: number | null;
  metabolicAge: number | null;
  /** Garmin's `sourceType`: `MANUAL`, `INDEX_SCALE`, or a partner scale. */
  source: string | null;
}

/** Every weigh-in between `from` and `to` (inclusive, local dates), oldest first. */
export async function fetchBodyComposition(
  get: Get,
  from: string,
  to: string,
): Promise<WithRaw<BodyComposition>[]> {
  assertRange(from, to);
  const body = await get('body composition', '/weight-service/weight/dateRange', {
    startDate: from,
    endDate: to,
  });
  if (body === null) return [];
  const list = record(body, 'body composition')['dateWeightList'];
  const entries: WithRaw<BodyComposition>[] = [];
  for (const raw of list == null ? [] : array(list, 'dateWeightList')) {
    if (!isRecord(raw)) continue;
    const date = str(raw['calendarDate']);
    if (date === null) continue;
    entries.push({
      date,
      time: epochToIso(raw['timestampGMT']),
      weightKg: grams(raw['weight']),
      bmi: num(raw['bmi']),
      bodyFatPercent: num(raw['bodyFat']),
      bodyWaterPercent: num(raw['bodyWater']),
      boneMassKg: grams(raw['boneMass']),
      muscleMassKg: grams(raw['muscleMass']),
      visceralFat: num(raw['visceralFat']),
      metabolicAge: num(raw['metabolicAge']),
      source: str(raw['sourceType']),
      raw,
    });
  }
  return entries.sort((a, b) => (a.time ?? a.date).localeCompare(b.time ?? b.date));
}

// Garmin sends every mass in grams.
function grams(value: unknown): number | null {
  const g = num(value);
  return g === null ? null : g / 1000;
}
