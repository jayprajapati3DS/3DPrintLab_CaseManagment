import type { AppRole } from "@/lib/auth/session";

/**
 * The sidebar, page titles and icons, as laid out in the design's dashboard
 * shell. `phase` is the build phase a page arrives in (docs/build-plan.md);
 * anything past the current one renders as a "planned" card rather than a
 * dead link, so the navigation already has its final shape.
 */

export const CURRENT_PHASE = 5;

export interface PageDef {
  title: string;
  subtitle: string;
  href: string;
  /** 24-unit viewBox stroke path, from the design. */
  icon: string;
  phase: number;
}

const ICONS = {
  casesetup: "M9 2h6a1 1 0 0 1 1 1v2H8V3a1 1 0 0 1 1-1zM8 4H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-2M8 11h8M8 15h5",
  products: "M21 8 12 3 3 8v8l9 5 9-5zM3 8l9 5 9-5M12 13v8",
  subscopes: "M12 2 2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5",
  viewers: "M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z",
  hospitals: "M3 21h18M5 21V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16M9 21v-4h6v4M12 7v4M10 9h4",
  dashboard: "M3 3h7v9H3zM14 3h7v5h-7zM14 12h7v9h-7zM3 16h7v5H3z",
  variables: "M8 4c-2 0-3 1-3 3v2c0 1.5-1 3-2 3 1 0 2 1.5 2 3v2c0 2 1 3 3 3M16 4c2 0 3 1 3 3v2c0 1.5 1 3 2 3-1 0-2 1.5-2 3v2c0 2-1 3-3 3",
  cases: "M12 2 2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5",
  parts:
    "M21 16V8a2 2 0 0 0-1-1.7l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.7l7 4a2 2 0 0 0 2 0l7-4a2 2 0 0 0 1-1.7zM3.3 7 12 12l8.7-5M12 22V12",
  tasks: "M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11",
  schedule: "M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z",
  quality: "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10zM9 12l2 2 4-4",
  approvals: "M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11M3 21h0",
  audit:
    "M9 2h6a1 1 0 0 1 1 1v2H8V3a1 1 0 0 1 1-1zM8 4H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-2M8 11h8M8 15h8M8 19h5",
  production: "M2 20h20M4 20V9l5 3V9l5 3V9l5 3v8M17 4v5",
  partsetup: "M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6",
  qaforms:
    "M9 2h6a1 1 0 0 1 1 1v2H8V3a1 1 0 0 1 1-1zM8 4H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-2M9 13l2 2 4-4",
  printers:
    "M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2M6 14h12v8H6z",
  postproc: "M12 2c1 3 4 4 4 8a4 4 0 0 1-8 0c0-2 1-3 1-3 .5 1.5 1.5 2 2 2 0-3-1-4 1-7zM5 22h14",
  measuring: "M2 17 17 2l5 5L7 22zM7.5 11.5l2 2M10.5 8.5l2 2M13.5 5.5l2 2",
  tooling:
    "M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.8-3.8a6 6 0 0 1-7.9 7.9l-6.9 6.9a2.1 2.1 0 0 1-3-3l6.9-6.9a6 6 0 0 1 7.9-7.9z",
  steril: "M9 3h6M10 3v6l-5 9a2 2 0 0 0 1.7 3h10.6a2 2 0 0 0 1.7-3l-5-9V3M7.5 14h9",
  materials: "M12 2 2 7l10 5 10-5-10-5zM2 12l10 5 10-5",
  components: "M14 4l6 6-9 9H5v-6zM9 9l6 6",
  packaging: "M21 8 12 3 3 8v8l9 5 9-5zM3 8l9 5 9-5M12 13v8",
  vendors:
    "M1 3h15v13H1zM16 8h4l3 3v5h-7zM5.5 21a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM18.5 21a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z",
  grn: "M3 7h11v9H3zM14 10h4l3 3v3h-7M7 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM17 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4z",
  grnlots: "M4 6h16M4 12h16M4 18h10M18 16l2 2 3-3",
  grnsetup:
    "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z",
  params: "M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0M14 4v4M8 10v4M16 16v4",
  software: "M2 4h20v12H2zM8 20h8M12 16v4M8 9l-2 2 2 2M16 9l2 2-2 2",
  operators:
    "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM17 11l2 2 4-4",
  tech: "M12 2v4M12 18v4M4.9 4.9l2.8 2.8M16.3 16.3l2.8 2.8M2 12h4M18 12h4M4.9 19.1l2.8-2.8M16.3 7.7l2.8-2.8M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8z",
  parttypes: "M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z",
  spaces: "M3 21h18M5 21V7l7-4 7 4v14M9 21v-6h6v6",
  users:
    "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8",
  integrations:
    "M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7",
  settings:
    "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z",
  activity: "M12 8v4l3 3M3 12a9 9 0 1 0 18 0 9 9 0 0 0-18 0z",
} as const;

const page = (
  icon: keyof typeof ICONS,
  title: string,
  subtitle: string,
  phase: number,
  href = `/${icon}`,
): PageDef => ({ title, subtitle, href, icon: ICONS[icon], phase });

const ACCOUNT: PageDef = {
  title: "Account",
  subtitle: "Your profile and security settings",
  href: "/account",
  icon: "",
  phase: 1,
};

/** A company space: the manufacturing application itself. */
const SPACE_PAGES = {
  dashboard: page("dashboard", "Dashboard", "Overview", 1, "/"),
  cases: page("cases", "Cases", "Browse, filter and open cases", 1),
  parts: page("parts", "Parts", "All manufactured parts across cases — status, material and traceability", 3),
  orders: page("cases", "My Orders", "Your cases' order forms — to check, fill and sign", 4, "/orders"),
  qualityforms: page("qaforms", "Quality Forms", "Every quality form on cases and parts — its stage, status and who it is with", 4, "/qualityforms"),
  tasks: page("tasks", "Tasks", "Assign, track and follow up on case & part tasks", 3),
  schedule: page("schedule", "Schedule", "Production and delivery calendar", 6),
  approvals: page("approvals", "My Approvals", "Quality forms sent to you for approval", 4),
  quality: page("quality", "Quality Records", "Inspections, deviations and release records", 6),
  audit: page("audit", "Audit Log", "Time-stamped audit trail — archive & deletion approvals, qualification, validation and change control", 2),
  production: page("production", "Manufacturing Workflow Setup", "Workflows and their production stages", 2),
  casesetup: page("casesetup", "Case Form Setup", "Case source, case ID rule and the form a case is opened with", 3),
  products: page("products", "Products", "What cases are opened for, and the stages their cases go through", 3),
  viewers: page("viewers", "Viewer list", "The viewers a case can be seen in — associated on each product", 3),
  hospitals: page("hospitals", "Hospitals", "The hospitals cases come from — and the surgeons who work there", 3),
  subscopes: page("subscopes", "Sub-scopes", "Older sub-scope records — sub-scopes are now kept inside their product", 3),
  sites: page("production", "Manufacturing Sites", "Where parts are made — in-house, partner hospitals and vendors — with their equipment and people", 3, "/sites"),
  partsetup: page("partsetup", "Part Request Setup", "Part ID rule and request forms — open one to edit it", 3),
  qaforms: page("qaforms", "QA Form Setup", "Configurable QA checklists with variables that fetch part, case and request data", 4),
  variables: page("variables", "Variable List", "The {…} values QA forms fetch from the case, part, request and libraries — and where each is used", 4),
  printers: page("printers", "Printers & Machines", "Printers, CNC machines and their status", 2),
  postproc: page("postproc", "Post-processing Equipment", "Furnaces, EDM, blasting, cleaning and finishing equipment", 2),
  measuring: page("measuring", "Measuring Equipment", "Calibrated inspection instruments and calibration schedule", 2),
  tooling: page("tooling", "Tooling & Fixtures", "Build plates, cutters and fixtures with usage life", 2),
  steril: page("steril", "Sterilization", "Validated sterilization methods and cycles", 2),
  materials: page("materials", "Materials", "Materials, lots and stock levels", 2),
  components: page("components", "Standard Components", "Screws, sleeves, pins and instruments — lot and stock", 2),
  packaging: page("packaging", "Packaging & Labelling", "Sterile barrier, trays, labels and IFUs", 2),
  vendors: page("vendors", "Suppliers & Vendors", "Approved supplier list — manufacturers, materials, labs and contractors", 2),
  grn: page("grn", "GRN List", "Receive, inspect and accept deliveries into stock", 5),
  grnlots: page("grnlots", "Lot List", "Every lot received — status, stock, log and the parts made from it", 5),
  grnsetup: page("grnsetup", "GRN Setup", "Numbering, receipt fields, lot IDs, acceptance tests and rules", 5),
  params: page("params", "Process Parameters", "Validated machine + material parameter sets", 2),
  software: page("software", "Software & Versions", "Validated software and periodic review", 2),
  operators: page("operators", "Operator Qualifications", "Training and qualification by machine and process", 2),
  tech: page("tech", "Manufacturing Tech", "Manufacturing technologies and processes", 2),
  parttypes: page("parttypes", "Part Types", "Part types available in part requests", 2),
  users: page("users", "Users & Roles", "Accounts and permissions", 1),
  integrations: page("integrations", "Integrations & API", "Connect to the 3D Surgical Platform", 1),
  settings: page("settings", "Space Settings", "Configuration for this space", 6),
  account: ACCOUNT,
} satisfies Record<string, PageDef>;

/** The admin console: company spaces and the platform itself, nothing else. */
const ADMIN_PAGES = {
  spaces: page("spaces", "Company Spaces", "Create, configure and suspend company spaces — each with its own sign-in URL", 1),
  admins: page("users", "Platform Admins", "Who can sign in to the admin console and what they can do", 6, "/admins"),
  platform: page("integrations", "Integrations & API", "Platform-wide connection to the 3D Surgical Platform for all spaces", 6, "/platform-api"),
  settings: page("settings", "Platform Settings", "Platform-wide configuration", 6),
  activity: page("activity", "Admin Activity Log", "Spaces created, suspended and changed — time-stamped", 1),
  account: ACCOUNT,
} satisfies Record<string, PageDef>;

export interface NavItem extends PageDef {
  id: string;
}

export interface NavSection {
  title: string;
  items: NavItem[];
}

function section<T extends Record<string, PageDef>>(
  pages: T,
  title: string,
  ids: Array<keyof T & string>,
): NavSection {
  return { title, items: ids.map((id) => ({ id, ...pages[id] })) };
}

const WORKSPACE: NavSection[] = [
  section(SPACE_PAGES, "Workspace", ["dashboard", "cases", "parts", "qualityforms", "tasks", "schedule"]),
  section(SPACE_PAGES, "Quality", ["approvals", "quality", "audit"]),
  section(SPACE_PAGES, "Case Setup", ["casesetup", "products", "viewers"]),
  section(SPACE_PAGES, "QA Setup", ["qaforms", "variables"]),
  section(SPACE_PAGES, "Setup", ["sites", "production", "partsetup"]),
  section(SPACE_PAGES, "Equipment", ["printers", "postproc", "measuring", "tooling", "steril"]),
  section(SPACE_PAGES, "Materials & Supply", ["materials", "components", "packaging", "vendors"]),
  section(SPACE_PAGES, "Goods Receipt", ["grn", "grnlots", "grnsetup"]),
  section(SPACE_PAGES, "Process & People", ["params", "software", "operators", "tech", "parttypes"]),
];

/**
 * The sidebar for a role. The admin console has one short section; a space has
 * the whole application, plus a "Space" section only its admins see.
 */
export function navSections(role: AppRole, siteOnly = false, surgeonOnly = false): NavSection[] {
  // A surgeon: their cases' order forms, and what waits for their signature.
  if (surgeonOnly) return [section(SPACE_PAGES, "Workspace", ["orders"]), section(SPACE_PAGES, "Quality", ["approvals"])];
  // A vendor's or partner's staff: their sites' parts, those parts' forms, and what waits for them.
  if (siteOnly) return [section(SPACE_PAGES, "Workspace", ["parts", "qualityforms"]), section(SPACE_PAGES, "Quality", ["approvals"])];
  if (role === "SUPER_ADMIN") {
    return [section(ADMIN_PAGES, "Platform", ["spaces", "admins", "platform", "settings", "activity"])];
  }
  if (role === "SPACE_ADMIN") {
    return [...WORKSPACE, section(SPACE_PAGES, "Space", ["users", "hospitals", "integrations", "settings"])];
  }
  return WORKSPACE;
}

function pagesFor(role: AppRole): Record<string, PageDef> {
  return role === "SUPER_ADMIN" ? ADMIN_PAGES : SPACE_PAGES;
}

/**
 * The page a pathname belongs to on this site: `/cases/abc` is still "cases".
 * Null when the path is not a page of the site the viewer is on — a space has
 * no `/spaces`, and the admin console has no `/cases`.
 */
export function pageForPath(role: AppRole, pathname: string): NavItem | null {
  const first = `/${pathname.split("/")[1] ?? ""}`;
  const pages = pagesFor(role);
  const id = Object.keys(pages).find((key) => pages[key].href === first);
  return id ? { id, ...pages[id] } : null;
}
