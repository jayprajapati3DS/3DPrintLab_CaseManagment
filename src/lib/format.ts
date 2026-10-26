import { formatInTimeZone } from "date-fns-tz";

/** Used until a space has a platform connection that says otherwise. */
export const DEFAULT_TIMEZONE = "Asia/Kolkata";

/** `Oct 09, 2026` — the design's long date. */
export function fmtDate(value: Date | null | undefined, timeZone = DEFAULT_TIMEZONE): string {
  if (!value) return "—";
  return formatInTimeZone(value, timeZone, "MMM dd, yyyy");
}

/** `Oct 09` — the design's short date, for cards. */
export function fmtShortDate(value: Date | null | undefined, timeZone = DEFAULT_TIMEZONE): string {
  if (!value) return "—";
  return formatInTimeZone(value, timeZone, "MMM dd");
}

/** `Oct 09, 2026 · 14:32` */
export function fmtDateTime(value: Date | null | undefined, timeZone = DEFAULT_TIMEZONE): string {
  if (!value) return "—";
  return formatInTimeZone(value, timeZone, "MMM dd, yyyy · HH:mm");
}

/** Up to two initials, for avatars. */
export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
}

/**
 * `Rahul Kulkarni` → `R. Kulkarni`. Lists show the patient this way, as the
 * design does; the full name stays behind the audited reveal on the case.
 */
export function shortPatientName(name: string | null | undefined): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "—";
  if (parts.length === 1) return `${parts[0][0].toUpperCase()}.`;
  return `${parts[0][0].toUpperCase()}. ${parts[parts.length - 1]}`;
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString("en-IN")} ${n === 1 ? one : many}`;
}
