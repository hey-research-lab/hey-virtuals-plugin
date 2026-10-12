import { defineConfig } from 'tsup';

/**
 * Two builds. The GAME worker (`.`) ships ESM and CJS like the SDK. The ACP provider (`./acp`)
 * ships ESM only, because `@virtuals-protocol/acp-node-v2` is an ESM-only package it imports
 * lazily. Dependencies and peers stay external. `pnpm build` clears dist first.
 */
export default defineConfig([
  {
    entry: { index: 'src/index.ts' },
    format: ['esm', 'cjs'],
    dts: true,
    target: 'es2022',
    platform: 'node',
    sourcemap: false,
    splitting: false,
    clean: false,
  },
  {
    entry: { acp: 'src/acp/index.ts' },
    format: ['esm'],
    dts: true,
    target: 'es2022',
    platform: 'node',
    sourcemap: false,
    splitting: false,
    clean: false,
  },
]);
