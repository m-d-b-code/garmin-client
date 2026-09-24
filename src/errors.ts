// Messages never carry an email, a token, a cookie or a response body: they may end up in the
// consumer's logs. Only HTTP statuses and Garmin's own status codes are included.

export type GarminErrorCode =
  | 'INVALID_CREDENTIALS'
  | 'MFA_INVALID'
  | 'AUTH_EXPIRED'
  | 'RATE_LIMITED'
  | 'BOT_CHALLENGE'
  | 'NOT_FOUND'
  | 'API_ERROR'
  | 'UNEXPECTED_RESPONSE';

export abstract class GarminError extends Error {
  abstract readonly code: GarminErrorCode;

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = new.target.name;
  }
}

/** Garmin rejected the email/password pair. */
export class InvalidCredentials extends GarminError {
  readonly code = 'INVALID_CREDENTIALS';
}

/** The MFA code was refused. The pending login stays valid: the user may retry. */
export class MfaInvalid extends GarminError {
  readonly code = 'MFA_INVALID';
}

/** No usable session: never logged in, or the refresh token was refused. Sign in again. */
export class AuthExpired extends GarminError {
  readonly code = 'AUTH_EXPIRED';
}

/** HTTP 429. `retryAfter` is in seconds, when Garmin sent a `Retry-After` header. */
export class RateLimited extends GarminError {
  readonly code = 'RATE_LIMITED';

  constructor(
    message: string,
    readonly retryAfter?: number,
  ) {
    super(message);
  }
}

/**
 * Cloudflare or Garmin suspect a bot (HTTP 403, CAPTCHA, HTML challenge page). Retrying from the
 * same IP rarely helps; importing tokens obtained elsewhere does.
 */
export class BotChallenge extends GarminError {
  readonly code = 'BOT_CHALLENGE';
}

/** HTTP 404 on an API call: the resource does not exist (unknown activity id…). */
export class NotFound extends GarminError {
  readonly code = 'NOT_FOUND';
}

/** Any other non-success HTTP status. */
export class ApiError extends GarminError {
  readonly code = 'API_ERROR';

  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** Garmin answered, but not in the expected shape: the protocol probably changed. */
export class UnexpectedResponse extends GarminError {
  readonly code = 'UNEXPECTED_RESPONSE';
}
