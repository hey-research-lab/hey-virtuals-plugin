# hey-virtuals-plugin

A Virtuals Protocol GAME worker, plus an Agent Commerce Protocol provider scaffold, that lets an
agent ask HEY Research Lab which Robinhood Chain projects are still building, what they shipped and
what HEY does not know.

[![CI](https://github.com/hey-research-lab/hey-virtuals-plugin/actions/workflows/ci.yml/badge.svg)](https://github.com/hey-research-lab/hey-virtuals-plugin/actions/workflows/ci.yml)
[![License: MIT](assets/badges/license-mit.svg)](LICENSE)
[![Node >= 22](assets/badges/node-22.svg)](package.json)
[![Robinhood Chain 4663](assets/badges/robinhood-chain-4663.svg)](https://heyresearch.xyz)

## Why it exists

Many agents on Robinhood Chain run on Virtuals: in HEY's own catalogue, 668 of the 971 "AI Agents"
projects were launched through Virtuals. Those agents are asked about projects, tickers and
contracts every day. This package gives them HEY's answer — activity status, the last meaningful
ship, the change ledger and the gaps, each with its evidence and source — without having to find
HEY first. It reads only HEY's public API, through the published
[`@hey-research-lab/sdk`](https://www.npmjs.com/package/@hey-research-lab/sdk).

## Why Robinhood Chain only

HEY researches one chain: Robinhood Chain, chain id `4663` (`eip155:4663`). Every function takes
an optional `chain_id` that accepts `4663` or `eip155:4663` only; anything else is refused with
`unsupported_chain` ("HEY supports Robinhood Chain (4663) only; chain X is not supported.") before
any request. The ACP provider applies the same rule to a buyer's requirement. (Which chain an ACP
job _settles_ on is a separate choice; see below.)

## Install

```sh
npm install @hey-research-lab/virtuals-plugin @virtuals-protocol/game
# only for the ACP provider:
npm install @virtuals-protocol/acp-node-v2
```

Node.js 22 or later. No HEY API key is needed; `HEY_API_KEY` (from heyresearch.xyz/account) only
lifts the anonymous rate limit.

## Smallest working example

```ts
import { GameAgent } from '@virtuals-protocol/game';
import { heyResearchWorker } from '@hey-research-lab/virtuals-plugin';

const agent = new GameAgent(process.env.GAME_API_KEY!, {
  name: 'Robinhood Chain builder scout',
  goal: 'Report which Robinhood Chain projects are still building, citing HEY.',
  description: 'Reports building evidence with its source and as-of time; unknown stays unknown.',
  workers: [heyResearchWorker()], // or heyResearchWorker({ apiKey, baseUrl })
});
await agent.init();
await agent.run(60, { verbose: true });
```

To call one function without an agent (offline-friendly for your own tests, with an injected
`fetchImpl`):

```ts
import { heyResearchFunctions } from '@hey-research-lab/virtuals-plugin';
const [research] = heyResearchFunctions();
const res = await research.executable({ query: '$AGENTOS' }, console.log);
console.log(res.status, res.feedback); // "done", HEY's answer as text
```

A runnable script is in [`examples/game-agent.ts`](examples/game-agent.ts).

## Functions

| Name                   | What it answers                                                                                                                                                                                                                           | SDK read                                                                                               |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `hey_research_project` | One project by HEY slug, `$TICKER`, name or 0x contract: activity status, last meaningful ship, meaningful events in 30 days, Build Momentum, Still Building, token contract and its verification, market context, unknowns, evidence ids | `agent.answer('research_project')`, after `token.lookup` (contract) or `search.suggest` (ticker, name) |
| `hey_find_projects`    | Projects in HEY's index by name, ticker or contract, each labelled: published project (slug, status, link), launch record (not researched), issuer stock token (never a project)                                                          | `search.suggest`                                                                                       |
| `hey_recent_changes`   | What changed on the chain or for one project in 1–30 days: the true total, how many count as building, each event with its date, precision and evidence id                                                                                | `agent.answer('what_changed')`                                                                         |
| `hey_project_timeline` | One project's ships and timeline: date and precision, verification state, whether it counts as building, source                                                                                                                           | `projects.timeline`                                                                                    |
| `hey_chain_overview`   | Robinhood Chain day by day: ships, builders shipping, projects published, then transactions, launches and DEX figures (market context)                                                                                                    | `chain`                                                                                                |

Each returns an `ExecutableGameFunctionResponse`:

- **Done** with HEY's answer as text — including "HEY holds no published project for …" and a
  list of candidates for an ambiguous name, which are answers, not failures.
- **Failed** for an unsupported chain, a malformed argument, or a read HEY refused or could not
  serve, with HEY's own error code and sentence, the retry delay and the request id
  (`HEY could not answer: rate_limited (HTTP 429) — … Retry after 12 seconds. Request id: …`).

Every answer keeps HEY's semantics: an unknown value reads "unknown", "not measured — reason",
"withheld — reason" or "not read", never 0 or "none"; market figures are labelled context and
never a builder signal; a ticker is not identity (a ticker that several records share is called
out, and a name that matches several projects is listed, not guessed). Every answer ends with:

```
Source: HEY Research Lab — heyresearch.xyz · https://heyresearch.xyz/project/<slug>
```

`heyResearchWorker(options)` takes `apiKey`, `baseUrl` (tests and local mocks only: `https:` or
`http://localhost`; the environment's `HEY_API_KEY` goes to heyresearch.xyz only, so a custom `baseUrl`
needs an explicit `apiKey`), `fetchImpl`, `timeoutMs`, `client`, and `id` / `name` / `description` /
`getEnvironment` overrides. `heyResearchFunctions(options)` returns the five `GameFunction`s for
your own worker. The framework-neutral reads (`researchProject`, `findProjects`, `recentChanges`,
`projectTimeline`, `chainOverview`) are exported too.

## ACP provider (seller) scaffold

`@hey-research-lab/virtuals-plugin/acp` lets HEY act as an
[Agent Commerce Protocol](https://app.virtuals.io/research/agent-commerce-protocol) provider with
one offering: **"HEY builder research on a Robinhood Chain project/contract"**. A buyer sends
`{"query": "<slug | $TICKER | name | 0x contract>", "chainId": 4663}`; the seller checks HEY holds
an answer, proposes the budget, and when the job is funded reads HEY again and submits the
deliverable: JSON (`hey.virtuals-acp-deliverable/v1`) with the same report text the GAME function
returns, the project link, HEY's citation and as-of time, and the attribution line. If HEY holds no
such project, or several match, the job is rejected _before_ any budget, with HEY's answer in the
message. If HEY cannot be read at delivery, the job is rejected so the funds return.

It is built on `@virtuals-protocol/acp-node-v2`. The package named in older guides,
`@virtuals-protocol/acp-node`, is deprecated on npm in favour of v2, so this scaffold compiles
against v2 (0.1.15).

**It does nothing by default.** Importing it connects to nothing. `startHeyAcpSeller()` throws a
clear `AcpConfigError` naming every missing variable (never a value) and does not load the ACP SDK
until all of these are set and `HEY_ACP_ENABLE=1`:

| Variable                     | What                                                                                                                              | Where it comes from                                                              |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `HEY_ACP_WALLET_ADDRESS`     | The agent wallet address                                                                                                          | Agent page on app.virtuals.io                                                    |
| `HEY_ACP_WALLET_ID`          | The agent wallet id (v2's replacement for v1's "session entity key id")                                                           | Agent page on app.virtuals.io                                                    |
| `HEY_ACP_SIGNER_PRIVATE_KEY` | The signer key: a Privy authorization key (base64, not an EOA private key)                                                        | Agent page → **Signers** → **+ Add Signer** → **Copy Key**                       |
| `HEY_ACP_CHAIN_ID`           | Settlement chain: `8453` (Base) or `4663` (Robinhood Chain). No default                                                           | The founder's decision                                                           |
| `HEY_ACP_PRICE_USDC`         | USDC per job; **default `0`**, the lowest value the SDK and registry accept (the SDK's own seller example runs a 0 USDC offering) | **The founder's decision**; set it equal to the offering's price on the registry |
| `HEY_ACP_OFFERING_NAME`      | Defaults to `hey_builder_research`; must equal the offering name on the registry                                                  | —                                                                                |
| `HEY_ACP_BUILDER_CODE`       | Optional Base builder code                                                                                                        | Agent page → **Settings**                                                        |
| `HEY_ACP_ENABLE`             | `1` to start. Anything else: nothing starts                                                                                       | The founder                                                                      |

```sh
pnpm dlx tsx examples/acp-seller.ts   # explains what is missing, or checks the config and exits unless HEY_ACP_ENABLE=1
```

```ts
import { startHeyAcpSeller } from '@hey-research-lab/virtuals-plugin/acp';
const seller = await startHeyAcpSeller(); // reads HEY_ACP_* from the environment
// … later: await seller.stop();
```

The building blocks are exported for review and for your own wiring: `loadHeyAcpConfig`,
`createHeyAcpEntryHandler`, `parseRequirement`, `buildDeliverable`, `HEY_ACP_OFFERING` (name,
description, requirement JSON Schema, deliverable description, SLA) and the `AcpRuntime` seam.

### Which wallet and chain ACP settles on

Facts as the ACP v2 SDK (0.1.15) states them in its own constants; HEY has not independently
verified any of these contracts:

- **Wallet.** Each registered agent has an agent wallet: a Privy server-managed smart account (on
  Alchemy's account infrastructure) created on app.virtuals.io. HEY's process never holds that
  wallet's key; it holds a _signer_ authorization key the founder generates under the agent's
  Signers tab, which lets the SDK ask Privy to sign for the agent wallet. The buyer's payment, in
  USDC, is escrowed by the ACP contract and released to the agent wallet when the job completes.
- **Chains.** The SDK's mainnets are Base (`8453`), Robinhood Chain (`4663`) and Arc (`5042`), plus
  Solana. On Base and Robinhood Chain the ACP contract is
  `0x238E541BfefD82238730D00a2208E5497F1832E0`; USDC is
  `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` on Base and
  `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168` on Robinhood Chain. Both chains are in the SDK's
  ERC-20 gas-sponsored list. This scaffold allows Base or Robinhood Chain and picks neither.
- **To decide:** the settlement chain (Base is where most ACP buyers already hold USDC; Robinhood
  Chain keeps HEY on the chain it researches), the price, and whether to register at all. Any
  protocol fee is Virtuals' and is not modelled here; check their current terms.

A paid job buys delivery of the same public answer anyone can read free on heyresearch.xyz; it
changes no status, score or order on HEY.

## Listing

**GAME (game-node plugins).**

1. Done: the package is on npm as
   [`@hey-research-lab/virtuals-plugin`](https://www.npmjs.com/package/@hey-research-lab/virtuals-plugin)
   and this repository is public.
2. Fork [game-by-virtuals/game-node](https://github.com/game-by-virtuals/game-node), add
   `plugins/heyResearchPlugin/` with a `README.md` (install, usage, functions, troubleshooting) and
   the [`plugin_metadata.yml`](plugin_metadata.yml) in this repository (filled from their
   template). Plugins there keep their own package names (`tokenmetrics-virtuals-plugin` is one).
3. Open a pull request with their plugin PR template and the `plugin` label, with a log of a run.

**ACP (Service Registry on app.virtuals.io).**

1. Sign in at [app.virtuals.io](https://app.virtuals.io/acp/new) and register a new agent as a
   provider (seller). Give it HEY's name and description; never imply Robinhood affiliation.
2. On the agent's page, note the wallet address and wallet id; under **Signers**, add a signer and
   copy its key; under **Settings**, copy the builder code (optional).
3. Add one offering: name `hey_builder_research`; description, requirement schema and deliverable
   from `HEY_ACP_OFFERING`; SLA at least 5 minutes; price as decided; on the settlement chain chosen.
4. Set the `HEY_ACP_*` variables on the host that will run the seller (never in the repository), run
   `examples/acp-seller.ts` once without `HEY_ACP_ENABLE` to check them, then with
   `HEY_ACP_ENABLE=1`.
5. Test with a separate buyer agent (the SDK requires different wallets) at a 0 or minimal price
   before announcing the offering.

## How it relates to HEY Research Lab

It reads HEY's public API through `@hey-research-lab/sdk` and nothing else — no page scraping, no
provider calls, no key embedded. The `x-hey-integration` header (`hey-virtuals-plugin/<version>`)
lets HEY count this plugin's calls. HEY's private quality gate stays authoritative: the plugin
relays what HEY publishes and computes no status, score or verdict of its own.

## What it does NOT prove

The plugin relays HEY's public research to an agent. A HEY answer is evidence with provenance:
activity status is a record of development, not a view on a token, and nothing it returns is
investment advice, a safety verdict or a recommendation. An unknown value means HEY does not know —
not zero. A paid ACP job buys delivery of the same public answer anyone can read free; it does not
make the answer true, current or advice, and it changes nothing on HEY.

HEY Research Lab is an independent research project and is not affiliated with, endorsed by or
partnered with Robinhood Markets, Inc. or Robinhood Chain. It is not affiliated with or endorsed by
Virtuals Protocol either.

## What it never does

- Never says a token is safe, never tells anyone to buy or sell, never predicts a price.
- Never profiles addresses, never calls them people, never follows one.
- Never fills an unknown with 0, false or "none".
- Never claims Robinhood affiliation.
- Never calls a provider, a write route or `POST /api/scan`; never embeds a key.
- ACP: never connects, registers or signs without the founder's configuration and
  `HEY_ACP_ENABLE=1`; never logs or stores the signer key.

## Security

See [SECURITY.md](SECURITY.md). Network: HTTPS GETs to `https://heyresearch.xyz` only (and, for an
enabled ACP seller, the ACP SDK's own connections). No files are read or written. Peer dependencies
beyond the allowed set, with why: `@virtuals-protocol/game` (the framework this plugs into) and,
optional, `@virtuals-protocol/acp-node-v2` (the ACP client, loaded only when the seller starts).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Tests run offline over saved fixtures with the network
blocked and the ACP client stubbed; `pnpm scan` checks for leaked secrets and attribution.

## Links

[Site](https://heyresearch.xyz) · [Developers](https://heyresearch.xyz/developers) ·
[Public API](https://heyresearch.xyz/docs/public-api) · [Agents guide](https://heyresearch.xyz/developers/agents) ·
[MCP](https://heyresearch.xyz/docs/mcp) · [SDK](https://www.npmjs.com/package/@hey-research-lab/sdk) ·
[Organisation](https://github.com/hey-research-lab) · [GAME SDK](https://github.com/game-by-virtuals/game-node) ·
[ACP SDK v2](https://www.npmjs.com/package/@virtuals-protocol/acp-node-v2) · Contact: hi@heyresearch.xyz

## Licence

MIT © 2026 HEY Research Lab
