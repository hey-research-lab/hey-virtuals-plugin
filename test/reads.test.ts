import { describe, expect, it } from 'vitest';

import {
  chainOverview,
  findProjects,
  projectTimeline,
  recentChanges,
  researchProject,
} from '../src/reads.js';
import { ATTRIBUTION } from '../src/text.js';
import { ctxFor, liveIndex, loadFixture, variant, type Call } from './helpers.js';

const ids = liveIndex();

describe('hey_research_project', () => {
  it('answers a slug from the agent contract, with builder state, evidence, as-of and attribution', async () => {
    const r = await researchProject(ctxFor(['research']), ids.slug);
    expect(r.ok).toBe(true);
    expect(r.outcome).toBe('answer');
    expect(r.text).toContain(`Project: https://heyresearch.xyz/project/${ids.slug}`);
    expect(r.text).toContain('Activity status: ACTIVE (measured)');
    expect(r.text).toContain('Last meaningful ship: 2026-10-02T14:13:07Z');
    expect(r.text).toContain('Still Building: not measured — no_token');
    expect(r.text).toContain('ship:4ec70ca8-a1c9-46a2-888b-f29a4f824de1');
    expect(r.text).toContain('NOT_VERIFIED projectOwner');
    expect(r.text).toContain('Token contract: none recorded by HEY for this project.');
    const asOf = (loadFixture('research').response.body as { asOf: string }).asOf;
    expect(r.text).toContain(`As of: ${asOf.replace(/\.\d{3}Z$/, 'Z')}`);
    expect(r.text.split('\n').at(-1)).toBe(
      `${ATTRIBUTION} · https://heyresearch.xyz/project/${ids.slug}`,
    );
    expect(r.citation?.kind).toBe('hey_agent_answer');
    expect(r.asOf).toBe(asOf);
  });

  it('keeps market figures as labelled context, with the launch-pool qualifier', async () => {
    const r = await researchProject(ctxFor(['research-token']), ids.tokenSlug);
    expect(r.text).toContain('Market context (context only, never a builder signal)');
    expect(r.text).toContain("a launch pool's own supply, not market depth");
    expect(r.text).toContain('FDV (dexscreener');
    expect(r.text).toContain(`Token contract: ${ids.token} (chain 4663); verification VERIFIED`);
    expect(r.text).toContain('A token is not the project.');
  });

  it('resolves a 0x contract through HEY’s token lookup, accepting either case', async () => {
    const calls: Call[] = [];
    const r = await researchProject(
      ctxFor(['token', 'research-token'], calls),
      ids.token.toUpperCase().replace('0X', '0x'),
    );
    expect(r.outcome).toBe('answer');
    expect(calls.map((c) => c.url.pathname)).toEqual([
      `/api/token/4663/${ids.token}`,
      '/api/agent/research_project',
    ]);
    expect(r.text).toContain(
      `Contract ${ids.token} is the token HEY records for ${ids.tokenSlug}.`,
    );
  });

  it('answers an unknown contract as a reading of HEY’s index, with HEY Scan', async () => {
    const r = await researchProject(
      ctxFor(['token-unknown']),
      '0x0000000000000000000000000000000000000001',
    );
    expect(r.ok).toBe(true);
    expect(r.outcome).toBe('not_found');
    expect(r.text).toContain(
      'HEY has no published project for contract 0x0000000000000000000000000000000000000001',
    );
    expect(r.text).toContain(
      'https://heyresearch.xyz/scan/0x0000000000000000000000000000000000000001',
    );
    expect(r.text).toContain('not a finding about the contract');
  });

  it('resolves a $TICKER through search and says the ticker is not identity', async () => {
    const calls: Call[] = [];
    const r = await researchProject(ctxFor(['search', 'research-token'], calls), `$${ids.symbol}`);
    expect(r.outcome).toBe('answer');
    expect(calls[0]?.url.pathname).toBe('/api/search/suggest');
    expect(r.text).toContain(
      `resolved through HEY's search to the published project ${ids.tokenSlug}`,
    );
    expect(r.text).toMatch(
      /other records? in HEY's index share this ticker on other contracts; a ticker is not identity/,
    );
  });

  it('lists candidates instead of guessing when a name matches several projects', async () => {
    const r = await researchProject(ctxFor(['synthetic/search-ambiguous']), 'Example Agent');
    expect(r.ok).toBe(true);
    expect(r.outcome).toBe('ambiguous');
    expect(r.text).toContain('HEY holds no single published project');
    expect(r.text).toContain('slug example-agent ·');
    expect(r.text).toContain('Launch record (not a published project; HEY has not researched it)');
    expect(r.text).toContain('(never a project)');
    expect(r.text).toContain('HEY may hold more launch records');
  });

  it('falls back to search when a slug is not published, and says so', async () => {
    const r = await researchProject(
      ctxFor(['research-not-found', 'synthetic/search-no-such']),
      'hey-virtuals-no-such-project',
    );
    expect(r.ok).toBe(true);
    expect(r.outcome).toBe('not_found');
    expect(r.text).toContain('HEY holds no published project with the slug');
    expect(r.text).toContain("HEY's search index returned no match");
  });

  it('refuses a malformed address and an empty query without a request', async () => {
    const calls: Call[] = [];
    const ctx = ctxFor([], calls);
    const bad = await researchProject(ctx, '0x1234');
    expect(bad.ok).toBe(false);
    expect(bad.error?.code).toBe('invalid_address');
    const empty = await researchProject(ctx, '   ');
    expect(empty.error?.code).toBe('invalid_argument');
    expect(calls).toHaveLength(0);
  });
});

describe('unknown stays unknown', () => {
  it('renders null builder and market fields as unknown or not measured, never 0 or none', async () => {
    const research = variant('research-token', (body) => {
      const data = body.data as Record<string, Record<string, unknown>>;
      Object.assign(data.builderState!, {
        activityMeasured: false,
        lastMeaningfulShipAt: null,
        meaningfulEvents30d: null,
        buildMomentum: null,
        buildMomentumReason: 'not_scored',
        stillBuildingState: 'NOT_MEASURED',
        stillBuildingWithheld: 'activity_unknown',
      });
      data.latestMeaningfulChange = null as unknown as Record<string, unknown>;
      data.latestMeaningfulChangeReason = 'not_in_recent_changes' as unknown as Record<
        string,
        unknown
      >;
      Object.assign(data.marketContext!, {
        valuation: null,
        valuationWithheld: 'valuation_over_liquidity',
        liquidityUsd: null,
        volume24hUsd: null,
        tokenMarketStatus: null,
      });
    });
    const r = await researchProject(ctxFor([research]), ids.tokenSlug);
    expect(r.text).toContain('HEY could not measure building; the status is not a finding');
    expect(r.text).toContain('Last meaningful ship: unknown');
    expect(r.text).toContain('Meaningful events in 30 days: not measured');
    expect(r.text).toContain('Build Momentum: not measured — not_scored');
    expect(r.text).toContain('Still Building: not measured — activity_unknown');
    expect(r.text).toContain('this is not "none"');
    expect(r.text).toContain('valuation withheld — valuation_over_liquidity');
    expect(r.text).toContain('liquidity not read; 24h volume not read; market status unknown');
    expect(r.text).not.toMatch(/: 0\b|: none\b|\$0\b/);
  });

  it('says not read when HEY sent no market context at all', async () => {
    const research = variant('research', (body) => {
      (body.data as Record<string, unknown>).marketContext = null;
    });
    const r = await researchProject(ctxFor([research]), ids.slug);
    expect(r.text).toContain('Market context: not read.');
  });

  it('renders a chain day HEY did not measure as not measured', async () => {
    const chain = variant('chain', (body) => {
      const day = (body.days as Record<string, unknown>[])[0]!;
      for (const k of [
        'dexTrades',
        'dexVolumeUsd',
        'ships',
        'buildersShipping',
        'launches',
        'transactions',
      ]) {
        delete day[k];
      }
      day.dexVolumeWithheld = 'implausible_vs_trailing_median';
    });
    const r = await chainOverview(ctxFor([chain]), 3);
    expect(r.text).toContain('ships not measured');
    expect(r.text).toContain('volume withheld — implausible_vs_trailing_median');
    expect(r.text).toContain('launches not measured');
  });
});

describe('hey_find_projects', () => {
  it('lists published projects with their slug, link and status', async () => {
    const r = await findProjects(ctxFor(['search']), ids.symbol);
    expect(r.outcome).toBe('answer');
    expect(r.text).toContain(
      `slug ${ids.tokenSlug} · https://heyresearch.xyz/project/${ids.tokenSlug}`,
    );
    expect(r.text).toContain('Shipping · Verified Builder');
    expect(r.text).toContain('A ticker is not identity');
    expect(r.text).toContain('Read at: 2026-10-13T00:00:00Z');
  });

  it('reports an empty search as a reading of one index', async () => {
    const r = await findProjects(ctxFor(['search-empty']), 'zzqx-no-such-name');
    expect(r.outcome).toBe('not_found');
    expect(r.text).toContain(`HEY's search index returned no match for "zzqx-no-such-name"`);
  });
});

describe('hey_recent_changes', () => {
  it('gives the true total, the building count and each event with its evidence', async () => {
    const r = await recentChanges(ctxFor(['changes']), { days: '7', limit: '5' });
    const d = (loadFixture('changes').response.body as { data: { total: number } }).data;
    expect(r.outcome).toBe('answer');
    expect(r.text).toContain(`Total in the window: ${d.total}; 292 count as building; showing 5.`);
    expect(r.text).toContain('counts as building');
    expect(r.text).toMatch(/evidence ship:[0-9a-f-]{36}/);
    expect(r.text).toContain('never a cause and never a price signal');
    expect(r.text).toContain('earlier ones are absent, not zero');
  });

  it('narrows to one project and building only', async () => {
    const calls: Call[] = [];
    const r = await recentChanges(ctxFor(['changes-project'], calls), {
      project: ids.slug,
      days: 30,
      limit: 5,
      buildingOnly: 'true',
    });
    expect(calls[0]?.url.searchParams.get('building')).toBe('only');
    expect(r.projectUrl).toBe(`https://heyresearch.xyz/project/${ids.slug}`);
    expect(r.text.split('\n').at(-1)).toBe(
      `${ATTRIBUTION} · https://heyresearch.xyz/project/${ids.slug}`,
    );
  });

  it('refuses an out-of-range window without a request', async () => {
    const r = await recentChanges(ctxFor([]), { days: '90' });
    expect(r.ok).toBe(false);
    expect(r.text).toContain('days must be a whole number from 1 to 30');
  });
});

describe('hey_project_timeline', () => {
  it('lists ships with verification, building and source', async () => {
    const r = await projectTimeline(ctxFor(['timeline']), ids.slug, '5');
    expect(r.outcome).toBe('answer');
    expect(r.text).toContain('code: Code changes, week of 2026-09-28');
    expect(r.text).toContain('verification SOURCE_LINKED');
    expect(r.text).toContain('counts as building');
    expect(r.text).toContain('code read: SUBSTANTIVE');
    expect(r.text).toContain('self-reported entry stays distinct from a verified one');
  });

  it('answers an unpublished slug as not found', async () => {
    const r = await projectTimeline(
      ctxFor(['timeline-not-found']),
      'hey-virtuals-no-such-project',
      5,
    );
    expect(r.ok).toBe(true);
    expect(r.outcome).toBe('not_found');
    expect(r.text).toContain(
      'HEY holds no published project with the slug "hey-virtuals-no-such-project"',
    );
  });
});

describe('hey_chain_overview', () => {
  it('leads with building counts and labels DEX figures as market context', async () => {
    const r = await chainOverview(ctxFor(['chain']), '3');
    expect(r.outcome).toBe('answer');
    expect(r.text).toContain('Robinhood Chain (4663) day by day from HEY, 3 days');
    expect(r.text).toContain('2026-10-11: building — ships 60, builders shipping 51');
    expect(r.text).toContain('DEX (market context)');
    expect(r.text.split('\n').at(-1)).toBe(
      `${ATTRIBUTION} · https://heyresearch.xyz/api/chain?days=3`,
    );
  });
});

describe('API errors pass through as clear messages', () => {
  it('keeps the rate limit code, delay and request id', async () => {
    const r = await researchProject(ctxFor(['synthetic/rate-limited']), 'agentos');
    expect(r.ok).toBe(false);
    expect(r.outcome).toBe('error');
    expect(r.error).toMatchObject({
      code: 'rate_limited',
      status: 429,
      retryAfterSeconds: 12,
      retryable: true,
    });
    expect(r.text).toContain('HEY could not answer: rate_limited (HTTP 429)');
    expect(r.text).toContain('Retry after 12 seconds.');
    expect(r.text).toContain('Request id: 00000000-0000-4000-8000-000000000429.');
  });

  it('reports a HEY 5xx with its request id', async () => {
    const r = await chainOverview(ctxFor(['synthetic/internal-error']));
    expect(r.ok).toBe(false);
    expect(r.error?.status).toBe(500);
    expect(r.text).toContain('Request id: 00000000-0000-4000-8000-000000000500.');
  });

  it('reports a network failure without throwing', async () => {
    const r = await chainOverview({
      hey: new (await import('@hey-research-lab/sdk')).HeyClient({
        fetchImpl: async () => {
          throw new TypeError('fetch failed');
        },
      }),
    });
    expect(r.ok).toBe(false);
    expect(r.error?.code).toBe('network');
  });
});
