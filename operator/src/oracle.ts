// Oracle feed for vaults whose NAV band reads a Pyth-compatible oracle: the
// testnet paper-season vaults, which read a mock (`oracle-mock/`) written with
// the public market price (CoinGecko) by a separate writer account. Mainnet
// vaults don't use an oracle: their band is priced by two 1Click-signed quotes
// attached to each NAV post (Operator.priceQuotes, D-H-5).
import { connect, keyStores, KeyPair, type Account } from "near-api-js";

export const NEAR_USD_FEED = "c415de8d2eba7db216527dff4b60e8f3a5311c740dadb233e13e12547e226750";
export type OraclePrice = { price: string; conf: string; expo: number; publish_time: number };

/** A Pyth price for a USD value (8 decimals), confidence as a fraction of the price. */
export function toPythPrice(usd: number, confFrac: number, nowS: number): OraclePrice {
  const p = Math.round(usd * 1e8);
  return { price: String(p), conf: String(Math.max(1, Math.round(p * confFrac))), expo: -8, publish_time: nowS };
}

export async function coingeckoNearUsd(fetchImpl: typeof fetch = fetch): Promise<number> {
  const r = await fetchImpl("https://api.coingecko.com/api/v3/simple/price?ids=near&vs_currencies=usd", { headers: { accept: "application/json" } });
  if (!r.ok) throw new Error(`coingecko ${r.status}`);
  const j = (await r.json()) as { near?: { usd?: number } };
  if (!j.near?.usd) throw new Error("coingecko: no NEAR price");
  return j.near.usd;
}

async function account(network: "testnet" | "mainnet", rpc: string, id: string, key: string): Promise<Account> {
  const ks = new keyStores.InMemoryKeyStore();
  await ks.setKey(network, id, KeyPair.fromString(key as `ed25519:${string}`));
  const near = await connect({ networkId: network, nodeUrl: rpc, keyStore: ks } as unknown as Parameters<typeof connect>[0]);
  return near.account(id);
}

/** Testnet: write the public price to the mock oracle. */
export class MockFeed {
  constructor(private rpc: string, private oracle: string, private writer: string, private writerKey: string, private priceId = NEAR_USD_FEED) {}
  async push(usd: number, nowS = Math.floor(Date.now() / 1000)): Promise<{ tx: string; price: OraclePrice }> {
    const price = toPythPrice(usd, 0.0005, nowS);
    const a = await account("testnet", this.rpc, this.writer, this.writerKey);
    const o = await a.functionCall({ contractId: this.oracle, methodName: "set_price", args: { price_id: this.priceId, price }, gas: 30_000_000_000_000n, attachedDeposit: 0n });
    const failure = (o.receipts_outcome as any[]).map((r) => r.outcome.status?.Failure).find(Boolean);
    if (failure) throw new Error(`set_price: ${JSON.stringify(failure).slice(0, 200)}`);
    return { tx: o.transaction.hash, price };
  }
}
