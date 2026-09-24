import { describe, expect, it } from 'vitest';

import {
  ApiError,
  AuthExpired,
  fromPythonTokens,
  memoryTokenStore,
  RateLimited,
} from '../src/index.js';
import {
  client,
  DI_TOKEN,
  fakeJwt,
  FakeGarmin,
  fixture,
  json,
  NOW,
  PROFILE,
  status,
  tokens,
} from './helpers.js';

const refreshed = fakeJwt({
  client_id: 'GARMIN_CONNECT_MOBILE_ANDROID_DI_2025Q2',
  exp: NOW / 1000 + 7200,
});

describe('session', () => {
  it('fails with AuthExpired when there is no session', async () => {
    const garmin = new FakeGarmin();
    await expect(client(garmin).profile.get()).rejects.toBeInstanceOf(AuthExpired);
    expect(garmin.calls).toHaveLength(0);
  });

  it('sends the access token as a Bearer', async () => {
    const session = tokens();
    const garmin = new FakeGarmin().on('GET', PROFILE, json(fixture('social-profile')));
    await client(garmin, memoryTokenStore(session)).profile.get();
    expect(garmin.calls[0]?.headers.get('authorization')).toBe(`Bearer ${session.diToken}`);
  });

  it('refreshes proactively when the token expires within 15 minutes', async () => {
    const store = memoryTokenStore(tokens({ expiresInS: 10 * 60 }));
    const garmin = new FakeGarmin()
      .on('POST', DI_TOKEN, json({ access_token: refreshed, refresh_token: 'refresh-2' }))
      .on('GET', PROFILE, json(fixture('social-profile')));

    await client(garmin, store).profile.get();

    const form = new URLSearchParams(garmin.callsTo(DI_TOKEN)[0]?.body);
    expect(form.get('grant_type')).toBe('refresh_token');
    expect(form.get('refresh_token')).toBe('refresh-1');
    expect(garmin.callsTo(PROFILE)[0]?.headers.get('authorization')).toBe(`Bearer ${refreshed}`);
    expect(await store.load()).toMatchObject({ diToken: refreshed, diRefreshToken: 'refresh-2' });
  });

  it('keeps the refresh token when Garmin does not rotate it', async () => {
    const store = memoryTokenStore(tokens({ expiresInS: 0 }));
    const garmin = new FakeGarmin()
      .on('POST', DI_TOKEN, json({ access_token: refreshed }))
      .on('GET', PROFILE, json(fixture('social-profile')));
    await client(garmin, store).profile.get();
    expect((await store.load())?.diRefreshToken).toBe('refresh-1');
  });

  it('runs a single refresh for concurrent calls', async () => {
    const store = memoryTokenStore(tokens({ expiresInS: 0 }));
    const garmin = new FakeGarmin()
      .on('POST', DI_TOKEN, json({ access_token: refreshed, refresh_token: 'refresh-2' }))
      .on('GET', PROFILE, json(fixture('social-profile')));
    const garminClient = client(garmin, store);

    await Promise.all([
      garminClient.profile.get(),
      garminClient.profile.get(),
      garminClient.profile.get(),
    ]);

    expect(garmin.callsTo(DI_TOKEN)).toHaveLength(1);
    expect(garmin.callsTo(PROFILE)).toHaveLength(3);
  });

  it('refreshes once on 401 and retries the call', async () => {
    const store = memoryTokenStore(tokens());
    const garmin = new FakeGarmin()
      .on('GET', PROFILE, status(401), json(fixture('social-profile')))
      .on('POST', DI_TOKEN, json({ access_token: refreshed, refresh_token: 'refresh-2' }));

    await expect(client(garmin, store).profile.get()).resolves.toMatchObject({
      fullName: 'Jane Doe',
    });
    expect(garmin.callsTo(DI_TOKEN)).toHaveLength(1);
    expect(garmin.callsTo(PROFILE)[1]?.headers.get('authorization')).toBe(`Bearer ${refreshed}`);
  });

  it('does not loop on a second 401', async () => {
    const garmin = new FakeGarmin()
      .on('GET', PROFILE, status(401))
      .on('POST', DI_TOKEN, json({ access_token: refreshed }));
    const error = await client(garmin, memoryTokenStore(tokens()))
      .profile.get()
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(401);
    expect(garmin.callsTo(PROFILE)).toHaveLength(2);
  });

  it('fails with AuthExpired when the refresh is refused, and keeps the store', async () => {
    const session = tokens({ expiresInS: 0 });
    const store = memoryTokenStore(session);
    const garmin = new FakeGarmin().on(
      'POST',
      DI_TOKEN,
      json({ error: 'invalid_grant' }, { status: 400 }),
    );

    const error = (await client(garmin, store)
      .profile.get()
      .catch((e: unknown) => e)) as Error;
    expect(error).toBeInstanceOf(AuthExpired);
    expect(error.message).not.toContain(session.diToken);
    expect(error.message).not.toContain(session.diRefreshToken);
    expect(await store.load()).toEqual(session);
  });

  it('imports a python-garminconnect session', async () => {
    const session = tokens();
    const store = memoryTokenStore();
    const imported = fromPythonTokens(
      JSON.stringify({
        di_token: session.diToken,
        di_refresh_token: session.diRefreshToken,
        di_client_id: session.diClientId,
      }),
    );
    await client(new FakeGarmin(), store).importSession(imported);
    expect(await store.load()).toEqual(session);
    expect(() => fromPythonTokens('{"di_token":"x"}')).toThrow(TypeError);
    expect(() => fromPythonTokens('not json')).toThrow(TypeError);
  });

  it('logout clears the store', async () => {
    const store = memoryTokenStore(tokens());
    await client(new FakeGarmin(), store).logout();
    expect(await store.load()).toBeNull();
  });
});

describe('API calls', () => {
  const signedIn = (garmin: FakeGarmin) => client(garmin, memoryTokenStore(tokens()));

  it('retries 5xx and 429 with backoff', async () => {
    const garmin = new FakeGarmin().on(
      'GET',
      PROFILE,
      status(503),
      status(429),
      json(fixture('social-profile')),
    );
    await expect(signedIn(garmin).profile.get()).resolves.toMatchObject({ profileId: 22222222 });
    expect(garmin.callsTo(PROFILE)).toHaveLength(3);
  });

  it('gives up with RateLimited after the retries', async () => {
    const garmin = new FakeGarmin().on('GET', PROFILE, status(429, { 'retry-after': '5' }));
    const error = await signedIn(garmin)
      .profile.get()
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RateLimited);
    expect((error as RateLimited).retryAfter).toBe(5);
    expect(garmin.callsTo(PROFILE)).toHaveLength(3);
  });

  it('does not wait for a long Retry-After', async () => {
    const garmin = new FakeGarmin().on('GET', PROFILE, status(429, { 'retry-after': '3600' }));
    await expect(signedIn(garmin).profile.get()).rejects.toBeInstanceOf(RateLimited);
    expect(garmin.callsTo(PROFILE)).toHaveLength(1);
  });
});
