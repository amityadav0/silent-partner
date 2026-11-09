// Paper-follow: try a vault with no wallet. Records the entry share price from
// the latest on-chain NAV in this browser and values the simulated position at
// each later NAV. Nothing leaves the browser; nothing is signed.
export type PaperFollow = { vault: string; usd: number; entry_price: string; entry_epoch: number; entry_ms: number };

const KEY = (vault: string) => `sp.paper.${vault}`;
const memory = new Map<string, PaperFollow>(); // when storage is unavailable (private mode, previews)

export function loadPaper(vault: string): PaperFollow | null {
  try {
    const v = localStorage.getItem(KEY(vault));
    if (v) return JSON.parse(v) as PaperFollow;
  } catch {
    /* fall through to memory */
  }
  return memory.get(vault) ?? null;
}

export function savePaper(f: PaperFollow | null, vault: string) {
  if (f) memory.set(vault, f);
  else memory.delete(vault);
  try {
    if (f) localStorage.setItem(KEY(vault), JSON.stringify(f));
    else localStorage.setItem(KEY(vault), "");
  } catch {
    /* memory only */
  }
}

export function startPaper(vault: string, usd: number, latest: { price: string; epoch: number } | undefined, now = Date.now()): PaperFollow | null {
  if (!latest || BigInt(latest.price) === 0n) return null;
  return { vault, usd, entry_price: latest.price, entry_epoch: latest.epoch, entry_ms: now };
}

/** The simulated position at share price `price` (× 1e18), after fees, as the vault's holders see it. */
export function paperPosition(f: PaperFollow, price: string): { value: number; pnl: number; pct: number } {
  const ratio = Number((BigInt(price) * 1_000_000n) / BigInt(f.entry_price)) / 1_000_000;
  const value = f.usd * ratio;
  return { value, pnl: value - f.usd, pct: ratio - 1 };
}

/** The copy's return line: from the entry epoch on, relative to the entry price. */
export function copyLine(navs: { epoch: number; timestamp_ms: number; price: string }[], f: PaperFollow): { t: number; r: number; epoch: number }[] {
  return navs.filter((n) => n.epoch >= f.entry_epoch).map((n) => ({ t: n.timestamp_ms, epoch: n.epoch, r: paperPosition(f, n.price).pct }));
}
