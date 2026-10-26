/**
 * What each kind of master data is.
 *
 * Machines, materials, suppliers and the nine equipment registries share one
 * list screen and one detail screen. This file is the whole difference between
 * them: their words, their fields, their statuses, their tabs. Adding a
 * registry is an entry here, not a new screen — which is how the design drives
 * them too.
 *
 * No server imports: client components read this.
 */

export const RESOURCE_KINDS = [
  "workflows",
  "printers",
  "materials",
  "vendors",
  "measuring",
  "postproc",
  "steril",
  "components",
  "tooling",
  "software",
  "params",
  "operators",
  "packaging",
  "products",
  "subscopes",
  "viewers",
  "hospitals",
  "sites",
] as const;
export type ResourceKind = (typeof RESOURCE_KINDS)[number];

export type Track = "maintenance" | "qualification";
export type TabKey = "overview" | "lots" | "maint" | "qual" | "supplied" | "receipts" | "usage" | "history" | "docs" | "members" | "equipment";

export type FieldType = "text" | "number" | "date" | "select" | "textarea" | "swatch";

export interface FieldDef {
  key: string;
  label: string;
  type: FieldType;
  options?: readonly string[];
  /** Options come from the space's technologies instead of a fixed list. */
  optionsFrom?: "technologies";
  /** A select of another kind's records; the value stored is the record's id. */
  ref?: ResourceKind;
  /** Free text, with another kind's names offered as suggestions. */
  suggest?: ResourceKind;
  placeholder?: string;
  /** Text for the empty choice of a select. */
  empty?: string;
  step?: string;
}

/** Which four summary cards a list shows. */
/** The viewers a case can be opened in, for now — a viewer's type is one of them. */
export const VIEWER_TYPES = ["3D Viewer", "Orthognathic Planner", "Fibula Flap Planner"] as const;

export type SummaryKind = "machines" | "materials" | "vendors" | "equipment" | "due" | "life" | "stock" | "catalog" | "simple";

export interface KindConfig {
  kind: ResourceKind;
  /** The sidebar page this kind lives at — `/printers`, `/production`… */
  route: string;
  title: string;
  description: string;
  /** Singular, in the archive and audit wording: "machine", "supplier". */
  noun: string;
  eyebrow: string;
  addLabel: string;
  newName: string;
  nameLabel: string;
  searchPlaceholder: string;
  intro: [string, string];
  icon: string;
  statuses: readonly string[];
  fields: FieldDef[];
  tabs: TabKey[];
  tabLabels?: Partial<Record<TabKey, string>>;
  /** The note above a schedule, per track. */
  hints?: Partial<Record<Track, string>>;
  summary: SummaryKind;
  /** The word for what falls due, and the schedule it is read from. */
  due?: { word: string; track: Track };
  /** Headings of the four columns before "Status". */
  columns: [string, string, string, string];
  photo: boolean;
  /** What the picture is called — "photo" unless set (a viewer has a "logo"). */
  photoWord?: string;
  /** Stock counted in pieces, against a reorder level. */
  stock?: boolean;
  /** Usage life counted against a limit. */
  life?: boolean;
  /**
   * The record's ID — asset ID, tool ID, item code… — which can be typed or
   * made from a pattern (src/lib/resources/ids.ts): the field it lives in, the
   * field {TYPE} is read from, and the pattern suggested until one is saved.
   */
  ids?: { field: string; type: string; pattern: string };
}

/** What a manufacturing site is: this hospital's own, a partner's, or an outsourced vendor's. */
export const SITE_TYPES = ["In-house", "Partner hospital", "External vendor"] as const;

/** The lists whose items belong to a site (or are shared by all) — in the order the sidebar has them. */
export const SITE_ITEM_KINDS: ResourceKind[] = ["printers", "postproc", "measuring", "tooling", "steril", "materials", "components", "packaging", "params", "software", "operators"];

export const TECH_TYPES = ["DMLS", "SLM", "SLA", "SLS", "MJF", "FDM", "FFF", "PolyJet", "Billet", "Other"] as const;

export const STAGE_ROLES = ["Manufacturing", "Engineer", "Quality", "Logistics", "Administrator"] as const;

/** Quality forms a stage can carry. Becomes the QA form library in phase 4. */
export const STAGE_FORMS = [
  "QAC (JM-F-DND-004)",
  "Build inspection checklist",
  "Dimensional QC report",
  "Post-processing record",
  "Cleaning & sterilization record",
  "Labelling & packaging check",
  "Final release record",
  "Polymer build record",
  "Final inspection",
] as const;

export const STAGE_EMAILS = [
  "Stage started — notify owner",
  "Part ready for QC",
  "Part dispatched — notify customer",
  "Rework required — notify engineer",
] as const;

export const DOCUMENT_KINDS = [
  "Manual",
  "SOP",
  "Validation report",
  "Qualification report",
  "Service report",
  "Calibration certificate",
  "Certificate / declaration",
  "Other",
] as const;

export const SWATCHES = ["#6B7785", "#2A9D8F", "#9B59B6", "#C98A2E", "#98A2B3", "#D6336C", "#3B82F6"] as const;

export const QUAL_RESULTS = ["Pass", "Pass with remarks", "Fail"] as const;

const DEFAULT_QUAL_HINT =
  "IQ, OQ, PQ, process validations or any other qualification — add it with its due date, then Record it with the PDF report when done.";
const MAINT_HINT =
  "Add an item with its next due date. When it's done, click Record, attach the PDF report and save — the record is kept below.";

const ICON = {
  factory: "M2 20h20M4 20V9l5 3V9l5 3V9l5 3v8M17 4v5",
  printer: "M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2M6 14h12v8H6z",
  layers: "M12 2 2 7l10 5 10-5-10-5zM2 12l10 5 10-5",
  truck: "M1 3h15v13H1zM16 8h4l3 3v5h-7zM5.5 21a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM18.5 21a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z",
  ruler: "M2 17 17 2l5 5L7 22zM7.5 11.5l2 2M10.5 8.5l2 2M13.5 5.5l2 2",
  flame: "M12 2c1 3 4 4 4 8a4 4 0 0 1-8 0c0-2 1-3 1-3 .5 1.5 1.5 2 2 2 0-3-1-4 1-7zM5 22h14",
  flask: "M9 3h6M10 3v6l-5 9a2 2 0 0 0 1.7 3h10.6a2 2 0 0 0 1.7-3l-5-9V3M7.5 14h9",
  pencil: "M14 4l6 6-9 9H5v-6zM9 9l6 6",
  box: "M21 8 12 3 3 8v8l9 5 9-5zM3 8l9 5 9-5M12 13v8",
  wrench:
    "M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.8-3.8a6 6 0 0 1-7.9 7.9l-6.9 6.9a2.1 2.1 0 0 1-3-3l6.9-6.9a6 6 0 0 1 7.9-7.9z",
  monitor: "M2 4h20v12H2zM8 20h8M12 16v4M8 9l-2 2 2 2M16 9l2 2-2 2",
  sliders: "M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M14 4v4M8 10v4M16 16v4",
  userCheck: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM17 11l2 2 4-4",
} as const;

export const KINDS: Record<ResourceKind, KindConfig> = {
  workflows: {
    kind: "workflows",
    route: "/production",
    title: "Production workflows",
    description:
      "Click a workflow to view or edit its stages. Each carries its own ordered stages.",
    noun: "workflow",
    eyebrow: "MANUFACTURING WORKFLOW",
    addLabel: "New workflow",
    newName: "New workflow",
    nameLabel: "Workflow name",
    searchPlaceholder: "Search workflow or method…",
    intro: [
      "Set up manufacturing workflows for ",
      " — each workflow has its own status stages. When a part is requested, the chosen workflow drives its live status.",
    ],
    icon: ICON.factory,
    statuses: [],
    fields: [],
    tabs: ["overview"],
    summary: "due",
    columns: ["Workflow", "Method", "Stages", ""],
    photo: false,
  },

  printers: {
    kind: "printers",
    route: "/printers",
    title: "Printers & machines",
    description:
      "Identity, qualification, maintenance and build history for every machine.",
    noun: "machine",
    eyebrow: "PRINTER / MACHINE",
    addLabel: "+ Add machine",
    newName: "New machine",
    nameLabel: "Machine name",
    searchPlaceholder: "Search name, asset ID, serial, technology…",
    intro: ["Printers and machines available to ", " — assign them to workflows and parts."],
    icon: ICON.printer,
    statuses: ["Available", "In use", "Maintenance", "Out of service"],
    fields: [
      { key: "assetId", label: "Asset ID", type: "text", placeholder: "e.g. PR-DMLS-01" },
      { key: "serial", label: "Serial number", type: "text" },
      { key: "maker", label: "Manufacturer", type: "text" },
      { key: "model", label: "Model", type: "text" },
      { key: "location", label: "Location", type: "text" },
      { key: "tech", label: "Technology", type: "select", options: TECH_TYPES },
      { key: "process", label: "Process", type: "select", optionsFrom: "technologies" },
      { key: "materialId", label: "Default material", type: "select", ref: "materials", empty: "None" },
      { key: "volume", label: "Build volume", type: "text", placeholder: "e.g. 250 × 250 × 325 mm" },
      { key: "commissioned", label: "Commissioned on", type: "date" },
      { key: "siteId", label: "Site", type: "select", ref: "sites", empty: "All sites (shared)" },
    ],
    tabs: ["overview", "qual", "maint", "history", "docs"],
    tabLabels: { qual: "Qualification", maint: "Maintenance", history: "Build history" },
    hints: { qualification: DEFAULT_QUAL_HINT, maintenance: MAINT_HINT },
    summary: "machines",
    due: { word: "Maintenance", track: "maintenance" },
    columns: ["Machine", "Technology", "Next qualification", "Next maintenance"],
    photo: true,
    ids: { field: "assetId", type: "tech", pattern: "PR-{TYPE}-{##}" },
  },

  materials: {
    kind: "materials",
    route: "/materials",
    title: "Material inventory",
    description:
      "Stock is tracked by lot / batch with full traceability. Click a material to manage its lots.",
    noun: "material",
    eyebrow: "MATERIAL",
    addLabel: "+ Add material",
    newName: "New material",
    nameLabel: "Material name",
    searchPlaceholder: "Search material, technology or grade…",
    intro: ["Materials and lot inventory for ", " — track lots, quantities and low-stock thresholds."],
    icon: ICON.layers,
    statuses: [],
    fields: [
      { key: "code", label: "Material code", type: "text", placeholder: "e.g. MAT-SLA-01" },
      { key: "process", label: "Process", type: "select", optionsFrom: "technologies" },
      { key: "tech", label: "Technology", type: "select", options: TECH_TYPES },
      { key: "grade", label: "Grade", type: "select", options: ["Metal", "Resin", "Polymer", "Ceramic"] },
      { key: "use", label: "Clinical use", type: "text", placeholder: "e.g. Implantable (ISO 10993)" },
      { key: "unit", label: "Unit of measure", type: "select", options: ["kg", "g", "L", "ml", "spool", "sheet", "unit"] },
      { key: "threshold", label: "Low-stock threshold", type: "number", step: "0.1" },
      { key: "color", label: "Swatch colour", type: "swatch" },
      { key: "siteId", label: "Site", type: "select", ref: "sites", empty: "All sites (shared)" },
    ],
    tabs: ["overview", "lots", "receipts", "qual", "usage", "docs"],
    tabLabels: { lots: "Lots & stock", qual: "Material qualification" },
    hints: {
      qualification:
        "Material qualification, biocompatibility (ISO 10993) and periodic powder / resin testing — add with a due date, then Record it with the test report or CoA.",
    },
    summary: "materials",
    due: { word: "Qualification", track: "qualification" },
    columns: ["Material", "Tech", "In stock", "Lots"],
    photo: false,
    ids: { field: "code", type: "tech", pattern: "MAT-{TYPE}-{##}" },
  },

  vendors: {
    kind: "vendors",
    route: "/vendors",
    title: "Approved suppliers & vendors",
    description:
      "Outsourced manufacturers, material and component suppliers, calibration labs, sterilization contractors and packaging suppliers.",
    noun: "supplier",
    eyebrow: "SUPPLIER / VENDOR",
    addLabel: "+ Add supplier",
    newName: "New supplier",
    nameLabel: "Supplier name",
    searchPlaceholder: "Search supplier, type or location…",
    intro: [
      "Approved suppliers and vendors for ",
      " — outsourced manufacturers, material suppliers, calibration labs and sterilization contractors.",
    ],
    icon: ICON.truck,
    statuses: ["Approved", "Trial", "Suspended"],
    fields: [
      { key: "code", label: "Supplier code", type: "text", placeholder: "e.g. SUP-001" },
      {
        key: "kind",
        label: "Supplier type",
        type: "select",
        options: [
          "Outsourced manufacturing",
          "Raw material supplier",
          "Component supplier",
          "Packaging supplier",
          "Calibration lab",
          "Sterilization contractor",
          "Testing lab",
          "Service / maintenance",
        ],
      },
      { key: "specialty", label: "Specialty", type: "text", placeholder: "e.g. Metal DMLS · Ti / CoCr" },
      { key: "location", label: "Location", type: "text" },
      { key: "contact", label: "Contact email", type: "text" },
      { key: "lead", label: "Typical lead time (days)", type: "number" },
    ],
    tabs: ["overview", "qual", "receipts", "supplied", "usage", "docs"],
    tabLabels: { qual: "Supplier evaluation", supplied: "Supplied items" },
    hints: {
      qualification:
        "Supplier evaluation, audits and certificate checks (ISO 13485 §7.4) — add with a due date, then Record it with the evaluation form or audit report.",
    },
    summary: "vendors",
    due: { word: "Re-evaluation", track: "qualification" },
    columns: ["Supplier", "Type · specialty", "Location", "Lead"],
    photo: false,
    ids: { field: "code", type: "kind", pattern: "SUP-{###}" },
  },

  measuring: {
    kind: "measuring",
    route: "/measuring",
    title: "Measuring & inspection equipment",
    description:
      "Calibrated instruments used for inspection and QA measurements (ISO 13485 §7.6).",
    noun: "instrument",
    eyebrow: "MEASURING EQUIPMENT",
    addLabel: "+ Add instrument",
    newName: "New instrument",
    nameLabel: "Instrument name",
    searchPlaceholder: "Search instrument, asset ID or type…",
    intro: [
      "Calibrated measuring and inspection equipment for ",
      " — calibration status is tracked automatically.",
    ],
    icon: ICON.ruler,
    statuses: ["In service", "Out of service", "Quarantined"],
    fields: [
      { key: "assetId", label: "Asset ID", type: "text", placeholder: "e.g. QC-CMM-01" },
      {
        key: "kind",
        label: "Type",
        type: "select",
        options: ["CMM", "3D scanner", "Caliper", "Micrometer", "Height gauge", "Pin / thread gauge", "Surface roughness tester", "Hardness tester", "Torque tester", "Other"],
      },
      { key: "location", label: "Location", type: "text" },
      { key: "range", label: "Measuring range", type: "text" },
      { key: "resolution", label: "Resolution / accuracy", type: "text" },
      { key: "siteId", label: "Site", type: "select", ref: "sites", empty: "All sites (shared)" },
    ],
    tabs: ["overview", "maint", "qual", "receipts", "usage", "docs"],
    tabLabels: { maint: "Calibration", qual: "Qualification" },
    hints: { qualification: DEFAULT_QUAL_HINT, maintenance: MAINT_HINT },
    summary: "equipment",
    due: { word: "Calibration", track: "maintenance" },
    columns: ["Instrument", "Type", "Range · resolution", "Next calibration"],
    photo: true,
    ids: { field: "assetId", type: "kind", pattern: "QC-{TYPE}-{##}" },
  },

  postproc: {
    kind: "postproc",
    route: "/postproc",
    title: "Post-processing & finishing equipment",
    description:
      "Furnaces, EDM, blasting, cleaning and finishing equipment used after the build.",
    noun: "equipment",
    eyebrow: "POST-PROCESSING EQUIPMENT",
    addLabel: "+ Add equipment",
    newName: "New equipment",
    nameLabel: "Equipment name",
    searchPlaceholder: "Search equipment, asset ID or type…",
    intro: [
      "Post-processing and finishing equipment at ",
      " — with validation references and maintenance schedule.",
    ],
    icon: ICON.flame,
    statuses: ["Available", "In use", "Maintenance", "Out of service"],
    fields: [
      { key: "assetId", label: "Asset ID", type: "text" },
      {
        key: "kind",
        label: "Type",
        type: "select",
        options: ["Heat treatment furnace", "Vacuum furnace / HIP", "Wire EDM", "Band saw", "Support removal station", "Bead / sand blaster", "Ultrasonic cleaner", "Tumbler / polisher", "Electropolishing", "Passivation line", "Anodizing line", "Laser marker", "UV post-cure", "Other"],
      },
      { key: "usedFor", label: "Used for (process / materials)", type: "text" },
      { key: "capacity", label: "Capacity", type: "text" },
      { key: "usedStages", label: "Used at stages", type: "text", placeholder: "e.g. Heat treatment & depowdering" },
      { key: "siteId", label: "Site", type: "select", ref: "sites", empty: "All sites (shared)" },
    ],
    tabs: ["overview", "maint", "qual", "receipts", "usage", "docs"],
    tabLabels: { maint: "Maintenance", qual: "Qualification" },
    hints: { qualification: DEFAULT_QUAL_HINT, maintenance: MAINT_HINT },
    summary: "equipment",
    due: { word: "Maintenance", track: "maintenance" },
    columns: ["Equipment", "Type", "Next qualification", "Next maintenance"],
    photo: true,
    ids: { field: "assetId", type: "kind", pattern: "PP-{TYPE}-{##}" },
  },

  steril: {
    kind: "steril",
    route: "/steril",
    title: "Sterilization methods & cycles",
    description:
      "Validated sterilization cycles — in-house autoclaves or contract sterilizers.",
    noun: "cycle",
    eyebrow: "STERILIZATION CYCLE",
    addLabel: "+ Add cycle",
    newName: "New cycle",
    nameLabel: "Cycle name",
    searchPlaceholder: "Search cycle, method or equipment…",
    intro: [
      "Validated sterilization methods and cycles for ",
      " — each cycle links to its validation report and revalidation date.",
    ],
    icon: ICON.flask,
    statuses: ["Validated", "In validation", "Retired"],
    fields: [
      { key: "code", label: "Cycle code", type: "text", placeholder: "e.g. STE-PV-134" },
      {
        key: "method",
        label: "Method",
        type: "select",
        options: ["Steam — prevacuum", "Steam — gravity", "Ethylene oxide (EtO)", "Gamma irradiation", "E-beam", "Hydrogen peroxide plasma", "Dry heat"],
      },
      { key: "provider", label: "Provided by", type: "select", options: ["In-house", "Contract sterilizer"] },
      { key: "equipment", label: "Autoclave / contractor", type: "text", suggest: "vendors" },
      { key: "params", label: "Cycle parameters", type: "text", placeholder: "e.g. 134 °C · 4 min · 3 pulses · 20 min dry" },
      { key: "sal", label: "Sterility assurance level (SAL)", type: "text" },
      { key: "standard", label: "Standard", type: "text" },
      { key: "bi", label: "Biological / chemical indicator", type: "text" },
      { key: "siteId", label: "Site", type: "select", ref: "sites", empty: "All sites (shared)" },
    ],
    tabs: ["overview", "maint", "qual", "receipts", "usage", "docs"],
    tabLabels: { maint: "Maintenance", qual: "Validation" },
    hints: { qualification: DEFAULT_QUAL_HINT, maintenance: MAINT_HINT },
    summary: "equipment",
    due: { word: "Revalidation", track: "qualification" },
    columns: ["Cycle", "Method", "Parameters", "Next revalidation"],
    photo: true,
    ids: { field: "code", type: "method", pattern: "STE-{###}" },
  },

  components: {
    kind: "components",
    route: "/components",
    title: "Standard components",
    description:
      "Bought-in screws, sleeves, pins and instruments supplied with implants and guides — lot-traceable.",
    noun: "component",
    eyebrow: "STANDARD COMPONENT",
    addLabel: "+ Add component",
    newName: "New component",
    nameLabel: "Component name",
    searchPlaceholder: "Search component, part no. or supplier…",
    intro: [
      "Standard bought-in components used by ",
      " — screws, sleeves, pins and instruments with lot and stock.",
    ],
    icon: ICON.pencil,
    statuses: ["Active", "On hold", "Obsolete"],
    fields: [
      { key: "partNo", label: "Part no. / catalogue no.", type: "text" },
      {
        key: "category",
        label: "Category",
        type: "select",
        options: ["Bone screw", "Locking screw", "Drill sleeve", "Guide pin / K-wire", "Fixation plate", "Surgical instrument", "Other"],
      },
      { key: "size", label: "Size / specification", type: "text" },
      { key: "material", label: "Material", type: "text" },
      { key: "sterile", label: "Supplied", type: "select", options: ["Non-sterile", "Sterile"] },
      { key: "reorder", label: "Reorder level", type: "number" },
      { key: "udi", label: "UDI-DI", type: "text", placeholder: "optional" },
      { key: "siteId", label: "Site", type: "select", ref: "sites", empty: "All sites (shared)" },
    ],
    tabs: ["overview", "lots", "receipts", "qual", "usage", "docs"],
    tabLabels: { lots: "Lots & stock", qual: "Incoming inspection & supplier CoC" },
    hints: {
      qualification:
        "First-article / incoming inspection and supplier CoC checks — add with a due date, then Record it with the inspection report.",
    },
    summary: "stock",
    columns: ["Component", "Category", "Size · material", "Stock"],
    photo: true,
    ids: { field: "partNo", type: "category", pattern: "CMP-{####}" },
    stock: true,
  },

  tooling: {
    kind: "tooling",
    route: "/tooling",
    title: "Tooling & fixtures",
    description:
      "Build plates, cutters, fixtures and recoater blades — with usage life tracking.",
    noun: "tool",
    eyebrow: "TOOLING / FIXTURE",
    addLabel: "+ Add tool",
    newName: "New tool",
    nameLabel: "Tool name",
    searchPlaceholder: "Search tool, ID or machine…",
    intro: ["Tooling and fixtures used at ", " — usage life is tracked against each limit."],
    icon: ICON.wrench,
    statuses: ["Available", "In use", "Needs regrind / resurface", "Retired"],
    fields: [
      { key: "toolId", label: "Tool ID", type: "text" },
      {
        key: "kind",
        label: "Type",
        type: "select",
        options: ["Build plate", "Recoater blade", "Powder sieve / mesh", "CNC cutter / end mill", "Drill bit", "Holding fixture", "Inspection fixture", "Other"],
      },
      { key: "usedOn", label: "Used on (machine)", type: "text", suggest: "printers" },
      { key: "material", label: "Tool material", type: "text" },
      { key: "location", label: "Storage location", type: "text" },
      { key: "lifeUnit", label: "Life measured in", type: "select", options: ["builds", "cycles", "hours", "parts"] },
      { key: "lifeLimit", label: "Life limit", type: "number" },
      { key: "used", label: "Used so far", type: "number" },
      { key: "siteId", label: "Site", type: "select", ref: "sites", empty: "All sites (shared)" },
    ],
    tabs: ["overview", "maint", "receipts", "usage", "docs"],
    tabLabels: { maint: "Maintenance" },
    hints: { maintenance: MAINT_HINT },
    summary: "life",
    columns: ["Tool", "Type", "Used on", "Life used"],
    photo: true,
    ids: { field: "toolId", type: "kind", pattern: "TL-{TYPE}-{##}" },
    life: true,
  },

  software: {
    kind: "software",
    route: "/software",
    title: "Software & versions",
    description:
      "Validated software used for segmentation, design, build preparation, CAM and inspection (ISO 13485 §4.1.6).",
    noun: "software",
    eyebrow: "SOFTWARE",
    addLabel: "+ Add software",
    newName: "New software",
    nameLabel: "Software name",
    searchPlaceholder: "Search software, vendor or purpose…",
    intro: ["Validated software used at ", " — installed vs validated versions and periodic review."],
    icon: ICON.monitor,
    statuses: ["Validated", "Validation pending", "Not for production use", "Retired"],
    fields: [
      { key: "code", label: "Software ID", type: "text", placeholder: "e.g. SW-001" },
      { key: "vendor", label: "Vendor", type: "text" },
      {
        key: "purpose",
        label: "Used for",
        type: "select",
        options: ["Segmentation", "Implant / guide design", "Build preparation / slicer", "CAM programming", "Inspection / metrology", "Label / UDI printing", "QMS / document control", "Other"],
      },
      { key: "version", label: "Validated version", type: "text" },
      { key: "installed", label: "Installed version", type: "text" },
      { key: "licence", label: "Licence / seats", type: "text" },
      { key: "siteId", label: "Site", type: "select", ref: "sites", empty: "All sites (shared)" },
    ],
    tabs: ["overview", "qual", "usage", "docs"],
    tabLabels: { qual: "Validation" },
    hints: {
      qualification:
        "Software validation (ISO 13485 §4.1.6) and periodic reviews — add with a due date, then Record it with the validation report.",
    },
    summary: "due",
    due: { word: "Review", track: "qualification" },
    columns: ["Software", "Purpose", "Validated version", "Next review"],
    photo: false,
    ids: { field: "code", type: "purpose", pattern: "SW-{###}" },
  },

  params: {
    kind: "params",
    route: "/params",
    title: "Process parameter sets",
    description:
      "Validated machine + material + parameter profiles chosen when a part is built.",
    noun: "parameter set",
    eyebrow: "PROCESS PARAMETER SET",
    addLabel: "+ Add parameter set",
    newName: "New parameter set",
    nameLabel: "Parameter set name",
    searchPlaceholder: "Search set, machine or material…",
    intro: ["Validated process parameter sets for ", " — pick one when a part is built."],
    icon: ICON.sliders,
    statuses: ["Validated", "In validation", "Superseded"],
    fields: [
      { key: "code", label: "Code / revision", type: "text", placeholder: "e.g. PPS-DMLS-TI-01 rev B" },
      {
        key: "process",
        label: "Process",
        type: "select",
        options: ["DMLS / LPBF", "SLA", "SLS", "MJF", "FDM", "CNC milling", "Heat treatment", "Other"],
      },
      { key: "machine", label: "Machine", type: "text", suggest: "printers" },
      { key: "material", label: "Material", type: "text", suggest: "materials" },
      { key: "layer", label: "Layer thickness / step", type: "text" },
      { key: "keyParams", label: "Key parameters", type: "text", placeholder: "e.g. 280 W · 1200 mm/s · 30 µm" },
      { key: "siteId", label: "Site", type: "select", ref: "sites", empty: "All sites (shared)" },
    ],
    tabs: ["overview", "qual", "usage", "docs"],
    tabLabels: { qual: "Validation" },
    hints: { qualification: DEFAULT_QUAL_HINT },
    summary: "due",
    due: { word: "Revalidation", track: "qualification" },
    columns: ["Parameter set", "Machine · material", "Key parameters", "Next revalidation"],
    photo: false,
    ids: { field: "code", type: "process", pattern: "PPS-{TYPE}-{##}" },
  },

  operators: {
    kind: "operators",
    route: "/operators",
    title: "Operator qualifications",
    description:
      "Who is trained and qualified on which machine or process — used when assigning stage tasks.",
    noun: "person",
    eyebrow: "OPERATOR QUALIFICATION",
    addLabel: "+ Add person",
    newName: "New person",
    nameLabel: "Name",
    searchPlaceholder: "Search person, role or process…",
    intro: ["Trained and qualified people at ", " — only qualified people should be assigned to a stage."],
    icon: ICON.userCheck,
    statuses: ["Qualified", "In training", "Suspended"],
    fields: [
      { key: "empId", label: "Employee ID", type: "text" },
      {
        key: "role",
        label: "Role",
        type: "select",
        options: ["Manufacturing operator", "Design engineer", "Production engineer", "QC inspector", "Quality manager", "Packaging operator"],
      },
      { key: "qualifiedFor", label: "Qualified for (machines / processes)", type: "text", placeholder: "e.g. EOS M 290, heat treatment" },
      { key: "siteId", label: "Site", type: "select", ref: "sites", empty: "All sites (shared)" },
    ],
    tabs: ["overview", "qual", "usage", "docs"],
    tabLabels: { qual: "Training & qualification" },
    hints: {
      qualification:
        "Training, competency assessments and requalification — add each with its due date, then Record it with the training record or certificate.",
    },
    summary: "due",
    due: { word: "Requalification", track: "qualification" },
    columns: ["Person", "Role", "Qualified for", "Requalification"],
    photo: false,
    ids: { field: "empId", type: "role", pattern: "EMP-{###}" },
  },

  packaging: {
    kind: "packaging",
    route: "/packaging",
    title: "Packaging & labelling materials",
    description:
      "Sterile barrier systems, trays, labels and IFUs — lot-controlled for the device history record.",
    noun: "item",
    eyebrow: "PACKAGING / LABELLING",
    addLabel: "+ Add item",
    newName: "New item",
    nameLabel: "Item name",
    searchPlaceholder: "Search item, code or supplier…",
    intro: [
      "Packaging and labelling materials for ",
      " — lot-controlled for the device history record.",
    ],
    icon: ICON.box,
    statuses: ["Approved", "Quarantine", "Obsolete"],
    fields: [
      { key: "code", label: "Item code", type: "text" },
      {
        key: "kind",
        label: "Type",
        type: "select",
        options: ["Sterile barrier pouch", "Tyvek header bag", "Thermoformed tray", "Inner box / carton", "Device label", "UDI label", "IFU", "Insert / desiccant", "Other"],
      },
      { key: "spec", label: "Size / specification", type: "text" },
      { key: "reorder", label: "Reorder level", type: "number" },
      { key: "siteId", label: "Site", type: "select", ref: "sites", empty: "All sites (shared)" },
    ],
    tabs: ["overview", "lots", "receipts", "qual", "usage", "docs"],
    tabLabels: { lots: "Lots & stock", qual: "Packaging validation" },
    hints: {
      qualification:
        "Sterile barrier validation (ISO 11607): seal strength, integrity, accelerated / real-time ageing — add with a due date, then Record it with the report.",
    },
    summary: "stock",
    columns: ["Item", "Type", "Lot · expiry", "Stock"],
    photo: true,
    ids: { field: "code", type: "kind", pattern: "PKG-{###}" },
    stock: true,
  },

  hospitals: {
    kind: "hospitals",
    route: "/hospitals",
    title: "Hospitals",
    description:
      "The hospitals cases come from. A case form offers them all, or only the hospitals of the surgeon chosen — each person's hospitals are set on Users & Roles.",
    noun: "hospital",
    eyebrow: "HOSPITAL",
    addLabel: "+ Add hospital",
    newName: "New hospital",
    nameLabel: "Hospital name",
    searchPlaceholder: "Search hospital, code or city…",
    intro: ["The hospitals ", " opens cases for."],
    icon: ICON.factory,
    statuses: ["Active", "Inactive"],
    fields: [
      { key: "code", label: "Hospital code", type: "text", placeholder: "e.g. SCMC" },
      { key: "city", label: "City", type: "text" },
      { key: "address", label: "Address", type: "textarea" },
      { key: "contact", label: "Contact (name, phone, email)", type: "text" },
    ],
    tabs: ["overview", "docs"],
    summary: "simple",
    columns: ["Hospital", "City", "Departments", "People"],
    photo: true,
    photoWord: "logo",
  },

  sites: {
    kind: "sites",
    route: "/sites",
    title: "Manufacturing sites",
    description:
      "Where parts are made — this hospital's own facility, a partner hospital, or an outsourced vendor. Machines, equipment and materials belong to a site (or are shared by all); a part request chooses the site, and its quality forms offer that site's items.",
    noun: "site",
    eyebrow: "MANUFACTURING SITE",
    addLabel: "+ Add site",
    newName: "New site",
    nameLabel: "Site name",
    searchPlaceholder: "Search site, type, vendor or city…",
    intro: ["The manufacturing sites of ", " — in-house, partner hospitals and outsourced vendors, with their equipment and people."],
    icon: ICON.factory,
    statuses: ["Approved", "Pending approval", "Suspended"],
    fields: [
      { key: "code", label: "Site code", type: "text", placeholder: "e.g. SCMC-3D" },
      { key: "type", label: "Site type", type: "select", options: SITE_TYPES },
      { key: "vendorId", label: "Vendor (outsourced)", type: "select", ref: "vendors", empty: "None — not a vendor" },
      { key: "city", label: "City", type: "text" },
      { key: "address", label: "Address", type: "textarea" },
      { key: "contact", label: "Contact (name, phone, email)", type: "text" },
      { key: "certificate", label: "Certification", type: "text", placeholder: "e.g. ISO 13485:2016 — cert. no." },
      { key: "certExpiry", label: "Certificate valid until", type: "date" },
    ],
    tabs: ["overview", "equipment", "members", "qual", "docs"],
    tabLabels: { qual: "Audits & approval" },
    hints: {
      qualification:
        "Site approval, audits and certificate checks (ISO 13485 §7.4 for outsourced sites) — add with a due date, then Record it with the audit report.",
    },
    summary: "simple",
    due: { word: "Next audit", track: "qualification" },
    columns: ["Site", "Type · vendor", "City", "Equipment · people"],
    photo: true,
    photoWord: "logo",
    ids: { field: "code", type: "type", pattern: "SITE-{##}" },
  },

  viewers: {
    kind: "viewers",
    route: "/viewers",
    title: "Viewer list",
    description:
      "The viewers a case can be seen in — 3D Viewer, Orthognathic Planner, Fibula Flap Planner. Each product, and each sub-scope, is associated with none, one or more of them.",
    noun: "viewer",
    eyebrow: "VIEWER",
    addLabel: "+ Add viewer",
    newName: "New viewer",
    nameLabel: "Viewer name",
    searchPlaceholder: "Search viewer or type…",
    intro: ["The viewers ", " offers with its cases."],
    icon: ICON.monitor,
    statuses: ["Active", "Inactive"],
    fields: [
      { key: "type", label: "Type", type: "select", options: VIEWER_TYPES },
      { key: "description", label: "Description", type: "textarea" },
    ],
    tabs: ["overview", "docs"],
    summary: "simple",
    columns: ["Viewer", "Type", "Description", "Used by"],
    photo: true,
    photoWord: "logo",
  },

  products: {
    kind: "products",
    route: "/products",
    title: "Products",
    description:
      "What a case is opened for — 3DPDF, anatomical model, PSI, mold… — each with the stages its cases go through, set up like a workflow's, and the manufacturing workflow of its parts. Chosen on the case form.",
    noun: "product",
    eyebrow: "PRODUCT",
    addLabel: "+ Add product",
    newName: "New product",
    nameLabel: "Product name",
    searchPlaceholder: "Search product, code or tag…",
    intro: ["The products ", " opens cases for — and the stages their cases go through."],
    icon: ICON.layers,
    statuses: ["Active", "Inactive"],
    fields: [
      { key: "code", label: "Product code", type: "text", placeholder: "e.g. PSI — used as {TYPE} in the case ID" },
      {
        key: "category",
        label: "Category",
        type: "select",
        options: ["Planning / report", "Anatomical model", "Patient-specific instrument", "Mold", "Implant", "Other"],
      },
      { key: "workflowId", label: "Workflow", type: "select", ref: "workflows", empty: "Not set yet" },
      { key: "description", label: "Description", type: "textarea" },
    ],
    tabs: ["overview", "docs"],
    summary: "catalog",
    columns: ["Product", "Kind · tags", "Case stages", "Manufacturing workflows"],
    photo: false,
    ids: { field: "code", type: "category", pattern: "PRD-{##}" },
  },

  subscopes: {
    kind: "subscopes",
    route: "/subscopes",
    title: "Sub-scopes",
    description:
      "Variants of a product — e.g. PSI: orthognathic, mandible reconstruction — each able to have its own case stages instead of the product's.",
    noun: "sub-scope",
    eyebrow: "SUB-SCOPE",
    addLabel: "+ Add sub-scope",
    newName: "New sub-scope",
    nameLabel: "Sub-scope name",
    searchPlaceholder: "Search sub-scope or product…",
    intro: ["Sub-scopes of ", "'s products — a sub-scope's own case stages, when set, are used instead of its product's."],
    icon: ICON.layers,
    statuses: ["Active", "Inactive"],
    fields: [
      { key: "productId", label: "Product", type: "select", ref: "products", empty: "Choose a product" },
      { key: "code", label: "Sub-scope code", type: "text" },
      { key: "workflowId", label: "Workflow", type: "select", ref: "workflows", empty: "Same as the product" },
      { key: "description", label: "Description", type: "textarea" },
    ],
    tabs: ["overview", "docs"],
    summary: "catalog",
    columns: ["Sub-scope", "Product", "Case stages", "Manufacturing workflow"],
    photo: false,
  },
};

const BY_ROUTE = new Map(RESOURCE_KINDS.map((kind) => [KINDS[kind].route, kind]));

/** The kind a sidebar page shows, if that page is a resource list. */
export function kindForRoute(route: string): ResourceKind | null {
  return BY_ROUTE.get(route) ?? null;
}

export const TAB_LABELS: Record<TabKey, string> = {
  overview: "Overview",
  lots: "Lots & stock",
  maint: "Maintenance",
  qual: "Qualification",
  supplied: "Supplied items",
  receipts: "Receipts",
  usage: "Usage records",
  history: "Build history",
  docs: "Documents",
  members: "Members",
  equipment: "Equipment & materials",
};

export function tabLabel(config: KindConfig, tab: TabKey): string {
  return config.tabLabels?.[tab] ?? TAB_LABELS[tab];
}

export const TRACK_OF_TAB: Partial<Record<TabKey, Track>> = {
  maint: "maintenance",
  qual: "qualification",
};

// --- Workflows ---------------------------------------------------------------

export interface StageTask {
  name: string;
  /** Due offset in days from the start of the stage. */
  days: number;
}

/** The id in an editor opened from "Add", before anything is saved: `<route>/new`. */
export const NEW_ID = "new";

export interface WorkflowStage {
  id: string;
  name: string;
  /**
   * Who works on the stage: role names, comma separated — the app's or the
   * platform's ("Member, Production"). "" = assign later. Older stages hold
   * one of the fixed labels (Manufacturing, Quality…).
   */
  role: string;
  /**
   * Who may be sent this stage's quality forms for approval: role names,
   * comma separated; "" or absent = anyone in the space.
   */
  approvers?: string;
  /** Expected working days; null = not set. */
  days: number | null;
  forms: string[];
  /**
   * Whether this stage's quality forms must be approved before a part moves
   * on; absent = yes. Off, the forms stay on the part to complete later.
   */
  formsRequired?: boolean;
  /**
   * Forms of this stage that do not hold it back even when its forms must be
   * approved (by their label, as in `forms`) — completed and approved later.
   */
  optionalForms?: string[];
  /**
   * Case stages only: when this stage's quality forms can be filled — only
   * while the case is at the stage ("stage", the default), or at any time.
   */
  formsFill?: "stage" | "anytime";
  /**
   * With more than one form: any of them can be filled ("any", the default),
   * or they are filled in the order listed — each once the one before it is
   * submitted ("sequence").
   */
  formsOrder?: "any" | "sequence";
  emailsNext: string[];
  emailsBack: string[];
  tasks: StageTask[];
  /**
   * Case stages only: the viewer buttons shown while a case is at this stage —
   * each associated viewer, and the roles that see it ("" = everyone).
   */
  viewers?: StageViewer[];
  /**
   * The case's — or part's — information locked: while it is at this stage
   * ("stage"), or from this stage on ("onward"); absent = not locked.
   */
  lockInfo?: "stage" | "onward";
  /** Whom the lock holds: role names, comma separated; "" or absent = everyone. */
  lockRoles?: string;
}

/** Whether a form record is the one a stage lists by this label: "Name (code)", the name or the code. */
export function formMatches(label: string, form: { name: string; code: string }): boolean {
  const l = label.trim().toLowerCase();
  return l === (form.code ? `${form.name} (${form.code})` : form.name).toLowerCase() || l === form.name.toLowerCase() || Boolean(form.code && l === form.code.toLowerCase());
}

/** A form counts as filled, for the next in order, once it is submitted. */
const FILLED = new Set(["Pending approval", "Approved"]);

/**
 * In a stage whose forms are filled in order: the name of the earlier form
 * not yet submitted, which this one waits for — or null when it may be filled.
 */
export function orderWaiting(
  stage: Pick<WorkflowStage, "forms" | "formsOrder"> | undefined,
  form: { name: string; code: string },
  siblings: Array<{ name: string; code: string; status: string }>,
): string | null {
  if (!stage || stage.formsOrder !== "sequence" || stage.forms.length < 2) return null;
  const at = stage.forms.findIndex((l) => formMatches(l, form));
  if (at <= 0) return null;
  for (const label of stage.forms.slice(0, at)) {
    const before = siblings.find((x) => formMatches(label, x));
    if (before && !FILLED.has(before.status)) return before.name;
  }
  return null;
}

/** A stage's forms in the order it lists them (unlisted ones last, as they were). */
export function inStageOrder<T extends { name: string; code: string }>(stage: Pick<WorkflowStage, "forms"> | undefined, forms: T[]): T[] {
  const pos = (f: T) => {
    const i = (stage?.forms ?? []).findIndex((l) => formMatches(l, f));
    return i < 0 ? Number.MAX_SAFE_INTEGER : i;
  };
  return [...forms].sort((a, b) => pos(a) - pos(b));
}

type LockStage = Pick<WorkflowStage, "name" | "lockInfo" | "lockRoles">;

/** The stage whose lock holds the information at stage `at` — its own, or an earlier one's "from here on"; null when none. */
export function lockingStage(stages: LockStage[], at: number): LockStage | null {
  for (let j = Math.min(at, stages.length - 1); j >= 0; j -= 1) {
    const s = stages[j];
    if (s?.lockInfo === "onward" || (j === at && s?.lockInfo === "stage")) return s;
  }
  return null;
}

/** Whether stage `i` locks the information (for anyone): to tag it LOCKED. */
export function stageLocked(stages: LockStage[], i: number): boolean {
  return lockingStage(stages, i) !== null;
}

/**
 * Why this person may not change the information at stage `at` — or null
 * when they may. Their role names are matched against the lock's roles.
 */
export function infoLockedFor(stages: LockStage[], at: number, roleNames: string[], noun: "case" | "part"): string | null {
  const s = lockingStage(stages, at);
  if (!s) return null;
  const want = (s.lockRoles ?? "").split(",").map((r) => r.trim().toLowerCase()).filter(Boolean);
  const have = roleNames.map((r) => r.trim().toLowerCase());
  if (want.length && !want.some((w) => have.some((h) => h === w || h.includes(w)))) return null;
  return `The ${noun} information is locked at "${s.name}"${want.length ? ` for ${s.lockRoles}` : ""} — it can no longer be changed.`;
}

/** Whether a form of a stage is one that does not hold it back: by its label, name or code. */
export function isOptionalForm(stage: Pick<WorkflowStage, "optionalForms"> | undefined, form: { name: string; code: string }): boolean {
  const optional = new Set((stage?.optionalForms ?? []).map((f) => f.trim().toLowerCase()));
  if (optional.size === 0) return false;
  const label = (form.code ? `${form.name} (${form.code})` : form.name).toLowerCase();
  return optional.has(label) || optional.has(form.name.toLowerCase()) || Boolean(form.code && optional.has(form.code.toLowerCase()));
}

export interface StageViewer {
  viewerId: string;
  /** Role names, comma separated; "" = everyone. */
  roles: string;
}

export interface WorkflowData {
  method: string;
  sourcing: "In-house" | "Outsourced";
  /** Outsourced: the vendor of its default site (kept for display; the site decides). */
  vendorId: string;
  /** Earlier: the vendors it could go to — replaced by its sites. */
  vendorIds?: string[];
  /** The manufacturing sites it runs at (Manufacturing Sites ids); none listed = any site that fits how it is made. */
  siteIds?: string[];
  /** The site a part request starts with. */
  siteId?: string;
  stages: WorkflowStage[];
}
