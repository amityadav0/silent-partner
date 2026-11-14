"use client";
// Counts a page view on every route change, and a ref landing when the URL carries ?ref= (V8).
import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { track } from "@/lib/funnel";

export function FunnelViews() {
  const path = usePathname();
  useEffect(() => {
    track("view", path ?? "/");
    if (path === "/") track("landing");
    if (path?.startsWith("/create/ai")) track("create_open");
    if (new URLSearchParams(location.search).get("ref")) track("ref_landing");
  }, [path]);
  return null;
}
