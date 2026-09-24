import { type AuthContext, refreshTokens } from './auth.js';
import { REFRESH_MARGIN_MS } from './constants.js';
import { AuthExpired } from './errors.js';
import { jwtExpiresAt } from './jwt.js';
import type { GarminTokens, TokenStore } from './tokens.js';

/**
 * Owns the current tokens: loads them lazily from the store, refreshes them before they expire,
 * and hands every new pair back to the store. Only one refresh runs at a time, because Garmin may
 * rotate the refresh token and a second concurrent refresh would use a revoked one.
 */
export class Session {
  // `undefined`: not loaded from the store yet. `null`: loaded, nothing there.
  #tokens: GarminTokens | null | undefined;
  #refreshing: Promise<GarminTokens> | null = null;

  constructor(
    private readonly store: TokenStore,
    private readonly auth: AuthContext,
    private readonly now: () => number,
  ) {}

  async set(tokens: GarminTokens): Promise<void> {
    this.#tokens = tokens;
    await this.store.save(tokens);
  }

  async clear(): Promise<void> {
    this.#tokens = null;
    await this.store.clear();
  }

  /** A valid access token, refreshed first when it expires within the margin. */
  async accessToken(): Promise<string> {
    const tokens = await this.#current();
    const expiresAt = jwtExpiresAt(tokens.diToken);
    if (expiresAt !== null && expiresAt - REFRESH_MARGIN_MS <= this.now()) {
      return (await this.#refresh(tokens)).diToken;
    }
    return tokens.diToken;
  }

  /**
   * Called after a 401 with the token that was refused. When another call already replaced it,
   * the new one is returned instead of refreshing a second time.
   */
  async refreshAfterRejection(rejected: string): Promise<string> {
    const tokens = await this.#current();
    if (tokens.diToken !== rejected) return tokens.diToken;
    return (await this.#refresh(tokens)).diToken;
  }

  async #current(): Promise<GarminTokens> {
    if (this.#tokens === undefined) this.#tokens = await this.store.load();
    if (!this.#tokens) throw new AuthExpired('No Garmin session: sign in or import tokens first');
    return this.#tokens;
  }

  #refresh(tokens: GarminTokens): Promise<GarminTokens> {
    this.#refreshing ??= (async () => {
      try {
        const refreshed = await refreshTokens(this.auth, tokens);
        await this.set(refreshed);
        return refreshed;
      } finally {
        this.#refreshing = null;
      }
    })();
    return this.#refreshing;
  }
}
