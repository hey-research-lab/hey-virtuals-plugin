import type { AssetToken, JobRoomEntry } from '@virtuals-protocol/acp-node-v2';

import { CAIP2, CHAIN_ID, CHAIN_NAME } from '../chain.js';
import type { HeyResult } from '../result.js';
import { ATTRIBUTION, clean } from '../text.js';
import { VERSION } from '../version.js';
import { DEFAULT_OFFERING_NAME } from './config.js';

/** What to enter on app.virtuals.io when adding the offering. The price is not here: it is the founder's. */
export const HEY_ACP_OFFERING = {
  name: DEFAULT_OFFERING_NAME,
  description:
    'HEY builder research on one Robinhood Chain (chain 4663) project or contract, from HEY Research Lab ' +
    '(heyresearch.xyz): is it still building, what it shipped and when, Build Momentum, Still Building, whether ' +
    'the token contract is verified as the project’s, and what HEY does not know, with evidence ids, the ' +
    'project link and the as-of time. Research evidence only: not price advice, not a trading signal, not a ' +
    'safety verdict. HEY Research Lab is not affiliated with Robinhood.',
  requirement: {
    type: 'object',
    additionalProperties: false,
    required: ['query'],
    properties: {
      query: {
        type: 'string',
        minLength: 2,
        maxLength: 200,
        description:
          'A HEY project slug, a $TICKER, a project name, or a 0x token/contract address on Robinhood Chain.',
      },
      chainId: {
        type: 'integer',
        const: CHAIN_ID,
        description: 'Optional; only 4663 (Robinhood Chain) is supported.',
      },
    },
  },
  deliverable:
    'JSON (schema "hey.virtuals-acp-deliverable/v1"): the HEY report as text, the project link, the HEY ' +
    'citation and as-of time, and the attribution line.',
  /** The registry's floor is 5 minutes (`MIN_SLA_MINS`); a HEY read takes seconds. */
  slaMinutes: 5,
} as const;

export const DELIVERABLE_SCHEMA = 'hey.virtuals-acp-deliverable/v1';
const MAX_REQUIREMENT_BYTES = 4096;

export type ParsedRequirement =
  | { ok: true; query: string }
  | { ok: false; code: 'invalid_requirement' | 'unsupported_chain'; message: string };

/**
 * A buyer's requirement: `{"query": "...", "chainId": 4663}` as the offering's schema asks, or a
 * bare string. Only `query` and `chainId` are read; anything else is ignored, never merged.
 */
export function parseRequirement(content: string): ParsedRequirement {
  if (content.length > MAX_REQUIREMENT_BYTES) {
    return {
      ok: false,
      code: 'invalid_requirement',
      message: 'The requirement is longer than 4 KB.',
    };
  }
  let parsed: unknown = content;
  try {
    parsed = JSON.parse(content);
  } catch {
    parsed = content;
  }
  let query: unknown = parsed;
  let chainId: unknown;
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const record = parsed as Record<string, unknown>;
    query = Object.hasOwn(record, 'query') ? record.query : undefined;
    chainId = Object.hasOwn(record, 'chainId') ? record.chainId : undefined;
  }
  if (chainId !== undefined && chainId !== CHAIN_ID && chainId !== CAIP2) {
    return {
      ok: false,
      code: 'unsupported_chain',
      message: `HEY supports Robinhood Chain (4663) only; chain ${clean(String(chainId), 40)} is not supported.`,
    };
  }
  if (typeof query !== 'string' || clean(query, 300).length < 2 || clean(query, 300).length > 200) {
    return {
      ok: false,
      code: 'invalid_requirement',
      message:
        'The requirement needs "query": a HEY project slug, $TICKER, name or 0x contract address on Robinhood Chain (2 to 200 characters).',
    };
  }
  return { ok: true, query: clean(query, 200) };
}

/** The deliverable the buyer receives: HEY's report, its link, citation and as-of time, and the attribution. */
export function buildDeliverable(query: string, result: HeyResult, deliveredAt: Date): string {
  return JSON.stringify({
    schema: DELIVERABLE_SCHEMA,
    provider: {
      name: 'HEY Research Lab',
      url: 'https://heyresearch.xyz',
      plugin: `hey-virtuals-plugin/${VERSION}`,
    },
    chain: { name: CHAIN_NAME, chainId: CHAIN_ID, caip2: CAIP2 },
    request: { query },
    outcome: result.outcome,
    report: result.text,
    project: result.projectUrl ?? null,
    citation: result.citation ?? null,
    asOf: result.asOf ?? null,
    deliveredAt: deliveredAt.toISOString(),
    notAdvice: true,
    source: ATTRIBUTION,
  });
}

/**
 * The part of an ACP v2 `JobSession` the seller uses. `JobSession` satisfies it (a type test holds
 * that), and tests pass a stub, so no test ever builds a real session, wallet or connection.
 */
export type AcpSessionLike = {
  readonly jobId: string;
  readonly chainId: number;
  readonly status: string;
  readonly job: { readonly description: string } | null;
  readonly entries: readonly JobRoomEntry[];
  setBudget(amount: AssetToken): Promise<void>;
  submit(deliverable: string): Promise<void>;
  reject(reason: string): Promise<void>;
  sendMessage(content: string): Promise<void>;
};

export type HeyAcpHandlerDeps = {
  offeringName: string;
  priceUsdc: number;
  /** `AssetToken.usdc` from the ACP SDK; injected so tests never load it. */
  usdc: (amount: number, chainId: number) => AssetToken;
  /** The HEY read that answers a job (the same `researchProject` the GAME worker uses). */
  research: (query: string) => Promise<HeyResult>;
  log?: (message: string) => void;
  now?: () => Date;
};

function requirementOf(session: AcpSessionLike, entry?: JobRoomEntry): string | undefined {
  if (entry?.kind === 'message' && entry.contentType === 'requirement') return entry.content;
  const first = session.entries.find(
    (e) => e.kind === 'message' && e.contentType === 'requirement',
  );
  return first?.kind === 'message' ? first.content : undefined;
}

/**
 * The seller's state machine, after the ACP v2 seller example:
 *
 *   requirement message (status open) → check offering, chain and that HEY holds an answer,
 *                                         then `setBudget` (or `reject` before anything is paid)
 *   job.funded                        → read HEY again and `submit` the deliverable
 *                                         (or `reject`, which returns the funds, if HEY is unreachable)
 *   job.completed / rejected / expired → log only
 *
 * The requirement is read back from the session's own history at `job.funded`, so a restarted
 * seller resumes a funded job without any state of its own.
 */
export function createHeyAcpEntryHandler(deps: HeyAcpHandlerDeps) {
  const log = deps.log ?? (() => {});
  const now = deps.now ?? (() => new Date());

  const refuse = async (session: AcpSessionLike, tag: string, detail: string) => {
    log(`[job ${session.jobId}] rejecting: ${tag}`);
    await session.sendMessage(detail.slice(0, 2000));
    await session.reject(tag);
  };

  return async (session: AcpSessionLike, entry: JobRoomEntry): Promise<void> => {
    try {
      if (
        entry.kind === 'message' &&
        entry.contentType === 'requirement' &&
        session.status === 'open'
      ) {
        const offering = session.job?.description;
        if (offering !== deps.offeringName) {
          await refuse(
            session,
            'unsupported_offering',
            `This provider serves the offering "${deps.offeringName}" only.`,
          );
          return;
        }
        const requirement = parseRequirement(entry.content);
        if (!requirement.ok) {
          await refuse(session, requirement.code, requirement.message);
          return;
        }
        const check = await deps.research(requirement.query);
        if (check.outcome !== 'answer') {
          // Nothing paid yet: tell the buyer what HEY holds instead of charging for "not found".
          await refuse(
            session,
            check.outcome === 'error' || check.outcome === 'invalid'
              ? (check.error?.code ?? 'hey_error')
              : check.outcome,
            check.text,
          );
          return;
        }
        await session.setBudget(deps.usdc(deps.priceUsdc, session.chainId));
        log(`[job ${session.jobId}] budget set: ${deps.priceUsdc} USDC`);
        return;
      }

      if (entry.kind !== 'system') return;
      switch (entry.event.type) {
        case 'job.funded': {
          if (session.status !== 'funded') return;
          const content = requirementOf(session);
          const requirement = content === undefined ? undefined : parseRequirement(content);
          if (!requirement?.ok) {
            await refuse(session, 'invalid_requirement', 'The requirement could not be read back.');
            return;
          }
          const result = await deps.research(requirement.query);
          if (result.outcome !== 'answer') {
            await refuse(
              session,
              result.error?.code ?? result.outcome,
              `HEY could not answer at delivery time; the job is rejected so the funds return. ${result.text}`,
            );
            return;
          }
          await session.submit(buildDeliverable(requirement.query, result, now()));
          log(`[job ${session.jobId}] delivered`);
          return;
        }
        case 'job.completed':
        case 'job.rejected':
        case 'job.expired':
          log(`[job ${session.jobId}] ${entry.event.type}`);
          return;
        default:
          return;
      }
    } catch (error) {
      // Never rethrow into the SDK's dispatcher; never print anything but the message.
      log(
        `[job ${session.jobId}] failed: ${error instanceof Error ? clean(error.message, 300) : 'unknown error'}`,
      );
    }
  };
}
