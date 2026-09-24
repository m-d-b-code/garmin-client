import { CONNECT_API_ORIGIN, NATIVE_HEADERS } from './constants.js';
import { ApiError, NotFound, RateLimited, UnexpectedResponse } from './errors.js';
import { type Fetch, readJson, retryAfterSeconds } from './http.js';
import type { Session } from './session.js';

export interface RetryOptions {
  /** Extra attempts after a 429 or 5xx. Default 2. */
  retries: number;
  /** First backoff delay, doubled on each retry. Default 1000 ms. */
  baseDelayMs: number;
  /** A `Retry-After` longer than this is not waited for: `RateLimited` is thrown instead. */
  maxDelayMs: number;
}

export interface ApiContext {
  fetch: Fetch;
  timeoutMs: number;
  retry: RetryOptions;
  sleep: (ms: number) => Promise<void>;
}

export type Query = Record<string, string | number | undefined>;

/**
 * Authenticated GET on connectapi.garmin.com. Returns the parsed JSON, `null` on 204.
 * `label` names the call in errors: the path may contain the user's display name.
 */
export async function apiGet(
  ctx: ApiContext,
  session: Session,
  label: string,
  path: string,
  query: Query = {},
): Promise<unknown> {
  const url = new URL(path, CONNECT_API_ORIGIN);
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }

  let token = await session.accessToken();
  let refreshedOn401 = false;
  let attempt = 0;

  for (;;) {
    const res = await ctx.fetch(url, {
      headers: { ...NATIVE_HEADERS, Authorization: `Bearer ${token}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(ctx.timeoutMs),
    });

    if (res.status === 401 && !refreshedOn401) {
      await res.body?.cancel();
      refreshedOn401 = true;
      token = await session.refreshAfterRejection(token);
      continue;
    }

    if (res.status === 429 || res.status >= 500) {
      await res.body?.cancel();
      const retryAfter = retryAfterSeconds(res);
      const delay =
        retryAfter !== undefined ? retryAfter * 1000 : ctx.retry.baseDelayMs * 2 ** attempt;
      if (attempt < ctx.retry.retries && delay <= ctx.retry.maxDelayMs) {
        attempt++;
        await ctx.sleep(delay);
        continue;
      }
      if (res.status === 429) throw new RateLimited(`${label}: rate limited`, retryAfter);
      throw new ApiError(`${label}: HTTP ${res.status}`, res.status);
    }

    if (res.status === 204) return null;
    if (res.status === 404) {
      await res.body?.cancel();
      throw new NotFound(`${label}: not found`);
    }
    if (!res.ok) {
      await res.body?.cancel();
      throw new ApiError(`${label}: HTTP ${res.status}`, res.status);
    }

    const body = await readJson(res);
    if (body === undefined) throw new UnexpectedResponse(`${label}: non-JSON response`);
    return body;
  }
}
