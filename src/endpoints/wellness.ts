// Daily wellness data. Most URLs here embed the account's display name, passed in by the client.

import {
  addDays,
  array,
  assertDate,
  assertRange,
  child,
  epochToIso,
  gmtToIso,
  isRecord,
  num,
  record,
  requiredStr,
  str,
  type WithRaw,
} from '../parse.js';
import type { Get } from './get.js';

export interface DailySummary {
  date: string;
  steps: number | null;
  distanceMeters: number | null;
  floorsAscended: number | null;
  totalCalories: number | null;
  activeCalories: number | null;
  bmrCalories: number | null;
  activeSeconds: number | null;
  highlyActiveSeconds: number | null;
  sedentarySeconds: number | null;
  sleepingSeconds: number | null;
  moderateIntensityMinutes: number | null;
  vigorousIntensityMinutes: number | null;
  minHeartRate: number | null;
  maxHeartRate: number | null;
  restingHeartRate: number | null;
  restingHeartRate7DayAverage: number | null;
  averageStress: number | null;
  bodyBatteryHigh: number | null;
  bodyBatteryLow: number | null;
  averageSpo2: number | null;
  averageWakingRespiration: number | null;
}

export interface HeartRateDay {
  date: string;
  restingHeartRate: number | null;
  minHeartRate: number | null;
  maxHeartRate: number | null;
  /** Intraday samples, oldest first; gaps (watch off) are left out. */
  samples: { time: string; bpm: number }[];
}

export interface RestingHeartRate {
  date: string;
  bpm: number;
}

export interface DailySteps {
  date: string;
  steps: number | null;
  distanceMeters: number | null;
  goal: number | null;
}

export interface SleepNight {
  /** The calendar date Garmin files the night under: the day of waking up. */
  date: string;
  /** ISO 8601, UTC. */
  start: string | null;
  end: string | null;
  sleepSeconds: number | null;
  deepSeconds: number | null;
  lightSeconds: number | null;
  remSeconds: number | null;
  awakeSeconds: number | null;
  napSeconds: number | null;
  score: number | null;
  restingHeartRate: number | null;
  averageRespiration: number | null;
}

export interface HrvSummary {
  /** The date Garmin files the night under: the day of waking up. */
  date: string;
  /** Average HRV (RMSSD, ms) over the night; `null` when the watch was not worn. */
  lastNightAverage: number | null;
  /** Highest 5-minute average of the night, ms. */
  lastNight5MinHigh: number | null;
  weeklyAverage: number | null;
  /** Personal "balanced" range, ms, once Garmin has a few weeks of data. */
  baselineLow: number | null;
  baselineHigh: number | null;
  /** Garmin's reading of the trend: `BALANCED`, `UNBALANCED`, `LOW`, `POOR`… */
  status: string | null;
}

export interface HrvNight extends HrvSummary {
  /** 5-minute readings through the night, oldest first. */
  readings: { time: string; ms: number }[];
}

// Garmin's step statistics endpoint refuses ranges longer than 28 days.
const STEPS_CHUNK_DAYS = 28;
// The HRV range endpoint refuses more than 366 days between both dates.
const HRV_CHUNK_DAYS = 366;

export async function fetchDailySummary(
  get: Get,
  displayName: string,
  date: string,
): Promise<WithRaw<DailySummary>> {
  assertDate(date, 'date');
  const s = record(
    await get('daily summary', `/usersummary-service/usersummary/daily/${enc(displayName)}`, {
      calendarDate: date,
    }),
    'daily summary',
  );
  return {
    date: str(s['calendarDate']) ?? date,
    steps: num(s['totalSteps']),
    distanceMeters: num(s['totalDistanceMeters']),
    floorsAscended: num(s['floorsAscended']),
    totalCalories: num(s['totalKilocalories']),
    activeCalories: num(s['activeKilocalories']),
    bmrCalories: num(s['bmrKilocalories']),
    activeSeconds: num(s['activeSeconds']),
    highlyActiveSeconds: num(s['highlyActiveSeconds']),
    sedentarySeconds: num(s['sedentarySeconds']),
    sleepingSeconds: num(s['sleepingSeconds']),
    moderateIntensityMinutes: num(s['moderateIntensityMinutes']),
    vigorousIntensityMinutes: num(s['vigorousIntensityMinutes']),
    minHeartRate: num(s['minHeartRate']),
    maxHeartRate: num(s['maxHeartRate']),
    restingHeartRate: num(s['restingHeartRate']),
    restingHeartRate7DayAverage: num(s['lastSevenDaysAvgRestingHeartRate']),
    // Negative stress values are Garmin's "not enough data" markers.
    averageStress: nonNegative(s['averageStressLevel']),
    bodyBatteryHigh: num(s['bodyBatteryHighestValue']),
    bodyBatteryLow: num(s['bodyBatteryLowestValue']),
    averageSpo2: num(s['averageSpo2']),
    averageWakingRespiration: num(s['avgWakingRespirationValue']),
    raw: s,
  };
}

export async function fetchHeartRateDay(
  get: Get,
  displayName: string,
  date: string,
): Promise<WithRaw<HeartRateDay>> {
  assertDate(date, 'date');
  const body = record(
    await get('heart rate', `/wellness-service/wellness/dailyHeartRate/${enc(displayName)}`, {
      date,
    }),
    'heart rate',
  );
  const samples: HeartRateDay['samples'] = [];
  for (const point of Array.isArray(body['heartRateValues']) ? body['heartRateValues'] : []) {
    if (!Array.isArray(point)) continue;
    const time = epochToIso(point[0]);
    const bpm = num(point[1]);
    if (time !== null && bpm !== null) samples.push({ time, bpm });
  }
  return {
    date: str(body['calendarDate']) ?? date,
    restingHeartRate: num(body['restingHeartRate']),
    minHeartRate: num(body['minHeartRate']),
    maxHeartRate: num(body['maxHeartRate']),
    samples,
    raw: body,
  };
}

/** Resting heart rate per day, for days that have one. A single request covers up to a year. */
export async function fetchRestingHeartRate(
  get: Get,
  displayName: string,
  from: string,
  to: string,
): Promise<WithRaw<RestingHeartRate>[]> {
  assertRange(from, to);
  const body = record(
    await get('resting heart rate', `/userstats-service/wellness/daily/${enc(displayName)}`, {
      fromDate: from,
      untilDate: to,
      metricId: 60,
    }),
    'resting heart rate',
  );
  const values = child(child(body, 'allMetrics'), 'metricsMap')['WELLNESS_RESTING_HEART_RATE'];
  const days: WithRaw<RestingHeartRate>[] = [];
  for (const entry of Array.isArray(values) ? values : []) {
    if (!isRecord(entry)) continue;
    const date = str(entry['calendarDate']);
    const bpm = num(entry['value']);
    if (date !== null && bpm !== null) days.push({ date, bpm, raw: entry });
  }
  return days.sort((a, b) => a.date.localeCompare(b.date));
}

export async function fetchDailySteps(
  get: Get,
  from: string,
  to: string,
): Promise<WithRaw<DailySteps>[]> {
  assertRange(from, to);
  const days: WithRaw<DailySteps>[] = [];
  for (let start = from; start <= to; start = addDays(start, STEPS_CHUNK_DAYS)) {
    const chunkEnd = addDays(start, STEPS_CHUNK_DAYS - 1);
    const end = chunkEnd < to ? chunkEnd : to;
    const body = await get('steps', `/usersummary-service/stats/steps/daily/${start}/${end}`);
    if (body === null) continue;
    for (const raw of array(body, 'steps')) {
      const day = record(raw, 'steps day');
      days.push({
        date: requiredStr(day['calendarDate'], 'steps.calendarDate'),
        steps: num(day['totalSteps']),
        distanceMeters: num(day['totalDistance']),
        goal: num(day['stepGoal']),
        raw,
      });
    }
  }
  return days;
}

/** The night filed under `date`, or `null` when the watch recorded no sleep. */
export async function fetchSleep(
  get: Get,
  displayName: string,
  date: string,
): Promise<WithRaw<SleepNight> | null> {
  assertDate(date, 'date');
  const body = await get('sleep', `/wellness-service/wellness/dailySleepData/${enc(displayName)}`, {
    date,
    nonSleepBufferMinutes: 60,
  });
  if (body === null) return null;
  const data = record(body, 'sleep');
  const dto = child(data, 'dailySleepDTO');
  const sleepSeconds = num(dto['sleepTimeSeconds']);
  // Garmin returns a DTO full of nulls for a night without data.
  if (sleepSeconds === null && num(dto['sleepStartTimestampGMT']) === null) return null;
  return {
    date: str(dto['calendarDate']) ?? date,
    start: epochToIso(dto['sleepStartTimestampGMT']),
    end: epochToIso(dto['sleepEndTimestampGMT']),
    sleepSeconds,
    deepSeconds: num(dto['deepSleepSeconds']),
    lightSeconds: num(dto['lightSleepSeconds']),
    remSeconds: num(dto['remSleepSeconds']),
    awakeSeconds: num(dto['awakeSleepSeconds']),
    napSeconds: num(dto['napTimeSeconds']),
    score: num(child(child(dto, 'sleepScores'), 'overall')['value']),
    restingHeartRate: num(data['restingHeartRate']),
    averageRespiration: num(dto['averageRespirationValue']),
    raw: data,
  };
}

/** The night filed under `date` with its readings, or `null` when Garmin has no HRV for it. */
export async function fetchHrvNight(get: Get, date: string): Promise<WithRaw<HrvNight> | null> {
  assertDate(date, 'date');
  const body = await get('hrv', `/hrv-service/hrv/${date}`);
  if (body === null) return null;
  const data = record(body, 'hrv');
  if (!isRecord(data['hrvSummary'])) return null;
  const readings: HrvNight['readings'] = [];
  for (const raw of Array.isArray(data['hrvReadings']) ? data['hrvReadings'] : []) {
    if (!isRecord(raw)) continue;
    const time = gmtToIso(raw['readingTimeGMT']);
    const ms = num(raw['hrvValue']);
    if (time !== null && ms !== null) readings.push({ time, ms });
  }
  readings.sort((a, b) => a.time.localeCompare(b.time));
  return { ...parseHrvSummary(data['hrvSummary'], date), readings, raw: data };
}

/** Nightly HRV summaries between `from` and `to`, oldest first, without the readings. */
export async function fetchHrvRange(
  get: Get,
  from: string,
  to: string,
): Promise<WithRaw<HrvSummary>[]> {
  assertRange(from, to);
  const nights: WithRaw<HrvSummary>[] = [];
  for (let start = from; start <= to; start = addDays(start, HRV_CHUNK_DAYS)) {
    const chunkEnd = addDays(start, HRV_CHUNK_DAYS - 1);
    const end = chunkEnd < to ? chunkEnd : to;
    const body = await get('hrv', `/hrv-service/hrv/daily/${start}/${end}`);
    if (body === null) continue;
    const list = record(body, 'hrv')['hrvSummaries'];
    for (const raw of list == null ? [] : array(list, 'hrvSummaries')) {
      const date = isRecord(raw) ? str(raw['calendarDate']) : null;
      if (date !== null) nights.push({ ...parseHrvSummary(raw, date), raw });
    }
  }
  return nights.sort((a, b) => a.date.localeCompare(b.date));
}

function parseHrvSummary(value: unknown, date: string): HrvSummary {
  const s = record(value, 'hrv summary');
  const baseline = child(s, 'baseline');
  return {
    date: str(s['calendarDate']) ?? date,
    lastNightAverage: num(s['lastNightAvg']),
    lastNight5MinHigh: num(s['lastNight5MinHigh']),
    weeklyAverage: num(s['weeklyAvg']),
    baselineLow: num(baseline['balancedLow']),
    baselineHigh: num(baseline['balancedUpper']),
    status: str(s['status']),
  };
}

function enc(displayName: string): string {
  return encodeURIComponent(displayName);
}

function nonNegative(value: unknown): number | null {
  const n = num(value);
  return n !== null && n >= 0 ? n : null;
}
