"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Row, SectionHead } from "@/components/setup/stage-board";
import { S_INPUT } from "@/components/setup/ui";
import type { HospitalDepartment } from "@/lib/cases/hospitals";
import { saveHospitalTeam } from "@/lib/resources/actions";

/**
 * A hospital's departments and its people — the surgeons and others who work
 * there — and, if needed, which departments each belongs to. The people are
 * the ones of Users & Roles; associating them here is the same as there.
 */

export interface TeamPerson {
  id: string;
  name: string;
  roles: string;
}

const uid = () => `dep-${(typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Math.random()).slice(2)).slice(0, 10)}`;

export function HospitalTeam({
  hospitalId,
  initialDepartments,
  initialPeople,
  everyone,
  canEdit,
}: {
  hospitalId: string;
  initialDepartments: HospitalDepartment[];
  /** Who works here now. */
  initialPeople: string[];
  /** Everyone active in the space, to add. */
  everyone: TeamPerson[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [departments, setDepartments] = useState(initialDepartments);
  const [people, setPeople] = useState(initialPeople);
  const [newDept, setNewDept] = useState("");
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const touch = () => {
    setDirty(true);
    setMessage(null);
  };
  const name = (id: string) => everyone.find((p) => p.id === id)?.name ?? "Someone no longer here";
  const roles = (id: string) => everyone.find((p) => p.id === id)?.roles ?? "";

  function addDepartment() {
    const n = newDept.trim();
    if (!n) return;
    if (departments.some((d) => d.name.toLowerCase() === n.toLowerCase())) return setMessage({ ok: false, text: `"${n}" is already a department.` });
    setDepartments((list) => [...list, { id: uid(), name: n, personIds: [] }]);
    setNewDept("");
    touch();
  }

  function toggle(deptId: string, personId: string) {
    setDepartments((list) =>
      list.map((d) => (d.id !== deptId ? d : { ...d, personIds: d.personIds.includes(personId) ? d.personIds.filter((x) => x !== personId) : [...d.personIds, personId] })),
    );
    touch();
  }

  function save() {
    startTransition(async () => {
      const result = await saveHospitalTeam(hospitalId, { departments, personIds: people });
      setMessage({ ok: result.ok, text: result.message ?? (result.ok ? "Saved." : "Could not save.") });
      if (result.ok) {
        setDirty(false);
        router.refresh();
      }
    });
  }

  const addable = everyone.filter((p) => !people.includes(p.id));
  return (
    <section className="border-line overflow-hidden rounded-[14px] border bg-white" aria-label="Departments and people">
      <div className="border-line-2 flex flex-wrap items-center gap-3 border-b px-4 py-3 sm:px-[22px]">
        <div className="flex min-w-[200px] flex-1 flex-col gap-0.5">
          <h3 className="m-0 text-sm font-bold">Departments &amp; people</h3>
          <p className="text-muted m-0 text-[12.5px]">A case form offers this hospital&apos;s departments — the surgeon&apos;s own, when they are linked to one.</p>
        </div>
        {canEdit ? (
          <>
            {message ? <span className={"text-[12.5px] " + (message.ok ? "text-ok" : "text-bad")}>{message.text}</span> : dirty ? <span className="text-warn text-[12.5px] font-semibold">Unsaved changes</span> : null}
            <button type="button" onClick={save} disabled={!dirty || pending} className="bg-brand h-9 rounded-lg border-0 px-4 text-[12.5px] font-semibold text-white disabled:opacity-50">
              {pending ? "Saving…" : "Save"}
            </button>
          </>
        ) : null}
      </div>

      <fieldset disabled={!canEdit || pending} className="m-0 min-w-0 border-0 p-0">
        <SectionHead title="Departments" />
        <Row label="Departments" hint="As the hospital names them — e.g. Ein Karem - Oral & Maxillofacial.">
          <div className="flex flex-col gap-2">
            {departments.length === 0 ? <span className="text-faint text-[12.5px]">No departments yet.</span> : null}
            {departments.map((d) => (
              <div key={d.id} className="flex items-center gap-2">
                <input
                  aria-label="Department name"
                  value={d.name}
                  onChange={(e) => {
                    setDepartments((list) => list.map((x) => (x.id === d.id ? { ...x, name: e.target.value } : x)));
                    touch();
                  }}
                  className={`${S_INPUT} h-8 max-w-[360px]`}
                />
                <span className="text-muted text-[12px] whitespace-nowrap">
                  {d.personIds.length} {d.personIds.length === 1 ? "person" : "people"}
                </span>
                <button
                  type="button"
                  aria-label={`Remove department ${d.name}`}
                  onClick={() => {
                    setDepartments((list) => list.filter((x) => x.id !== d.id));
                    touch();
                  }}
                  className="text-bad border-0 bg-transparent px-1 text-[15px]"
                >
                  ×
                </button>
              </div>
            ))}
            <div className="flex items-center gap-2">
              <input
                aria-label="New department"
                value={newDept}
                placeholder="Add a department…"
                onChange={(e) => setNewDept(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addDepartment();
                  }
                }}
                className={`${S_INPUT} h-8 max-w-[360px]`}
              />
              <button type="button" onClick={addDepartment} className="border-field text-ink-2 h-8 rounded-lg border bg-white px-3 text-[12.5px] font-semibold">
                + Add department
              </button>
            </div>
          </div>
        </Row>

        <SectionHead title="People" />
        <Row label="Who works here" hint="Surgeons and others — added on Users & Roles. Link each to departments if needed.">
          <div className="flex flex-col gap-2">
            {people.length === 0 ? <span className="text-faint text-[12.5px]">Nobody associated yet.</span> : null}
            {people.map((pid) => (
              <div key={pid} className="border-line-2 flex flex-col gap-1.5 rounded-[10px] border px-3 py-2" data-testid={`hospital-person-${name(pid)}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-ink text-[13px] font-semibold">{name(pid)}</span>
                  {roles(pid) ? <span className="text-muted text-[12px]">{roles(pid)}</span> : null}
                  <span className="flex-1" />
                  <button
                    type="button"
                    aria-label={`Remove ${name(pid)} from this hospital`}
                    onClick={() => {
                      setPeople((list) => list.filter((x) => x !== pid));
                      setDepartments((list) => list.map((d) => ({ ...d, personIds: d.personIds.filter((x) => x !== pid) })));
                      touch();
                    }}
                    className="text-bad border-0 bg-transparent p-0 text-[12px] font-semibold"
                  >
                    Remove
                  </button>
                </div>
                {departments.length ? (
                  <div role="group" aria-label={`${name(pid)} departments`} className="flex flex-wrap gap-1.5">
                    {departments.map((d) => {
                      const on = d.personIds.includes(pid);
                      return (
                        <button
                          key={d.id}
                          type="button"
                          aria-pressed={on}
                          onClick={() => toggle(d.id, pid)}
                          className={"rounded-full border px-2.5 py-0.5 text-[11.5px] font-semibold " + (on ? "border-brand-edge bg-brand-wash text-brand-ink" : "border-field text-ink-3 bg-white")}
                        >
                          {on ? "✓ " : "+ "}
                          {d.name}
                        </button>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            ))}
            {addable.length ? (
              <select
                aria-label="Add a person to this hospital"
                value=""
                onChange={(e) => {
                  if (!e.target.value) return;
                  setPeople((list) => [...list, e.target.value]);
                  touch();
                }}
                className="border-field text-ink-2 h-8 max-w-[360px] rounded-lg border bg-white px-2 text-[12.5px] font-semibold"
              >
                <option value="">+ Add a person…</option>
                {addable.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                    {p.roles ? ` — ${p.roles}` : ""}
                  </option>
                ))}
              </select>
            ) : null}
          </div>
        </Row>
      </fieldset>
    </section>
  );
}
