import type * as AcpSdk from '@virtuals-protocol/acp-node-v2';
import type { AssetToken, JobRoomEntry } from '@virtuals-protocol/acp-node-v2';

import type { AcpSettlementChainId, Secret } from './config.js';
import type { AcpSessionLike } from './service.js';

/** The part of an ACP v2 `AcpAgent` the seller uses; `AcpAgent` satisfies it (a type test holds that). */
export type AcpAgentLike = {
  on(
    event: 'entry',
    handler: (session: AcpSessionLike, entry: JobRoomEntry) => void | Promise<void>,
  ): unknown;
  start(onConnected?: () => void): Promise<void>;
  stop(): Promise<void>;
  getAddress(): Promise<string>;
};

export type CreateAcpAgentInput = {
  walletAddress: `0x${string}`;
  walletId: string;
  signer: Secret;
  chainId: AcpSettlementChainId;
  builderCode?: string;
};

/**
 * Everything the seller needs from the ACP SDK, behind one seam: building the agent (the only step
 * that touches the wallet) and making a USDC amount. Tests replace it entirely.
 */
export type AcpRuntime = {
  createAgent(input: CreateAcpAgentInput): Promise<AcpAgentLike>;
  usdc(amount: number, chainId: number): AssetToken;
};

export class AcpSdkMissingError extends Error {
  readonly code = 'acp_sdk_missing';
  constructor() {
    super(
      'The ACP provider needs @virtuals-protocol/acp-node-v2 (an optional peer dependency). Install it with ' +
        '`npm i @virtuals-protocol/acp-node-v2`; the GAME worker does not need it.',
    );
  }
}

/**
 * Loads `@virtuals-protocol/acp-node-v2` on first use (never at import time) and adapts it to
 * `AcpRuntime`: a Privy-managed agent wallet through `PrivyAlchemyEvmProviderAdapter`, on the one
 * settlement chain configured, and `AcpAgent.create({ evmProvider })`.
 */
export async function loadAcpRuntime(): Promise<AcpRuntime> {
  let acp: typeof AcpSdk;
  try {
    acp = await import('@virtuals-protocol/acp-node-v2');
  } catch {
    throw new AcpSdkMissingError();
  }
  return {
    async createAgent(input) {
      const chain = acp.getEvmChainByChainId(input.chainId);
      if (!chain) {
        throw new Error(`The ACP SDK does not know settlement chain ${input.chainId}.`);
      }
      const evmProvider = await acp.PrivyAlchemyEvmProviderAdapter.create({
        walletAddress: input.walletAddress,
        walletId: input.walletId,
        signerPrivateKey: input.signer.reveal(),
        chains: [chain],
        ...(input.builderCode ? { builderCode: input.builderCode } : {}),
      });
      const agent: AcpAgentLike = await acp.AcpAgent.create({ evmProvider });
      return agent;
    },
    usdc: (amount, chainId) => acp.AssetToken.usdc(amount, chainId),
  };
}
