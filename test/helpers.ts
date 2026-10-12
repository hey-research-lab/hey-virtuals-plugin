import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { HeyClient, type FetchLike } from '@hey-research-lab/sdk';

import type { ReadContext } from '../src/reads.js';

export type Fixture = {
  request: { path: string; params: Record<string, string | number> };
  response: { status: number; headers: Record<string, string>; body: unknown };
};

const FIXTURES = join(import.meta.dirname, 'fixtures');
export const NOW = new Date('2026-10-13T00:00:00.000Z');

/** `research` reads test/fixtures/live/research.json; `synthetic/x` reads test/fixtures/synthetic/x.json. */
export function loadFixture(name: string): Fixture {
  const path = name.startsWith('synthetic/') ? `${name}.json` : join('live', `${name}.json`);
  return JSON.parse(readFileSync(join(FIXTURES, path), 'utf8')) as Fixture;
}

export function liveIndex(): { slug: string; tokenSlug: string; token: string; symbol: string } {
  return JSON.parse(readFileSync(join(FIXTURES, 'live', 'index.json'), 'utf8')) as {
    slug: string;
    tokenSlug: string;
    token: string;
    symbol: string;
  };
}

export type Call = { url: URL; init: RequestInit | undefined };

function key(path: string, params: Record<string, string | number>): string {
  const url = new URL(path, 'https://heyresearch.xyz');
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  url.searchParams.sort();
  return `${decodeURIComponent(url.pathname)}${url.search}`;
}

/**
 * A fetch that answers from saved fixtures (or bodies a test built from them) and fails the test
 * on any request none of them recorded: path and every query parameter must match.
 */
export function routeFetch(fixtures: (string | Fixture)[], calls: Call[] = []): FetchLike {
  const table = new Map<string, Fixture>();
  for (const f of fixtures) {
    const fixture = typeof f === 'string' ? loadFixture(f) : f;
    table.set(key(fixture.request.path, fixture.request.params), fixture);
  }
  return async (input, init) => {
    const url = new URL(input);
    calls.push({ url, init });
    const params = Object.fromEntries(url.searchParams.entries());
    const fixture = table.get(key(url.pathname, params));
    if (!fixture) {
      throw new Error(`Unexpected request ${url.pathname}${url.search}; no fixture recorded it`);
    }
    const body =
      typeof fixture.response.body === 'string'
        ? fixture.response.body
        : JSON.stringify(fixture.response.body);
    return new Response(body, {
      status: fixture.response.status,
      headers: fixture.response.headers,
    });
  };
}

/** A copy of a fixture with its body changed; for the unknown-value paths HEY rarely sends. */
export function variant(name: string, edit: (body: Record<string, unknown>) => void): Fixture {
  const fixture = structuredClone(loadFixture(name));
  edit(fixture.response.body as Record<string, unknown>);
  return fixture;
}

export function ctxFor(fixtures: (string | Fixture)[], calls: Call[] = []): ReadContext {
  return {
    hey: new HeyClient({ fetchImpl: routeFetch(fixtures, calls) }),
    now: () => NOW,
  };
}

/** Words HEY's output must never use (ECOSYSTEM conventions §1), as whole words. */
export const FORBIDDEN = [
  /\brug(ged|s)?\b/i,
  /\bscam\b/i,
  /\b(un)?safe\b/i,
  /\bbullish\b/i,
  /\bbearish\b/i,
  /\bbuy\b/i,
  /\bsell\b/i,
  /\b100x\b/i,
  /\balpha\b/i,
  /\bundervalued\b/i,
  /\bguaranteed\b/i,
  /\bsmart money\b/i,
  /\bwhales?\b/i,
  /\bdev wallet\b/i,
  /\busers\b/i,
  /\bpartnership\b/i,
  /\baudited\b/i,
  /\bofficial robinhood\b/i,
];

export function forbiddenIn(text: string): string[] {
  return FORBIDDEN.filter((re) => re.test(text)).map((re) => re.source);
}
