// Manual check against the real Garmin Connect, never run in CI: `pnpm smoke`.
// Signs in (or reuses/imports a session), calls every endpoint once and prints a summary with
// counts and presence only, never raw health data or tokens.
//
//   GARMIN_TOKENS          session file, reused and kept up to date (default .garmin-tokens.json)
//   GARMIN_PYTHON_TOKENS   python-garminconnect garmin_tokens.json to import when no session yet
//   GARMIN_EMAIL           for a password login when there is neither
//   GARMIN_PASSWORD        asked in the terminal when unset

import { readFile, rm, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';

import {
  fromPythonTokens,
  GarminClient,
  GarminError,
  type GarminTokens,
  type TokenStore,
} from 'garmin-client';

const tokenFile = process.env['GARMIN_TOKENS'] ?? '.garmin-tokens.json';

const store: TokenStore = {
  async load() {
    try {
      return JSON.parse(await readFile(tokenFile, 'utf8')) as GarminTokens;
    } catch {
      return null;
    }
  },
  async save(tokens) {
    await writeFile(tokenFile, JSON.stringify(tokens), { mode: 0o600 });
  },
  async clear() {
    await rm(tokenFile, { force: true });
  },
};

const garmin = new GarminClient({ store });

// Output goes through a gate so the password prompt does not echo what is typed.
let muted = false;
const output = new Writable({
  write(chunk, _encoding, done) {
    if (!muted) process.stdout.write(chunk as Buffer);
    done();
  },
});
const io = createInterface({ input: process.stdin, output, terminal: true });

try {
  await signIn();
  describeSession(await store.load());
  await run();
} catch (error) {
  report(error);
  process.exitCode = 1;
} finally {
  io.close();
}

async function signIn(): Promise<void> {
  if (await store.load()) {
    console.log(`session: reusing ${tokenFile}`);
    return;
  }
  const pythonTokens = process.env['GARMIN_PYTHON_TOKENS'];
  if (pythonTokens) {
    await garmin.importSession(fromPythonTokens(await readFile(pythonTokens, 'utf8')));
    console.log('session: imported from python-garminconnect');
    return;
  }
  const email = process.env['GARMIN_EMAIL'] ?? (await io.question('Garmin email: '));
  const password = process.env['GARMIN_PASSWORD'] ?? (await askHidden('Garmin password: '));
  const started = Date.now();
  const result = await garmin.login({ email, password });
  if (result.status === 'needs_mfa') {
    console.log('login: MFA required');
    await garmin.resumeLogin(await io.question('MFA code: '));
  }
  console.log(`login: ok in ${Date.now() - started} ms`);
}

async function askHidden(prompt: string): Promise<string> {
  process.stdout.write(prompt);
  muted = true;
  try {
    return await io.question('');
  } finally {
    muted = false;
    process.stdout.write('\n');
  }
}

async function run(): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = shift(today, -1);
  const weekAgo = shift(today, -7);

  const profile = await step(
    'profile',
    () => garmin.profile.get(),
    (p) => `display name ${p.displayName ? 'present' : 'missing'}`,
  );
  const recent = await step(
    'activities.list',
    () => garmin.activities.list({ limit: 5 }),
    (a) =>
      `${a.length} activities, types: ${[...new Set(a.map((x) => x.type))].join(', ') || 'none'}`,
  );
  await step(
    'activities.between',
    () => garmin.activities.between(weekAgo, today),
    (a) => `${a.length} activities over 7 days`,
  );
  const first = recent?.[0];
  if (first) {
    await step(
      'activities.get',
      () => garmin.activities.get(first.id),
      (a) =>
        `type ${a.type ?? '?'}, duration ${a.durationSeconds === null ? 'missing' : 'present'}`,
    );
    await step(
      'activities.laps',
      () => garmin.activities.laps(first.id),
      (l) => `${l.length} laps`,
    );
    await step(
      'activities.heartRateZones',
      () => garmin.activities.heartRateZones(first.id),
      (z) => `${z.length} zones, ${z.filter((x) => x.seconds > 0).length} with time`,
    );
  }
  const strength = recent?.find((a) => a.type === 'strength_training');
  if (strength) {
    await step(
      'activities.exerciseSets',
      () => garmin.activities.exerciseSets(strength.id),
      (s) =>
        `${s.sets.filter((x) => !x.rest).length} active sets, ` +
        `${s.sets.filter((x) => x.weightKg !== null).length} with a weight`,
    );
  } else {
    console.log('activities.exerciseSets: skipped (no strength activity in the last 5)');
  }
  await step(
    'daily.summary',
    () => garmin.daily.summary(yesterday),
    (d) => `${countPresent(d)} fields present`,
  );
  await step(
    'heartRate.day',
    () => garmin.heartRate.day(yesterday),
    (h) => `${h.samples.length} samples`,
  );
  await step(
    'heartRate.resting',
    () => garmin.heartRate.resting(weekAgo, yesterday),
    (r) => `${r.length} days`,
  );
  await step(
    'steps.daily',
    () => garmin.steps.daily(weekAgo, yesterday),
    (s) => `${s.length} days`,
  );
  await step(
    'sleep.day',
    () => garmin.sleep.day(today),
    (s) => (s === null ? 'no sleep recorded' : `${countPresent(s)} fields present`),
  );
  await step(
    'hrv.day',
    () => garmin.hrv.day(today),
    (h) => (h === null ? 'no HRV' : `${h.readings.length} readings, status ${h.status ?? '?'}`),
  );
  await step(
    'hrv.between',
    () => garmin.hrv.between(shift(today, -30), today),
    (h) => `${h.filter((n) => n.lastNightAverage !== null).length} nights with HRV over 30 days`,
  );
  await step(
    'body.composition',
    () => garmin.body.composition(shift(today, -365), today),
    (b) =>
      `${b.length} weigh-ins over a year, ${b.filter((x) => x.bodyFatPercent !== null).length} with body fat`,
  );
  await step(
    'records.list',
    () => garmin.records.list(),
    (r) => `${r.length} records, ${r.filter((x) => x.kind === null).length} of unknown kind`,
  );
  await step(
    'vo2max.between',
    () => garmin.vo2max.between(shift(today, -365), today),
    (v) => `${v.length} days with a VO2max over a year`,
  );
  if (!profile) process.exitCode = 1;
}

async function step<T>(
  name: string,
  call: () => Promise<T>,
  summary: (value: T) => string,
): Promise<T | undefined> {
  const started = Date.now();
  try {
    const value = await call();
    console.log(`${name}: ok in ${Date.now() - started} ms, ${summary(value)}`);
    return value;
  } catch (error) {
    report(error, name);
    process.exitCode = 1;
    return undefined;
  }
}

/** Access token lifetime and client ID: tells how often a refresh, then a login, is needed. */
function describeSession(tokens: GarminTokens | null): void {
  if (!tokens) return;
  const exp = jwtField(tokens.diToken, 'exp');
  const refreshExp = jwtField(tokens.diRefreshToken, 'exp');
  const hours = (epoch: number) => ((epoch * 1000 - Date.now()) / 3_600_000).toFixed(1);
  console.log(
    `session: client ${tokens.diClientId}, access token expires in ` +
      `${typeof exp === 'number' ? `${hours(exp)} h` : 'unknown'}, refresh token ` +
      `${typeof refreshExp === 'number' ? `expires in ${hours(refreshExp)} h` : 'is opaque (no exp)'}`,
  );
}

function jwtField(token: string, field: string): unknown {
  try {
    const payload = token.split('.')[1] ?? '';
    return (
      JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<string, unknown>
    )[field];
  } catch {
    return undefined;
  }
}

function report(error: unknown, name = 'smoke'): void {
  if (error instanceof GarminError) {
    const extra =
      'retryAfter' in error && error.retryAfter ? ` (retry after ${error.retryAfter} s)` : '';
    console.error(`${name}: ${error.name} [${error.code}] ${error.message}${extra}`);
  } else {
    console.error(`${name}:`, error);
  }
}

function countPresent(value: object): string {
  const fields = Object.values(value);
  return `${fields.filter((v) => v !== null).length}/${fields.length}`;
}

function shift(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
