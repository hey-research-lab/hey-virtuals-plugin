import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { ExecutableGameFunctionStatus, GameWorker } from '@virtuals-protocol/game';
import { describe, expect, it } from 'vitest';

import {
  ATTRIBUTION,
  HEY_FUNCTION_NAMES,
  VERSION,
  createHeyClient,
  heyEnvironment,
  heyResearchFunctions,
  heyResearchWorker,
} from '../src/index.js';
import { NOW, forbiddenIn, liveIndex, routeFetch, type Call } from './helpers.js';

const ids = liveIndex();
const ALL_FIXTURES = [
  'research',
  'research-token',
  'research-not-found',
  'token',
  'token-unknown',
  'search',
  'search-name',
  'search-empty',
  'changes',
  'changes-project',
  'timeline',
  'timeline-not-found',
  'chain',
  'synthetic/search-ambiguous',
  'synthetic/search-no-such',
  'synthetic/rate-limited',
];

function functionsOver(fixtures: string[], calls: Call[] = []) {
  const fns = heyResearchFunctions({ fetchImpl: routeFetch(fixtures, calls), now: () => NOW });
  return Object.fromEntries(fns.map((f) => [f.name, f]));
}

const silent = () => {};

describe('heyResearchWorker', () => {
  it('is a GAME worker with the five HEY functions and concrete descriptions', () => {
    const worker = heyResearchWorker({ fetchImpl: routeFetch([]) });
    expect(worker).toBeInstanceOf(GameWorker);
    expect(worker.id).toBe('hey_research_worker');
    expect(worker.functions.map((f) => f.name)).toEqual([...HEY_FUNCTION_NAMES]);
    expect(worker.description).toContain('Robinhood Chain');
    for (const fn of worker.functions) {
      expect(fn.description).toContain('Robinhood Chain');
      expect(fn.description.length).toBeGreaterThan(120);
      expect(forbiddenIn(fn.description)).toEqual([]);
      const json = fn.toJSON() as { fn_name: string; args: { name: string }[] };
      expect(json.fn_name).toBe(fn.name);
      expect(json.args.map((a) => a.name)).toContain('chain_id');
    }
  });

  it('takes id, name and description overrides', () => {
    const worker = heyResearchWorker({ id: 'x', name: 'y', description: 'z' });
    expect([worker.id, worker.name, worker.description]).toEqual(['x', 'y', 'z']);
  });

  it('reports its chain and citation line as the environment', async () => {
    const env = await heyEnvironment();
    expect(env).toMatchObject({ chainId: 4663, caip2: 'eip155:4663', citation: ATTRIBUTION });
    const worker = heyResearchWorker();
    expect(await worker.getEnvironment?.()).toEqual(env);
  });
});

describe('GAME function responses', () => {
  it('returns Done with HEY’s text for each happy path', async () => {
    const fns = functionsOver(ALL_FIXTURES);
    const cases: [string, Record<string, string>][] = [
      ['hey_research_project', { query: ids.slug }],
      ['hey_find_projects', { query: ids.symbol }],
      ['hey_recent_changes', { days: '7', limit: '5' }],
      ['hey_project_timeline', { project: ids.slug, limit: '5' }],
      ['hey_chain_overview', { days: '3' }],
    ];
    for (const [name, args] of cases) {
      const res = await fns[name]!.executable(args, silent);
      expect(res.status, name).toBe(ExecutableGameFunctionStatus.Done);
      expect(res.feedback, name).toContain(ATTRIBUTION);
    }
  });

  it('runs through GAME’s own execute path ({ arg: { value } }) and logs no key', async () => {
    const logs: string[] = [];
    const calls: Call[] = [];
    const [research] = heyResearchFunctions({
      fetchImpl: routeFetch(['research'], calls),
      apiKey: 'test-key-not-real',
    });
    const res = await research!.execute({ query: { value: ids.slug } }, (m) => logs.push(m));
    expect(res.status).toBe(ExecutableGameFunctionStatus.Done);
    expect(res.toJSON('a1')).toMatchObject({ action_id: 'a1', action_status: 'done' });
    expect(logs.join('\n')).not.toContain('test-key-not-real');
    expect(new Headers(calls[0]?.init?.headers).get('authorization')).toBe(
      'Bearer test-key-not-real',
    );
  });

  it('identifies the integration and sends no key unless one is given', async () => {
    const calls: Call[] = [];
    const prior = process.env.HEY_API_KEY;
    delete process.env.HEY_API_KEY;
    const [research] = heyResearchFunctions({ fetchImpl: routeFetch(['research'], calls) });
    await research!.executable({ query: ids.slug }, silent);
    const headers = new Headers(calls[0]?.init?.headers);
    expect(headers.get('authorization')).toBeNull();
    expect(headers.get('x-hey-integration')).toBe(`hey-virtuals-plugin/${VERSION}`);
    if (prior !== undefined) process.env.HEY_API_KEY = prior;
  });

  it('sends the environment key to heyresearch.xyz only; a custom baseUrl needs an explicit key', async () => {
    const prior = process.env.HEY_API_KEY;
    process.env.HEY_API_KEY = 'env-key-not-real';
    try {
      const authorization = async (options: Parameters<typeof heyResearchFunctions>[0]) => {
        const calls: Call[] = [];
        const [research] = heyResearchFunctions({
          ...options,
          fetchImpl: routeFetch(['research'], calls),
        });
        await research!.executable({ query: ids.slug }, silent);
        return {
          url: String(calls[0]?.url),
          authorization: new Headers(calls[0]?.init?.headers).get('authorization'),
        };
      };
      expect((await authorization({})).authorization).toBe('Bearer env-key-not-real');
      expect((await authorization({ baseUrl: 'https://heyresearch.xyz' })).authorization).toBe(
        'Bearer env-key-not-real',
      );
      const mock = await authorization({ baseUrl: 'https://hey-mock.example' });
      expect(mock.url).toMatch(/^https:\/\/hey-mock\.example\//);
      expect(mock.authorization).toBeNull();
      expect((await authorization({ baseUrl: 'http://localhost:3000' })).authorization).toBeNull();
      expect(
        (
          await authorization({
            baseUrl: 'https://hey-mock.example',
            apiKey: 'explicit-key-not-real',
          })
        ).authorization,
      ).toBe('Bearer explicit-key-not-real');
    } finally {
      if (prior === undefined) delete process.env.HEY_API_KEY;
      else process.env.HEY_API_KEY = prior;
    }
  });

  it('refuses another chain with unsupported_chain and makes no request', async () => {
    const calls: Call[] = [];
    const fns = functionsOver([], calls);
    for (const chain of ['1', '8453', 'eip155:1', '04663', 'Robinhood']) {
      const res = await fns.hey_research_project!.executable(
        { query: ids.slug, chain_id: chain },
        silent,
      );
      expect(res.status).toBe(ExecutableGameFunctionStatus.Failed);
      expect(res.feedback).toContain(
        `HEY supports Robinhood Chain (4663) only; chain ${chain} is not supported.`,
      );
    }
    expect(calls).toHaveLength(0);
  });

  it('accepts 4663 and eip155:4663', async () => {
    const fns = functionsOver(['chain']);
    for (const chain of ['4663', 'eip155:4663']) {
      const res = await fns.hey_chain_overview!.executable({ days: '3', chain_id: chain }, silent);
      expect(res.status).toBe(ExecutableGameFunctionStatus.Done);
    }
  });

  it('returns Failed with HEY’s error passed through', async () => {
    const fns = functionsOver(['synthetic/rate-limited']);
    const res = await fns.hey_research_project!.executable({ query: 'agentos' }, silent);
    expect(res.status).toBe(ExecutableGameFunctionStatus.Failed);
    expect(res.feedback).toContain('rate_limited (HTTP 429)');
    expect(res.feedback).toContain('Retry after 12 seconds.');
  });

  it('returns Done for "HEY holds no such project": an answer, not a failure', async () => {
    const fns = functionsOver(['token-unknown']);
    const res = await fns.hey_research_project!.executable(
      { query: '0x0000000000000000000000000000000000000001' },
      silent,
    );
    expect(res.status).toBe(ExecutableGameFunctionStatus.Done);
  });
});

describe('forbidden words', () => {
  it('appear in no output the plugin produces over every fixture', async () => {
    const fns = functionsOver(ALL_FIXTURES);
    const runs: [string, Record<string, string>][] = [
      ['hey_research_project', { query: ids.slug }],
      ['hey_research_project', { query: ids.tokenSlug }],
      ['hey_research_project', { query: ids.token }],
      ['hey_research_project', { query: `$${ids.symbol}` }],
      ['hey_research_project', { query: '0x0000000000000000000000000000000000000001' }],
      ['hey_research_project', { query: 'Example Agent' }],
      ['hey_research_project', { query: 'hey-virtuals-no-such-project' }],
      ['hey_research_project', { query: 'agentos', chain_id: '1' }],
      ['hey_find_projects', { query: ids.symbol }],
      ['hey_find_projects', { query: 'musepass' }],
      ['hey_find_projects', { query: 'zzqx-no-such-name' }],
      ['hey_recent_changes', { days: '7', limit: '5' }],
      ['hey_recent_changes', { project: ids.slug, days: '30', limit: '5', building_only: 'true' }],
      ['hey_project_timeline', { project: ids.slug, limit: '5' }],
      ['hey_project_timeline', { project: 'hey-virtuals-no-such-project', limit: '5' }],
      ['hey_chain_overview', { days: '3' }],
    ];
    const outputs: string[] = [];
    for (const [name, args] of runs) {
      outputs.push((await fns[name]!.executable(args, silent)).feedback);
    }
    // research on a slug that is rate limited
    const limited = functionsOver(['synthetic/rate-limited']);
    outputs.push(
      (await limited.hey_research_project!.executable({ query: 'agentos' }, silent)).feedback,
    );
    for (const text of outputs) expect(forbiddenIn(text), text.slice(0, 200)).toEqual([]);
    expect(forbiddenIn(heyResearchWorker().description)).toEqual([]);
  });
});

describe('configuration', () => {
  it('rejects a base URL that is not https or local', () => {
    expect(() => createHeyClient({ baseUrl: 'http://example.com' })).toThrow(
      /baseUrl must be https/,
    );
    expect(() => createHeyClient({ baseUrl: 'https://user:pw@example.com' })).toThrow();
    expect(() => createHeyClient({ baseUrl: 'http://localhost:3000' })).not.toThrow();
  });

  it('keeps VERSION equal to package.json', () => {
    const pkg = JSON.parse(
      readFileSync(join(import.meta.dirname, '..', 'package.json'), 'utf8'),
    ) as {
      version: string;
    };
    expect(VERSION).toBe(pkg.version);
  });
});
