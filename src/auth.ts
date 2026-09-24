// Port of the "mobile iOS" strategy of python-garminconnect `client.py`: JSON login on
// sso.garmin.com, then the CAS service ticket is exchanged for DI OAuth2 tokens. The other
// upstream strategies (curl_cffi TLS impersonation, HTML widget, web portal) are left out until
// this one proves blocked from Node.

import {
  DI_CLIENT_IDS,
  DI_GRANT_TYPE_SERVICE_TICKET,
  DI_TOKEN_URL,
  IOS_LOGIN_USER_AGENT,
  IOS_SERVICE_URL,
  IOS_SSO_CLIENT_ID,
  MOBILE_LOGIN_PATH,
  MOBILE_MFA_VERIFY_PATH,
  NATIVE_HEADERS,
  SSO_ORIGIN,
} from './constants.js';
import {
  AuthExpired,
  BotChallenge,
  InvalidCredentials,
  MfaInvalid,
  RateLimited,
  UnexpectedResponse,
} from './errors.js';
import {
  basicAuth,
  cookieHeader,
  type Fetch,
  formBody,
  readJson,
  retryAfterSeconds,
} from './http.js';
import { jwtClientId } from './jwt.js';
import { isRecord } from './parse.js';
import type { GarminTokens } from './tokens.js';

export interface AuthContext {
  fetch: Fetch;
  timeoutMs: number;
}

export type LoginStep =
  { status: 'ok'; tokens: GarminTokens } | { status: 'needs_mfa'; state: string };

/** What `verifyMfa` needs from the login step: the SSO session cookies and the MFA channel. */
interface MfaState {
  v: 1;
  cookies: string;
  mfaMethod: string;
}

const SSO_QUERY = new URLSearchParams({
  clientId: IOS_SSO_CLIENT_ID,
  locale: 'en-US',
  service: IOS_SERVICE_URL,
}).toString();

const SSO_HEADERS = {
  'User-Agent': IOS_LOGIN_USER_AGENT,
  Accept: 'application/json, text/plain, */*',
  'Content-Type': 'application/json',
  Origin: SSO_ORIGIN,
};

export async function login(ctx: AuthContext, email: string, password: string): Promise<LoginStep> {
  const res = await ctx.fetch(`${SSO_ORIGIN}${MOBILE_LOGIN_PATH}?${SSO_QUERY}`, {
    method: 'POST',
    headers: SSO_HEADERS,
    body: JSON.stringify({ username: email, password, rememberMe: true, captchaToken: '' }),
    signal: AbortSignal.timeout(ctx.timeoutMs),
  });
  const body = await ssoJson(res, 'Login');
  const status = responseStatus(body);

  switch (status) {
    case 'SUCCESSFUL':
      return { status: 'ok', tokens: await exchangeServiceTicket(ctx, serviceTicket(body)) };
    case 'MFA_REQUIRED': {
      const state: MfaState = {
        v: 1,
        cookies: cookieHeader(res),
        mfaMethod: mfaMethod(body),
      };
      return { status: 'needs_mfa', state: encodeState(state) };
    }
    case 'INVALID_USERNAME_PASSWORD':
      throw new InvalidCredentials('Garmin rejected the email or password');
    case 'CAPTCHA_REQUIRED':
      throw new BotChallenge('Login: Garmin asks for a CAPTCHA');
    default:
      throw new UnexpectedResponse(
        `Login: unexpected response (HTTP ${res.status}, status ${status ?? 'missing'})`,
      );
  }
}

export async function verifyMfa(
  ctx: AuthContext,
  encoded: string,
  code: string,
): Promise<GarminTokens> {
  const state = decodeState(encoded);
  const res = await ctx.fetch(`${SSO_ORIGIN}${MOBILE_MFA_VERIFY_PATH}?${SSO_QUERY}`, {
    method: 'POST',
    headers: { ...SSO_HEADERS, Cookie: state.cookies },
    body: JSON.stringify({
      mfaMethod: state.mfaMethod,
      mfaVerificationCode: code,
      rememberMyBrowser: true,
      reconsentList: [],
      mfaSetup: false,
    }),
    signal: AbortSignal.timeout(ctx.timeoutMs),
  });
  const body = await ssoJson(res, 'MFA verification');
  const status = responseStatus(body);
  if (status === 'SUCCESSFUL') return exchangeServiceTicket(ctx, serviceTicket(body));
  throw new MfaInvalid(`MFA code refused (status ${status ?? `HTTP ${res.status}`})`);
}

export async function exchangeServiceTicket(
  ctx: AuthContext,
  ticket: string,
): Promise<GarminTokens> {
  let lastStatus = 0;
  for (const clientId of DI_CLIENT_IDS) {
    const res = await postDiToken(ctx, clientId, {
      client_id: clientId,
      service_ticket: ticket,
      grant_type: DI_GRANT_TYPE_SERVICE_TICKET,
      service_url: IOS_SERVICE_URL,
    });
    if (res.status === 429) {
      throw new RateLimited('DI token exchange rate limited', retryAfterSeconds(res));
    }
    lastStatus = res.status;
    if (!res.ok) {
      await res.body?.cancel();
      continue;
    }
    const tokens = parseTokenResponse(await readJson(res), clientId);
    if (tokens) return tokens;
  }
  throw new UnexpectedResponse(
    `DI token exchange failed for every client ID (last HTTP ${lastStatus})`,
  );
}

export async function refreshTokens(ctx: AuthContext, tokens: GarminTokens): Promise<GarminTokens> {
  const res = await postDiToken(ctx, tokens.diClientId, {
    grant_type: 'refresh_token',
    client_id: tokens.diClientId,
    refresh_token: tokens.diRefreshToken,
  });
  if (res.status === 429) {
    throw new RateLimited('Token refresh rate limited', retryAfterSeconds(res));
  }
  const body = await readJson(res);
  if (!res.ok) {
    if (res.status === 403 && body === undefined) {
      throw new BotChallenge('Token refresh: HTTP 403 challenge page');
    }
    throw new AuthExpired(`Token refresh refused (HTTP ${res.status}): sign in again`);
  }
  const refreshed = parseTokenResponse(body, tokens.diClientId, tokens.diRefreshToken);
  if (!refreshed) throw new UnexpectedResponse('Token refresh: no access token in response');
  return refreshed;
}

function postDiToken(ctx: AuthContext, clientId: string, fields: Record<string, string>) {
  return ctx.fetch(DI_TOKEN_URL, {
    method: 'POST',
    headers: {
      ...NATIVE_HEADERS,
      Authorization: basicAuth(clientId),
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
      'Cache-Control': 'no-cache',
    },
    body: formBody(fields),
    signal: AbortSignal.timeout(ctx.timeoutMs),
  });
}

/**
 * `client_id` is read back from the access token because Garmin may issue it for another client
 * than the one asked for, and refresh only works with the right one. The refresh token may or may
 * not be rotated: keep the previous one when the response has none.
 */
function parseTokenResponse(
  body: unknown,
  requestedClientId: string,
  previousRefreshToken?: string,
): GarminTokens | null {
  if (!isRecord(body) || typeof body['access_token'] !== 'string') return null;
  const accessToken = body['access_token'];
  const refreshToken =
    typeof body['refresh_token'] === 'string' ? body['refresh_token'] : previousRefreshToken;
  if (!refreshToken) return null;
  return {
    diToken: accessToken,
    diRefreshToken: refreshToken,
    diClientId: jwtClientId(accessToken) ?? requestedClientId,
  };
}

/** Shared handling of SSO answers: throttling and bot challenges look the same on every call. */
async function ssoJson(res: Response, step: string): Promise<Record<string, unknown>> {
  if (res.status === 429) {
    throw new RateLimited(`${step} rate limited by Garmin`, retryAfterSeconds(res));
  }
  if (res.status === 403) throw new BotChallenge(`${step}: HTTP 403 (bot challenge)`);
  const body = await readJson(res);
  if (!isRecord(body)) {
    // Garmin answers JSON even on failures; HTML means a challenge page in front of it.
    throw new BotChallenge(`${step}: non-JSON response (HTTP ${res.status})`);
  }
  const error = body['error'];
  if (isRecord(error) && String(error['status-code']) === '429') {
    throw new RateLimited(`${step} rate limited by Garmin`);
  }
  return body;
}

function responseStatus(body: Record<string, unknown>): string | undefined {
  const status = body['responseStatus'];
  return isRecord(status) && typeof status['type'] === 'string' ? status['type'] : undefined;
}

function serviceTicket(body: Record<string, unknown>): string {
  const ticket = body['serviceTicketId'];
  if (typeof ticket !== 'string' || ticket === '') {
    throw new UnexpectedResponse('SSO answered SUCCESSFUL without a service ticket');
  }
  return ticket;
}

function mfaMethod(body: Record<string, unknown>): string {
  const info = body['customerMfaInfo'];
  const method = isRecord(info) ? info['mfaLastMethodUsed'] : undefined;
  return typeof method === 'string' && method !== '' ? method : 'email';
}

function encodeState(state: MfaState): string {
  return Buffer.from(JSON.stringify(state)).toString('base64url');
}

function decodeState(encoded: string): MfaState {
  try {
    const state: unknown = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    if (
      isRecord(state) &&
      state['v'] === 1 &&
      typeof state['cookies'] === 'string' &&
      typeof state['mfaMethod'] === 'string'
    ) {
      return state as unknown as MfaState;
    }
  } catch {
    // Falls through to the error below.
  }
  throw new TypeError('Invalid MFA state: pass the `state` returned by login() unchanged');
}
