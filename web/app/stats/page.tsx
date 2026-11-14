import type { Metadata } from "next";
import { Stats } from "./stats";

// A3: Amit's numbers. Not linked anywhere, not indexed. Everything on it is an aggregate count
// that is already public (season-state/usage.json and funnel.json), so unlinked is enough.
export const metadata: Metadata = { title: "Stats · Silent Partner", robots: { index: false, follow: false } };

export default function StatsPage() {
  return <Stats />;
}
