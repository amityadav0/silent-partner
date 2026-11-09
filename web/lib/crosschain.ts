// Follow from any chain: a follower sends USDC on Base / Arbitrum / Ethereum /
// Solana and 1Click delivers USDC on NEAR straight into the vault with
// `ft_transfer_call(msg = <their NEAR account>)` (customRecipientMsg), so the
// vault mints the shares to them in one step. The contract accepts `msg` = the
// account to credit (lib.rs ft_on_transfer).
export const ONECLICK = "https://1click.chaindefuser.com";
export const NEAR_USDC = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";

export type Chain = { id: string; name: string; asset: string; addressHint: string; /** a well-formed address, used only for dry quotes */ placeholder: string };
export const CHAINS: Chain[] = [
  { id: "base", name: "Base", asset: "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near", addressHint: "0x…", placeholder: "0x1111111111111111111111111111111111111111" },
  { id: "arb", name: "Arbitrum", asset: "nep141:arb-0xaf88d065e77c8cc2239327c5edb3a432268e5831.omft.near", addressHint: "0x…", placeholder: "0x1111111111111111111111111111111111111111" },
  { id: "eth", name: "Ethereum", asset: "nep141:eth-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.omft.near", addressHint: "0x…", placeholder: "0x1111111111111111111111111111111111111111" },
  { id: "sol", name: "Solana", asset: "nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near", addressHint: "base58 address", placeholder: "So11111111111111111111111111111111111111112" },
];

export type CrossQuote = { amountIn: string; amountOut: string; amountOutFormatted: string; timeEstimate: number; depositAddress?: string; deadline: string };

/** The 1Click request: USDC on `chain` → USDC on NEAR into `vault`, crediting `beneficiary`. */
export function crossQuoteBody(o: { chain: Chain; usdc: number; vault: string; beneficiary: string; refundTo: string; dry: boolean; nowMs: number }) {
  return {
    dry: o.dry,
    swapType: "EXACT_INPUT",
    slippageTolerance: 100,
    originAsset: o.chain.asset,
    destinationAsset: NEAR_USDC,
    amount: String(Math.round(o.usdc * 1e6)),
    depositType: "ORIGIN_CHAIN",
    recipientType: "DESTINATION_CHAIN",
    recipient: o.vault,
    customRecipientMsg: o.beneficiary,
    refundType: "ORIGIN_CHAIN",
    refundTo: o.refundTo,
    deadline: new Date(o.nowMs + 60 * 60_000).toISOString(),
  };
}

export async function crossQuote(body: ReturnType<typeof crossQuoteBody>, fetchImpl: typeof fetch = fetch): Promise<CrossQuote> {
  const r = await fetchImpl(`${ONECLICK}/v0/quote`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = (await r.json()) as { quote?: CrossQuote; message?: string };
  if (!r.ok || !j.quote) throw new Error(j.message ?? `1Click ${r.status}`);
  return j.quote;
}
