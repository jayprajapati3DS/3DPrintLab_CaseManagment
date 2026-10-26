/**
 * How a case's free-text platform status is read.
 *
 * The platform sends status, state and priority as display strings, and each
 * tenant can word them differently. Everything that interprets those strings
 * lives here, so the tiles, badges and dashboard cannot drift apart — and so
 * there is one place to adjust when a tenant's wording does not match.
 *
 * No server-only imports: the badge helpers are used by client components.
 */

export type CaseBucket = "NEW" | "ACTIVE" | "COMPLETED" | "ARCHIVED";

/**
 * Which tile a case counts under. Decided once, at sync, and stored on the
 * case so lists can filter on an indexed column rather than pattern-matching
 * text on every request.
 */
export function classifyCase(c: {
  caseStatus: string | null;
  caseState: string | null;
  isArchived: boolean;
}): CaseBucket {
  if (c.isArchived || /archiv|cancel/i.test(c.caseState ?? "")) return "ARCHIVED";
  const status = c.caseStatus ?? "";
  if (/complet|shipp|deliver|closed/i.test(status)) return "COMPLETED";
  if (/creat|^new\b|submitted/i.test(status)) return "NEW";
  return "ACTIVE";
}

export interface Badge {
  bg: string;
  fg: string;
}

const NEUTRAL: Badge = { bg: "#F2F4F7", fg: "#344054" };

/** The design's nine pipeline statuses, matched loosely so near-names still land. */
const STATUS_BADGES: Array<[RegExp, Badge]> = [
  [/design approval|approval/i, { bg: "#FFFAEB", fg: "#B54708" }],
  [/scan|review/i, { bg: "#EFF8FF", fg: "#175CD3" }],
  [/segment/i, { bg: "#FFF6ED", fg: "#C4320A" }],
  [/design|plan/i, { bg: "#F4F3FF", fg: "#5925DC" }],
  [/manufactur|production|print/i, { bg: "#FEF3F2", fg: "#B42318" }],
  [/qa|quality|steril/i, { bg: "#EFF8FF", fg: "#175CD3" }],
  [/shipp|deliver|dispatch/i, { bg: "#ECFDF3", fg: "#067647" }],
  [/complet|closed/i, NEUTRAL],
  [/creat|new/i, NEUTRAL],
];

export function statusBadge(status: string | null | undefined): Badge {
  if (!status) return NEUTRAL;
  return STATUS_BADGES.find(([pattern]) => pattern.test(status))?.[1] ?? NEUTRAL;
}

const PRIORITY_BADGES: Record<string, Badge> = {
  low: { bg: "#EFF8FF", fg: "#175CD3" },
  medium: { bg: "#FFFAEB", fg: "#B54708" },
  high: { bg: "#FFF1EB", fg: "#C4320A" },
  critical: { bg: "#FEE4E2", fg: "#B42318" },
};

export function priorityBadge(priority: string | null | undefined): Badge {
  return PRIORITY_BADGES[(priority ?? "").trim().toLowerCase()] ?? NEUTRAL;
}

/** Cancelled and on-hold cases carry a coloured left edge in lists. */
export function stateEdge(state: string | null | undefined): {
  color: string | null;
  label: string | null;
  dimmed: boolean;
} {
  const value = state ?? "";
  if (/cancel/i.test(value)) return { color: "#F04438", label: "CANCELLED", dimmed: true };
  if (/hold/i.test(value)) return { color: "#F79009", label: "ON HOLD", dimmed: false };
  return { color: null, label: null, dimmed: false };
}

/** The design's product colours; anything else gets one from the same family by name. */
const PRODUCT_COLOURS: Array<[RegExp, [string, string]]> = [
  [/subperiosteal/i, ["#22D3EE", "#0E7490"]],
  [/model/i, ["#F87171", "#DC2626"]],
  [/spin|cage/i, ["#98A2B3", "#667085"]],
  [/splint|orthognathic/i, ["#A78BFA", "#7C3AED"]],
  [/hip/i, ["#38BDF8", "#0284C7"]],
  [/crani/i, ["#2DD4BF", "#0F766E"]],
  [/mandib/i, ["#818CF8", "#4F46E5"]],
  [/shoulder/i, ["#FBBF24", "#D97706"]],
  [/guide|knee/i, ["#667085", "#344054"]],
];

/** `[from, to]` of the product tile's gradient; `to` doubles as the dot colour. */
export function productColours(product: string | null | undefined): [string, string] {
  const name = product ?? "";
  const known = PRODUCT_COLOURS.find(([pattern]) => pattern.test(name));
  if (known) return known[1];
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return PRODUCT_COLOURS[hash % PRODUCT_COLOURS.length][1];
}
