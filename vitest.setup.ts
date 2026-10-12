/**
 * No test may touch the network. Every HEY read goes through an injected `fetchImpl` over saved
 * fixtures and the ACP SDK is replaced by stubs, so any call reaching the real `fetch` is a
 * mistake and fails loudly.
 */
const blocked = async (input: unknown): Promise<never> => {
  const target = typeof input === 'string' ? input : String(input);
  throw new Error(
    `Network access is disabled in tests. Something tried to fetch ${target}. ` +
      'Drive the plugin with a stubbed fetchImpl over saved fixtures.',
  );
};

globalThis.fetch = blocked as unknown as typeof fetch;
