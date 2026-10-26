/**
 * Everyone working on a case or a part, gathered from what they did on it —
 * the surgeon and sales on the case, the case team by status, the production
 * team by part — each with their roles and what they did.
 */

import type { TeamSection } from "@/lib/team";

const initials = (name: string) =>
  (name.match(/[A-Za-z][A-Za-z'-]*/g) ?? [])
    .filter((w) => !/^(dr|prof|mr|mrs|ms)$/i.test(w))
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase() || "?";

export function TeamPanel({ sections, subject }: { sections: TeamSection[]; subject: string }) {
  const any = sections.some((s) => s.people.length > 0);
  return (
    <div className="flex flex-col gap-5 p-4 sm:p-[22px]" data-testid="team">
      <div className="flex flex-col gap-0.5">
        <h3 className="m-0 text-[15px] font-bold">Team</h3>
        <p className="text-muted m-0 text-[12.5px]">Everyone working on this {subject} — from what each of them is assigned to and has done on it.</p>
      </div>
      {!any ? <div className="border-field text-muted rounded-[12px] border border-dashed p-6 text-center text-[13px]">No one yet.</div> : null}
      {sections
        .filter((s) => s.people.length > 0)
        .map((s) => (
          <section key={s.title} className="flex flex-col gap-2.5" aria-label={s.title}>
            <div className="flex flex-wrap items-baseline gap-x-2">
              <h4 className="text-brand m-0 text-[11px] font-bold tracking-[0.8px] uppercase">{s.title}</h4>
              <span className="text-muted text-[12px]">{s.hint}</span>
            </div>
            <ul className="m-0 grid list-none grid-cols-1 gap-2.5 p-0 sm:grid-cols-2 xl:grid-cols-3">
              {s.people.map((p) => (
                <li key={p.name} className="border-line flex gap-3 rounded-[12px] border bg-white px-3.5 py-3">
                  <span className="bg-brand-wash text-brand-ink flex h-9 w-9 flex-none items-center justify-center rounded-full text-[12px] font-bold">{initials(p.name)}</span>
                  <span className="flex min-w-0 flex-col gap-1">
                    <span className="text-ink text-[13.5px] font-semibold">{p.name}</span>
                    {p.roles ? <span className="text-muted text-[11.5px]">{p.roles}</span> : null}
                    <span className="flex flex-wrap gap-1">
                      {p.did.map((d) => (
                        <span key={d} className="bg-subtle text-ink-2 rounded-md px-1.5 py-[1px] text-[11px]">
                          {d}
                        </span>
                      ))}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ))}
    </div>
  );
}
