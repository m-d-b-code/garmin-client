import type { Query } from '../api.js';

/** An authenticated GET bound to a session; `label` names the call in error messages. */
export type Get = (label: string, path: string, query?: Query) => Promise<unknown>;
