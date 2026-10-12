import {
  ExecutableGameFunctionResponse,
  ExecutableGameFunctionStatus,
  GameFunction,
  GameWorker,
} from '@virtuals-protocol/game';

import { CAIP2, CHAIN_ID, CHAIN_NAME } from './chain.js';
import { createHeyClient, type HeyPluginOptions } from './client.js';
import {
  chainOverview,
  checkChain,
  findProjects,
  projectTimeline,
  recentChanges,
  researchProject,
  type ReadContext,
} from './reads.js';
import type { HeyResult } from './result.js';
import { ATTRIBUTION, SITE_URL } from './text.js';

export const HEY_FUNCTION_NAMES = [
  'hey_research_project',
  'hey_find_projects',
  'hey_recent_changes',
  'hey_project_timeline',
  'hey_chain_overview',
] as const;
export type HeyFunctionName = (typeof HEY_FUNCTION_NAMES)[number];

export const HEY_WORKER_ID = 'hey_research_worker';
export const HEY_WORKER_NAME = 'HEY Research — Robinhood Chain builders';
export const HEY_WORKER_DESCRIPTION =
  'Reads HEY Research Lab (heyresearch.xyz), the builder-discovery layer for Robinhood Chain (chain id 4663): ' +
  'which projects are still building, what they shipped and when, what changed on the chain, and what HEY does not know. ' +
  'Look up a project by slug, $TICKER, name or 0x contract address. Every answer is evidence with provenance ' +
  '(evidence ids, the HEY project link, the as-of time); market figures are context only. It never gives price ' +
  'advice, trading calls or a safety verdict, and it is not affiliated with Robinhood.';

const CHAIN_ARG = {
  name: 'chain_id',
  description: `Optional. Only ${CHAIN_ID} (${CHAIN_NAME}, ${CAIP2}) is supported; any other chain is refused with unsupported_chain.`,
  type: 'string',
  optional: true,
};

export type HeyFunctionOptions = HeyPluginOptions & {
  /** The clock for "read at" lines; tests pin it. */
  now?: () => Date;
};

export type HeyResearchWorkerOptions = HeyFunctionOptions & {
  /** Defaults to `hey_research_worker`. */
  id?: string;
  name?: string;
  description?: string;
  /** Replace the default environment the worker reports to GAME. */
  getEnvironment?: () => Promise<Record<string, unknown>>;
};

/** HEY's answer as GAME's response: Done for an answer (including "HEY holds no such project"), Failed otherwise. */
export function toGameResponse(result: HeyResult): ExecutableGameFunctionResponse {
  return new ExecutableGameFunctionResponse(
    result.ok ? ExecutableGameFunctionStatus.Done : ExecutableGameFunctionStatus.Failed,
    result.text,
  );
}

async function run(
  name: HeyFunctionName,
  chainArg: string | undefined,
  logger: (msg: string) => void,
  read: () => Promise<HeyResult>,
): Promise<ExecutableGameFunctionResponse> {
  const refused = checkChain(chainArg);
  if (refused) return toGameResponse(refused);
  logger(`${name}: reading HEY Research Lab`);
  const result = await read();
  logger(`${name}: ${result.outcome}`);
  return toGameResponse(result);
}

/**
 * The five HEY functions, each one SDK read. Compose them into your own worker, or use
 * `heyResearchWorker` for a ready one.
 */
export function heyResearchFunctions(options: HeyFunctionOptions = {}) {
  const ctx: ReadContext = {
    hey: createHeyClient(options),
    ...(options.now ? { now: options.now } : {}),
  };

  const research = new GameFunction({
    name: 'hey_research_project',
    description:
      'Research one Robinhood Chain project from HEY Research Lab by its HEY slug, $TICKER, name or 0x contract address: ' +
      'is it still building (activity status), what did it ship and when was its last meaningful ship, Build Momentum, ' +
      'Still Building, whether the token contract is verified as the project’s, and what HEY does not know. ' +
      'Returns evidence with provenance (evidence ids, project link, as-of time). Not price advice, not a safety verdict.',
    hint: 'Use a 0x contract address when you have one: a ticker is not identity.',
    args: [
      {
        name: 'query',
        description:
          'A HEY project slug (e.g. agentos), a $TICKER, a project name, or a 0x token/contract address on Robinhood Chain.',
        type: 'string',
      },
      CHAIN_ARG,
    ],
    executable: async (args, logger) =>
      run('hey_research_project', args.chain_id, logger, () => researchProject(ctx, args.query)),
  });

  const find = new GameFunction({
    name: 'hey_find_projects',
    description:
      'Find Robinhood Chain projects in HEY Research Lab’s index by name, ticker or 0x contract address. Lists ' +
      'published projects with their activity status, slug and HEY link, and labels launch records HEY has not ' +
      'researched and issuer stock tokens, which are never projects. Use it to get the right slug before researching.',
    args: [
      {
        name: 'query',
        description:
          'A name, ticker (with or without $) or 0x contract address, 2 to 64 characters.',
        type: 'string',
      },
      CHAIN_ARG,
    ],
    executable: async (args, logger) =>
      run('hey_find_projects', args.chain_id, logger, () => findProjects(ctx, args.query)),
  });

  const changes = new GameFunction({
    name: 'hey_recent_changes',
    description:
      'What changed recently on Robinhood Chain, or for one project, from HEY Research Lab’s change ledger: releases, ' +
      'ships, weeks of code activity, contract deployments and upgrades, activity-status moves. Gives the true total in ' +
      'the window, how many count as building, and each event with its own date, precision and evidence id. ' +
      'Not market news, never a cause and never a price signal.',
    args: [
      {
        name: 'project',
        description: 'Optional HEY project slug; omit for the whole chain.',
        type: 'string',
        optional: true,
      },
      {
        name: 'days',
        description: 'Window in days, 1 to 30; default 7.',
        type: 'number',
        optional: true,
      },
      {
        name: 'building_only',
        description:
          '"true" to keep only events that count as building (leaves out market readings).',
        type: 'boolean',
        optional: true,
      },
      {
        name: 'limit',
        description:
          'Events to list, 1 to 50; default 10. The total always covers the whole window.',
        type: 'number',
        optional: true,
      },
      CHAIN_ARG,
    ],
    executable: async (args, logger) =>
      run('hey_recent_changes', args.chain_id, logger, () =>
        recentChanges(ctx, {
          project: args.project,
          days: args.days,
          limit: args.limit,
          buildingOnly: args.building_only,
        }),
      ),
  });

  const timeline = new GameFunction({
    name: 'hey_project_timeline',
    description:
      'A Robinhood Chain project’s recent ships and timeline from HEY Research Lab, newest first: what it shipped ' +
      '(releases, code weeks, deployments), when and at which precision, the verification state (self-reported stays ' +
      'distinct from verified), whether each counts as building, and its source. Takes the HEY project slug.',
    args: [
      {
        name: 'project',
        description: 'The HEY project slug (find it with hey_find_projects).',
        type: 'string',
      },
      {
        name: 'limit',
        description: 'Entries to list, 1 to 50; default 10.',
        type: 'number',
        optional: true,
      },
      CHAIN_ARG,
    ],
    executable: async (args, logger) =>
      run('hey_project_timeline', args.chain_id, logger, () =>
        projectTimeline(ctx, args.project, args.limit),
      ),
  });

  const overview = new GameFunction({
    name: 'hey_chain_overview',
    description:
      'Robinhood Chain day by day from HEY Research Lab: ships, builders shipping, projects published and Verified ' +
      'Builders recorded, plus transactions, token launches and DEX trades and volume (DEX figures are market context ' +
      'only). A day or figure HEY did not measure says "not measured", never 0.',
    args: [
      {
        name: 'days',
        description: 'Days to list, 1 to 30; default 7.',
        type: 'number',
        optional: true,
      },
      CHAIN_ARG,
    ],
    executable: async (args, logger) =>
      run('hey_chain_overview', args.chain_id, logger, () => chainOverview(ctx, args.days)),
  });

  return [research, find, changes, timeline, overview];
}

/** The environment the worker reports to GAME each step: what it covers and how to cite it. */
export async function heyEnvironment(): Promise<Record<string, unknown>> {
  return {
    chain: CHAIN_NAME,
    chainId: CHAIN_ID,
    caip2: CAIP2,
    provider: 'HEY Research Lab',
    site: SITE_URL,
    citation: ATTRIBUTION,
    boundaries:
      'Builder evidence only: market figures are context; no price advice, no safety verdict; unknown is never zero.',
  };
}

/**
 * A ready GAME worker with the five HEY functions.
 *
 * ```ts
 * const agent = new GameAgent(process.env.GAME_API_KEY!, {
 *   name: 'Robinhood Chain scout', goal: '…', description: '…',
 *   workers: [heyResearchWorker()],
 * });
 * ```
 */
export function heyResearchWorker(options: HeyResearchWorkerOptions = {}): GameWorker {
  return new GameWorker({
    id: options.id ?? HEY_WORKER_ID,
    name: options.name ?? HEY_WORKER_NAME,
    description: options.description ?? HEY_WORKER_DESCRIPTION,
    functions: heyResearchFunctions(options),
    getEnvironment: options.getEnvironment ?? heyEnvironment,
  });
}
