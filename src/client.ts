import { type ApiContext, apiGet, type RetryOptions } from './api.js';
import { type AuthContext, login, verifyMfa } from './auth.js';
import { DEFAULT_TIMEOUT_MS } from './constants.js';
import {
  type Activity,
  activitiesBetween,
  type ExerciseSets,
  fetchActivity,
  fetchExerciseSets,
  fetchHeartRateZones,
  fetchLaps,
  type HeartRateZone,
  type Lap,
  listActivities,
} from './endpoints/activities.js';
import { type BodyComposition, fetchBodyComposition } from './endpoints/body.js';
import type { Get } from './endpoints/get.js';
import {
  fetchPersonalRecords,
  fetchVo2Max,
  type PersonalRecord,
  type Vo2Max,
} from './endpoints/performance.js';
import { fetchProfile, type Profile } from './endpoints/profile.js';
import {
  type DailySteps,
  type DailySummary,
  fetchDailySteps,
  fetchDailySummary,
  fetchHeartRateDay,
  fetchHrvNight,
  fetchHrvRange,
  fetchRestingHeartRate,
  fetchSleep,
  type HeartRateDay,
  type HrvNight,
  type HrvSummary,
  type RestingHeartRate,
  type SleepNight,
} from './endpoints/wellness.js';
import { type Fetch, sleep } from './http.js';
import { isRecord, type WithRaw } from './parse.js';
import { Session } from './session.js';
import type { GarminTokens, TokenStore } from './tokens.js';

export interface GarminClientOptions<Raw extends boolean = false> {
  /** Where the session lives. Receives every new token pair (login, refresh, import). */
  store: TokenStore;
  /** Defaults to the global `fetch`. Tests inject recorded responses here. */
  fetch?: Fetch;
  /** Per-request timeout. Default 30 s. */
  timeoutMs?: number;
  /** Backoff on 429 and 5xx for data calls; login and refresh are never retried. */
  retry?: Partial<RetryOptions>;
  /**
   * Keep, on every returned record, the Garmin object it was parsed from as `raw`: the whole
   * response for a single-object call, the item for a list or a range. For consumers that archive
   * what Garmin sent, including the fields this library does not read. Default `false`.
   */
  raw?: Raw;
  /** Clock, for tests of the refresh margin. */
  now?: () => number;
  /** Delay between retries, for tests. */
  sleep?: (ms: number) => Promise<void>;
}

export type LoginResult =
  | { status: 'ok' }
  /**
   * Garmin sent a code by email or SMS. Pass it to `resumeLogin()` together with `state`.
   * `state` holds the SSO session cookies: keep it server-side and short-lived, it is a
   * credential for the few minutes the code stays valid.
   */
  | { status: 'needs_mfa'; state: string };

/** `T`, with `raw` when the client was created with `raw: true`. */
export type MaybeRaw<T, Raw extends boolean> = Raw extends true ? WithRaw<T> : T;

export class GarminClient<Raw extends boolean = false> {
  readonly #auth: AuthContext;
  readonly #api: ApiContext;
  readonly #session: Session;
  readonly #get: Get;
  readonly #raw: boolean;
  #pendingMfa: string | null = null;
  #displayName: Promise<string> | null = null;

  constructor(options: GarminClientOptions<Raw>) {
    const fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.#auth = { fetch, timeoutMs };
    this.#api = {
      fetch,
      timeoutMs,
      retry: { retries: 2, baseDelayMs: 1000, maxDelayMs: 30_000, ...options.retry },
      sleep: options.sleep ?? sleep,
    };
    this.#session = new Session(options.store, this.#auth, options.now ?? Date.now);
    this.#get = (label, path, query) => apiGet(this.#api, this.#session, label, path, query);
    this.#raw = options.raw ?? false;
  }

  /**
   * Signs in with email and password. The password is only sent to Garmin, never kept. On
   * success the tokens are saved to the store.
   */
  async login(credentials: { email: string; password: string }): Promise<LoginResult> {
    const step = await login(this.#auth, credentials.email, credentials.password);
    if (step.status === 'needs_mfa') {
      this.#pendingMfa = step.state;
      return step;
    }
    await this.#start(step.tokens);
    return { status: 'ok' };
  }

  /**
   * Finishes a login that returned `needs_mfa`. `state` defaults to the one kept by this
   * instance; pass it explicitly when the MFA step runs in another process or request.
   * A wrong code throws `MfaInvalid` and may be retried with the same state.
   */
  async resumeLogin(code: string, state: string | null = this.#pendingMfa): Promise<void> {
    if (state === null) throw new TypeError('No MFA login pending: call login() first');
    const tokens = await verifyMfa(this.#auth, state, code.trim());
    this.#pendingMfa = null;
    await this.#start(tokens);
  }

  /**
   * Adopts an existing session (tokens from another machine, or `fromPythonTokens()`) without
   * a password login. The tokens are saved to the store as is; they are checked on first use.
   */
  async importSession(tokens: GarminTokens): Promise<void> {
    await this.#start(tokens);
  }

  /** Forgets the session locally and in the store. Garmin offers no token revocation. */
  async logout(): Promise<void> {
    this.#pendingMfa = null;
    this.#displayName = null;
    await this.#session.clear();
  }

  readonly profile = {
    get: (): Promise<MaybeRaw<Profile, Raw>> => this.#out(fetchProfile(this.#get)),
  };

  readonly activities = {
    /** Most recent first; `start` is an offset (0 = latest activity). */
    list: (options: { start?: number; limit?: number } = {}): Promise<MaybeRaw<Activity, Raw>[]> =>
      this.#out(listActivities(this.#get, options.start, options.limit)),
    between: (from: string, to: string): Promise<MaybeRaw<Activity, Raw>[]> =>
      this.#out(activitiesBetween(this.#get, from, to)),
    get: (id: number): Promise<MaybeRaw<Activity, Raw>> => this.#out(fetchActivity(this.#get, id)),
    exerciseSets: (id: number): Promise<MaybeRaw<ExerciseSets, Raw>> =>
      this.#out(fetchExerciseSets(this.#get, id)),
    /** Laps as recorded by the watch: per kilometre with auto lap, or per button press. */
    laps: (id: number): Promise<MaybeRaw<Lap, Raw>[]> => this.#out(fetchLaps(this.#get, id)),
    heartRateZones: (id: number): Promise<MaybeRaw<HeartRateZone, Raw>[]> =>
      this.#out(fetchHeartRateZones(this.#get, id)),
  };

  readonly daily = {
    summary: async (date: string): Promise<MaybeRaw<DailySummary, Raw>> =>
      this.#out(fetchDailySummary(this.#get, await this.#name(), date)),
  };

  readonly heartRate = {
    day: async (date: string): Promise<MaybeRaw<HeartRateDay, Raw>> =>
      this.#out(fetchHeartRateDay(this.#get, await this.#name(), date)),
    resting: async (from: string, to: string = from): Promise<MaybeRaw<RestingHeartRate, Raw>[]> =>
      this.#out(fetchRestingHeartRate(this.#get, await this.#name(), from, to)),
  };

  readonly steps = {
    daily: (from: string, to: string = from): Promise<MaybeRaw<DailySteps, Raw>[]> =>
      this.#out(fetchDailySteps(this.#get, from, to)),
  };

  readonly sleep = {
    day: async (date: string): Promise<MaybeRaw<SleepNight, Raw> | null> =>
      this.#out(fetchSleep(this.#get, await this.#name(), date)),
  };

  readonly hrv = {
    day: (date: string): Promise<MaybeRaw<HrvNight, Raw> | null> =>
      this.#out(fetchHrvNight(this.#get, date)),
    between: (from: string, to: string = from): Promise<MaybeRaw<HrvSummary, Raw>[]> =>
      this.#out(fetchHrvRange(this.#get, from, to)),
  };

  readonly body = {
    composition: (from: string, to: string = from): Promise<MaybeRaw<BodyComposition, Raw>[]> =>
      this.#out(fetchBodyComposition(this.#get, from, to)),
  };

  readonly records = {
    list: async (): Promise<MaybeRaw<PersonalRecord, Raw>[]> =>
      this.#out(fetchPersonalRecords(this.#get, await this.#name())),
  };

  readonly vo2max = {
    between: (from: string, to: string = from): Promise<MaybeRaw<Vo2Max, Raw>[]> =>
      this.#out(fetchVo2Max(this.#get, from, to)),
  };

  async #start(tokens: GarminTokens): Promise<void> {
    this.#displayName = null;
    await this.#session.set(tokens);
  }

  /**
   * Parsers always attach `raw`; it is dropped here unless the client keeps it. The one unchecked
   * cast of the client: each method's declared type stands for what its parser returns.
   */
  async #out<T>(result: Promise<T>): Promise<never> {
    const value = await result;
    return (this.#raw ? value : dropRaw(value)) as never;
  }

  /** The display name, fetched once per session: several URLs need it. */
  #name(): Promise<string> {
    this.#displayName ??= fetchProfile(this.#get).then(
      (profile) => profile.displayName,
      (error: unknown) => {
        this.#displayName = null;
        throw error;
      },
    );
    return this.#displayName;
  }
}

function dropRaw(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(dropRaw);
  if (!isRecord(value) || !('raw' in value)) return value;
  const { raw: _, ...rest } = value;
  return rest;
}
