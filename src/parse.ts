// Narrowing helpers for Garmin payloads. Fields Garmin may omit or null become `null`; only the
// shape an endpoint cannot do without (the object itself, an id) throws `UnexpectedResponse`.

import { UnexpectedResponse } from './errors.js';

export type Json = Record<string, unknown>;

/**
 * A record with the Garmin object it was parsed from: the whole response for a single-object
 * endpoint, the list item for a list or a range. Parsers always attach it; the client drops it
 * unless created with `raw: true`.
 */
export type WithRaw<T> = T & { raw: unknown };

export function isRecord(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function record(value: unknown, what: string): Json {
  if (!isRecord(value)) throw new UnexpectedResponse(`${what}: expected an object`);
  return value;
}

export function array(value: unknown, what: string): unknown[] {
  if (!Array.isArray(value)) throw new UnexpectedResponse(`${what}: expected an array`);
  return value;
}

/** A child object, or an empty one when missing: lets optional sub-objects be read uniformly. */
export function child(value: Json, key: string): Json {
  const nested = value[key];
  return isRecord(nested) ? nested : {};
}

export function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function str(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

export function requiredNum(value: unknown, what: string): number {
  const n = num(value);
  if (n === null) throw new UnexpectedResponse(`${what}: expected a number`);
  return n;
}

export function requiredStr(value: unknown, what: string): string {
  const s = str(value);
  if (s === null) throw new UnexpectedResponse(`${what}: expected a string`);
  return s;
}

/** Garmin's `2026-09-24 07:12:00` (UTC) or `2026-09-24T07:12:00.0` into ISO 8601 with `Z`. */
export function gmtToIso(value: unknown): string | null {
  const s = str(value);
  if (s === null) return null;
  const date = new Date(`${s.replace(' ', 'T').replace(/Z$/, '')}Z`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** Epoch milliseconds into ISO 8601. */
export function epochToIso(value: unknown): string | null {
  const ms = num(value);
  return ms === null ? null : new Date(ms).toISOString();
}

/** Local wall-clock time as Garmin sends it, normalised to `YYYY-MM-DDTHH:mm:ss` (no offset). */
export function localDateTime(value: unknown): string | null {
  const s = str(value);
  const match = s?.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})/);
  return match ? `${match[1]}T${match[2]}` : null;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Validates a `YYYY-MM-DD` argument; caller errors are `RangeError`, not Garmin errors. */
export function assertDate(value: string, name: string): string {
  if (!DATE.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
    throw new RangeError(`${name} must be a YYYY-MM-DD date`);
  }
  return value;
}

export function assertRange(from: string, to: string): void {
  assertDate(from, 'from');
  assertDate(to, 'to');
  if (from > to) throw new RangeError('from must not be after to');
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
