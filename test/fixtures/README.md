# Fixtures

Garmin responses replayed by the tests. **No real personal data**: names, ids and values are
invented, tokens are fake JWTs built in `test/helpers.ts`.

The values are **synthetic**, but the shapes were checked against real responses on 2026-09-24:
every field the parsers read exists under the same name, with the same date formats. Invented
values are kept on purpose, rather than anonymised recordings of real health data. When Garmin
changes a payload, confirm with `pnpm smoke`, then update the matching file and its parser.
