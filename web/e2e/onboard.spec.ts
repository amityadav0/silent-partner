// V6: zero-friction testnet onboarding. The UI part fakes a signed-in MyNearWallet session; the
// timing part sends the exact transactions of a first follow from a local spare testnet account.
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { expect, test } from "@playwright/test";
import { connect, keyStores, KeyPair, utils } from "near-api-js";

async function signedInAs(page: import("@playwright/test").Page, account: string) {
  await page.addInitScript((a) => {
    localStorage.setItem("signedAccountId", a);
    localStorage.setItem("near-wallet-selector:selectedWalletId", JSON.stringify("my-near-wallet"));
  }, account);
}

test("V6: a new testnet wallet sees Get 100 test USDC and the faucet hint", async ({ page }) => {
  await signedInAs(page, "sp-e2e-nobody-0001.testnet");
  await page.goto("/leaderboard/");
  const strip = page.getByTestId("onboard");
  await expect(strip).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("onboard-mint")).toHaveText("Get 100 test USDC");
  await expect(page.getByTestId("onboard-faucet")).toContainText("~0.5 testnet NEAR");
  await expect(page.getByTestId("onboard-mint")).toBeDisabled(); // no NEAR for fees yet
});

// A dedicated implicit testnet account (1 testnet NEAR from the spare pool), key kept locally only.
const CRED = `${homedir()}/.near-credentials/testnet/sp-e2e-follower.json`;
const FOLLOWER = existsSync(CRED) ? (JSON.parse(readFileSync(CRED, "utf8")).account_id as string) : "";
test("V6: a first real follow (register + mint 100 test USDC, then deposit) lands in under 60 s", async () => {
  test.skip(!existsSync(CRED), "no local testnet keys");
  test.setTimeout(120_000);
  const ks = new keyStores.InMemoryKeyStore();
  await ks.setKey("testnet", FOLLOWER, KeyPair.fromString(JSON.parse(readFileSync(CRED, "utf8")).private_key));
  const near = await connect({ networkId: "testnet", nodeUrl: "https://rpc.testnet.fastnear.com", keyStore: ks } as never);
  const acct = await near.account(FOLLOWER);
  const vault = "sp-vault-60270.testnet";
  const sharesOf = async () => BigInt(((await acct.viewFunction({ contractId: vault, methodName: "get_shares", args: { account_id: FOLLOWER } })) as [string, string])[0]);
  const before = await sharesOf();
  const t0 = Date.now();
  // the onboarding button: storage_deposit (if needed) + mint, one transaction
  const reg = await acct.viewFunction({ contractId: "usdc.fakes.testnet", methodName: "storage_balance_of", args: { account_id: FOLLOWER } });
  const { transactions } = await import("near-api-js");
  await acct.signAndSendTransaction({
    receiverId: "usdc.fakes.testnet",
    actions: [
      ...(reg ? [] : [transactions.functionCall("storage_deposit", { account_id: FOLLOWER }, 30n * 10n ** 12n, BigInt(utils.format.parseNearAmount("0.00125")!))]),
      transactions.functionCall("mint", { account_id: FOLLOWER, amount: "100000000" }, 30n * 10n ** 12n, 0n),
    ],
  });
  // the follow panel: deposit 2 USDC into the vault
  await acct.functionCall({ contractId: "usdc.fakes.testnet", methodName: "ft_transfer_call", args: { receiver_id: vault, amount: "2000000", msg: "" }, gas: 150n * 10n ** 12n, attachedDeposit: 1n });
  const secs = (Date.now() - t0) / 1000;
  const after = await sharesOf();
  console.log(`first follow: ${secs.toFixed(1)} s, shares ${before} → ${after}`);
  expect(after > before, "shares minted").toBe(true);
  expect(secs).toBeLessThan(60);
});
