"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * The dark confirmation that appears at the foot of the screen after an
 * action, as the design draws it. One at a time; it leaves by itself.
 */
export function useToast() {
  const [message, setMessage] = useState<{ text: string; bad: boolean; seq: number } | null>(null);
  const seq = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const toast = useCallback((text: string, bad = false) => {
    if (timer.current) clearTimeout(timer.current);
    seq.current += 1;
    setMessage({ text, bad, seq: seq.current });
    timer.current = setTimeout(() => setMessage(null), bad ? 6000 : 3200);
  }, []);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const node = (
    <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-6 z-[60] flex justify-center px-4">
      {message ? (
        <div
          // A new element per message, so each one is announced afresh.
          key={message.seq}
          role={message.bad ? "alert" : "status"}
          data-toast={message.seq}
          className={
            "max-w-[560px] rounded-xl px-4 py-3 text-[13px] font-medium text-white shadow-[0_12px_30px_rgba(16,24,40,.3)] " +
            (message.bad ? "bg-bad" : "bg-ink")
          }
        >
          {message.text}
        </div>
      ) : null}
    </div>
  );

  return { toast, node };
}
