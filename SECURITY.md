# Security policy

## Reporting a vulnerability

Please report privately through GitHub's "Report a vulnerability" (Security → Advisories) on this
repository, or email hi@heyresearch.xyz with "security" in the subject. Do not open a public issue.
We aim to acknowledge within 3 working days. There is no bug bounty for this repository.

## Scope

- **GAME worker (`.`):** HTTPS GET requests to `https://heyresearch.xyz` through
  `@hey-research-lab/sdk`, one per function call (a research by contract or ticker resolves first,
  so two). No retries, no redirects beyond the SDK's own rule, a 15-second timeout. It never calls
  `POST /api/scan`, an account route or a write route, and never fetches a URL found inside an
  answer. Arguments from the model are validated before any request (slug, address, chain id,
  numeric ranges). Text from HEY's sources is data: it is stripped of control, zero-width and
  bidirectional-override characters, folded onto one line and bounded, and words that read like an
  instruction are marked as data.
- **ACP provider (`./acp`):** does nothing on import. `startHeyAcpSeller` refuses to load the ACP
  SDK, build a wallet adapter, connect or sign unless every `HEY_ACP_*` variable is set and
  `HEY_ACP_ENABLE=1`. A buyer's requirement is size-capped (4 KB), parsed as JSON or taken as a
  string, and only `query` and `chainId` are read; nothing is merged into an object. Another chain
  is refused with `unsupported_chain`.
- **Local system:** reads and writes no files, spawns no processes, keeps no state.
- **Test-only override:** `baseUrl` accepts `https:` or `http://localhost` / `http://127.0.0.1`
  only, with no credentials.

## Handling secrets

The GAME worker never needs HEY credentials. An optional `HEY_API_KEY` is read from the
environment, sent only to HEY as a bearer token, never logged and never placed in a URL.

The ACP provider reads the agent's signer key (`HEY_ACP_SIGNER_PRIVATE_KEY`, the Privy
authorization key from the agent's Signers tab on app.virtuals.io) from the environment. It is held
in a `Secret` whose `toString`, `toJSON` and `util.inspect` print `[redacted]`, read once when the
wallet adapter is built, and never logged, written to disk or included in an error. Configuration
errors name the variable, never its value. An EOA private key is refused. Never commit a `.env`
with values; the tests use obviously fake values only.

## Supported versions

The latest 0.x minor receives fixes.
