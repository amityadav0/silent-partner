// AI leader (wired in the next step). Holds until then.
import type { Series } from "./market.js";
import type { Decision } from "../season/tick.js";
export async function aiLeader(_s: Series, _current: number, _o: { apiKey?: string; model?: string }): Promise<Decision> {
  return { target: null, why: "AI leader not wired yet" };
}
