/**
 * A hospital's departments, and who works in each. A person works at a
 * hospital (users.hospitalIds — set here or on Users & Roles); within it they
 * may also belong to one or more departments, so a case form can offer the
 * surgeon's own department. Pure: the hospital page, the case form and the
 * server all read it.
 */

export interface HospitalDepartment {
  id: string;
  name: string;
  /** People of the space in this department. */
  personIds: string[];
}

export function readDepartments(data: unknown): HospitalDepartment[] {
  const list = ((data ?? {}) as { departments?: unknown }).departments;
  if (!Array.isArray(list)) return [];
  return list
    .filter((d): d is Record<string, unknown> => Boolean(d) && typeof d === "object")
    .map((d) => ({
      id: String(d.id ?? ""),
      name: String(d.name ?? "").trim(),
      personIds: Array.isArray(d.personIds) ? d.personIds.filter((p): p is string => typeof p === "string") : [],
    }))
    .filter((d) => d.id && d.name);
}

/** The departments a case form offers: the surgeon's own at that hospital, else all of them. */
export function departmentsFor(departments: HospitalDepartment[], surgeonId: string | null): HospitalDepartment[] {
  const mine = surgeonId ? departments.filter((d) => d.personIds.includes(surgeonId)) : [];
  return mine.length ? mine : departments;
}
