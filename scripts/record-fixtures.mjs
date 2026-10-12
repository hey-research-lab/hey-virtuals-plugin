#!/usr/bin/env node
// Records the test fixtures from HEY's live public API. Maintainers only; never run in CI.
//
//   HEY_LIVE=1 node scripts/record-fixtures.mjs
//
// Read-only GETs through @hey-research-lab/sdk itself (so every recorded path and query is exactly
// what the plugin sends), one at a time, at most one request per second, no API key. Each fixture
// keeps the status, a small header allowlist and the body, unchanged. The identifiers used are
// written to test/fixtures/live/index.json.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { HeyClient, HeyApiError } from '@hey-research-lab/sdk';

if (process.env.HEY_LIVE !== '1') {
  console.error('Refusing to call the live API without HEY_LIVE=1.');
  process.exit(2);
}

const OUT = join(import.meta.dirname, '..', 'test', 'fixtures', 'live');
const KEEP_HEADERS = ['content-type', 'x-request-id', 'x-hey-api-version', 'retry-after'];
mkdirSync(OUT, { recursive: true });

let last = 0;
let pending = null;
const recordingFetch = async (input, init) => {
  const wait = last + 1100 - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  last = Date.now();
  const res = await fetch(input, init);
  const url = new URL(input);
  const params = Object.fromEntries(url.searchParams.entries());
  const headers = {};
  for (const h of KEEP_HEADERS) {
    const v = res.headers.get(h);
    if (v !== null) headers[h] = v;
  }
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  pending = {
    request: { path: url.pathname, params },
    response: { status: res.status, headers, body },
  };
  return new Response(text, { status: res.status, headers: res.headers });
};

const hey = new HeyClient({
  fetchImpl: recordingFetch,
  userAgent: 'hey-virtuals-plugin-fixture-recorder/0.1.0',
});

async function record(name, call) {
  pending = null;
  try {
    await call();
  } catch (e) {
    if (!(e instanceof HeyApiError)) throw e;
  }
  if (!pending) throw new Error(`no request recorded for ${name}`);
  writeFileSync(join(OUT, `${name}.json`), `${JSON.stringify(pending, null, 2)}\n`);
  console.log(`${pending.response.status} ${pending.request.path} -> ${name}.json`);
  return pending.response.body;
}

const slug = process.env.HEY_RECORD_SLUG ?? 'musepass-musepass';
const tokenSlug = process.env.HEY_RECORD_TOKEN_SLUG ?? 'agentos';
await record('research', () => hey.agent.answer('research_project', { project: slug }));
const withToken = await record('research-token', () =>
  hey.agent.answer('research_project', { project: tokenSlug }),
);
const token = withToken?.data?.contractIdentity?.token?.address;
const symbol = withToken?.data?.identity?.symbol?.text;
await record('research-not-found', () =>
  hey.agent.answer('research_project', { project: 'hey-virtuals-no-such-project' }),
);
if (token) await record('token', () => hey.token.lookup(4663, token));
await record('token-unknown', () =>
  hey.token.lookup(4663, '0x0000000000000000000000000000000000000001'),
);
await record('search', () => hey.search.suggest(symbol ?? slug));
await record('search-name', () => hey.search.suggest(slug.split('-')[0]));
await record('search-slug', () => hey.search.suggest(tokenSlug));
await record('search-empty', () => hey.search.suggest('zzqx-no-such-name'));
await record('changes', () => hey.agent.answer('what_changed', { days: 7, limit: 5 }));
await record('changes-project', () =>
  hey.agent.answer('what_changed', { project: slug, days: 30, limit: 5, building: 'only' }),
);
await record('timeline', () => hey.projects.timeline(slug, { limit: 5 }));
await record('timeline-not-found', () =>
  hey.projects.timeline('hey-virtuals-no-such-project', { limit: 5 }),
);
await record('chain', () => hey.chain({ days: 3 }));

writeFileSync(
  join(OUT, 'index.json'),
  `${JSON.stringify({ recordedAt: new Date().toISOString(), base: 'https://heyresearch.xyz', slug, tokenSlug, token: token ?? null, symbol: symbol ?? null }, null, 2)}\n`,
);
