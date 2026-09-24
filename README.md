# garmin-client

Node client for **Garmin Connect**: sign-in (MFA included), session renewal, and reading an
account's health and activity data: activities (laps, heart rate zones, strength-training sets),
heart rate, HRV, sleep, steps, body composition, personal records and VO2max.

> ⚠️ **Unofficial API.** Garmin neither publishes nor supports these endpoints; they may change or
> be blocked without notice. This project is not affiliated with Garmin. Use it for your own data
> only.

> 🚧 **Early days.** Every call has been run against a real account, but Garmin changes things
> without notice. Expect breaking changes before 1.0.

## Installation

Not published to npm: each [release](https://github.com/m-d-b-code/garmin-client/releases)
attaches a tarball with the built package.

```sh
pnpm add https://github.com/m-d-b-code/garmin-client/releases/download/v0.2.0/garmin-client.tgz
```

## Design

A library, not a service: no server, no files, no database, no runtime dependency. The
application embedding it provides token storage (`TokenStore`) and decides when to sync. The
password only passes through to Garmin; only tokens are handed back, to the store.

## Usage

```ts
import { GarminClient, type TokenStore } from 'garmin-client';

const store: TokenStore = {
  load: async () => /* tokens or null */,
  save: async (tokens) => { /* persist, encrypted at rest */ },
  clear: async () => { /* forget */ },
};

const garmin = new GarminClient({ store });

const result = await garmin.login({ email, password });
if (result.status === 'needs_mfa') {
  // `result.state` may be kept server-side to finish in another request or process.
  await garmin.resumeLogin(code, result.state);
}

const sleep = await garmin.sleep.day('2026-09-24');
```

Once signed in, the session is renewed on its own: the access token is refreshed 15 minutes
before it expires (and once on a 401), and every new token pair goes to `store.save()`.

An existing session of [python-garminconnect](https://github.com/cyberjunky/python-garminconnect)
can be adopted without a new login:

```ts
import { fromPythonTokens } from 'garmin-client';

await garmin.importSession(fromPythonTokens(readFileSync('garmin_tokens.json', 'utf8')));
```

### Data

| Call                                | Returns                                            |
| ----------------------------------- | -------------------------------------------------- |
| `profile.get()`                     | Display name, full name                            |
| `activities.list({ start, limit })` | Latest activities, newest first (see below)        |
| `activities.between(from, to)`      | Every activity in a date range                     |
| `activities.get(id)`                | One activity                                       |
| `activities.exerciseSets(id)`       | Strength sets: exercises, reps, weight (kg), rests |
| `activities.laps(id)`               | Laps: distance, pace, heart rate, cadence, climb   |
| `activities.heartRateZones(id)`     | Time spent in each heart rate zone                 |
| `daily.summary(date)`               | Steps, calories, intensity minutes, heart rate…    |
| `heartRate.day(date)`               | Intraday heart rate curve                          |
| `heartRate.resting(from, to?)`      | Resting heart rate per day                         |
| `steps.daily(from, to?)`            | Steps per day                                      |
| `sleep.day(date)`                   | Sleep stages, score, start and end; `null` if none |
| `hrv.day(date)`                     | Night HRV with 5-minute readings; `null` if none   |
| `hrv.between(from, to?)`            | Nightly HRV averages, baseline and status          |
| `body.composition(from, to?)`       | Weigh-ins: weight, fat, muscle, bone, water (kg/%) |
| `records.list()`                    | Personal records (fastest 5 km, most steps…)       |
| `vo2max.between(from, to?)`         | VO2max estimates, running and cycling              |

Every sport shares one flat `Activity`: time, distance, speed, elevation, heart rate, intensity
minutes, steps, cadence, power, running dynamics, strength sets and reps. What a sport or device
does not measure is `null`.

Dates are `YYYY-MM-DD`. Missing values are `null`, never guessed. Units are in the field names
(`distanceMeters`, `groundContactTimeMs`…); Garmin's grams are converted to kilograms.

### Raw responses

Created with `raw: true`, the client also returns, on every record, the Garmin object it was
parsed from: the whole response for a single-object call (`daily.summary()`, `sleep.day()`…),
the item for a list or a range (one activity of `activities.between()`, one day of
`steps.daily()`…). Useful to archive what Garmin sent, fields this library does not read
included, and parse it again later.

```ts
const garmin = new GarminClient({ store, raw: true });

const summary = await garmin.daily.summary('2026-09-24');
summary.steps; // typed
summary.raw; // `unknown`: Garmin's JSON, as received
```

Without the option, `raw` is neither returned nor typed.

### Errors

Every Garmin failure is a `GarminError` subclass with a stable `code`; messages never contain
credentials, tokens or health data.

| Error                | When                                                        |
| -------------------- | ----------------------------------------------------------- |
| `InvalidCredentials` | Wrong email or password                                     |
| `MfaInvalid`         | Wrong MFA code; the pending login can be retried            |
| `AuthExpired`        | No session, or the refresh token was refused: sign in again |
| `RateLimited`        | HTTP 429, with `retryAfter` in seconds when known           |
| `BotChallenge`       | Cloudflare or CAPTCHA in the way of the login               |
| `NotFound`           | Unknown resource (activity id…)                             |
| `ApiError`           | Any other HTTP error, with `status`                         |
| `UnexpectedResponse` | Garmin answered in an unknown shape: the protocol changed   |

## Development

```sh
pnpm install
pnpm test          # replayed responses only, never calls Garmin
pnpm typecheck
pnpm smoke         # manual run against the real Garmin Connect, see scripts/smoke.ts
```

## Credits

The authentication flow and endpoint catalogue are ported from
[python-garminconnect](https://github.com/cyberjunky/python-garminconnect) (MIT, Ron Klinkien).

## License

MIT — see [`LICENSE`](LICENSE).
