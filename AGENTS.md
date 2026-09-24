# garmin-client

Node library (TypeScript, ESM) that talks to Garmin Connect: authentication, session renewal,
reading health and activity data. **No server, no I/O of its own**: the consumer injects
token storage and decides when to sync.

Garmin publishes no API for these endpoints: they change, get rate-limited or blocked without
notice. Every decision favours **ease of repair** over completeness.

Open questions and next steps: `TODO.md`.

## Reference

Read the protocol from [python-garminconnect](https://github.com/cyberjunky/python-garminconnect)
(`garminconnect/client.py` for auth, `garminconnect/__init__.py` for endpoints), not from memory:
it changed in March 2026 (garth dropped, move to DI OAuth2 tokens). Port **what is needed**, never
the whole catalogue. When behaviour diverges, reread the upstream commit that introduced it before
deciding. Upstream MIT licence: the notice stays in `LICENSE`.

## Principles

- **Zero runtime dependencies** by default: native `fetch`. Any added dependency must be justified
  (e.g. TLS impersonation if Cloudflare blocks login) and stay optional where possible.
- **Injectable `fetch`**: tests never call Garmin, they replay recorded responses
  (`test/fixtures/`, anonymised).
- **No secret stored or logged**: the password only passes through; only tokens leave, via the
  consumer's `TokenStore`. Never a token, cookie or health response body in an error message or a
  log.
- **Typed errors** (`InvalidCredentials`, `AuthExpired`, `RateLimited`, `BotChallenge`…): the consumer
  decides what to show, the library does not guess.
- **Read-only** until a write use case exists.
- **Measured data first**: activities, heart rate, HRV, sleep, body composition, records.
  Garmin's opaque scores (Body Battery, stress, Training Readiness) are not ported on their own;
  the few already in the daily summary stay. The consumer decides which of them it reads.

## Conventions

- Everything in the repo is **English** (public library): code, comments, error messages, docs.
  Comments only for a non-obvious _why_.
- Strict TypeScript (`tsconfig.json`), Prettier, Vitest. Node ≥ 26, pnpm.
- `pnpm build` · `pnpm typecheck` · `pnpm test` · `pnpm format:check`.
- Commits: [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`,
  `docs:`, `chore:`…), imperative subject under ~72 characters, one logical change per commit,
  and the checks above passing before each commit.
