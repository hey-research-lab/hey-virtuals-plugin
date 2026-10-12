# Contributing

Thank you for helping. This plugin is a thin, read-only bridge from Virtuals Protocol agents to HEY
Research Lab's public API; changes that keep it that way are welcome.

## Setup

```sh
corepack enable
pnpm install
pnpm scan          # leak and attribution scan (scripts/scan.mjs)
pnpm lint
pnpm typecheck
pnpm test          # offline: fixtures only, the network is blocked, the ACP SDK is stubbed
pnpm build
```

Node.js 22+, pnpm 9.15.1.

## Rules

- **One function, one SDK read.** Only `@hey-research-lab/sdk` reads public routes; never an
  account, write or partner route, and never `POST /api/scan`. Research by contract or ticker
  resolves first (`token.lookup` or `search.suggest`), then reads the agent contract. No retries.
- **Keep HEY's semantics.** Print HEY's state values verbatim; an absent or null value prints as
  "unknown", "not measured — reason", "withheld — reason" or "not read", never `0`, `false`, a blank
  or "none". Market figures are labelled context. Every answer ends with
  `Source: HEY Research Lab — heyresearch.xyz` and the HEY link, and carries its as-of time.
- **Robinhood Chain only** (4663 / `eip155:4663`); anything else is `unsupported_chain`.
- **Wording:** no investment advice, no safety verdicts, no trading language, no "users" for
  addresses, no Robinhood affiliation. The forbidden-word test scans every output.
- **ACP:** nothing may connect, register or sign by default. Tests never load the real ACP SDK
  client or a wallet; they stub `AcpRuntime` or mock the module.
- **Tests:** `test/fixtures/live/` holds answers recorded from the live API through the SDK itself;
  `test/fixtures/synthetic/` holds hand-written answers for paths the live API cannot be asked for
  politely (rate limits, 5xx, an ambiguous name).
- **No secrets** in code, fixtures, commits or logs; no `.env` with values.
- Conventional commit messages (`feat:`, `fix:`, `test:`, `docs:`, `chore:`, `ci:`).

## Re-recording fixtures (maintainers)

```sh
pnpm build >/dev/null; HEY_LIVE=1 node scripts/record-fixtures.mjs
```

About fourteen read-only GETs on public routes through the SDK, at most one per second, no API key.
Never run it in CI. Review the diff before committing and run `pnpm scan`. Replace personal account
handles with neutral placeholders (`builder-one`) and keep the structure exactly as recorded; the
2026-10-12 recording replaced one GitHub account handle in `changes.json` this way.

## Parity

`src/chain.ts` and `src/evm.ts` are the HEY Research Lab ecosystem's shared chain and address
modules. The reads, state vocabularies and agent-contract shapes were checked against
`@hey-research-lab/sdk` 0.2.0 and HEY's public contract (https://heyresearch.xyz/openapi.json,
https://heyresearch.xyz/api/agent) on 2026-10-13. The GAME side compiles against
`@virtuals-protocol/game` 0.1.14 and the ACP side against `@virtuals-protocol/acp-node-v2` 0.1.15.
