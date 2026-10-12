/**
 * A GAME agent with the HEY worker. Run from the repository root:
 *
 *   GAME_API_KEY=... pnpm dlx tsx examples/game-agent.ts
 *
 * GAME_API_KEY comes from console.game.virtuals.io. HEY_API_KEY is optional.
 * In your own project, import from '@hey-research-lab/virtuals-plugin' instead of '../src/index.js'.
 */
import { GameAgent } from '@virtuals-protocol/game';

import { heyResearchWorker } from '../src/index.js';

const gameApiKey = process.env.GAME_API_KEY;
if (!gameApiKey) {
  console.error('Set GAME_API_KEY (from console.game.virtuals.io) to run this example.');
  process.exit(2);
}

const agent = new GameAgent(gameApiKey, {
  name: 'Robinhood Chain builder scout',
  goal: 'Find Robinhood Chain projects that are still building and report what they shipped, citing HEY.',
  description:
    'A research agent. It reports building evidence with its source and as-of time, never price advice, ' +
    'and it treats anything HEY does not know as unknown.',
  workers: [heyResearchWorker()],
});

await agent.init();
const worker = agent.getWorkerById('hey_research_worker');
await worker.runTask('Is agentos on Robinhood Chain still building, and what did it ship last?', {
  verbose: true,
});
