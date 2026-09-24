import { readFileSync } from 'node:fs';

import {
  GarminClient,
  type GarminTokens,
  memoryTokenStore,
  type TokenStore,
} from '../src/index.js';

export function fixture(name: string): unknown {
  return JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8'));
}

/** An unsigned JWT with the given payload: enough for the client, which never verifies it. */
export function fakeJwt(payload: Record<string, unknown>): string {
  const part = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${part({ alg: 'RS256', typ: 'JWT' })}.${part(payload)}.fake-signature`;
}

export const NOW = Date.UTC(2026, 8, 24, 12, 0, 0);

export function tokens(
  overrides: Partial<GarminTokens> & { expiresInS?: number } = {},
): GarminTokens {
  const { expiresInS = 3600, ...rest } = overrides;
  return {
    diToken: fakeJwt({
      client_id: 'GARMIN_CONNECT_MOBILE_ANDROID_DI_2025Q2',
      exp: NOW / 1000 + expiresInS,
    }),
    diRefreshToken: 'refresh-1',
    diClientId: 'GARMIN_CONNECT_MOBILE_ANDROID_DI_2025Q2',
    ...rest,
  };
}

export interface Call {
  method: string;
  url: URL;
  headers: Headers;
  body: string;
}

type Reply = Response | ((call: Call) => Response);

interface Route {
  method: string;
  match: (url: URL) => boolean;
  replies: Reply[];
}

/**
 * A `fetch` that answers from a route table and records every call. Each route replays its
 * replies in order and repeats the last one. An unrouted call fails the test.
 */
export class FakeGarmin {
  readonly calls: Call[] = [];
  readonly #routes: Route[] = [];

  on(method: string, path: string | RegExp, ...replies: Reply[]): this {
    const match =
      typeof path === 'string'
        ? (url: URL) => url.pathname === path
        : (url: URL) => path.test(url.pathname);
    this.#routes.push({ method, match, replies });
    return this;
  }

  callsTo(path: string | RegExp): Call[] {
    return this.calls.filter((c) =>
      typeof path === 'string' ? c.url.pathname === path : path.test(c.url.pathname),
    );
  }

  readonly fetch = async (
    input: string | URL | Request,
    init: RequestInit = {},
  ): Promise<Response> => {
    const url = new URL(input instanceof Request ? input.url : input);
    const call: Call = {
      method: init.method ?? 'GET',
      url,
      headers: new Headers(init.headers),
      body: typeof init.body === 'string' ? init.body : '',
    };
    this.calls.push(call);
    const route = this.#routes.find((r) => r.method === call.method && r.match(url));
    if (!route) throw new Error(`Unrouted ${call.method} ${url.href}`);
    const reply = route.replies.length > 1 ? route.replies.shift()! : route.replies[0]!;
    return typeof reply === 'function' ? reply(call) : copy(reply);
  };
}

// A fresh copy per call: `clone()` tees the body, and cancelling one branch of a tee hangs until
// the other branch is consumed too.
async function copy(reply: Response): Promise<Response> {
  const body = reply.status === 204 ? null : await reply.clone().text();
  return new Response(body, { status: reply.status, headers: reply.headers });
}

export function json(body: unknown, init: ResponseInit & { cookies?: string[] } = {}): Response {
  const headers = new Headers(init.headers);
  headers.set('content-type', 'application/json');
  for (const cookie of init.cookies ?? []) headers.append('set-cookie', cookie);
  return new Response(JSON.stringify(body), { ...init, headers });
}

export function status(code: number, headers: Record<string, string> = {}): Response {
  return new Response(code === 204 ? null : '', { status: code, headers });
}

export function html(code: number): Response {
  return new Response('<html><title>Just a moment...</title></html>', {
    status: code,
    headers: { 'content-type': 'text/html' },
  });
}

export function client(
  garmin: FakeGarmin,
  store: TokenStore = memoryTokenStore(),
  now: () => number = () => NOW,
): GarminClient {
  return new GarminClient({
    store,
    fetch: garmin.fetch,
    now,
    sleep: () => Promise.resolve(),
  });
}

export const SSO_LOGIN = '/mobile/api/login';
export const SSO_MFA = '/mobile/api/mfa/verifyCode';
export const DI_TOKEN = '/di-oauth2-service/oauth/token';
export const PROFILE = '/userprofile-service/socialProfile';
