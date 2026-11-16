// Funnel counters (V8, A2, C4). The public counter (abacus) is flaky: reads time out or answer 500.
// A failed read is unknown, not zero, and every counter only ever goes up, so each published number
// is the larger of the last published value and this read. A bad hour can't wipe a count.

/** One counter read: the value on HTTP 200, null on anything else (error, timeout, 5xx). */
export async function readCounter(url: string, fetchImpl: typeof fetch = fetch): Promise<number | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await fetchImpl(url, { signal: AbortSignal.timeout(8_000) });
      if (r.ok) {
        const v = ((await r.json()) as { value?: unknown }).value;
        return typeof v === "number" && Number.isFinite(v) ? v : 0;
      }
    } catch {
      /* retry once, then unknown */
    }
  }
  return null;
}

/** Counters never go down: keep the last published value when a read fails or comes back lower. */
export const mergeCount = (prev: unknown, got: number | null): number => Math.max(typeof prev === "number" ? prev : 0, got ?? 0);
