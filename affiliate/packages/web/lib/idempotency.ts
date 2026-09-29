/*
 * Idempotency-Key values for the app's POSTs (/v1/links, /v1/disputes; /join
 * keeps its own per legal name). One key per unchanged payload: a retry
 * after a timeout, or a second click, replays the API's first answer
 * (packages/api/src/idempotency.ts stores every < 500 response per org)
 * instead of minting a second link or filing a duplicate ticket. A changed
 * payload gets a new key. Relative imports only (tested).
 */

/** 32 hex characters (crypto.randomUUID needs a secure context; getRandomValues does not). */
export function randomKey(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export class IdempotencyKeys {
  private readonly keys = new Map<string, string>();

  constructor(private readonly prefix: string) {}

  /** The key for this payload: the same one for as long as the payload is unchanged. */
  keyFor(payload: unknown): string {
    const fingerprint = JSON.stringify(payload);
    let key = this.keys.get(fingerprint);
    if (!key) {
      key = `${this.prefix}-${randomKey()}`;
      this.keys.set(fingerprint, key);
    }
    return key;
  }

  /** Drop the key once the payload's request succeeded and a new, identical one should count as new. */
  forget(payload: unknown): void {
    this.keys.delete(JSON.stringify(payload));
  }
}
