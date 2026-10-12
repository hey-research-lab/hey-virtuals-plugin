/**
 * HEY as an ACP provider (seller). Run from the repository root:
 *
 *   pnpm dlx tsx examples/acp-seller.ts
 *
 * Without configuration it explains what is missing and exits. With every HEY_ACP_* variable set
 * but HEY_ACP_ENABLE unset, it checks the configuration and exits without connecting or signing.
 * Only with HEY_ACP_ENABLE=1 does it build the agent wallet adapter and listen for jobs.
 * In your own project, import from '@hey-research-lab/virtuals-plugin/acp'.
 */
import {
  AcpConfigError,
  describeAcpConfig,
  loadHeyAcpConfig,
  startHeyAcpSeller,
} from '../src/acp/index.js';

let config;
try {
  config = loadHeyAcpConfig(process.env);
} catch (error) {
  if (error instanceof AcpConfigError) {
    console.error(error.message);
    process.exit(2);
  }
  throw error;
}

if (!config.enabled) {
  console.log(`Configuration is complete: ${describeAcpConfig(config)}.`);
  console.log(
    'Not starting: set HEY_ACP_ENABLE=1 once the agent is registered and the price is decided.',
  );
  process.exit(0);
}

const seller = await startHeyAcpSeller({ config });
const shutdown = async () => {
  await seller.stop();
  process.exit(0);
};
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
