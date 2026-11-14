"use client";
import Link from "next/link";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

export function Go({ to, label }: { to: string; label: string }) {
  const router = useRouter();
  useEffect(() => router.replace(to), [to, router]);
  return <p className="muted" data-testid="redirect">Opening {label}… <Link href={to}>Go now</Link></p>;
}
