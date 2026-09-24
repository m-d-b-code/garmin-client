import { describe, expect, it } from 'vitest';

import { ApiError, memoryTokenStore, NotFound } from '../src/index.js';
import { client, FakeGarmin, fixture, json, PROFILE, status, tokens } from './helpers.js';

const DISPLAY_NAME = 'a1b2c3d4-e5f6-7890-abcd-ef0123456789';

function signedIn(garmin: FakeGarmin) {
  garmin.on('GET', PROFILE, json(fixture('social-profile')));
  return client(garmin, memoryTokenStore(tokens()));
}

describe('profile', () => {
  it('reads the display name', async () => {
    expect(await signedIn(new FakeGarmin()).profile.get()).toEqual({
      displayName: DISPLAY_NAME,
      fullName: 'Jane Doe',
      profileId: 22222222,
    });
  });

  it('is fetched once for every endpoint that needs it', async () => {
    const garmin = new FakeGarmin()
      .on('GET', /^\/wellness-service\/wellness\/dailySleepData\//, json(fixture('sleep')))
      .on('GET', /^\/wellness-service\/wellness\/dailyHeartRate\//, json(fixture('heart-rate')));
    const garminClient = signedIn(garmin);
    await garminClient.sleep.day('2026-09-22');
    await garminClient.heartRate.day('2026-09-22');
    expect(garmin.callsTo(PROFILE)).toHaveLength(1);
  });
});

const MORNING_RUN = {
  id: 30000000001,
  name: 'Morning Run',
  type: 'running',
  location: 'Springfield',
  startLocal: '2026-09-21T07:05:12',
  start: '2026-09-21T05:05:12.000Z',
  durationSeconds: 2701.2,
  movingDurationSeconds: 2650,
  elapsedDurationSeconds: 2760,
  distanceMeters: 8123.4,
  averageSpeedMetersPerSecond: 3.007,
  maxSpeedMetersPerSecond: 3.9,
  elevationGainMeters: 54,
  elevationLossMeters: 51,
  minElevationMeters: 402.4,
  maxElevationMeters: 431,
  calories: 598,
  averageHeartRate: 148,
  maxHeartRate: 171,
  moderateIntensityMinutes: 20,
  vigorousIntensityMinutes: 25,
  steps: 7890,
  averageCadence: 166.5,
  averagePowerWatts: 265,
  maxPowerWatts: 410,
  normalizedPowerWatts: 270,
  strideLengthCm: 108.4,
  groundContactTimeMs: 262.1,
  verticalOscillationCm: 8.6,
  verticalRatioPercent: 7.9,
  activeSets: null,
  totalReps: null,
};

describe('activities', () => {
  it('lists with offset and limit', async () => {
    const garmin = new FakeGarmin().on(
      'GET',
      '/activitylist-service/activities/search/activities',
      json(fixture('activities')),
    );
    const activities = await signedIn(garmin).activities.list({ start: 20, limit: 2 });

    expect(garmin.calls[0]?.url.search).toBe('?start=20&limit=2');
    expect(activities).toHaveLength(2);
    expect(activities[1]).toEqual(MORNING_RUN);
    expect(activities[0]).toMatchObject({
      type: 'strength_training',
      movingDurationSeconds: null,
      averageCadence: null,
      activeSets: 8,
      totalReps: 84,
    });
  });

  it('pages through a date range until a short page', async () => {
    const page = (n: number) =>
      Array.from({ length: n }, (_, i) => ({ activityId: 1000 + i, activityType: {} }));
    const garmin = new FakeGarmin().on(
      'GET',
      '/activitylist-service/activities/search/activities',
      json(page(20)),
      json(page(3)),
    );
    const activities = await signedIn(garmin).activities.between('2026-09-01', '2026-09-24');

    expect(activities).toHaveLength(23);
    const starts = garmin.calls.map((c) => c.url.searchParams.get('start'));
    expect(starts).toEqual(['0', '20']);
    expect(garmin.calls[0]?.url.searchParams.get('startDate')).toBe('2026-09-01');
    expect(garmin.calls[0]?.url.searchParams.get('endDate')).toBe('2026-09-24');
  });

  it('reads one activity', async () => {
    const garmin = new FakeGarmin().on(
      'GET',
      '/activity-service/activity/30000000001',
      json(fixture('activity')),
    );
    // Same run as in the list, read from `summaryDTO` and its other field names.
    expect(await signedIn(garmin).activities.get(30000000001)).toEqual(MORNING_RUN);
  });

  it('dedupes exercises within a set, keeps supersets and converts grams', async () => {
    const garmin = new FakeGarmin().on(
      'GET',
      '/activity-service/activity/30000000002/exerciseSets',
      json(fixture('exercise-sets')),
    );
    const { activityId, sets } = await signedIn(garmin).activities.exerciseSets(30000000002);

    expect(activityId).toBe(30000000002);
    expect(sets.map((s) => s.rest)).toEqual([false, true, false, false]);
    expect(sets[0]).toEqual({
      rest: false,
      exercises: [{ category: 'PULL_UP', name: 'PULL_UP' }],
      reps: 8,
      durationSeconds: 35,
      weightKg: null,
      start: '2026-09-22T16:32:00.000Z',
    });
    expect(sets[2]?.exercises).toEqual([
      { category: 'BENCH_PRESS', name: 'BARBELL_BENCH_PRESS' },
      { category: 'ROW', name: 'DUMBBELL_ROW' },
    ]);
    expect(sets[2]?.weightKg).toBe(60);
    expect(sets[3]?.exercises).toEqual([{ category: 'CARDIO', name: null }]);
  });

  it('returns no sets for an activity without any', async () => {
    const garmin = new FakeGarmin()
      .on('GET', '/activity-service/activity/1/exerciseSets', status(204))
      .on(
        'GET',
        '/activity-service/activity/2/exerciseSets',
        json({ activityId: 2, exerciseSets: null }),
      );
    const garminClient = signedIn(garmin);
    expect(await garminClient.activities.exerciseSets(1)).toEqual({ activityId: 1, sets: [] });
    expect(await garminClient.activities.exerciseSets(2)).toEqual({ activityId: 2, sets: [] });
  });

  it('reads laps', async () => {
    const garmin = new FakeGarmin().on(
      'GET',
      '/activity-service/activity/30000000001/splits',
      json(fixture('laps')),
    );
    const laps = await signedIn(garmin).activities.laps(30000000001);

    expect(laps).toHaveLength(2);
    expect(laps[0]).toEqual({
      index: 1,
      start: '2026-09-21T05:05:12.000Z',
      distanceMeters: 1000,
      durationSeconds: 330.5,
      movingDurationSeconds: 328,
      averageSpeedMetersPerSecond: 3.026,
      maxSpeedMetersPerSecond: 3.4,
      averageHeartRate: 142,
      maxHeartRate: 151,
      averageCadence: 164.5,
      elevationGainMeters: 6,
      elevationLossMeters: 2,
      calories: 72,
      intensity: 'ACTIVE',
    });
    expect(laps[1]).toMatchObject({ index: 2, averageCadence: null, intensity: 'COOLDOWN' });
  });

  it('reads time in heart rate zones, lowest zone first', async () => {
    const garmin = new FakeGarmin().on(
      'GET',
      '/activity-service/activity/30000000001/hrTimeInZones',
      json(fixture('hr-zones')),
    );
    const zones = await signedIn(garmin).activities.heartRateZones(30000000001);

    expect(zones.map((z) => z.zone)).toEqual([1, 2, 3, 4, 5]);
    expect(zones[1]).toEqual({ zone: 2, seconds: 820.4, lowBpm: 120 });
  });

  it('validates arguments before calling Garmin', async () => {
    const garmin = new FakeGarmin();
    const garminClient = signedIn(garmin);
    await expect(garminClient.activities.get(-1)).rejects.toBeInstanceOf(RangeError);
    await expect(garminClient.activities.list({ limit: 0 })).rejects.toBeInstanceOf(RangeError);
    await expect(
      garminClient.activities.between('2026-09-24', '2026-09-01'),
    ).rejects.toBeInstanceOf(RangeError);
    await expect(garminClient.sleep.day('24/09/2026')).rejects.toBeInstanceOf(RangeError);
    expect(garmin.calls.filter((c) => c.url.pathname !== PROFILE)).toHaveLength(0);
  });
});

describe('daily data', () => {
  it('reads the daily summary', async () => {
    const garmin = new FakeGarmin().on(
      'GET',
      `/usersummary-service/usersummary/daily/${DISPLAY_NAME}`,
      json(fixture('daily-summary')),
    );
    const summary = await signedIn(garmin).daily.summary('2026-09-22');

    expect(garmin.callsTo(/usersummary\/daily/)[0]?.url.searchParams.get('calendarDate')).toBe(
      '2026-09-22',
    );
    expect(summary).toMatchObject({
      date: '2026-09-22',
      steps: 11234,
      totalCalories: 2650,
      restingHeartRate: 52,
      restingHeartRate7DayAverage: 53,
      bodyBatteryHigh: 88,
    });
    // -1 is Garmin's "not enough data", not a stress level.
    expect(summary.averageStress).toBeNull();
  });

  it('reads the heart rate curve and skips gaps', async () => {
    const garmin = new FakeGarmin().on(
      'GET',
      `/wellness-service/wellness/dailyHeartRate/${DISPLAY_NAME}`,
      json(fixture('heart-rate')),
    );
    const day = await signedIn(garmin).heartRate.day('2026-09-22');
    expect(day.restingHeartRate).toBe(52);
    expect(day.samples).toEqual([
      { time: new Date(1790028000000).toISOString(), bpm: 55 },
      { time: new Date(1790028240000).toISOString(), bpm: 58 },
    ]);
  });

  it('reads resting heart rate over a range, oldest first', async () => {
    const garmin = new FakeGarmin().on(
      'GET',
      `/userstats-service/wellness/daily/${DISPLAY_NAME}`,
      json(fixture('resting-heart-rate')),
    );
    expect(await signedIn(garmin).heartRate.resting('2026-09-21', '2026-09-22')).toEqual([
      { date: '2026-09-21', bpm: 54 },
      { date: '2026-09-22', bpm: 52 },
    ]);
    const query = garmin.callsTo(/userstats-service/)[0]?.url.searchParams;
    expect(query?.get('fromDate')).toBe('2026-09-21');
    expect(query?.get('untilDate')).toBe('2026-09-22');
    expect(query?.get('metricId')).toBe('60');
  });

  it('reads steps and splits long ranges into 28-day chunks', async () => {
    const garmin = new FakeGarmin().on(
      'GET',
      /^\/usersummary-service\/stats\/steps\/daily\//,
      json(fixture('steps')),
    );
    const days = await signedIn(garmin).steps.daily('2026-01-01', '2026-03-01');

    expect(
      garmin.callsTo(/stats\/steps/).map((c) => c.url.pathname.split('/').slice(-2).join('..')),
    ).toEqual(['2026-01-01..2026-01-28', '2026-01-29..2026-02-25', '2026-02-26..2026-03-01']);
    expect(days[0]).toEqual({ date: '2026-09-21', steps: 9876, distanceMeters: 7400, goal: 10000 });
  });

  it('reads a night of sleep', async () => {
    const garmin = new FakeGarmin().on(
      'GET',
      `/wellness-service/wellness/dailySleepData/${DISPLAY_NAME}`,
      json(fixture('sleep')),
    );
    expect(await signedIn(garmin).sleep.day('2026-09-22')).toEqual({
      date: '2026-09-22',
      start: '2026-09-21T21:40:00.000Z',
      end: '2026-09-22T05:40:00.000Z',
      sleepSeconds: 27000,
      deepSeconds: 5400,
      lightSeconds: 14400,
      remSeconds: 7200,
      awakeSeconds: 900,
      napSeconds: 0,
      score: 82,
      restingHeartRate: 52,
      averageRespiration: 13.5,
    });
  });

  it('returns null for a night without sleep data', async () => {
    const garmin = new FakeGarmin().on('GET', /dailySleepData/, json(fixture('sleep-empty')));
    expect(await signedIn(garmin).sleep.day('2026-09-23')).toBeNull();
  });
});

describe('heart rate variability', () => {
  it('reads a night with its readings, oldest first', async () => {
    const garmin = new FakeGarmin().on('GET', '/hrv-service/hrv/2026-09-22', json(fixture('hrv')));
    expect(await signedIn(garmin).hrv.day('2026-09-22')).toEqual({
      date: '2026-09-22',
      lastNightAverage: 52,
      lastNight5MinHigh: 74,
      weeklyAverage: 48,
      baselineLow: 44,
      baselineHigh: 58,
      status: 'BALANCED',
      readings: [
        { time: '2026-09-21T21:40:00.000Z', ms: 49 },
        { time: '2026-09-21T21:45:00.000Z', ms: 55 },
      ],
    });
  });

  it('returns null when Garmin has no HRV for the night', async () => {
    const garmin = new FakeGarmin().on('GET', /^\/hrv-service\/hrv\//, status(204));
    expect(await signedIn(garmin).hrv.day('2026-09-22')).toBeNull();
  });

  it('reads nightly summaries and splits ranges over 366 days', async () => {
    const garmin = new FakeGarmin().on(
      'GET',
      /^\/hrv-service\/hrv\/daily\//,
      json(fixture('hrv-range')),
    );
    const nights = await signedIn(garmin).hrv.between('2025-01-01', '2026-03-01');

    expect(
      garmin.callsTo(/hrv\/daily/).map((c) => c.url.pathname.split('/').slice(-2).join('..')),
    ).toEqual(['2025-01-01..2026-01-01', '2026-01-02..2026-03-01']);
    expect(nights.slice(0, 2)).toEqual([
      {
        date: '2026-09-21',
        lastNightAverage: null,
        lastNight5MinHigh: null,
        weeklyAverage: 47,
        baselineLow: null,
        baselineHigh: null,
        status: 'NONE',
      },
      expect.objectContaining({ date: '2026-09-21' }),
    ]);
  });
});

describe('body composition', () => {
  it('converts grams to kilograms, oldest first', async () => {
    const garmin = new FakeGarmin().on(
      'GET',
      '/weight-service/weight/dateRange',
      json(fixture('body-composition')),
    );
    const entries = await signedIn(garmin).body.composition('2026-09-01', '2026-09-24');

    const query = garmin.callsTo(/weight-service/)[0]?.url.searchParams;
    expect(query?.get('startDate')).toBe('2026-09-01');
    expect(query?.get('endDate')).toBe('2026-09-24');
    expect(entries.map((e) => e.date)).toEqual(['2026-09-19', '2026-09-22']);
    expect(entries[0]).toMatchObject({ weightKg: 72.3, bodyFatPercent: null, source: 'MANUAL' });
    expect(entries[1]).toEqual({
      date: '2026-09-22',
      time: new Date(1790143200000).toISOString(),
      weightKg: 71.85,
      bmi: 22.4,
      bodyFatPercent: 15.2,
      bodyWaterPercent: 60.1,
      boneMassKg: 3.1,
      muscleMassKg: 57.4,
      visceralFat: 6,
      metabolicAge: 28,
      source: 'INDEX_SCALE',
    });
  });
});

describe('performance', () => {
  it('reads personal records and keeps unknown kinds', async () => {
    const garmin = new FakeGarmin().on(
      'GET',
      `/personalrecord-service/personalrecord/prs/${DISPLAY_NAME}`,
      json(fixture('personal-records')),
    );
    expect(await signedIn(garmin).records.list()).toEqual([
      {
        typeId: 3,
        kind: 'fastest_5k',
        value: 1498.2,
        activityId: 30000000001,
        activityType: 'running',
        achievedAt: new Date(1790053800000).toISOString(),
      },
      {
        typeId: 12,
        kind: 'most_steps_day',
        value: 23456,
        activityId: null,
        activityType: null,
        achievedAt: new Date(1789000000000).toISOString(),
      },
      {
        typeId: 99,
        kind: null,
        value: 7,
        activityId: null,
        activityType: null,
        achievedAt: null,
      },
    ]);
  });

  it('reads VO2max, oldest first, precise value when there is one', async () => {
    const garmin = new FakeGarmin().on(
      'GET',
      '/metrics-service/metrics/maxmet/daily/2026-09-01/2026-09-24',
      json(fixture('vo2max')),
    );
    expect(await signedIn(garmin).vo2max.between('2026-09-01', '2026-09-24')).toEqual([
      { date: '2026-09-14', running: 48, cycling: null },
      { date: '2026-09-21', running: 48.7, cycling: null },
    ]);
  });
});

describe('errors', () => {
  it('maps 404 to NotFound', async () => {
    const garmin = new FakeGarmin().on('GET', /^\/activity-service\/activity\/\d+$/, status(404));
    await expect(signedIn(garmin).activities.get(1)).rejects.toBeInstanceOf(NotFound);
  });

  it('keeps the display name out of error messages', async () => {
    const garmin = new FakeGarmin().on('GET', /^\/wellness-service\//, status(500));
    const error = (await signedIn(garmin)
      .sleep.day('2026-09-22')
      .catch((e: unknown) => e)) as Error;
    expect(error).toBeInstanceOf(ApiError);
    expect(error.message).toBe('sleep: HTTP 500');
  });
});
