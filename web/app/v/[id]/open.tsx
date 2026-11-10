"use client";
import Link from "next/link";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Opens the vault page, keeping ?ref= so the invite stays credited. */
export function Open({ id, name }: { id: string; name: string }) {
  const router = useRouter();
  useEffect(() => {
    const ref = new URLSearchParams(window.location.search).get("ref");
    router.replace(`/vault/?id=${encodeURIComponent(id)}${ref ? `&ref=${encodeURIComponent(ref)}` : ""}`);
  }, [id, router]);
  return (
    <section data-testid="vault-link">
      <p className="muted">Opening {name}… <Link href={`/vault/?id=${id}`}>Open it now</Link></p>
    </section>
  );
}
