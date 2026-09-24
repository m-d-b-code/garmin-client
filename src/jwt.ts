/**
 * Reads the payload of a JWT without verifying it: the signing key is Garmin's. Only used for
 * `exp` (when to refresh) and `client_id` (which client ID to refresh with), never for trust.
 */
export function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const part = token.split('.')[1];
  if (!part) return null;
  try {
    const payload: unknown = JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
    return typeof payload === 'object' && payload !== null && !Array.isArray(payload)
      ? (payload as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** Expiry of the token in epoch milliseconds, or `null` when unknown. */
export function jwtExpiresAt(token: string): number | null {
  const exp = decodeJwtPayload(token)?.['exp'];
  return typeof exp === 'number' && Number.isFinite(exp) ? exp * 1000 : null;
}

export function jwtClientId(token: string): string | null {
  const clientId = decodeJwtPayload(token)?.['client_id'];
  return typeof clientId === 'string' && clientId !== '' ? clientId : null;
}
