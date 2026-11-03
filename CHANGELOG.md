# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/).

## 0.1.1 — unreleased (not yet on npm)

- Security: `HEY_API_KEY` from the environment is sent to `https://heyresearch.xyz` only. With a custom
  `baseUrl` (a mock, a proxy, a local server) no key is sent unless the caller passes `apiKey`
  explicitly, as the AgentKit, GOAT and CLI integrations already do.
- Development: vitest 4.1.12.

## 0.1.0 — 2026-10-13

Initial release.

- GAME worker for `@virtuals-protocol/game` 0.1.14: `heyResearchWorker({ apiKey?, baseUrl? })` and
  `heyResearchFunctions()` with five functions — `hey_research_project`, `hey_find_projects`,
  `hey_recent_changes`, `hey_project_timeline`, `hey_chain_overview` — each returning
  `ExecutableGameFunctionResponse` (Done for an answer, including "HEY holds no such project";
  Failed for a refused or failed read) with text that keeps HEY's semantics, its as-of time, the
  HEY link and the attribution line.
- Research by HEY slug, `$TICKER`, name or 0x contract: a contract resolves through HEY's token
  lookup, a ticker or name through HEY's search, and is researched only on one exact match; several
  matches are listed, never guessed.
- `@hey-research-lab/virtuals-plugin/acp`: an Agent Commerce Protocol provider scaffold for
  `@virtuals-protocol/acp-node-v2` 0.1.15 offering "HEY builder research on a Robinhood Chain
  project/contract". Off by default: it needs every `HEY_ACP_*` variable and `HEY_ACP_ENABLE=1`.
  Price defaults to 0 USDC (pricing is the founder's decision); settlement chain (Base or Robinhood
  Chain) has no default.
- Robinhood Chain (4663) only; any other chain is refused with `unsupported_chain`.
- Tests over saved fixtures with the network blocked and the ACP client fully stubbed; a
  forbidden-word scan over every output.
