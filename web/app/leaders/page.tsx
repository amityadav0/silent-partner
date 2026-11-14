// /leaders/ is a natural guess for the leaderboard (Y8): send it there.
import type { Metadata } from "next";
import { Go } from "./go";

export const metadata: Metadata = { title: "Leaderboard · Silent Partner", robots: { index: false } };

export default function Leaders() {
  return <Go to="/leaderboard/" label="the leaderboard" />;
}
