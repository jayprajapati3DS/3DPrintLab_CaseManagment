"use client";

import { useEffect, useState } from "react";

/**
 * Hover any uploaded picture in the app — a product image, a logo, a part's
 * photo, a scan — and it pops up larger beside the pointer. One listener for
 * the whole app, so every page gets it: it reacts to images served by this
 * application (stored files) that are shown smaller than they are.
 */

const OURS = /^\/api\/(files|part-files|case-files|grn-files)\//;
const MAX = 420;

export function ImageZoom() {
  const [shown, setShown] = useState<{ src: string; x: number; y: number } | null>(null);

  useEffect(() => {
    function zoomable(target: EventTarget | null): HTMLImageElement | null {
      if (!(target instanceof HTMLImageElement) || target.dataset.noZoom !== undefined) return null;
      const src = target.getAttribute("src") ?? "";
      if (!OURS.test(src)) return null;
      // Already shown large — nothing to gain.
      const box = target.getBoundingClientRect();
      if (box.width >= MAX * 0.85 && box.height >= MAX * 0.6) return null;
      return target;
    }
    const over = (e: MouseEvent) => {
      const img = zoomable(e.target);
      if (img) setShown({ src: img.getAttribute("src")!, x: e.clientX, y: e.clientY });
    };
    const move = (e: MouseEvent) => setShown((s) => (s ? { ...s, x: e.clientX, y: e.clientY } : s));
    const out = (e: MouseEvent) => {
      if (zoomable(e.target)) setShown(null);
    };
    const hide = () => setShown(null);
    document.addEventListener("mouseover", over);
    document.addEventListener("mousemove", move, { passive: true });
    document.addEventListener("mouseout", out);
    window.addEventListener("scroll", hide, { passive: true });
    return () => {
      document.removeEventListener("mouseover", over);
      document.removeEventListener("mousemove", move);
      document.removeEventListener("mouseout", out);
      window.removeEventListener("scroll", hide);
    };
  }, []);

  if (!shown) return null;
  // Beside the pointer, kept on screen.
  const width = typeof window === "undefined" ? 1200 : window.innerWidth;
  const height = typeof window === "undefined" ? 800 : window.innerHeight;
  const left = shown.x + 18 + MAX > width ? Math.max(8, shown.x - 18 - MAX) : shown.x + 18;
  const top = Math.min(Math.max(8, shown.y - MAX / 2), Math.max(8, height - MAX - 8));
  return (
    <div
      aria-hidden="true"
      data-testid="image-zoom"
      className="border-line pointer-events-none fixed z-[100] flex items-center justify-center rounded-[12px] border bg-white p-2 shadow-[0_12px_32px_rgba(16,24,40,.22)]"
      style={{ left, top, width: MAX, height: MAX }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- the stored image hovered, shown larger */}
      <img src={shown.src} alt="" data-no-zoom className="max-h-full max-w-full object-contain" />
    </div>
  );
}
