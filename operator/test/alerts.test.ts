import { describe, expect, it } from "vitest";
import { computeAlerts, handleCommands, ntfyTopic, pushNtfy, type Snapshot } from "../src/season/alerts.js";

const H = 3600_000;
const snap = (o: Partial<Snapshot> = {}): Snapshot => ({ vault: "v.testnet", name: "Calm Owl", price: 1, lastNavMs: 0, emergency: false, pending: 0, claimsPaid: 0, ...o });

describe("alerts", () => {
  it("the first sighting only sets a baseline", () => {
    const r = computeAlerts({}, [snap({ price: 1.05 })], H);
    expect(r.events).toEqual([]);
    expect(r.state["v.testnet"].peak).toBe(1.05);
  });
  it("moves, highs, drawdown levels, withdrawals and payouts", () => {
    let s = computeAlerts({}, [snap({ price: 1.0 })], H).state;
    let r = computeAlerts(s, [snap({ price: 1.03, lastNavMs: 2 * H })], 2 * H);
    expect(r.events.map((e) => e.kind)).toEqual(["high"]);
    r = computeAlerts(r.state, [snap({ price: 1.025, lastNavMs: 3 * H })], 3 * H);
    expect(r.events).toEqual([]); // −0.49%: below the 2% threshold
    r = computeAlerts(r.state, [snap({ price: 1.0, lastNavMs: 3 * H })], 3 * H);
    expect(r.events.map((e) => e.kind)).toEqual(["move"]);
    expect(r.events[0].text).toBe("Calm Owl: share price −2.44% since the last post (1.0000).");
    r = computeAlerts(r.state, [snap({ price: 0.97, lastNavMs: 4 * H, pending: 1 })], 4 * H);
    expect(r.events.map((e) => e.kind)).toEqual(["move", "drawdown", "withdrawal"]);
    expect(r.events[1].text).toContain("−5%");
    // still below −5%, no repeat; then −10%
    r = computeAlerts(r.state, [snap({ price: 0.965, lastNavMs: 5 * H, pending: 1 })], 5 * H);
    expect(r.events).toEqual([]);
    r = computeAlerts(r.state, [snap({ price: 0.92, lastNavMs: 6 * H, pending: 0, claimsPaid: 2 })], 6 * H);
    expect(r.events.map((e) => e.kind)).toEqual(["move", "drawdown", "paid"]);
    expect(r.events[2].text).toContain("2 withdrawals were paid out");
    s = r.state;
    expect(s["v.testnet"].ddLevel).toBe(2);
  });
  it("operator silence after 12 hours, and emergency, once each", () => {
    const s = computeAlerts({}, [snap({ lastNavMs: 0 })], H).state;
    let r = computeAlerts(s, [snap({ lastNavMs: 0 })], 13 * H);
    expect(r.events.map((e) => e.kind)).toEqual(["silent"]);
    r = computeAlerts(r.state, [snap({ lastNavMs: 0, emergency: true })], 25 * H);
    expect(r.events.map((e) => e.kind)).toEqual(["emergency"]);
    r = computeAlerts(r.state, [snap({ lastNavMs: 0, emergency: true })], 26 * H);
    expect(r.events).toEqual([]);
  });
  it("alerts carry vault-level numbers only", () => {
    const s = computeAlerts({}, [snap()], H).state;
    const r = computeAlerts(s, [snap({ price: 1.2, pending: 1, claimsPaid: 1 })], 2 * H);
    for (const e of r.events) expect(e.text).not.toMatch(/NEAR|USDC|wNEAR|shares|account|\.testnet/);
  });
  it("ntfy topic and request", async () => {
    expect(ntfyTopic("c0.sp-sop-92991.testnet")).toBe("silent-partner-c0-sp-sop-92991-testnet");
    const seen: any[] = [];
    await pushNtfy({ vault: "c0.sp-sop-92991.testnet", kind: "high", text: "Calm Owl: new high", at: "" }, (async (u: string, i: RequestInit) => (seen.push({ u, i }), new Response("{}"))) as unknown as typeof fetch);
    expect(seen[0].u).toBe("https://ntfy.sh/silent-partner-c0-sp-sop-92991-testnet");
    expect(seen[0].i.body).toBe("Calm Owl: new high");
  });
  it("Telegram commands", () => {
    const known = new Set(["c0.sp-sop-92991.testnet"]);
    const msg = (id: number, text: string) => ({ update_id: id, message: { chat: { id: 42 }, text } });
    const r = handleCommands({ offset: 0, subs: {} }, [msg(5, "/follow c0.sp-sop-92991.testnet"), msg(6, "/follow nope.testnet"), msg(7, "/list")], known);
    expect(r.state).toEqual({ offset: 8, subs: { "42": ["c0.sp-sop-92991.testnet"] } });
    expect(r.replies[1].text).toContain("/follow <vault id>");
    expect(r.replies[2].text).toBe("c0.sp-sop-92991.testnet");
    expect(handleCommands(r.state, [msg(8, "/unfollow c0.sp-sop-92991.testnet")], known).state.subs["42"]).toEqual([]);
  });
});
