/**
 * What the case list opens on: the cases still being worked. Most of a space's
 * cases are finished and archived, and nobody opens the list to look at those.
 *
 * Kept apart from the queries because the browser needs it too, to know which
 * tile is the one that does not appear in the address.
 */
export const DEFAULT_TILE = "progress" as const;

/** And how it is ordered: by case number, the most recent first. */
export const DEFAULT_SORT = "caseid" as const;
