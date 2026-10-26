import type { QaItem } from "@/lib/qa/template";

/**
 * Sign-off by chosen people: "Reviewed by" and "Approved by" signatures.
 *
 * Whoever fills the form picks one or more people for each such field. On
 * submit the form goes to the first of them; each signs in turn — every
 * reviewer, then every approver, in the order of the fields and of the people
 * in them — and the last approver's signature approves the form.
 *
 * Kept in the form's values beside the field:
 *   `to:<item>`   the people chosen, [{ id, name }]
 *   `sigs:<item>` their signatures so far, one stamp each
 *   `<item>`      the names signed so far, for reading and print
 */

export interface SignPerson {
  id: string;
  name: string;
}

/** One signature: who, as which roles, when, and the copy of their signature image. */
export interface SignStamp extends SignPerson {
  roles: string;
  at: string;
  fileId?: string;
}

export const peopleKey = (itemId: string) => `to:${itemId}`;
export const stampsKey = (itemId: string) => `sigs:${itemId}`;

/** A field signed by chosen people, and which kind. */
export function chainField(item: Pick<QaItem, "type" | "signer">): "reviewer" | "approver" | null {
  return item.type === "sign" && (item.signer === "reviewer" || item.signer === "approver") ? item.signer : null;
}

function readList<T>(text: string | undefined, ok: (x: unknown) => x is T): T[] {
  if (!text) return [];
  try {
    const list = JSON.parse(text) as unknown;
    return Array.isArray(list) ? list.filter(ok) : [];
  } catch {
    return [];
  }
}

const isPerson = (x: unknown): x is SignPerson =>
  Boolean(x) && typeof (x as SignPerson).id === "string" && typeof (x as SignPerson).name === "string";

export const readPeople = (text: string | undefined): SignPerson[] => readList(text, isPerson);
export const readStamps = (text: string | undefined): SignStamp[] =>
  readList(text, (x): x is SignStamp => isPerson(x) && typeof (x as SignStamp).at === "string");

export interface SignStep {
  item: QaItem;
  kind: "reviewer" | "approver";
  person: SignPerson;
  signed: SignStamp | null;
}

/** Everyone who signs, in turn: reviewers first, then approvers. */
export function signSteps(items: QaItem[], values: Record<string, string>): SignStep[] {
  const steps: SignStep[] = [];
  for (const kind of ["reviewer", "approver"] as const) {
    for (const item of items) {
      if (chainField(item) !== kind) continue;
      const stamps = readStamps(values[stampsKey(item.id)]);
      for (const person of readPeople(values[peopleKey(item.id)])) {
        steps.push({ item, kind, person, signed: stamps.find((s) => s.id === person.id) ?? null });
      }
    }
  }
  return steps;
}
