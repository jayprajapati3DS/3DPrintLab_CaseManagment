"use client";

import { useRef, useState, useTransition } from "react";

import { saveSignatureAction } from "@/app/(app)/account/actions";
import { BTN_SECONDARY } from "@/components/ui/styles";

/**
 * Draw a signature with a mouse, pen or finger — or upload a picture — and
 * keep it on the signed-in person's profile (My account → My signature).
 * Used there, and on a quality form when a signature image is asked for and
 * the person has none yet.
 */
export function SignaturePad({
  title,
  onSaved,
  compact = false,
}: {
  title: string;
  /** After the image is kept on the profile. */
  onSaved: () => void;
  compact?: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ text: string; bad: boolean } | null>(null);
  const [drawn, setDrawn] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);
  const last = useRef<{ x: number; y: number } | null>(null);

  const point = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const c = canvas.current!;
    const r = c.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * c.width, y: ((e.clientY - r.top) / r.height) * c.height };
  };

  function down(e: React.PointerEvent<HTMLCanvasElement>) {
    e.currentTarget.setPointerCapture(e.pointerId);
    last.current = point(e);
  }
  function move(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!last.current) return;
    const ctx = canvas.current!.getContext("2d")!;
    const p = point(e);
    ctx.strokeStyle = "#0B1F4D";
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(last.current.x, last.current.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    last.current = p;
    setDrawn(true);
  }
  function clear() {
    const c = canvas.current!;
    c.getContext("2d")!.clearRect(0, 0, c.width, c.height);
    setDrawn(false);
  }

  function send(file: Blob, name: string) {
    setMessage(null);
    startTransition(async () => {
      try {
        const data = new FormData();
        data.set("signature", new File([file], name, { type: file.type }));
        const result = await saveSignatureAction(data);
        setMessage({ text: result.message ?? (result.ok ? "Saved" : "Could not save."), bad: !result.ok });
        if (result.ok) {
          clear();
          onSaved();
        }
      } catch {
        setMessage({ text: "The server could not be reached. Try again.", bad: true });
      }
    });
  }

  function saveDrawn() {
    canvas.current!.toBlob((blob) => {
      if (blob) send(blob, "signature.png");
    }, "image/png");
  }

  const button = compact ? "h-8 rounded-lg px-3 text-[12.5px]" : "h-10 rounded-[9px] px-4 text-[13.5px]";
  return (
    <div className="flex flex-col gap-2">
      <span className={"text-ink-2 font-semibold " + (compact ? "text-[12.5px]" : "text-[13px]")}>{title}</span>
      <canvas
        ref={canvas}
        width={720}
        height={220}
        aria-label="Draw your signature"
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={() => (last.current = null)}
        onPointerLeave={() => (last.current = null)}
        className={"border-field w-full touch-none rounded-lg border border-dashed bg-white " + (compact ? "max-w-[360px]" : "max-w-[480px]")}
        style={{ aspectRatio: "720 / 220" }}
      />
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={!drawn || pending}
          onClick={saveDrawn}
          className={`bg-ink border-0 font-semibold text-white disabled:opacity-50 ${button}`}
        >
          {pending ? "Saving…" : "Save drawn signature"}
        </button>
        <button type="button" disabled={!drawn || pending} onClick={clear} className={compact ? `border-field bg-white font-semibold ${button} border` : BTN_SECONDARY}>
          Clear
        </button>
        <label
          className={
            (compact ? `border-field bg-white font-semibold ${button} border` : BTN_SECONDARY) + " relative inline-flex cursor-pointer items-center overflow-hidden"
          }
        >
          Or upload an image
          <input
            type="file"
            aria-label="Upload a signature image"
            accept="image/png,image/jpeg,image/webp"
            disabled={pending}
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) send(file, file.name);
            }}
            className="absolute inset-0 cursor-pointer opacity-0"
          />
        </label>
      </div>
      {message ? (
        <span role="status" className={(compact ? "text-[12px] " : "text-[13px] ") + (message.bad ? "text-bad" : "text-ok")}>
          {message.text}
        </span>
      ) : null}
    </div>
  );
}
