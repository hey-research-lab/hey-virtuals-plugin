import { HeyApiError, type HeyAgentResponse } from '@hey-research-lab/sdk';

import { UnsupportedChainError } from './chain.js';
import { clean, sourceLine } from './text.js';

/**
 * What one HEY read produced, before a framework wraps it.
 *
 * - `answer`: HEY answered about a project or the chain.
 * - `not_found` / `ambiguous`: HEY answered that it holds no such project, or several match. These
 *   are answers too (a reading of HEY's index), so `ok` is true.
 * - `invalid` / `error`: the request was malformed, refused, or HEY could not be read.
 */
export type HeyOutcome = 'answer' | 'not_found' | 'ambiguous' | 'invalid' | 'error';

export type HeyResult = {
  ok: boolean;
  outcome: HeyOutcome;
  /** The text an agent reads: HEY's semantics kept, ending with the attribution line. */
  text: string;
  projectUrl?: string;
  asOf?: string;
  citation?: HeyAgentResponse['citation'];
  error?: {
    code: string;
    message: string;
    retryable: boolean;
    status?: number;
    retryAfterSeconds?: number;
    requestId?: string;
  };
};

export function invalid(code: string, message: string): HeyResult {
  return {
    ok: false,
    outcome: 'invalid',
    text: `${message}\n${sourceLine()}`,
    error: { code, message, retryable: false },
  };
}

export function unsupportedChain(chainId: unknown): HeyResult {
  const err = new UnsupportedChainError(chainId);
  return invalid(err.code, err.message);
}

function requestIdOf(body: unknown): string | undefined {
  if (body && typeof body === 'object' && 'requestId' in body) {
    const id = (body as { requestId?: unknown }).requestId;
    return typeof id === 'string' ? clean(id, 80) : undefined;
  }
  return undefined;
}

/** Any failure as one clear message: HEY's own error code and sentence, its request id and delay. */
export function fromError(error: unknown): HeyResult {
  if (error instanceof HeyApiError) {
    const retryable = ['rate_limited', 'quota', 'unavailable', 'network', 'timeout'].includes(
      error.code,
    );
    const requestId = requestIdOf(error.body);
    const parts = [
      `HEY could not answer: ${error.code}${error.status ? ` (HTTP ${error.status})` : ''} — ${clean(error.message, 300)}.`,
    ];
    if (error.retryAfterSeconds !== undefined) {
      parts.push(`Retry after ${error.retryAfterSeconds} seconds.`);
    }
    if (requestId) parts.push(`Request id: ${requestId}.`);
    return {
      ok: false,
      outcome: 'error',
      text: `${parts.join(' ')}\n${sourceLine()}`,
      error: {
        code: error.code,
        message: clean(error.message, 300),
        retryable,
        ...(error.status !== undefined ? { status: error.status } : {}),
        ...(error.retryAfterSeconds !== undefined
          ? { retryAfterSeconds: error.retryAfterSeconds }
          : {}),
        ...(requestId ? { requestId } : {}),
      },
    };
  }
  if (error instanceof UnsupportedChainError) return unsupportedChain(error.chainId);
  const message = error instanceof Error ? clean(error.message, 300) : 'unknown failure';
  return {
    ok: false,
    outcome: 'error',
    text: `HEY could not be read: ${message}\n${sourceLine()}`,
    error: { code: 'internal', message, retryable: false },
  };
}
