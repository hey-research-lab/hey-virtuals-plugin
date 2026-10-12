import { inspect } from 'node:util';

import { ADDRESS_RE } from '../evm.js';

/**
 * Settlement chains this scaffold allows. Both are mainnets the ACP v2 SDK
 * (`@virtuals-protocol/acp-node-v2` 0.1.15) lists in `EVM_MAINNET_CHAINS`, with a USDC address
 * and the ACP contract registered. Which one HEY settles on is the founder's decision; there is
 * deliberately no default.
 */
export const ACP_SETTLEMENT_CHAINS = {
  8453: 'Base',
  4663: 'Robinhood Chain',
} as const;
export type AcpSettlementChainId = keyof typeof ACP_SETTLEMENT_CHAINS;

/**
 * The default price, in USDC per job: 0, the lowest value the ACP v2 SDK and the registry accept
 * (the SDK's own seller example runs a 0 USDC offering). Pricing is the founder's decision: set
 * `HEY_ACP_PRICE_USDC` to the same value as the offering on app.virtuals.io.
 */
export const DEFAULT_PRICE_USDC = 0;
/** A typo guard, not a policy: a price above this is refused as a likely mistake. */
export const MAX_PRICE_USDC = 1000;
export const DEFAULT_OFFERING_NAME = 'hey_builder_research';

/** Holds a secret so that logging, `JSON.stringify` and `util.inspect` never print it. */
export class Secret {
  readonly #value: string;
  constructor(value: string) {
    this.#value = value;
  }
  /** The only way to read the value; called once, when the wallet adapter is built. */
  reveal(): string {
    return this.#value;
  }
  toString(): string {
    return '[redacted]';
  }
  toJSON(): string {
    return '[redacted]';
  }
  [inspect.custom](): string {
    return 'Secret([redacted])';
  }
}

export type HeyAcpConfig = {
  /** `HEY_ACP_ENABLE=1`. Without it nothing connects, registers or signs. */
  enabled: boolean;
  /** The agent wallet address shown on the agent's page on app.virtuals.io. */
  walletAddress: `0x${string}`;
  /** The agent wallet id shown on the same page. */
  walletId: string;
  /** The signer key from the agent's Signers tab (a Privy authorization key, not an EOA key). */
  signer: Secret;
  settlementChainId: AcpSettlementChainId;
  priceUsdc: number;
  offeringName: string;
  /** Optional Base builder code from the agent's Settings tab. */
  builderCode?: string;
};

export class AcpConfigError extends Error {
  readonly code = 'acp_not_configured';
  constructor(
    readonly missing: string[],
    readonly invalid: string[],
  ) {
    const parts: string[] = [];
    if (missing.length) parts.push(`missing ${missing.join(', ')}`);
    if (invalid.length) parts.push(`invalid ${invalid.join('; ')}`);
    super(
      `The HEY ACP seller is not configured: ${parts.join('; ')}. Register the agent on app.virtuals.io first, ` +
        'then set these in the environment (see the README, "ACP provider"). Nothing was started or signed.',
    );
  }
}

export type AcpEnv = Record<string, string | undefined>;

const read = (env: AcpEnv, name: string): string | undefined => {
  const value = env[name]?.trim();
  return value ? value : undefined;
};

/**
 * Reads and checks the seller's configuration from the environment. Throws one `AcpConfigError`
 * naming every missing or invalid variable, never their values.
 */
export function loadHeyAcpConfig(env: AcpEnv = process.env): HeyAcpConfig {
  const missing: string[] = [];
  const invalid: string[] = [];

  const walletAddress = read(env, 'HEY_ACP_WALLET_ADDRESS');
  if (!walletAddress) missing.push('HEY_ACP_WALLET_ADDRESS');
  else if (!ADDRESS_RE.test(walletAddress)) {
    invalid.push('HEY_ACP_WALLET_ADDRESS (a 0x address of 40 hex characters)');
  }

  const walletId = read(env, 'HEY_ACP_WALLET_ID');
  if (!walletId) missing.push('HEY_ACP_WALLET_ID');
  else if (walletId.length > 200) invalid.push('HEY_ACP_WALLET_ID (too long)');

  const signer = read(env, 'HEY_ACP_SIGNER_PRIVATE_KEY');
  if (!signer) missing.push('HEY_ACP_SIGNER_PRIVATE_KEY');
  else if (/^(0x)?[0-9a-fA-F]{64}$/.test(signer)) {
    invalid.push(
      'HEY_ACP_SIGNER_PRIVATE_KEY (this looks like an EOA private key; ACP v2 needs the signer key from the agent’s Signers tab on app.virtuals.io)',
    );
  } else if (!/^[A-Za-z0-9+/=_-]{40,4096}$/.test(signer)) {
    invalid.push('HEY_ACP_SIGNER_PRIVATE_KEY (not the base64 signer key from the Signers tab)');
  }

  const chainRaw = read(env, 'HEY_ACP_CHAIN_ID');
  let settlementChainId: AcpSettlementChainId | undefined;
  if (!chainRaw) missing.push('HEY_ACP_CHAIN_ID');
  else if (chainRaw === '8453' || chainRaw === '4663') {
    settlementChainId = Number(chainRaw) as AcpSettlementChainId;
  } else {
    invalid.push('HEY_ACP_CHAIN_ID (8453 for Base or 4663 for Robinhood Chain)');
  }

  const priceRaw = read(env, 'HEY_ACP_PRICE_USDC');
  let priceUsdc = DEFAULT_PRICE_USDC;
  if (priceRaw !== undefined) {
    const price = /^\d+(\.\d{1,6})?$/.test(priceRaw) ? Number(priceRaw) : NaN;
    if (!Number.isFinite(price) || price < 0 || price > MAX_PRICE_USDC) {
      invalid.push(
        `HEY_ACP_PRICE_USDC (a USDC amount from 0 to ${MAX_PRICE_USDC}, at most 6 decimals)`,
      );
    } else {
      priceUsdc = price;
    }
  }

  const offeringName = read(env, 'HEY_ACP_OFFERING_NAME') ?? DEFAULT_OFFERING_NAME;
  if (offeringName.length > 100) invalid.push('HEY_ACP_OFFERING_NAME (at most 100 characters)');

  const builderCode = read(env, 'HEY_ACP_BUILDER_CODE');
  if (builderCode !== undefined && !/^[A-Za-z0-9_-]{1,100}$/.test(builderCode)) {
    invalid.push('HEY_ACP_BUILDER_CODE (letters, digits, "-" and "_")');
  }

  if (
    missing.length ||
    invalid.length ||
    !walletAddress ||
    !walletId ||
    !signer ||
    !settlementChainId
  ) {
    throw new AcpConfigError(missing, invalid);
  }
  return {
    enabled: read(env, 'HEY_ACP_ENABLE') === '1',
    walletAddress: walletAddress as `0x${string}`,
    walletId,
    signer: new Secret(signer),
    settlementChainId,
    priceUsdc,
    offeringName,
    ...(builderCode ? { builderCode } : {}),
  };
}

/** A one-line, secret-free description of the configuration for logs. */
export function describeAcpConfig(config: HeyAcpConfig): string {
  return (
    `offering "${config.offeringName}", ${config.priceUsdc} USDC per job, settles on ` +
    `${ACP_SETTLEMENT_CHAINS[config.settlementChainId]} (${config.settlementChainId}), agent wallet ` +
    `${config.walletAddress.toLowerCase()}, ${config.enabled ? 'enabled' : 'not enabled (HEY_ACP_ENABLE is not "1")'}`
  );
}
