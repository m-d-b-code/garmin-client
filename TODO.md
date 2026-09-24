# To do

Open questions and possible next steps. Tick a box when done; remove a section once empty.

## Data to confirm

Each of these was read correctly from recorded responses, but not yet seen on a real account.

- [ ] Personal record `typeId` 16 appears on real accounts with an unknown meaning (possibly the
      current step-goal streak): exposed with `kind: null` until identified.
- [ ] Body composition: only weight has been seen for real (manual entries). The other masses are
      assumed to be in grams like weight (as `AlexxIT/SmartScaleConnect` does); check against a
      scale that pushes full data.
- [ ] `Activity`: cadence is read for running only (`averageRunningCadenceInStepsPerMinute`);
      cycling cadence (rpm) and power have never been seen on a real activity.

## Next

- [ ] ESLint, once `typescript-eslint` supports TypeScript 7.
- [ ] Activity files (FIT/GPX, track) and Training Status / training load, if a consumer needs
      them.

## Known deviations from upstream

To revisit only if the real Garmin contradicts them: only the "mobile iOS" login strategy is
ported (no HTML widget, web portal or `curl_cffi`); no `JWT_WEB` fallback if the DI exchange
fails; no token check through an API call after login; MFA through `/mobile/api/mfa/verifyCode`
only. `MfaRequired` is not an error: it is the `needs_mfa` result of `login()`.

**If Cloudflare starts blocking the login:** Node currently gets through without TLS
impersonation. Fallbacks, in order: [`impit`](https://github.com/apify/impit) (Rust, prebuilt
musl binaries, `fetch`-like API with browser impersonation: the closest match to `curl_cffi`)
injected through the client's `fetch` option; or a login done elsewhere followed by a token import,
since token refresh does not go through Cloudflare.
