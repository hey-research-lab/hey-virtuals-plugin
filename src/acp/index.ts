/**
 * `@hey-research-lab/virtuals-plugin/acp`: HEY as an Agent Commerce Protocol provider (seller)
 * offering one service, "HEY builder research on a Robinhood Chain project/contract".
 *
 * A scaffold the founder switches on: nothing here connects, registers or signs until
 * `startHeyAcpSeller` runs with a complete configuration and `HEY_ACP_ENABLE=1`.
 */
import { createHeyClient, type HeyPluginOptions } from '../client.js';
import { researchProject } from '../reads.js';
import {
  AcpConfigError,
  describeAcpConfig,
  loadHeyAcpConfig,
  type AcpEnv,
  type HeyAcpConfig,
} from './config.js';
import { loadAcpRuntime, type AcpAgentLike, type AcpRuntime } from './runtime.js';
import { createHeyAcpEntryHandler } from './service.js';

export {
  ACP_SETTLEMENT_CHAINS,
  AcpConfigError,
  DEFAULT_OFFERING_NAME,
  DEFAULT_PRICE_USDC,
  MAX_PRICE_USDC,
  Secret,
  describeAcpConfig,
  loadHeyAcpConfig,
  type AcpEnv,
  type AcpSettlementChainId,
  type HeyAcpConfig,
} from './config.js';
export {
  AcpSdkMissingError,
  loadAcpRuntime,
  type AcpAgentLike,
  type AcpRuntime,
  type CreateAcpAgentInput,
} from './runtime.js';
export {
  DELIVERABLE_SCHEMA,
  HEY_ACP_OFFERING,
  buildDeliverable,
  createHeyAcpEntryHandler,
  parseRequirement,
  type AcpSessionLike,
  type HeyAcpHandlerDeps,
  type ParsedRequirement,
} from './service.js';

export type StartHeyAcpSellerOptions = HeyPluginOptions & {
  /** A checked configuration; read from `env` (default `process.env`) when absent. */
  config?: HeyAcpConfig;
  env?: AcpEnv;
  /** The ACP SDK seam; `loadAcpRuntime()` by default. Tests pass a stub. */
  runtime?: AcpRuntime;
  /** Where progress lines go; never receives a secret. `console.log` by default. */
  log?: (message: string) => void;
  now?: () => Date;
};

export type HeyAcpSeller = {
  agent: AcpAgentLike;
  config: HeyAcpConfig;
  stop(): Promise<void>;
};

/**
 * Builds the agent wallet adapter, registers the HEY entry handler and starts listening for jobs.
 * Refuses, before loading the ACP SDK, when the configuration is incomplete or not enabled.
 */
export async function startHeyAcpSeller(
  options: StartHeyAcpSellerOptions = {},
): Promise<HeyAcpSeller> {
  const config = options.config ?? loadHeyAcpConfig(options.env ?? process.env);
  const log = options.log ?? ((message: string) => console.log(`[hey-acp] ${message}`));
  if (!config.enabled) {
    throw new AcpConfigError(
      [],
      ['HEY_ACP_ENABLE (set it to "1" once the agent is registered and the price is decided)'],
    );
  }
  const runtime = options.runtime ?? (await loadAcpRuntime());
  const hey = createHeyClient(options);
  log(`starting: ${describeAcpConfig(config)}`);
  const agent = await runtime.createAgent({
    walletAddress: config.walletAddress,
    walletId: config.walletId,
    signer: config.signer,
    chainId: config.settlementChainId,
    ...(config.builderCode ? { builderCode: config.builderCode } : {}),
  });
  agent.on(
    'entry',
    createHeyAcpEntryHandler({
      offeringName: config.offeringName,
      priceUsdc: config.priceUsdc,
      usdc: (amount, chainId) => runtime.usdc(amount, chainId),
      research: (query) =>
        researchProject({ hey, ...(options.now ? { now: options.now } : {}) }, query),
      log,
      ...(options.now ? { now: options.now } : {}),
    }),
  );
  await agent.start(() => log('connected; listening for jobs'));
  return { agent, config, stop: () => agent.stop() };
}
