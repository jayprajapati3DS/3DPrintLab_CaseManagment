import { stageLocked } from "@/lib/resources/config";

/**
 * A case's — or a part's — stages as a numbered timeline: done ones ticked, the current one
 * ringed, those whose quality forms must be approved tagged APPROVAL, those whose information
 * is locked tagged LOCKED.
 */
export function StatusTimeline({
  stages,
  current,
}: {
  stages: Array<{ name: string; forms: string[]; formsRequired?: boolean; lockInfo?: "stage" | "onward"; lockRoles?: string }>;
  current: number;
}) {
  return (
    <div className="overflow-x-auto pb-2">
      <ol className="m-0 flex w-full min-w-max list-none p-0" aria-label="Stages">
        {stages.map((s, i) => {
          const done = i < current;
          const now = i === current;
          const approval = s.forms.length > 0 && s.formsRequired !== false;
          return (
            <li key={i} aria-current={now ? "step" : undefined} className="relative flex min-w-[118px] flex-1 flex-col items-center gap-1.5">
              {i < stages.length - 1 ? (
                <span className={"absolute top-[15px] left-1/2 h-[3px] w-full " + (done ? "bg-brand" : "bg-[#E4E7EC]")} aria-hidden="true" />
              ) : null}
              <span
                className={
                  "relative flex h-[32px] w-[32px] items-center justify-center rounded-full border-2 text-[12.5px] font-bold " +
                  (done ? "border-brand bg-brand text-white" : now ? "border-brand text-brand bg-white" : "border-[#D0D5DD] bg-white text-[#98A2B3]")
                }
              >
                {done ? (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M5 12.5l4.5 4.5L19 7.5" />
                  </svg>
                ) : (
                  i + 1
                )}
              </span>
              <span className={"px-1 text-center text-[12.5px] leading-[1.3] " + (now ? "text-ink font-bold" : done ? "text-ink-2 font-medium" : "text-[#98A2B3] font-medium")}>{s.name}</span>
              {approval ? <span className="rounded bg-[#FFFAEB] px-1.5 py-[1px] text-[10px] font-bold tracking-[0.5px] text-[#DC6803]">APPROVAL</span> : null}
              {stageLocked(stages, i) ? (
                <span className="flex items-center gap-1 rounded bg-[#F2F4F7] px-1.5 py-[1px] text-[10px] font-bold tracking-[0.5px] text-[#344054]" title={(stages.find((_, j) => j <= i && stageLocked(stages, j))?.lockRoles ?? "").trim() ? "Information locked for some roles" : "Information locked for everyone"}>
                  <LockIcon />
                  LOCKED
                </span>
              ) : null}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

export function LockIcon({ size = 10 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  );
}
