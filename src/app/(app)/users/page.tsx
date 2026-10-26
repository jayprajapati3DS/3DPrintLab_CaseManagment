import type { Metadata } from "next";

import {
  deleteRoleMappingAction,
  saveRoleMappingAction,
  setUserActiveAction,
} from "@/app/(app)/users/actions";
import {
  BTN_PRIMARY,
  BTN_SMALL,
  CARD,
  CARD_HEADER,
  INPUT,
  LABEL,
  TABLE_HEAD,
  TABLE_ROW,
} from "@/components/ui/styles";
import { PeopleEditor } from "@/app/(app)/users/people-editor";
import { spaceRoles } from "@/lib/auth/roles";
import { requireSpaceAdmin, ROLE_LABELS, userRoleNames } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { fmtDateTime, plural } from "@/lib/format";
import { spaceTimeZone } from "@/lib/queries/cases";

export const metadata: Metadata = { title: "Users & Roles" };

const USER_COLUMNS =
  "grid min-w-[760px] grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_120px_170px_110px] items-center gap-3";
const ROLE_COLUMNS = "grid min-w-[480px] grid-cols-[minmax(0,1fr)_160px_120px] items-center gap-3";

export default async function UsersPage() {
  const user = await requireSpaceAdmin();

  const [users, mappings, space, timeZone, hospitals, roles] = await Promise.all([
    db.user.findMany({
      where: { spaceId: user.space.id },
      orderBy: [{ isActive: "desc" }, { name: "asc" }],
    }),
    db.roleMapping.findMany({
      where: { spaceId: user.space.id },
      orderBy: { platformRoleName: "asc" },
    }),
    db.space.findUnique({ where: { id: user.space.id }, select: { adminEmail: true } }),
    spaceTimeZone(user.space.id),
    db.resource.findMany({ where: { spaceId: user.space.id, kind: "hospitals", archivedAt: null }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    spaceRoles(user.space.id),
  ]);

  return (
    <div className="flex max-w-[1080px] flex-col gap-5">
      <section className={`${CARD} overflow-x-auto`}>
        <div className={CARD_HEADER}>
          <div className="flex min-w-[220px] flex-1 flex-col gap-0.5">
            <h2 className="m-0 text-[15px] font-semibold">People in {user.space.name}</h2>
            <p className="text-muted m-0 text-[12.5px]">
              Accounts appear here the first time someone signs in with their platform account.
              The space admin has a local account, which works before the platform is connected.
            </p>
          </div>
          <div className="text-muted font-mono text-xs whitespace-nowrap">{plural(users.length, "person", "people")}</div>
        </div>
        <div className={`${TABLE_HEAD} ${USER_COLUMNS}`}>
          <div>Person</div>
          <div>Platform role</div>
          <div>Role here</div>
          <div>Last sign-in</div>
          <div />
        </div>
        {users.length === 0 ? (
          <div className="text-muted px-5 py-10 text-center text-[13px]">
            Nobody has signed in to this space yet.
          </div>
        ) : (
          users.map((u) => (
            <div key={u.id} className={`${TABLE_ROW} ${USER_COLUMNS} ${u.isActive ? "" : "opacity-60"}`}>
              <div className="flex min-w-0 flex-col gap-0.5">
                <div className="truncate font-semibold">{u.name}</div>
                <div className="text-muted truncate text-xs">{u.email}</div>
              </div>
              <div className="text-ink-3 truncate">
                {u.platformRoleName ?? (u.passwordHash ? "Local account" : "—")}
              </div>
              <div>
                <span className="bg-brand-tint text-brand-ink rounded-full px-2.5 py-1 text-xs font-semibold">
                  {ROLE_LABELS[u.role]}
                </span>
              </div>
              <div className="text-ink-3 font-mono text-[12.5px]">
                {u.lastLoginAt ? fmtDateTime(u.lastLoginAt, timeZone) : "—"}
              </div>
              <div className="flex justify-end">
                {u.id === user.id ? (
                  <span className="text-muted text-xs">You</span>
                ) : (
                  <form action={setUserActiveAction}>
                    <input type="hidden" name="id" value={u.id} />
                    <input type="hidden" name="isActive" value={String(!u.isActive)} />
                    <button type="submit" className={BTN_SMALL}>
                      {u.isActive ? "Deactivate" : "Reactivate"}
                    </button>
                  </form>
                )}
              </div>
            </div>
          ))
        )}
      </section>

      <section className={CARD} aria-label="People and their hospitals">
        <div className={CARD_HEADER}>
          <div className="flex flex-col gap-0.5">
            <h2 className="m-0 text-[15px] font-semibold">People and their hospitals</h2>
            <p className="text-muted m-0 max-w-[720px] text-[12.5px] leading-[1.5]">
              Who a case form can offer as surgeon (by role) and the hospitals each works at. Add someone who never signs in
              here — a surgeon, say — with a role of their own.
            </p>
          </div>
        </div>
        <PeopleEditor
          roles={roles}
          hospitals={hospitals}
          people={users
            .filter((u) => u.isActive)
            .map((u) => ({
              id: u.id,
              name: u.name,
              email: u.email,
              role: u.platformRoleName ?? userRoleNames(u).join(", "),
              local: !u.platformUserId && !u.passwordHash,
              surgeonOnly: u.surgeonOnly,
              login: u.platformUserId ? "platform" : u.passwordHash ? "password" : "none",
              isAdmin: u.role === "SPACE_ADMIN",
              hospitalIds: u.hospitalIds,
            }))}
        />
      </section>

      <section className={`${CARD} overflow-x-auto`}>
        <div className={CARD_HEADER}>
          <div className="flex flex-col gap-0.5">
            <h2 className="m-0 text-[15px] font-semibold">Who may sign in</h2>
            <p className="text-muted m-0 max-w-[720px] text-[12.5px] leading-[1.5]">
              Only platform roles listed here can sign in to this space — the platform also holds
              surgeons and distributors, who do not belong in it. The name must match the role on
              the platform exactly. {space?.adminEmail} is always a space admin.
            </p>
          </div>
        </div>
        <div className={`${TABLE_HEAD} ${ROLE_COLUMNS}`}>
          <div>Platform role</div>
          <div>Signs in as</div>
          <div />
        </div>
        {mappings.map((m) => (
          <div key={m.id} className={`${TABLE_ROW} ${ROLE_COLUMNS}`}>
            <div className="font-semibold">{m.platformRoleName}</div>
            <div className="text-ink-3">{ROLE_LABELS[m.role]}</div>
            <form action={deleteRoleMappingAction} className="flex justify-end">
              <input type="hidden" name="id" value={m.id} />
              <button type="submit" className={BTN_SMALL}>
                Remove
              </button>
            </form>
          </div>
        ))}
        {mappings.length === 0 ? (
          <div className="text-muted px-5 py-8 text-center text-[13px]">
            No platform role is allowed in yet. Only the space admin can sign in.
          </div>
        ) : null}

        <form
          action={saveRoleMappingAction}
          className="border-line-3 bg-subtle flex flex-wrap items-end gap-3 border-t px-4 py-4 sm:px-5"
        >
          <label className="flex min-w-[200px] flex-1 flex-col gap-1.5">
            <span className={LABEL}>Platform role name</span>
            <input
              name="platformRoleName"
              required
              placeholder="e.g. Production Engineer"
              className={INPUT}
            />
          </label>
          <label className="flex min-w-[160px] flex-1 flex-col gap-1.5 sm:w-[180px] sm:flex-none">
            <span className={LABEL}>Signs in as</span>
            <select name="role" defaultValue="MEMBER" className={INPUT}>
              <option value="MEMBER">{ROLE_LABELS.MEMBER}</option>
              <option value="SPACE_ADMIN">{ROLE_LABELS.SPACE_ADMIN}</option>
            </select>
          </label>
          <button type="submit" className={BTN_PRIMARY}>
            Allow role
          </button>
        </form>
      </section>
    </div>
  );
}
