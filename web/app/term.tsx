"use client";
// A plain-words "?" note (V3): the technical name and how it works, for people who want them.
import { useId, useState, type ReactNode } from "react";

export function Term({ tip, children }: { tip: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <span className="term">
      <button type="button" className="term-q" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)} title={tip} data-testid="term">
        {children} <span aria-hidden="true" className="term-mark">?</span>
      </button>
      {open && <span id={id} role="note" className="term-tip">{tip}</span>}
    </span>
  );
}
