import { EbayApiError } from '../ebay/client';

/** Retrying cannot help (bad input, missing setup). The worker marks the job failed immediately. */
export class NonRetryableError extends Error {}

/** Short, token-free description safe to store and show to the user. */
export function describeError(err: unknown): string {
  if (err instanceof EbayApiError) {
    const errors = (err.body as { errors?: { message?: string }[] } | undefined)?.errors;
    const detail = errors?.map((e) => e.message).filter(Boolean).slice(0, 3).join('; ');
    return detail ? `eBay ${err.status}: ${detail}` : `eBay ${err.status}`;
  }
  return err instanceof Error ? err.message : String(err);
}
