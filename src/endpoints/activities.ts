import { UnexpectedResponse } from '../errors.js';
import {
  array,
  assertRange,
  child,
  gmtToIso,
  isRecord,
  type Json,
  localDateTime,
  num,
  record,
  requiredNum,
  str,
  type WithRaw,
} from '../parse.js';
import type { Get } from './get.js';

/**
 * One activity, whatever the sport: the same flat shape for a run, a hike or a strength session.
 * A field the sport or the device does not measure is `null`. Units are in the field names.
 */
export interface Activity {
  id: number;
  name: string | null;
  /** Garmin's `typeKey`: `running`, `hiking`, `strength_training`, `cycling`… */
  type: string | null;
  /** Place name Garmin derives from the start point, e.g. a town. */
  location: string | null;
  /** Wall-clock time where the activity took place, `YYYY-MM-DDTHH:mm:ss`, no offset. */
  startLocal: string | null;
  /** ISO 8601, UTC. */
  start: string | null;
  /** Timer time, pauses excluded. */
  durationSeconds: number | null;
  movingDurationSeconds: number | null;
  /** Start to end, pauses included. */
  elapsedDurationSeconds: number | null;
  distanceMeters: number | null;
  averageSpeedMetersPerSecond: number | null;
  maxSpeedMetersPerSecond: number | null;
  elevationGainMeters: number | null;
  elevationLossMeters: number | null;
  minElevationMeters: number | null;
  maxElevationMeters: number | null;
  calories: number | null;
  averageHeartRate: number | null;
  maxHeartRate: number | null;
  moderateIntensityMinutes: number | null;
  vigorousIntensityMinutes: number | null;
  steps: number | null;
  /** Steps per minute, on foot. */
  averageCadence: number | null;
  averagePowerWatts: number | null;
  maxPowerWatts: number | null;
  normalizedPowerWatts: number | null;
  /**
   * Running dynamics, from the watch or a chest strap. Walks and hikes get a stride length in
   * `list()` and `between()` only: the detail of `get()` leaves it out.
   */
  strideLengthCm: number | null;
  groundContactTimeMs: number | null;
  verticalOscillationCm: number | null;
  verticalRatioPercent: number | null;
  /** Strength training. Per-set detail: `exerciseSets()`. */
  activeSets: number | null;
  totalReps: number | null;
}

export interface ExerciseSet {
  rest: boolean;
  /** Distinct exercises of the set: one entry, or several for a superset. */
  exercises: { category: string; name: string | null }[];
  reps: number | null;
  durationSeconds: number | null;
  weightKg: number | null;
  /** ISO 8601, UTC. */
  start: string | null;
}

export interface ExerciseSets {
  activityId: number;
  sets: ExerciseSet[];
}

const LIST_PATH = '/activitylist-service/activities/search/activities';
const PAGE_SIZE = 20;
// A server that never returns an empty page must not loop forever (upstream does the same).
const MAX_PAGES = 500;
export const MAX_LIST_LIMIT = 1000;

export async function listActivities(
  get: Get,
  start = 0,
  limit = 20,
): Promise<WithRaw<Activity>[]> {
  if (!Number.isInteger(start) || start < 0) throw new RangeError('start must be an integer >= 0');
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIST_LIMIT) {
    throw new RangeError(`limit must be an integer between 1 and ${MAX_LIST_LIMIT}`);
  }
  const body = await get('activities', LIST_PATH, { start, limit });
  return parseList(body);
}

/** Every activity started between `from` and `to` (inclusive, local dates), newest first. */
export async function activitiesBetween(
  get: Get,
  from: string,
  to: string,
): Promise<WithRaw<Activity>[]> {
  assertRange(from, to);
  const all: WithRaw<Activity>[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const body = await get('activities', LIST_PATH, {
      startDate: from,
      endDate: to,
      start: page * PAGE_SIZE,
      limit: PAGE_SIZE,
    });
    const activities = parseList(body);
    all.push(...activities);
    if (activities.length < PAGE_SIZE) return all;
  }
  throw new UnexpectedResponse(`activities: more than ${MAX_PAGES} pages, aborting`);
}

export async function fetchActivity(get: Get, id: number): Promise<WithRaw<Activity>> {
  assertId(id);
  const body = record(await get('activity', `/activity-service/activity/${id}`), 'activity');
  return {
    ...parseActivity(body, child(body, 'activityTypeDTO'), child(body, 'summaryDTO')),
    raw: body,
  };
}

export async function fetchExerciseSets(get: Get, id: number): Promise<WithRaw<ExerciseSets>> {
  assertId(id);
  const body = await get('exercise sets', `/activity-service/activity/${id}/exerciseSets`);
  // Activities without sets (a run) answer 204 or an object with `exerciseSets: null`.
  if (body === null) return { activityId: id, sets: [], raw: null };
  const data = record(body, 'exercise sets');
  const sets = data['exerciseSets'] == null ? [] : array(data['exerciseSets'], 'exerciseSets');
  return {
    activityId: num(data['activityId']) ?? id,
    sets: sets.map((raw) => parseSet(record(raw, 'exercise set'))),
    raw: body,
  };
}

function parseList(body: unknown): WithRaw<Activity>[] {
  if (body === null) return [];
  return array(body, 'activities').map((raw) => {
    const a = record(raw, 'activity');
    return { ...parseActivity(a, child(a, 'activityType'), a), raw };
  });
}

/**
 * The list carries the figures on the activity itself, the detail in `summaryDTO`, sometimes
 * under another name: each field reads the list name first, then the detail one.
 */
function parseActivity(top: Json, type: Json, s: Json): Activity {
  const pick = (...keys: string[]) => {
    for (const key of keys) {
      const value = num(s[key]);
      if (value !== null) return value;
    }
    return null;
  };
  return {
    id: requiredNum(top['activityId'], 'activity.activityId'),
    name: str(top['activityName']),
    type: str(type['typeKey']),
    location: str(top['locationName']),
    startLocal: localDateTime(s['startTimeLocal']),
    start: gmtToIso(s['startTimeGMT']),
    durationSeconds: pick('duration'),
    movingDurationSeconds: pick('movingDuration'),
    elapsedDurationSeconds: pick('elapsedDuration'),
    distanceMeters: pick('distance'),
    averageSpeedMetersPerSecond: pick('averageSpeed'),
    maxSpeedMetersPerSecond: pick('maxSpeed'),
    elevationGainMeters: pick('elevationGain'),
    elevationLossMeters: pick('elevationLoss'),
    minElevationMeters: pick('minElevation'),
    maxElevationMeters: pick('maxElevation'),
    calories: pick('calories'),
    averageHeartRate: pick('averageHR'),
    maxHeartRate: pick('maxHR'),
    moderateIntensityMinutes: pick('moderateIntensityMinutes'),
    vigorousIntensityMinutes: pick('vigorousIntensityMinutes'),
    steps: pick('steps'),
    averageCadence: pick('averageRunningCadenceInStepsPerMinute', 'averageRunCadence'),
    averagePowerWatts: pick('avgPower', 'averagePower'),
    maxPowerWatts: pick('maxPower'),
    normalizedPowerWatts: pick('normPower', 'normalizedPower'),
    strideLengthCm: pick('avgStrideLength', 'strideLength'),
    groundContactTimeMs: pick('avgGroundContactTime', 'groundContactTime'),
    verticalOscillationCm: pick('avgVerticalOscillation', 'verticalOscillation'),
    verticalRatioPercent: pick('avgVerticalRatio', 'verticalRatio'),
    activeSets: pick('activeSets'),
    totalReps: pick('totalReps', 'totalExerciseReps'),
  };
}

function parseSet(set: Json): ExerciseSet {
  // Garmin repeats the same exercise several times inside one set (one entry per candidate of
  // its movement classifier); a superset is the only legitimate case of distinct entries.
  const seen = new Set<string>();
  const exercises: ExerciseSet['exercises'] = [];
  for (const raw of Array.isArray(set['exercises']) ? set['exercises'] : []) {
    if (!isRecord(raw)) continue;
    const category = str(raw['category']);
    if (category === null) continue;
    const name = str(raw['name']);
    const key = `${category}/${name ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    exercises.push({ category, name });
  }
  const grams = num(set['weight']);
  return {
    rest: set['setType'] === 'REST',
    exercises,
    reps: num(set['repetitionCount']),
    durationSeconds: num(set['duration']),
    // Garmin sends grams; 0 means "no load" (bodyweight), not a real weight.
    weightKg: grams !== null && grams > 0 ? grams / 1000 : null,
    start: gmtToIso(set['startTime']),
  };
}

export interface Lap {
  /** 1-based. Usually one lap per kilometre (auto lap) or per button press. */
  index: number;
  /** ISO 8601, UTC. */
  start: string | null;
  distanceMeters: number | null;
  durationSeconds: number | null;
  movingDurationSeconds: number | null;
  averageSpeedMetersPerSecond: number | null;
  maxSpeedMetersPerSecond: number | null;
  averageHeartRate: number | null;
  maxHeartRate: number | null;
  /** Steps per minute, runs only. */
  averageCadence: number | null;
  elevationGainMeters: number | null;
  elevationLossMeters: number | null;
  calories: number | null;
  /** Garmin's `intensityType`: `ACTIVE`, `REST`, `WARMUP`, `COOLDOWN`… */
  intensity: string | null;
}

export interface HeartRateZone {
  zone: number;
  seconds: number;
  /** Lower bound of the zone, from the heart rate zones set on the account. */
  lowBpm: number | null;
}

export async function fetchLaps(get: Get, id: number): Promise<WithRaw<Lap>[]> {
  assertId(id);
  const body = await get('laps', `/activity-service/activity/${id}/splits`);
  if (body === null) return [];
  const laps = record(body, 'laps')['lapDTOs'];
  return (laps == null ? [] : array(laps, 'lapDTOs')).map((raw, i) => {
    const lap = record(raw, 'lap');
    return {
      index: num(lap['lapIndex']) ?? i + 1,
      start: gmtToIso(lap['startTimeGMT']),
      distanceMeters: num(lap['distance']),
      durationSeconds: num(lap['duration']),
      movingDurationSeconds: num(lap['movingDuration']),
      averageSpeedMetersPerSecond: num(lap['averageSpeed']),
      maxSpeedMetersPerSecond: num(lap['maxSpeed']),
      averageHeartRate: num(lap['averageHR']),
      maxHeartRate: num(lap['maxHR']),
      averageCadence: num(lap['averageRunCadence']),
      elevationGainMeters: num(lap['elevationGain']),
      elevationLossMeters: num(lap['elevationLoss']),
      calories: num(lap['calories']),
      intensity: str(lap['intensityType']),
      raw,
    };
  });
}

export async function fetchHeartRateZones(get: Get, id: number): Promise<WithRaw<HeartRateZone>[]> {
  assertId(id);
  const body = await get('heart rate zones', `/activity-service/activity/${id}/hrTimeInZones`);
  if (body === null) return [];
  const zones: WithRaw<HeartRateZone>[] = [];
  for (const raw of array(body, 'heart rate zones')) {
    if (!isRecord(raw)) continue;
    const zone = num(raw['zoneNumber']);
    if (zone === null) continue;
    zones.push({
      zone,
      seconds: num(raw['secsInZone']) ?? 0,
      lowBpm: num(raw['zoneLowBoundary']),
      raw,
    });
  }
  return zones.sort((a, b) => a.zone - b.zone);
}

function assertId(id: number): void {
  if (!Number.isSafeInteger(id) || id <= 0) throw new RangeError('id must be a positive integer');
}
