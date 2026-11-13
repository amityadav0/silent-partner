"use client";
// "Watch 90 s" (V4): the demo video in a lightbox, muted, with captions on, served from Pages.
import { useEffect, useRef, useState } from "react";
import { BASE_PATH } from "@/lib/config";

export function WatchButton() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <>
      <button className="btn btn-lg" onClick={() => setOpen(true)} data-testid="watch">▶ Watch 90 s</button>
      <dialog
        ref={ref}
        className="watch-dialog"
        aria-label="Silent Partner demo video"
        onClose={() => setOpen(false)}
        onClick={(e) => {
          if (e.target === e.currentTarget) setOpen(false);
        }}
        data-testid="watch-dialog"
      >
        {open && (
          <video controls autoPlay muted playsInline preload="metadata" className="watch-video" poster={`${BASE_PATH}/demo/poster.jpg`} data-testid="watch-video">
            <source src={`${BASE_PATH}/demo/silent-partner-demo.mp4`} type="video/mp4" />
            <track kind="captions" srcLang="en" label="English" src={`${BASE_PATH}/demo/captions.vtt`} default />
          </video>
        )}
        <button className="watch-close" onClick={() => setOpen(false)} aria-label="Close video">✕</button>
      </dialog>
    </>
  );
}
