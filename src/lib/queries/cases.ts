import "server-only";

import { Prisma, type CaseBucket } from "@prisma/client";

import { decryptSecret } from "@/lib/crypto";
import { extrasFor, readCatalog } from "@/lib/cases/catalog";
import { DEFAULT_SORT, DEFAULT_TILE } from "@/lib/cases/list-defaults";
import { db } from "@/lib/db";
import { DEFAULT_TIMEZONE, fmtDate, fmtShortDate, shortPatientName } from "@/lib/format";

/**
 * The case list: tiles, facets, filters, sorting and paging.
 *
 * Every query takes the space first and nothing here can be called without
 * one, which is what keeps one company's cases out of another's list.
 */

export const PAGE_SIZE = 50;

export const TILES = ["all", "new", "progress", "completed", "archived"] as const;
export type Tile = (typeof TILES)[number];

export const SORTS = ["caseid", "surgery", "newest", "product", "surgeon", "status", "priority"] as const;
export type Sort = (typeof SORTS)[number];

/** Filter groups, in the order the popover shows them. */
export const FACETS = ["product", "scope", "status", "surgeon", "hospital", "priority", "state"] as const;
export type Facet = (typeof FACETS)[number];

const FACET_COLUMN = {
  product: "productName",
  scope: "scopeName",
  status: "caseStatus",
  surgeon: "surgeonName",
  hospital: "hospitalName",
  priority: "priority",
  state: "caseState",
} as const satisfies Record<Facet, keyof Prisma.CaseRecordWhereInput>;

export interface CaseListParams {
  q: string;
  tile: Tile;
  sort: Sort;
  page: number;
  filters: Record<Facet, string[]>;
}

type RawParams = Record<string, string | string[] | undefined>;

function many(value: string | string[] | undefined): string[] {
  if (value === undefined) return [];
  return (Array.isArray(value) ? value : [value]).filter((v) => v.length > 0).slice(0, 50);
}

function one(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

export function parseCaseListParams(raw: RawParams): CaseListParams {
  const tile = one(raw.tile) as Tile;
  const sort = one(raw.sort) as Sort;
  const page = Number.parseInt(one(raw.page), 10);
  return {
    q: one(raw.q).trim().slice(0, 100),
    tile: TILES.includes(tile) ? tile : DEFAULT_TILE,
    sort: SORTS.includes(sort) ? sort : DEFAULT_SORT,
    page: Number.isInteger(page) && page > 0 ? page : 1,
    filters: Object.fromEntries(FACETS.map((f) => [f, many(raw[f])])) as Record<Facet, string[]>,
  };
}

const TILE_BUCKETS: Record<Tile, CaseBucket[] | null> = {
  all: null,
  new: ["NEW"],
  // A case just created is already in progress, as in the design.
  progress: ["NEW", "ACTIVE"],
  completed: ["COMPLETED"],
  archived: ["ARCHIVED"],
};

function whereFor(spaceId: string, params: CaseListParams): Prisma.CaseRecordWhereInput {
  const and: Prisma.CaseRecordWhereInput[] = [];

  const buckets = TILE_BUCKETS[params.tile];
  if (buckets) and.push({ bucket: { in: buckets } });

  if (params.q) {
    const contains = { contains: params.q, mode: "insensitive" as const };
    // Patient names are encrypted at rest, so they cannot be searched here.
    and.push({
      OR: [
        { caseNumber: contains },
        { caseCode: contains },
        { productName: contains },
        { scopeName: contains },
        { surgeonName: contains },
        { hospitalName: contains },
      ],
    });
  }

  // Within a group any value may match; across groups all must.
  for (const facet of FACETS) {
    const values = params.filters[facet];
    if (values.length > 0) and.push({ [FACET_COLUMN[facet]]: { in: values } });
  }

  return { spaceId, AND: and };
}

function orderFor(sort: Sort): Prisma.CaseRecordOrderByWithRelationInput[] {
  const tieBreak: Prisma.CaseRecordOrderByWithRelationInput = { platformCaseId: "desc" };
  switch (sort) {
    case "caseid":
    default:
      // Highest number first, read as a number: E934 before E99.
      return [{ caseNumberSort: { sort: "desc", nulls: "last" } }, tieBreak];
    case "newest":
      return [{ platformCreatedAt: "desc" }, tieBreak];
    case "product":
      return [{ productName: { sort: "asc", nulls: "last" } }, tieBreak];
    case "surgeon":
      return [{ surgeonName: { sort: "asc", nulls: "last" } }, tieBreak];
    case "status":
      return [{ caseStatus: { sort: "asc", nulls: "last" } }, tieBreak];
    case "priority":
      return [{ priority: { sort: "asc", nulls: "last" } }, tieBreak];
    case "surgery":
      return [{ surgeryDate: { sort: "desc", nulls: "last" } }, tieBreak];
  }
}

/** One row of the list, already formatted — it crosses to a client component. */
export interface CaseRow {
  id: string;
  caseNumber: string;
  product: string | null;
  /** The product's — or its sub-scope's — image, when one is set. */
  imageId: string | null;
  /** The case's own picture, shown before the product's. */
  imageSrc: string | null;
  scope: string | null;
  surgeon: string | null;
  patient: string;
  hospital: string | null;
  surgeryDate: string;
  surgeryDateShort: string;
  priority: string | null;
  status: string | null;
  state: string | null;
}

export interface FacetValue {
  value: string;
  count: number;
}

export interface CaseListResult {
  rows: CaseRow[];
  total: number;
  pageCount: number;
  tileCounts: Record<Tile, number>;
  facets: Record<Facet, FacetValue[]>;
}

const PRIORITY_ORDER = ["critical", "high", "medium", "low"];

export async function listCases(
  spaceId: string,
  params: CaseListParams,
  timeZone = DEFAULT_TIMEZONE,
): Promise<CaseListResult> {
  const where = whereFor(spaceId, params);

  const [records, total, bucketCounts, ...facetGroups] = await Promise.all([
    db.caseRecord.findMany({
      where,
      orderBy: orderFor(params.sort),
      skip: (params.page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: {
        id: true,
        platformCaseId: true,
        caseNumber: true,
        productName: true,
        productId: true,
        subscopeId: true,
        scopeName: true,
        surgeonName: true,
        patientNameEncrypted: true,
        hospitalName: true,
        surgeryDate: true,
        priority: true,
        caseStatus: true,
        caseState: true,
        imageFileId: true,
      },
    }),
    db.caseRecord.count({ where }),
    // Tile and facet counts ignore the search and filters, as in the design:
    // they describe the whole space, not the current view.
    db.caseRecord.groupBy({ by: ["bucket"], where: { spaceId }, _count: { _all: true } }),
    ...FACETS.map((facet) => facetCounts(spaceId, FACET_COLUMN[facet])),
  ]);

  // Product images: by the case's product, or — for synced cases — a product of the same name.
  const products = (await db.resource.findMany({ where: { spaceId, kind: "products", archivedAt: null }, select: { id: true, name: true, data: true } })).map((p) => ({
    ...p,
    catalog: readCatalog(p.data),
  }));
  const imageFor = (c: { productId: string | null; subscopeId: string | null; productName: string | null }) => {
    const product = products.find((p) => p.id === c.productId) ?? products.find((p) => c.productName && p.name.toLowerCase() === c.productName.toLowerCase());
    return product ? extrasFor(product.catalog, c.subscopeId).imageId || null : null;
  };

  const byBucket = Object.fromEntries(
    bucketCounts.map((b) => [b.bucket, b._count._all]),
  ) as Partial<Record<CaseBucket, number>>;
  const n = (bucket: CaseBucket) => byBucket[bucket] ?? 0;

  const facets = Object.fromEntries(
    FACETS.map((facet, i) => {
      const values = facetGroups[i];
      if (facet === "priority") {
        values.sort(
          (a, b) =>
            PRIORITY_ORDER.indexOf(a.value.toLowerCase()) -
            PRIORITY_ORDER.indexOf(b.value.toLowerCase()),
        );
      }
      return [facet, values];
    }),
  ) as Record<Facet, FacetValue[]>;

  return {
    rows: records.map((c) => ({
      id: c.id,
      caseNumber: c.caseNumber ?? `#${c.platformCaseId}`,
      product: c.productName,
      imageId: imageFor(c),
      imageSrc: c.imageFileId ? `/api/case-files/${c.imageFileId}` : null,
      scope: c.scopeName,
      surgeon: c.surgeonName,
      patient: shortPatientName(decryptSecret(c.patientNameEncrypted)),
      hospital: c.hospitalName,
      surgeryDate: fmtDate(c.surgeryDate, timeZone),
      surgeryDateShort: fmtShortDate(c.surgeryDate, timeZone),
      priority: c.priority,
      status: c.caseStatus,
      state: c.caseState,
    })),
    total,
    pageCount: Math.max(1, Math.ceil(total / PAGE_SIZE)),
    tileCounts: {
      all: n("NEW") + n("ACTIVE") + n("COMPLETED") + n("ARCHIVED"),
      new: n("NEW"),
      progress: n("NEW") + n("ACTIVE"),
      completed: n("COMPLETED"),
      archived: n("ARCHIVED"),
    },
    facets,
  };
}

type FacetColumn = (typeof FACET_COLUMN)[Facet];

async function facetCounts(spaceId: string, column: FacetColumn): Promise<FacetValue[]> {
  // Raw because Prisma's groupBy cannot be typed over a column chosen at run
  // time. The identifier comes from FACET_COLUMN above, never from the request.
  const col = Prisma.raw(`"${column}"`);
  const rows = await db.$queryRaw<Array<{ value: string; count: bigint }>>(Prisma.sql`
    SELECT ${col} AS value, COUNT(*) AS count
    FROM case_records
    WHERE "spaceId" = ${spaceId} AND ${col} IS NOT NULL
    GROUP BY ${col}
    ORDER BY ${col} ASC
  `);
  return rows.map((r) => ({ value: r.value, count: Number(r.count) }));
}

export async function getCase(spaceId: string, id: string) {
  return db.caseRecord.findFirst({ where: { id, spaceId } });
}

/** The timezone a space's dates are shown in: its platform tenant's. */
export async function spaceTimeZone(spaceId: string): Promise<string> {
  const connection = await db.platformConnection.findUnique({
    where: { spaceId },
    select: { timezone: true },
  });
  return connection?.timezone || DEFAULT_TIMEZONE;
}
