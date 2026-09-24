import { describe, expect, it } from 'vitest';

import {
  BotChallenge,
  GarminError,
  InvalidCredentials,
  memoryTokenStore,
  MfaInvalid,
  RateLimited,
  UnexpectedResponse,
} from '../src/index.js';
import {
  client,
  DI_TOKEN,
  fakeJwt,
  FakeGarmin,
  html,
  json,
  NOW,
  SSO_LOGIN,
  SSO_MFA,
  status,
} from './helpers.js';

const CREDENTIALS = { email: 'jane@example.com', password: 'hunter2' };

const accessToken = fakeJwt({
  client_id: 'GARMIN_CONNECT_MOBILE_ANDROID_DI',
  exp: NOW / 1000 + 3600,
});

const successfulLogin = () =>
  json({ responseStatus: { type: 'SUCCESSFUL' }, serviceTicketId: 'ST-0000-fake' });

const tokenResponse = () =>
  json({ access_token: accessToken, refresh_token: 'refresh-1', expires_in: 3600 });

describe('login', () => {
  it('exchanges the service ticket and saves the tokens', async () => {
    const garmin = new FakeGarmin()
      .on('POST', SSO_LOGIN, successfulLogin())
      // The first client ID is retired: the next one is tried.
      .on('POST', DI_TOKEN, json({ error: 'invalid_client' }, { status: 400 }), tokenResponse());
    const store = memoryTokenStore();

    expect(await client(garmin, store).login(CREDENTIALS)).toEqual({ status: 'ok' });

    // The client ID comes from the access token, not from the list order.
    expect(await store.load()).toEqual({
      diToken: accessToken,
      diRefreshToken: 'refresh-1',
      diClientId: 'GARMIN_CONNECT_MOBILE_ANDROID_DI',
    });

    const [loginCall] = garmin.callsTo(SSO_LOGIN);
    expect(loginCall?.url.searchParams.get('clientId')).toBe('GCM_IOS_DARK');
    expect(JSON.parse(loginCall?.body ?? '')).toMatchObject({
      username: CREDENTIALS.email,
      password: CREDENTIALS.password,
    });

    const exchange = garmin.callsTo(DI_TOKEN);
    expect(exchange).toHaveLength(2);
    const form = new URLSearchParams(exchange[1]?.body);
    expect(form.get('service_ticket')).toBe('ST-0000-fake');
    expect(form.get('client_id')).toBe('GARMIN_CONNECT_MOBILE_ANDROID_DI_2024Q4');
    expect(exchange[1]?.headers.get('authorization')).toBe(
      `Basic ${Buffer.from('GARMIN_CONNECT_MOBILE_ANDROID_DI_2024Q4:').toString('base64')}`,
    );
  });

  it('fails with UnexpectedResponse when no client ID is accepted', async () => {
    const garmin = new FakeGarmin()
      .on('POST', SSO_LOGIN, successfulLogin())
      .on('POST', DI_TOKEN, json({ error: 'invalid_client' }, { status: 400 }));
    await expect(client(garmin).login(CREDENTIALS)).rejects.toBeInstanceOf(UnexpectedResponse);
    expect(garmin.callsTo(DI_TOKEN)).toHaveLength(4);
  });

  it('rejects wrong credentials', async () => {
    const garmin = new FakeGarmin().on(
      'POST',
      SSO_LOGIN,
      json({ responseStatus: { type: 'INVALID_USERNAME_PASSWORD' } }, { status: 401 }),
    );
    await expect(client(garmin).login(CREDENTIALS)).rejects.toBeInstanceOf(InvalidCredentials);
  });

  it.each([
    ['HTTP 403', () => html(403)],
    ['an HTML page', () => html(200)],
    ['a CAPTCHA', () => json({ responseStatus: { type: 'CAPTCHA_REQUIRED' } })],
  ])('reports %s as a bot challenge', async (_, reply) => {
    const garmin = new FakeGarmin().on('POST', SSO_LOGIN, reply());
    await expect(client(garmin).login(CREDENTIALS)).rejects.toBeInstanceOf(BotChallenge);
  });

  it('reports HTTP 429 with its Retry-After', async () => {
    const garmin = new FakeGarmin().on('POST', SSO_LOGIN, status(429, { 'retry-after': '120' }));
    const error = await client(garmin)
      .login(CREDENTIALS)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RateLimited);
    expect((error as RateLimited).retryAfter).toBe(120);
  });

  it('reports a 429 buried in a JSON body', async () => {
    const garmin = new FakeGarmin().on(
      'POST',
      SSO_LOGIN,
      json({ error: { 'status-code': '429' } }),
    );
    await expect(client(garmin).login(CREDENTIALS)).rejects.toBeInstanceOf(RateLimited);
  });

  it('never puts the email or password in an error message', async () => {
    const replies = [
      () => json({ responseStatus: { type: 'INVALID_USERNAME_PASSWORD' } }),
      () => json({ responseStatus: { type: 'SOMETHING_NEW' }, echo: CREDENTIALS }),
      () => html(403),
    ];
    for (const reply of replies) {
      const garmin = new FakeGarmin().on('POST', SSO_LOGIN, reply());
      const error = (await client(garmin)
        .login(CREDENTIALS)
        .catch((e: unknown) => e)) as Error;
      expect(error).toBeInstanceOf(GarminError);
      expect(error.message).not.toContain(CREDENTIALS.email);
      expect(error.message).not.toContain(CREDENTIALS.password);
    }
  });
});

describe('MFA', () => {
  const mfaRequired = () =>
    json(
      {
        responseStatus: { type: 'MFA_REQUIRED' },
        customerMfaInfo: { mfaLastMethodUsed: 'sms' },
      },
      { cookies: ['SESSION=abc; Path=/; Secure; HttpOnly', 'GARMIN-SSO=1; Path=/'] },
    );

  it('returns needs_mfa, then finishes with the code', async () => {
    const garmin = new FakeGarmin()
      .on('POST', SSO_LOGIN, mfaRequired())
      .on('POST', SSO_MFA, successfulLogin())
      .on('POST', DI_TOKEN, tokenResponse());
    const store = memoryTokenStore();
    const garminClient = client(garmin, store);

    const result = await garminClient.login(CREDENTIALS);
    expect(result.status).toBe('needs_mfa');
    expect(await store.load()).toBeNull();

    await garminClient.resumeLogin(' 123456 ');

    const [verify] = garmin.callsTo(SSO_MFA);
    expect(verify?.headers.get('cookie')).toBe('SESSION=abc; GARMIN-SSO=1');
    expect(JSON.parse(verify?.body ?? '')).toMatchObject({
      mfaMethod: 'sms',
      mfaVerificationCode: '123456',
    });
    expect((await store.load())?.diToken).toBe(accessToken);
  });

  it('can resume from another instance with the returned state', async () => {
    const garmin = new FakeGarmin()
      .on('POST', SSO_LOGIN, mfaRequired())
      .on('POST', SSO_MFA, successfulLogin())
      .on('POST', DI_TOKEN, tokenResponse());
    const result = await client(garmin).login(CREDENTIALS);
    if (result.status !== 'needs_mfa') throw new Error('expected needs_mfa');

    const store = memoryTokenStore();
    await client(garmin, store).resumeLogin('123456', result.state);
    expect(await store.load()).not.toBeNull();
  });

  it('keeps the pending login after a wrong code', async () => {
    const garmin = new FakeGarmin()
      .on('POST', SSO_LOGIN, mfaRequired())
      .on(
        'POST',
        SSO_MFA,
        json({ responseStatus: { type: 'INVALID_MFA_CODE' } }),
        successfulLogin(),
      )
      .on('POST', DI_TOKEN, tokenResponse());
    const garminClient = client(garmin);
    await garminClient.login(CREDENTIALS);

    await expect(garminClient.resumeLogin('000000')).rejects.toBeInstanceOf(MfaInvalid);
    await expect(garminClient.resumeLogin('123456')).resolves.toBeUndefined();
  });

  it('refuses to resume without a pending login', async () => {
    await expect(client(new FakeGarmin()).resumeLogin('123456')).rejects.toBeInstanceOf(TypeError);
    await expect(client(new FakeGarmin()).resumeLogin('123456', 'garbage')).rejects.toBeInstanceOf(
      TypeError,
    );
  });
});
