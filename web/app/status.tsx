"use client";
// D9: one line that shows the system is watched. Amber or red, in plain words, when something lags.
import { useEffect, useState } from "react";
import { judge, loadHealth, type Health } from "@/lib/health";

export function SystemStatus({ className = "" }: { className?: string }) {
  const [h, setH] = useState<Health | null>(null);
  useEffect(() => {
    loadHealth().then(setH, () => setH(null));
  }, []);
  if (!h) return <span className={`sys-status ${className}`} data-testid="sys-status" data-level="loading"><span className="sys-dot" aria-hidden="true" />Checking systems…</span>;
  const j = judge(h);
  return (
    <span className={`sys-status sys-${j.level} ${className}`} data-testid="sys-status" data-level={j.level}>
      <span className="sys-dot" aria-hidden="true" />
      <span><b>{j.headline}</b> · {j.parts.join(" · ")}</span>
    </span>
  );
}
