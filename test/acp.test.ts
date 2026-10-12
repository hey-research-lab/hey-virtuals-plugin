import { inspect } from 'node:util';

import type { AssetToken, JobRoomEntry } from '@virtuals-protocol/acp-node-v2';
import { describe, expect, it, vi } from 'vitest';

import {
  AcpConfigError,
  DELIVERABLE_SCHEMA,
  HEY_ACP_OFFERING,
  createHeyAcpEntryHandler,
  loadHeyAcpConfig,
  parseRequirement,
  startHeyAcpSeller,
  type AcpAgentLike,
  type AcpRuntime,
  type AcpSessionLike,
  type CreateAcpAgentInput,
} from '../src/acp/index.js';
import type { HeyResult } from '../src/result.js';
import { NOW, forbiddenIn, liveIndex, routeFetch } from './helpers.js';

// Obviously fake values in the shapes the loader checks; nothing here is or resembles a real key.
const FAKE_SIGNER = `FAKE${'signerkeyfortests'.repeat(4)}`;
const FAKE_WALLET = '0x00000000000000000000000000000000000000a1';
const ENV = {
  HEY_ACP_ENABLE: '1',
  HEY_ACP_WALLET_ADDRESS: FAKE_WALLET,
  HEY_ACP_WALLET_ID: 'wallet-id-for-tests',
  HEY_ACP_SIGNER_PRIVATE_KEY: FAKE_SIGNER,
  HEY_ACP_CHAIN_ID: '4663',
};
const ids = liveIndex();

describe('loadHeyAcpConfig', () => {
  it('names every missing variable and starts nothing', () => {
    let error: unknown;
    try {
      loadHeyAcpConfig({});
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(AcpConfigError);
    const e = error as AcpConfigError;
    expect(e.code).toBe('acp_not_configured');
    expect(e.missing).toEqual([
      'HEY_ACP_WALLET_ADDRESS',
      'HEY_ACP_WALLET_ID',
      'HEY_ACP_SIGNER_PRIVATE_KEY',
      'HEY_ACP_CHAIN_ID',
    ]);
    expect(e.message).toContain('Register the agent on app.virtuals.io first');
    expect(e.message).toContain('Nothing was started or signed.');
  });

  it('defaults the price to 0 USDC and the offering name, and never prints the signer', () => {
    const config = loadHeyAcpConfig(ENV);
    expect(config.priceUsdc).toBe(0);
    expect(config.offeringName).toBe(HEY_ACP_OFFERING.name);
    expect(config.settlementChainId).toBe(4663);
    expect(config.enabled).toBe(true);
    expect(JSON.stringify(config)).not.toContain(FAKE_SIGNER);
    expect(inspect(config, { depth: 5 })).not.toContain(FAKE_SIGNER);
    expect(String(config.signer)).toBe('[redacted]');
    expect(config.signer.reveal()).toBe(FAKE_SIGNER);
  });

  it('refuses an EOA private key, a bad chain and a bad price without echoing values', () => {
    const eoa = 'ab'.repeat(32);
    let error: AcpConfigError | undefined;
    try {
      loadHeyAcpConfig({
        ...ENV,
        HEY_ACP_SIGNER_PRIVATE_KEY: eoa,
        HEY_ACP_CHAIN_ID: '1',
        HEY_ACP_PRICE_USDC: '-1',
      });
    } catch (e) {
      error = e as AcpConfigError;
    }
    expect(error?.invalid.join(' ')).toContain('looks like an EOA private key');
    expect(error?.invalid.join(' ')).toContain('8453 for Base or 4663 for Robinhood Chain');
    expect(error?.invalid.join(' ')).toContain('HEY_ACP_PRICE_USDC');
    expect(error?.message).not.toContain(eoa);
  });

  it('is not enabled unless HEY_ACP_ENABLE is exactly 1', () => {
    expect(loadHeyAcpConfig({ ...ENV, HEY_ACP_ENABLE: 'true' }).enabled).toBe(false);
    expect(loadHeyAcpConfig({ ...ENV, HEY_ACP_ENABLE: undefined }).enabled).toBe(false);
  });
});

describe('parseRequirement', () => {
  it('reads the offering schema shape and a bare string', () => {
    expect(parseRequirement('{"query":"agentos","chainId":4663}')).toEqual({
      ok: true,
      query: 'agentos',
    });
    expect(parseRequirement('$AGENTOS')).toEqual({ ok: true, query: '$AGENTOS' });
    expect(parseRequirement('"agentos"')).toEqual({ ok: true, query: 'agentos' });
  });

  it('refuses another chain with unsupported_chain', () => {
    const r = parseRequirement('{"query":"agentos","chainId":8453}');
    expect(r).toMatchObject({ ok: false, code: 'unsupported_chain' });
  });

  it('refuses a missing query and an oversized body, and ignores prototype keys', () => {
    expect(parseRequirement('{"q":"x"}')).toMatchObject({ ok: false, code: 'invalid_requirement' });
    expect(parseRequirement('x'.repeat(5000))).toMatchObject({
      ok: false,
      code: 'invalid_requirement',
    });
    const r = parseRequirement('{"__proto__":{"query":"polluted"},"query":"agentos"}');
    expect(r).toEqual({ ok: true, query: 'agentos' });
    expect(({} as Record<string, unknown>).query).toBeUndefined();
  });
});

type Stub = AcpSessionLike & {
  calls: { setBudget: unknown[]; submit: string[]; reject: string[]; sendMessage: string[] };
};

function session(status: string, description: string | null, entries: JobRoomEntry[] = []): Stub {
  const calls = {
    setBudget: [] as unknown[],
    submit: [] as string[],
    reject: [] as string[],
    sendMessage: [] as string[],
  };
  return {
    jobId: '42',
    chainId: 4663,
    status,
    job: description === null ? null : { description },
    entries,
    calls,
    setBudget: async (amount) => {
      calls.setBudget.push(amount);
    },
    submit: async (d) => {
      calls.submit.push(d);
    },
    reject: async (r) => {
      calls.reject.push(r);
    },
    sendMessage: async (m) => {
      calls.sendMessage.push(m);
    },
  };
}

const requirement = (content: string): JobRoomEntry => ({
  kind: 'message',
  onChainJobId: '42',
  chainId: 4663,
  from: '0x00000000000000000000000000000000000000b2',
  contentType: 'requirement',
  content,
  timestamp: 1,
});
const system = (type: 'job.funded' | 'job.completed'): JobRoomEntry =>
  type === 'job.funded'
    ? {
        kind: 'system',
        onChainJobId: '42',
        chainId: 4663,
        timestamp: 2,
        event: { type, jobId: '42', client: '0xb2', amount: 0 },
      }
    : {
        kind: 'system',
        onChainJobId: '42',
        chainId: 4663,
        timestamp: 3,
        event: { type, jobId: '42', evaluator: '0xb2', reason: 'ok' },
      };

const answer: HeyResult = {
  ok: true,
  outcome: 'answer',
  text: 'HEY research: AgentOS on Robinhood Chain\nSource: HEY Research Lab — heyresearch.xyz · https://heyresearch.xyz/project/agentos',
  projectUrl: 'https://heyresearch.xyz/project/agentos',
  asOf: '2026-10-12T19:51:44.000Z',
  citation: null,
};
const fakeUsdc = (amount: number, chainId: number) =>
  ({ amount, chainId, symbol: 'USDC' }) as unknown as AssetToken;

function handler(research: (q: string) => Promise<HeyResult>, logs: string[] = []) {
  return createHeyAcpEntryHandler({
    offeringName: HEY_ACP_OFFERING.name,
    priceUsdc: 0,
    usdc: fakeUsdc,
    research,
    log: (m) => logs.push(m),
    now: () => NOW,
  });
}

describe('the seller’s job handler (ACP client fully stubbed)', () => {
  it('sets the configured budget once HEY holds an answer', async () => {
    const s = session('open', HEY_ACP_OFFERING.name);
    const research = vi.fn(async () => answer);
    await handler(research)(s, requirement('{"query":"agentos"}'));
    expect(research).toHaveBeenCalledWith('agentos');
    expect(s.calls.setBudget).toEqual([{ amount: 0, chainId: 4663, symbol: 'USDC' }]);
    expect(s.calls.reject).toEqual([]);
  });

  it('rejects before any budget when HEY holds no such project', async () => {
    const s = session('open', HEY_ACP_OFFERING.name);
    await handler(async () => ({
      ok: true,
      outcome: 'not_found',
      text: 'HEY has no published project…',
    }))(s, requirement('{"query":"0x0000000000000000000000000000000000000001"}'));
    expect(s.calls.setBudget).toEqual([]);
    expect(s.calls.reject).toEqual(['not_found']);
    expect(s.calls.sendMessage[0]).toContain('HEY has no published project');
  });

  it('rejects another offering and another chain', async () => {
    const other = session('open', 'something_else');
    await handler(async () => answer)(other, requirement('{"query":"agentos"}'));
    expect(other.calls.reject).toEqual(['unsupported_offering']);
    const chain = session('open', HEY_ACP_OFFERING.name);
    await handler(async () => answer)(chain, requirement('{"query":"agentos","chainId":1}'));
    expect(chain.calls.reject).toEqual(['unsupported_chain']);
    expect(chain.calls.sendMessage[0]).toContain('HEY supports Robinhood Chain (4663) only');
  });

  it('ignores a requirement once the job is past open (idempotent replay)', async () => {
    const s = session('budget_set', HEY_ACP_OFFERING.name);
    const research = vi.fn(async () => answer);
    await handler(research)(s, requirement('{"query":"agentos"}'));
    expect(research).not.toHaveBeenCalled();
    expect(s.calls.setBudget).toEqual([]);
  });

  it('delivers HEY’s answer as the deliverable when funded, reading the requirement from history', async () => {
    const s = session('funded', HEY_ACP_OFFERING.name, [requirement('{"query":"agentos"}')]);
    await handler(async () => answer)(s, system('job.funded'));
    expect(s.calls.submit).toHaveLength(1);
    const deliverable = JSON.parse(s.calls.submit[0]!) as Record<string, unknown>;
    expect(deliverable).toMatchObject({
      schema: DELIVERABLE_SCHEMA,
      chain: { chainId: 4663, caip2: 'eip155:4663', name: 'Robinhood Chain' },
      request: { query: 'agentos' },
      outcome: 'answer',
      project: 'https://heyresearch.xyz/project/agentos',
      asOf: '2026-10-12T19:51:44.000Z',
      deliveredAt: NOW.toISOString(),
      notAdvice: true,
      source: 'Source: HEY Research Lab — heyresearch.xyz',
    });
    expect(forbiddenIn(s.calls.submit[0]!)).toEqual([]);
  });

  it('rejects at funding, so the funds return, when HEY cannot be read', async () => {
    const s = session('funded', HEY_ACP_OFFERING.name, [requirement('agentos')]);
    await handler(async () => ({
      ok: false,
      outcome: 'error',
      text: 'HEY could not answer: unavailable (HTTP 503)',
      error: { code: 'unavailable', message: 'down', retryable: true },
    }))(s, system('job.funded'));
    expect(s.calls.submit).toEqual([]);
    expect(s.calls.reject).toEqual(['unavailable']);
  });

  it('never throws into the SDK dispatcher', async () => {
    const logs: string[] = [];
    const s = session('open', HEY_ACP_OFFERING.name);
    await expect(
      handler(async () => {
        throw new Error('boom');
      }, logs)(s, requirement('agentos')),
    ).resolves.toBeUndefined();
    expect(logs.at(-1)).toContain('failed: boom');
  });
});

function stubRuntime() {
  const handlers: ((s: AcpSessionLike, e: JobRoomEntry) => void | Promise<void>)[] = [];
  const agent: AcpAgentLike & { started: boolean } = {
    started: false,
    on: (_event, h) => {
      handlers.push(h);
      return agent;
    },
    start: async (onConnected) => {
      agent.started = true;
      onConnected?.();
    },
    stop: async () => {
      agent.started = false;
    },
    getAddress: async () => FAKE_WALLET,
  };
  const created: CreateAcpAgentInput[] = [];
  const runtime: AcpRuntime = {
    createAgent: vi.fn(async (input: CreateAcpAgentInput) => {
      created.push(input);
      return agent;
    }),
    usdc: fakeUsdc,
  };
  return { runtime, agent, handlers, created };
}

describe('startHeyAcpSeller', () => {
  it('refuses to start, load the SDK or touch a wallet unless enabled', async () => {
    const { runtime } = stubRuntime();
    await expect(
      startHeyAcpSeller({ env: { ...ENV, HEY_ACP_ENABLE: '' }, runtime }),
    ).rejects.toThrow(/HEY_ACP_ENABLE/);
    expect(runtime.createAgent).not.toHaveBeenCalled();
  });

  it('fails clearly when the founder has not configured the agent', async () => {
    const { runtime } = stubRuntime();
    await expect(startHeyAcpSeller({ env: {}, runtime })).rejects.toBeInstanceOf(AcpConfigError);
    expect(runtime.createAgent).not.toHaveBeenCalled();
  });

  it('builds the agent, registers the HEY handler and starts, logging no secret', async () => {
    const { runtime, agent, handlers, created } = stubRuntime();
    const logs: string[] = [];
    const seller = await startHeyAcpSeller({
      env: ENV,
      runtime,
      log: (m) => logs.push(m),
      fetchImpl: routeFetch(['research-token']),
      now: () => NOW,
    });
    expect(agent.started).toBe(true);
    expect(handlers).toHaveLength(1);
    expect(created[0]).toMatchObject({
      walletAddress: FAKE_WALLET,
      walletId: 'wallet-id-for-tests',
      chainId: 4663,
    });
    expect(created[0]?.signer.reveal()).toBe(FAKE_SIGNER);
    expect(logs.join('\n')).toContain('0 USDC per job, settles on Robinhood Chain (4663)');
    expect(logs.join('\n')).not.toContain(FAKE_SIGNER);

    // One requirement through the registered handler, answered from a saved HEY fixture.
    const s = session('open', HEY_ACP_OFFERING.name);
    await handlers[0]!(s, requirement(JSON.stringify({ query: ids.tokenSlug })));
    expect(s.calls.setBudget).toHaveLength(1);

    await seller.stop();
    expect(agent.started).toBe(false);
  });
});
