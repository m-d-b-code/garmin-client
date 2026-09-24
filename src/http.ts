export type Fetch = typeof globalThis.fetch;

/** Parses a JSON body, or returns `undefined` for anything else (Cloudflare HTML pages…). */
export async function readJson(res: Response): Promise<unknown> {
  const text = await res.text();
  if (text === '') return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

/** `Retry-After` in seconds; only the delta-seconds form, which is what Garmin sends. */
export function retryAfterSeconds(res: Response): number | undefined {
  const raw = res.headers.get('retry-after');
  if (raw === null) return undefined;
  const seconds = Number(raw);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : undefined;
}

export function formBody(fields: Record<string, string>): string {
  return new URLSearchParams(fields).toString();
}

export function basicAuth(clientId: string): string {
  return `Basic ${Buffer.from(`${clientId}:`).toString('base64')}`;
}

/** `name=value` pairs of the `Set-Cookie` headers, ready for a `Cookie` header. */
export function cookieHeader(res: Response, previous = ''): string {
  const jar = new Map<string, string>();
  for (const pair of previous.split('; ')) {
    const eq = pair.indexOf('=');
    if (eq > 0) jar.set(pair.slice(0, eq), pair.slice(eq + 1));
  }
  for (const line of res.headers.getSetCookie()) {
    const pair = line.split(';', 1)[0] ?? '';
    const eq = pair.indexOf('=');
    if (eq > 0) jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
  }
  return [...jar].map(([name, value]) => `${name}=${value}`).join('; ');
}

export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));
