import type { AcpAgent, JobSession } from '@virtuals-protocol/acp-node-v2';
import { describe, expect, it, vi } from 'vitest';

import {
  Secret,
  loadAcpRuntime,
  type AcpAgentLike,
  type AcpSessionLike,
} from '../src/acp/index.js';

// The ACP SDK is replaced entirely: no wallet adapter, no socket, no request.
const sdk = vi.hoisted(() => ({
  providerCreate: vi.fn(async (params: Record<string, unknown>) => ({ kind: 'provider', params })),
  agentCreate: vi.fn(async (input: Record<string, unknown>) => ({
    input,
    on: vi.fn(),
    start: vi.fn(async () => {}),
    stop: vi.fn(async () => {}),
    getAddress: vi.fn(async () => '0x00000000000000000000000000000000000000a1'),
  })),
  usdc: vi.fn((amount: number, chainId: number) => ({ amount, chainId })),
}));
vi.mock('@virtuals-protocol/acp-node-v2', () => ({
  PrivyAlchemyEvmProviderAdapter: { create: sdk.providerCreate },
  AcpAgent: { create: sdk.agentCreate },
  AssetToken: { usdc: sdk.usdc },
  getEvmChainByChainId: (id: number) =>
    id === 4663
      ? { id: 4663, name: 'Robinhood Chain' }
      : id === 8453
        ? { id: 8453, name: 'Base' }
        : null,
}));

describe('loadAcpRuntime (ACP SDK mocked)', () => {
  it('builds a Privy agent wallet on the one settlement chain and an AcpAgent from it', async () => {
    const runtime = await loadAcpRuntime();
    const signer = new Secret('FAKEsignerkeyfortestsFAKEsignerkeyfortestsFAKE');
    await runtime.createAgent({
      walletAddress: '0x00000000000000000000000000000000000000a1',
      walletId: 'wallet-id-for-tests',
      signer,
      chainId: 4663,
    });
    expect(sdk.providerCreate).toHaveBeenCalledWith({
      walletAddress: '0x00000000000000000000000000000000000000a1',
      walletId: 'wallet-id-for-tests',
      signerPrivateKey: signer.reveal(),
      chains: [{ id: 4663, name: 'Robinhood Chain' }],
    });
    expect(sdk.agentCreate).toHaveBeenCalledWith({
      evmProvider: { kind: 'provider', params: expect.any(Object) },
    });
    expect(runtime.usdc(0, 8453)).toEqual({ amount: 0, chainId: 8453 });
  });

  it('refuses a chain the SDK does not know', async () => {
    const runtime = await loadAcpRuntime();
    await expect(
      runtime.createAgent({
        walletAddress: '0x00000000000000000000000000000000000000a1',
        walletId: 'w',
        signer: new Secret('x'),
        chainId: 1 as 4663,
      }),
    ).rejects.toThrow(/settlement chain 1/);
  });
});

describe('the seams match the ACP v2 SDK types', () => {
  it('compiles: JobSession is an AcpSessionLike and AcpAgent is an AcpAgentLike', () => {
    // Type-level: `pnpm typecheck` fails if the SDK's shapes drift from the seams.
    const asSession = (s: JobSession): AcpSessionLike => s;
    const asAgent = (a: AcpAgent): AcpAgentLike => a;
    expect(typeof asSession).toBe('function');
    expect(typeof asAgent).toBe('function');
  });
});
