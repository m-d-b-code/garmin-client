// Public surface of the library. Everything a consumer may import is re-exported here;
// deep imports into `dist/` are not supported.

export { GarminClient, type GarminClientOptions, type LoginResult } from './client.js';
export type { RetryOptions } from './api.js';
export type {
  Activity,
  ExerciseSet,
  ExerciseSets,
  HeartRateZone,
  Lap,
} from './endpoints/activities.js';
export type { BodyComposition } from './endpoints/body.js';
export type { PersonalRecord, RecordKind, Vo2Max } from './endpoints/performance.js';
export type { Profile } from './endpoints/profile.js';
export type {
  DailySteps,
  DailySummary,
  HeartRateDay,
  HrvNight,
  HrvSummary,
  RestingHeartRate,
  SleepNight,
} from './endpoints/wellness.js';
export {
  ApiError,
  AuthExpired,
  BotChallenge,
  GarminError,
  type GarminErrorCode,
  InvalidCredentials,
  MfaInvalid,
  NotFound,
  RateLimited,
  UnexpectedResponse,
} from './errors.js';
export {
  fromPythonTokens,
  type GarminTokens,
  memoryTokenStore,
  type TokenStore,
} from './tokens.js';
