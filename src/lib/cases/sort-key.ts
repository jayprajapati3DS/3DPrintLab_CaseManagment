/**
 * A key that makes case numbers sort the way people read them.
 *
 * Sorted as plain text, "E99" comes after "E934" and "JM-0430" before
 * "JM-99", because text compares character by character. Here every run of
 * digits is padded to a fixed width, so numbers compare as numbers while the
 * letters around them still compare as letters:
 *
 *   E99      → e000000000099
 *   E934     → e000000000934
 *   JM-0430  → jm-000000000430
 *
 * The key is stored on the case at sync time, which lets the list sort and
 * page in the database rather than loading every case to sort it here.
 *
 * The migration that added the column back-fills existing cases with the same
 * rule written in SQL; the two must stay in step.
 */

const WIDTH = 12;

export function caseSortKey(caseNumber: string | null | undefined): string | null {
  const value = (caseNumber ?? "").trim().toLowerCase();
  if (!value) return null;
  return value.replace(/\d+/g, (digits) => digits.padStart(WIDTH, "0").slice(-WIDTH));
}
