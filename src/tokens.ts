/**
 * DI OAuth2 session issued by `diauth.garmin.com`. Same fields as the `garmin_tokens.json`
 * written by python-garminconnect >= 0.3, so an existing session can be imported as is.
 */
export interface GarminTokens {
  diToken: string;
  diRefreshToken: string;
  diClientId: string;
}

/**
 * Where the consumer keeps a session. The library never touches the filesystem or a database
 * itself: a file, a database row per account or a secret manager are all up to the consumer.
 */
export interface TokenStore {
  load(): Promise<GarminTokens | null>;
  save(tokens: GarminTokens): Promise<void>;
  clear(): Promise<void>;
}

/**
 * Reads the `garmin_tokens.json` of python-garminconnect (`di_token`, `di_refresh_token`,
 * `di_client_id`), as a JSON string or an already parsed object.
 */
export function fromPythonTokens(input: string | object): GarminTokens {
  let data: unknown = input;
  if (typeof input === 'string') {
    try {
      data = JSON.parse(input);
    } catch {
      throw new TypeError('Python tokens: not valid JSON');
    }
  }
  const fields = data as Record<string, unknown> | null;
  const diToken = fields?.['di_token'];
  const diRefreshToken = fields?.['di_refresh_token'];
  const diClientId = fields?.['di_client_id'];
  if (
    typeof diToken !== 'string' ||
    typeof diRefreshToken !== 'string' ||
    typeof diClientId !== 'string' ||
    !diToken ||
    !diRefreshToken ||
    !diClientId
  ) {
    throw new TypeError('Python tokens: di_token, di_refresh_token and di_client_id are required');
  }
  return { diToken, diRefreshToken, diClientId };
}

/** A `TokenStore` kept in memory only: for scripts and tests. */
export function memoryTokenStore(initial: GarminTokens | null = null): TokenStore {
  let tokens = initial;
  return {
    load: () => Promise.resolve(tokens),
    save: (next) => {
      tokens = next;
      return Promise.resolve();
    },
    clear: () => {
      tokens = null;
      return Promise.resolve();
    },
  };
}
