// Shareable vault link: /v/<vault>/ carries the vault's own preview (the light
// track-record card the season renders) for X and Telegram, then opens the vault
// page. Prerendered for every listed and live community vault at build time;
// the Pages workflow rebuilds on a schedule to pick up new launches.
import type { Metadata } from "next";
import { VAULTS } from "@/lib/config";
import { communityMeta, loadLaunches } from "@/lib/community";
import { cardUrl } from "@/lib/vault";
import { metaOf, type VaultMeta } from "@/lib/vaults";
import { Open } from "./open";

export const dynamicParams = false;
const SITE = "https://amityadav0.github.io/silent-partner";

async function all(): Promise<Map<string, VaultMeta>> {
  const m = new Map<string, VaultMeta>(VAULTS.map((id) => [id, metaOf(id)]));
  try {
    for (const l of await loadLaunches()) if (l.status === "live" && l.vault) m.set(l.vault, communityMeta(l));
  } catch {
    /* registry unreachable at build: house vaults only */
  }
  return m;
}

export async function generateStaticParams() {
  return [...(await all()).keys()].map((id) => ({ id }));
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const m = (await all()).get(id) ?? metaOf(id);
  const title = `${m.name} on Silent Partner`;
  const description = `${m.style}. Worst drawdown, return and the leader's own stake, verified in your browser. Positions sealed.`;
  return {
    title,
    description,
    openGraph: { title, description, url: `${SITE}/v/${id}/`, siteName: "Silent Partner", images: [{ url: cardUrl(id), width: 1200, height: 630, alt: `${m.name} track record` }] },
    twitter: { card: "summary_large_image", title, description, images: [cardUrl(id)] },
  };
}

export default async function VaultLink({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const m = (await all()).get(id) ?? metaOf(id);
  return <Open id={id} name={m.name} />;
}
