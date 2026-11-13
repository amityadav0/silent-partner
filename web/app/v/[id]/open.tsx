"use client";
import Link from "next/link";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Opens the vault page, keeping ?ref= so the invite stays credited. */
export function Open({ id, name }: { id: string; name: string }) {
  const router = useRouter();
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const ref = q.get("ref");
    // a follower's shared copy opens straight into a $100 copy for the next person (V2)
    if (q.get("copy") === "1") return router.replace(`/copy/?id=${encodeURIComponent(id)}&start=1${ref ? `&ref=${encodeURIComponent(ref)}` : ""}`);
    router.replace(`/vault/?id=${encodeURIComponent(id)}${ref ? `&ref=${encodeURIComponent(ref)}` : ""}`);
  }, [id, router]);
  return (
    <section data-testid="vault-link">
      <p className="muted">Opening {name}… <Link href={`/vault/?id=${id}`}>Open it now</Link></p>
    </section>
  );
}
