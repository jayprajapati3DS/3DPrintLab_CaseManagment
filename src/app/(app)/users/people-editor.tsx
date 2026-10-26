"use client";

import { useRouter } from "next/navigation";
import { useActionState, useState, useTransition } from "react";

import { addPersonAction, savePersonAction } from "@/app/(app)/users/actions";
import { BTN_PRIMARY, BTN_SMALL, INPUT, LABEL } from "@/components/ui/styles";

/**
 * People and the hospitals they work at — what a case form's surgeon and
 * hospital fields offer. Someone who never signs in here (a surgeon, say) is
 * added with a role of their own.
 */

export interface PersonRow {
  id: string;
  name: string;
  email: string;
  role: string;
  /** Added here (no login): their role is kept here and can be changed. */
  local: boolean;
  hospitalIds: string[];
  /** Surgeon access: their own cases' Order tab only. */
  surgeonOnly?: boolean;
  /** How they sign in: their platform account, a password kept here, or not at all. */
  login?: "platform" | "password" | "none";
  isAdmin?: boolean;
}

export function PeopleEditor({ people, hospitals, roles }: { people: PersonRow[]; hospitals: Array<{ id: string; name: string }>; roles: string[] }) {
  const [state, add, adding] = useActionState(addPersonAction, null);
  return (
    <div className="flex flex-col">
      {people.map((p) => (
        <PersonLine key={p.id} person={p} hospitals={hospitals} roles={roles} />
      ))}
      <form action={add} className="border-line-3 bg-subtle flex flex-wrap items-end gap-3 border-t px-4 py-4 sm:px-5">
        <label className="flex min-w-[180px] flex-1 flex-col gap-1.5">
          <span className={LABEL}>Name</span>
          <input name="name" required placeholder="e.g. Dr. A. Cohen" className={INPUT} />
        </label>
        <label className="flex min-w-[200px] flex-1 flex-col gap-1.5">
          <span className={LABEL}>Email</span>
          <input name="email" type="email" required placeholder="name@hospital.org" className={INPUT} />
        </label>
        <label className="flex min-w-[150px] flex-col gap-1.5 sm:w-[180px]">
          <span className={LABEL}>Role</span>
          <input name="roleName" required defaultValue="Surgeon" list="people-roles" className={INPUT} />
        </label>
        <datalist id="people-roles">
          {["Surgeon", ...roles].filter((r, i, all) => all.indexOf(r) === i).map((r) => (
            <option key={r} value={r} />
          ))}
        </datalist>
        <button type="submit" disabled={adding} className={BTN_PRIMARY}>
          {adding ? "Adding…" : "+ Add person"}
        </button>
        {state ? (
          <span role="status" className={"w-full text-[12.5px] " + (state.ok ? "text-ok" : "text-bad")}>
            {state.message}
          </span>
        ) : null}
      </form>
    </div>
  );
}

function PersonLine({ person, hospitals, roles }: { person: PersonRow; hospitals: Array<{ id: string; name: string }>; roles: string[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [roleName, setRoleName] = useState(person.role);
  const [ids, setIds] = useState(person.hospitalIds);
  const [surgeonOnly, setSurgeonOnly] = useState(Boolean(person.surgeonOnly));
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const names = person.hospitalIds.map((id) => hospitals.find((h) => h.id === id)?.name).filter(Boolean);

  function save() {
    startTransition(async () => {
      const result = await savePersonAction(person.id, { roleName: person.local ? roleName : undefined, hospitalIds: ids, surgeonOnly, password });
      if (result.ok) setPassword("");
      setMessage(result.message);
      if (result.ok) {
        setOpen(false);
        router.refresh();
      }
    });
  }

  return (
    <div className="border-line-3 flex flex-col gap-2 border-t px-4 py-3 sm:px-5" data-testid={`person-${person.email}`}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <div className="flex min-w-[200px] flex-1 flex-col">
          <span className="text-[13px] font-semibold">{person.name}</span>
          <span className="text-muted text-xs">
            {person.role || "—"}
            {person.login === "password" ? " · signs in with a password set here" : person.local ? " · added here, no login" : ""}
            {person.surgeonOnly ? " · surgeon access (Order tab only)" : ""}
          </span>
        </div>
        <div className="text-ink-3 min-w-[160px] flex-[1.4] text-[12.5px]">{names.length ? names.join(", ") : <span className="text-faint">No hospitals</span>}</div>
        <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className={BTN_SMALL} aria-label={`Edit ${person.name}`}>
          {open ? "Close" : "Edit"}
        </button>
      </div>
      {open ? (
        <div className="bg-subtle flex flex-col gap-3 rounded-[10px] p-3">
          {person.local ? (
            <label className="flex max-w-[260px] flex-col gap-1.5">
              <span className={LABEL}>Role</span>
              <input aria-label="Role" value={roleName} list="people-roles-edit" onChange={(e) => setRoleName(e.target.value)} className={INPUT} />
              <datalist id="people-roles-edit">
                {roles.map((r) => (
                  <option key={r} value={r} />
                ))}
              </datalist>
            </label>
          ) : null}
          <div className="flex flex-col gap-1.5">
            <span className={LABEL}>Hospitals</span>
            {hospitals.length ? (
              <div role="group" aria-label={`${person.name} hospitals`} className="flex flex-wrap gap-1.5">
                {hospitals.map((h) => {
                  const on = ids.includes(h.id);
                  return (
                    <button
                      key={h.id}
                      type="button"
                      aria-pressed={on}
                      onClick={() => setIds((list) => (on ? list.filter((x) => x !== h.id) : [...list, h.id]))}
                      className={"rounded-full border px-2.5 py-1 text-xs font-semibold " + (on ? "border-brand-edge bg-brand-wash text-brand-ink" : "border-field text-ink-2 bg-white")}
                    >
                      {on ? "✓ " : "+ "}
                      {h.name}
                    </button>
                  );
                })}
              </div>
            ) : (
              <span className="text-muted text-[12.5px]">No hospitals yet — add them on the Hospitals page.</span>
            )}
          </div>
          {person.isAdmin ? null : (
            <div className="flex flex-col gap-2">
              <span className={LABEL}>Access</span>
              <label className="flex items-center gap-2 text-[13px]">
                <input type="checkbox" checked={surgeonOnly} aria-label={`Surgeon access for ${person.name}`} onChange={(e) => setSurgeonOnly(e.target.checked)} className="h-4 w-4" />
                Surgeon access — sees only their own cases&apos; Order tab (My Orders), to check, fill and sign
              </label>
              {person.login === "platform" ? (
                <span className="text-muted text-[12px]">Signs in with their 3D Surgical Platform account.</span>
              ) : (
                <label className="flex max-w-[320px] flex-col gap-1.5">
                  <span className="text-muted text-[12px]">{person.login === "password" ? "Change their sign-in password" : "Give them a sign-in password (10+ characters)"}</span>
                  <input type="password" autoComplete="new-password" aria-label={`Sign-in password for ${person.name}`} value={password} onChange={(e) => setPassword(e.target.value)} className={INPUT} />
                </label>
              )}
            </div>
          )}
          <div className="flex items-center gap-3">
            <button type="button" disabled={pending} onClick={save} className={BTN_PRIMARY}>
              {pending ? "Saving…" : "Save"}
            </button>
            {message ? <span className="text-muted text-[12.5px]">{message}</span> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
