"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { useToast } from "@/components/ui/toast";
import { GROUP_COLOURS, GROUP_LABELS, type VarGroup } from "@/lib/qa/variables";

export interface VarRow {
  token: string;
  label: string;
  group: VarGroup;
  kind: string;
  description: string;
  example: string;
  usedIn: Array<{ id: string; code: string }>;
}

export interface LibraryRow {
  key: string;
  name: string;
  page: { title: string; href: string } | null;
  count: number;
  first: string[];
  usedIn: string[];
}

export function VarsView({
  vars,
  libraries,
  parts,
  partId,
  backHref,
  backLabel,
}: {
  vars: VarRow[];
  libraries: LibraryRow[];
  parts: Array<{ id: string; label: string }>;
  partId: string | null;
  backHref: string;
  backLabel: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const { toast, node } = useToast();
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState<VarGroup | "all">("all");

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return vars.filter(
      (v) =>
        (group === "all" || v.group === group) &&
        (!q || `${v.label} ${v.token} ${v.description} ${GROUP_LABELS[v.group]}`.toLowerCase().includes(q)),
    );
  }, [vars, query, group]);

  const groups = (Object.keys(GROUP_LABELS) as VarGroup[]).map((g) => [g, vars.filter((v) => v.group === g).length] as const);
  const inUse = vars.filter((v) => v.usedIn.length).length;

  async function copy(token: string) {
    try {
      await navigator.clipboard.writeText(`{${token}}`);
      toast(`Copied {${token}}`);
    } catch {
      toast("Copying is blocked by this browser — select the token and copy it by hand.", true);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <section className="border-line flex flex-col gap-3.5 rounded-[14px] border bg-white px-4 py-[18px] sm:px-[22px]">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex max-w-[720px] flex-col gap-0.5">
            <h2 className="m-0 text-[15px] font-bold">Variable library</h2>
            <p className="text-muted m-0 text-[12.5px] leading-[1.5]">
              Type a variable such as {"{part.id}"} in any QA form field and it is filled automatically from the part, case or request. Click a token to copy it.
            </p>
          </div>
          <Link href={backHref} className="border-field text-ink-2 flex h-9 items-center rounded-[9px] border bg-white px-3 text-[13px] font-semibold no-underline">
            ← {backLabel}
          </Link>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <input
            type="search"
            aria-label="Search variables"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name, token or source…"
            className="border-line h-9 w-full rounded-[9px] border bg-white px-3 text-[13px] sm:w-[280px]"
          />
          <label className="text-muted flex min-w-0 items-center gap-2 text-xs">
            Example values from
            <select
              value={partId ?? ""}
              onChange={(e) => router.replace(`${pathname}?view=vars${e.target.value ? `&part=${e.target.value}` : ""}`, { scroll: false })}
              className="border-line h-9 max-w-[260px] min-w-0 rounded-[9px] border bg-white px-2 text-[13px]"
            >
              {parts.length === 0 ? <option value="">No parts yet</option> : null}
              {parts.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
          <span className="text-muted text-xs">
            {shown.length} of {vars.length} variables · {inUse} in use
          </span>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {([["all", vars.length]] as Array<readonly [VarGroup | "all", number]>).concat(groups).map(([g, n]) => (
            <button
              key={g}
              type="button"
              aria-pressed={group === g}
              onClick={() => setGroup(g)}
              className={"h-8 rounded-full border px-3 text-xs font-semibold " + (group === g ? "border-ink bg-ink text-white" : "border-field text-ink-2 bg-white")}
            >
              {g === "all" ? "All" : GROUP_LABELS[g]} · {n}
            </button>
          ))}
        </div>

        <div className="border-line overflow-x-auto rounded-[10px] border">
          <table className="w-full min-w-[820px] border-collapse">
            <thead className="bg-subtle">
              <tr>
                {["Variable", "Where the value comes from", "Type", "Example value", "Used in forms"].map((h) => (
                  <th key={h} className="text-muted px-3 py-2.5 text-left text-[10.5px] font-bold tracking-[0.5px] uppercase">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.map((v) => (
                <tr key={v.token}>
                  <td className="border-line-3 border-t px-3 py-2.5 align-top">
                    <div className="flex flex-col items-start gap-1">
                      <span className="text-[13px] font-semibold">{v.label}</span>
                      <button
                        type="button"
                        onClick={() => copy(v.token)}
                        className="border-line-2 bg-subtle text-brand-ink rounded-md border px-2 py-0.5 font-mono text-xs"
                      >
                        {`{${v.token}}`} ⧉
                      </button>
                    </div>
                  </td>
                  <td className="border-line-3 border-t px-3 py-2.5 align-top text-[12.5px]">
                    <span className="font-semibold" style={{ color: GROUP_COLOURS[v.group] }}>
                      {GROUP_LABELS[v.group]}
                    </span>
                    <span className="text-muted block">{v.description}</span>
                  </td>
                  <td className="border-line-3 text-ink-3 border-t px-3 py-2.5 align-top text-[12.5px]">{v.kind}</td>
                  <td className="border-line-3 border-t px-3 py-2.5 align-top text-[12.5px]">
                    {v.example ? (
                      <span className="text-ink break-words">{v.kind === "Image" ? "[image]" : v.example}</span>
                    ) : (
                      <span className="text-faint">No value for this part</span>
                    )}
                  </td>
                  <td className="border-line-3 border-t px-3 py-2.5 align-top text-[12.5px]">
                    {v.usedIn.length ? (
                      <div className="flex flex-col items-start gap-1">
                        <span className="text-ink-2">
                          Used in {v.usedIn.length} form{v.usedIn.length === 1 ? "" : "s"}
                        </span>
                        <div className="flex flex-wrap gap-1">
                          {v.usedIn.map((f) => (
                            <Link key={f.id} href={`/qaforms/${f.id}`} className="bg-brand-tint text-brand-ink rounded px-1.5 py-px font-mono text-[11px] no-underline">
                              {f.code || "form"}
                            </Link>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <span className="text-faint">Not used yet</span>
                    )}
                  </td>
                </tr>
              ))}
              {shown.length === 0 ? (
                <tr>
                  <td colSpan={5} className="text-muted px-3 py-8 text-center text-[13px]">
                    No variables match.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="border-line flex flex-col gap-3.5 rounded-[14px] border bg-white px-4 py-[18px] sm:px-[22px]">
        <div className="flex flex-col gap-0.5">
          <h2 className="m-0 text-[15px] font-bold">Dropdown libraries</h2>
          <p className="text-muted m-0 text-[12.5px] leading-[1.5]">
            Live lists from the setup pages, for “Dropdown” fields. What is picked is saved as a traceability record on the part and on that item&apos;s Usage records tab.
          </p>
        </div>
        <div className="border-line overflow-x-auto rounded-[10px] border">
          <table className="w-full min-w-[720px] border-collapse">
            <thead className="bg-subtle">
              <tr>
                {["Library", "Options", "Current entries", "Used in"].map((h) => (
                  <th key={h} className="text-muted px-3 py-2.5 text-left text-[10.5px] font-bold tracking-[0.5px] uppercase">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {libraries.map((l) => (
                <tr key={l.key}>
                  <td className="border-line-3 border-t px-3 py-2.5 align-top text-[13px]">
                    <span className="font-semibold">{l.name}</span>
                    {l.page ? (
                      <span className="text-muted block text-[11.5px]">
                        Managed on:{" "}
                        <Link href={l.page.href} className="text-brand-ink no-underline">
                          {l.page.title}
                        </Link>
                      </span>
                    ) : null}
                  </td>
                  <td className="border-line-3 border-t px-3 py-2.5 align-top font-mono text-[13px]">{l.count}</td>
                  <td className="border-line-3 text-ink-2 border-t px-3 py-2.5 align-top text-[12.5px]">
                    {l.first.length ? `${l.first.join(", ")}${l.count > l.first.length ? ` +${l.count - l.first.length} more` : ""}` : <span className="text-faint">No entries yet</span>}
                  </td>
                  <td className="border-line-3 text-ink-2 border-t px-3 py-2.5 align-top text-[12.5px]">
                    {l.usedIn.length ? `Dropdowns in ${l.usedIn.join(", ")}` : <span className="text-faint">Not used in any dropdown yet</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      {node}
    </div>
  );
}
