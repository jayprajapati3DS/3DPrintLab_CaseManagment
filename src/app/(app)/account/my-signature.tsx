"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { removeSignatureAction } from "@/app/(app)/account/actions";
import { SignaturePad } from "@/components/account/signature-pad";
import { BTN_SECONDARY, CARD } from "@/components/ui/styles";

/**
 * My signature: drawn here with a mouse, pen or finger, or uploaded as a
 * picture. Quality forms whose signature asks for an image use it, and keep a
 * copy of it with the record.
 */
export function MySignature({ version }: { version: string | null }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ text: string; bad: boolean } | null>(null);
  function remove() {
    startTransition(async () => {
      const result = await removeSignatureAction();
      setMessage({ text: result.message ?? "", bad: !result.ok });
      router.refresh();
    });
  }

  return (
    <section className={`${CARD} flex flex-col`}>
      <div className="border-line-3 flex flex-col gap-0.5 border-b px-5 py-4">
        <span className="text-[15px] font-semibold">My signature</span>
        <span className="text-muted text-[12.5px]">
          Used on quality forms that ask for a signature image. Each form you sign keeps its own copy, so changing it here does not
          change anything already signed.
        </span>
      </div>
      <div className="flex flex-col gap-4 px-5 py-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="border-line bg-subtle flex h-[90px] w-[240px] items-center justify-center overflow-hidden rounded-lg border">
            {version ? (
              // eslint-disable-next-line @next/next/no-img-element -- the person's own stored signature
              <img src={`/api/signatures/me?v=${encodeURIComponent(version)}`} alt="Your signature" className="max-h-full max-w-full object-contain" />
            ) : (
              <span className="text-faint text-[12.5px]">No signature yet</span>
            )}
          </div>
          {version ? (
            <button type="button" disabled={pending} onClick={remove} className={BTN_SECONDARY}>
              Remove
            </button>
          ) : null}
        </div>

        <SignaturePad title={version ? "Replace it — draw below" : "Draw it below"} onSaved={() => router.refresh()} />
        {message ? (
          <span role="status" className={"text-[13px] " + (message.bad ? "text-bad" : "text-ok")}>
            {message.text}
          </span>
        ) : null}
      </div>
    </section>
  );
}
