import { HeyClient, type FetchLike } from '@hey-research-lab/sdk';

import { INTEGRATION } from './version.js';

/** How the plugin reaches HEY. Everything is optional: with nothing set it reads the public API anonymously. */
export type HeyPluginOptions = {
  /**
   * A HEY API key from heyresearch.xyz/account. Optional: it lifts the anonymous rate limit and
   * nothing else. Defaults to `HEY_API_KEY` from the environment, which is sent to heyresearch.xyz
   * only: with a custom `baseUrl`, pass the key here explicitly or none is sent. Sent as a bearer
   * token, never logged.
   */
  apiKey?: string;
  /**
   * Defaults to https://heyresearch.xyz. Only for tests and local mocks: `https:` or
   * `http://localhost` / `http://127.0.0.1`. It is not a network switch.
   */
  baseUrl?: string;
  /** For tests and exotic runtimes; the global `fetch` by default. */
  fetchImpl?: FetchLike;
  /** Milliseconds before a HEY read is abandoned; the SDK's default is 15 000. */
  timeoutMs?: number;
  /** A ready client, when the host already has one. Overrides the four fields above. */
  client?: HeyClient;
};

export class InvalidBaseUrlError extends Error {
  readonly code = 'invalid_base_url';
  constructor() {
    super('baseUrl must be https:, or http://localhost / http://127.0.0.1 for local tests.');
  }
}

export function assertBaseUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new InvalidBaseUrlError();
  }
  const local = url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !local) || url.username || url.password) {
    throw new InvalidBaseUrlError();
  }
  return url.origin;
}

/** HEY's own origin: the only one the environment's `HEY_API_KEY` is ever sent to. */
const HEY_ORIGIN = 'https://heyresearch.xyz';

function envApiKey(): string | undefined {
  const value = typeof process === 'undefined' ? undefined : process.env.HEY_API_KEY;
  return value && value.trim() ? value.trim() : undefined;
}

export function createHeyClient(options: HeyPluginOptions = {}): HeyClient {
  if (options.client) return options.client;
  const baseUrl = options.baseUrl ? assertBaseUrl(options.baseUrl) : undefined;
  // A key passed in the options goes to the origin passed beside it; a key from the environment goes
  // to heyresearch.xyz only, so pointing the plugin at a mock or a proxy never sends the host's real key.
  const apiKey =
    options.apiKey?.trim() ||
    (baseUrl === undefined || baseUrl === HEY_ORIGIN ? envApiKey() : undefined);
  return new HeyClient({
    ...(baseUrl ? { baseUrl } : {}),
    ...(apiKey ? { apiKey } : {}),
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
    ...(options.timeoutMs ? { timeoutMs: options.timeoutMs } : {}),
    userAgent: INTEGRATION,
    integration: INTEGRATION,
  });
}
