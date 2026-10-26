# Functional spec — `Cases.dc.html` ("Cases and tasks")

Source: `project/Cases.dc.html` (2261 lines, ~456 KB). Lines 9–1066 = `<x-dc>` template, 1067–2259 = `class Component extends DCLogic`.
Everything below was read from the file unless marked **(inferred)** or **(derived)** (= computed by me from the seed logic, not literally in the file).
The file contains no text that reads like an instruction to the reader/agent; it is pure template + logic.

Conventions: `me` = current user name (`props.userName ?? 'Platform Admin'`). "Toast" = dark pill bottom-centre, auto-hides after 2600 ms.

---

## 0. One-paragraph overview

One component renders **five different pages** depending on the `page` prop: **Cases** (list + case detail), **Tasks** (list/board + task modal), **Parts** (list + part detail with stage workflow, QA form filling, traceability), **Part Request Setup** (part-ID rule + request-form builder), and **QA Form Setup** (QA form template list, 3-pane template builder, variable library). Two overlays are global: the **Request a part** modal and the **QA form fill** modal; plus the **Task** modal and a toast. All data is in-memory React-style state seeded in the constructor; nothing is persisted.

---

## 1. Props

### 1.1 Declared in `data-props`

| Prop | Editor | Values / default | Effect |
|---|---|---|---|
| `page` | enum | `cases` (default), `tasks`, `parts`, `partsetup`, `qaforms` | Selects which page renders (see §2). |
| `userName` | none | string; falls back to `'Platform Admin'` | Current user (`me`). Used for "Assign to me", ownership gating of stage moves, `by` stamps, first entry of people dropdowns, `{user.name}` variable. |
| `onNavigate` | none | function(pageKey) | Called with `'parts'` when a part ID is clicked in a case's Manufacturing tab, and with `'cases'` when a case link is clicked from Parts/Tasks. The Dashboard shell uses it to switch sidebar section. |
| `$preview` | — | `{width:1184,height:1000}` | Design-canvas preview size only (content width ≈ 1184 px inside the shell). |

### 1.2 Used in the script but NOT declared in `data-props` (passed by Dashboard)

Dashboard mounts it as: `<dc-import name="Cases" page="{{casesPage}}" focus="{{casesFocus}}" on-parts-sync="{{onPartsSync}}" val-check="{{valCheck}}" user-name="{{userName}}" on-navigate="{{navigate}}">`.

| Prop | Shape | Effect |
|---|---|---|
| `focus` | string `"<command>#<timestamp>"` | Deep-link / command channel from Dashboard. Processed once per distinct value (`applyFocus`). Commands (the part after `#` is ignored): <br>• `newpart` → opens Request-a-part modal (case not locked). <br>• `case:<caseId>:<tab>:<partIdx>` → opens case detail on tab (`info` default). <br>• `part:<caseId>:<partIdx>:<pTab>` → opens part detail (`pTab` default `current`). <br>• `assign:<caseId>:<partIdx>` → sets part assignee = me, logs "Assigned part" / "Part assigned to {me} from the dashboard". <br>• `advance|<GRN>|<caseId>:<partIdx>;<caseId>:<partIdx>;…` → for each part: log "Received on {GRN}" / "Goods receipt accepted — part returned from supplier", then `movePart(+1)` (staggered 30 ms). |
| `onPartsSync` | function(list) | Called (async) whenever the parts snapshot changes. One object per part: `{idx, requestedOn, due, qty, assignee, material, sourcing, caseState, product, patient, priority, last, formsTotal, formsApproved, formsPending:[names of forms with a response but not Approved], tasksTotal, tasksOpen, uses:[traceability records], partType, wfName, pid, name, caseId, printer, stages:[names], stageIdx, stageAt:[], stageBy:[], stage, printing, queued, done, lot, date}`. `printing/queued/done` are relative to the first stage matching `/^printing|machining at/i`. This is how Dashboard / ProductionMaster get live part data. |
| `valCheck` | object or null **(shape inferred from usage)** | Live master data from ProductionMaster ("Manufacturing setup"): <br>`mode`: `'off'` / `'block'` / other (=warn). <br>`libs`: `{ [sourceKey]: string[] }` — option labels for QA "Dropdown" fields. <br>`details`: `{ [sourceKey]: { [optionLabel]: { vars:{…}, rows:[[label,value]…], warn:string } } }` plus `details.paramsMM: { "<printer>|<material>": paramsKey }` and `details.operators`. <br>`machines`: `{ [printerName]: { qualOk, qualMsg, simple, sets:[{id,name,rev,eff,material,scope[],supplier}] } }`. <br>`lotSup`: `{ [lot]: supplierName }`. <br>Without it, library dropdowns are empty and equipment variables resolve to `—`. |

### 1.3 Roles

There is **no role model** in this file. Every activity-log entry written by the UI is stamped `"{me} · Administrator"`. Seed log entries use role suffixes `Sales Rep`, `Engineer`, `Scan Centre`, `QC inspector`, `Manufacturing`, `Packaging` (strings only). The only permission-like rule is **ownership**: a part's stage can only be moved by its assignee (`pt.assignee === me`). Anyone can assign themselves.

---

## 2. Screens

### 2.1 Page map

| `page` | Sub-views | Switch condition |
|---|---|---|
| `cases` | Case list (`openId == null`) / Case detail (`openId` set) | click row → detail; "Back to cases" → list |
| `parts` | Part list (`partOpen == null`) / Part detail | click part → detail; "Back to parts" → list |
| `tasks` | Tasks (List or Board view) | |
| `partsetup` | Part Request Configuration (builder + live preview) | |
| `qaforms` | `qaMode`: `list` / `edit` / `vars` | |
| any | Request-a-part modal (`reqModal`), QA form-fill modal (`formFill` non-inline), Task modal (`modal`), toast | |

Root container: column, gap 16 px, font IBM Plex Sans, color `#101828`, full width. No page title/header inside the component (the shell provides it).

---

### 2.2 Cases — list (`page=cases`, no case open)

**Row 1 — 5 stat tiles** (grid 5 equal cols, gap 14; each tile is a toggle button; selected = border `#F97066`, bg `#FFF6F2`):

| key | Label | Rule | Icon bg / colour | Seed count (derived) |
|---|---|---|---|---|
| `all` | All Cases | all | `#FFF1EB` / `#E24E1B` | 15 |
| `new` | New | `status === 'Case Created'` | `#EFF8FF` / `#175CD3` | 0 |
| `progress` | In Progress | state not Archived/Cancelled and status ≠ Completed | `#FFFAEB` / `#B54708` | 11 |
| `completed` | Completed | status ∈ {Completed, Shipped} | `#ECFDF3` / `#067647` | 3 |
| `archived` | Archived | state ∈ {Archived, Cancelled} | `#F2F4F7` / `#475467` | 4 |

Tile: 34×34 icon chip (radius 9), count in IBM Plex Mono 19/600, label 12 px `#475467`. Counts ignore search/filters.

**Row 2 — toolbar** (flex, gap 10):
1. Search input, width 260, height 38, placeholder `Search cases, patient, surgeon…` (aria "Search cases"). Matches case-insensitive substring over `id + product + patient + surgeon + hospital`.
2. `Filters` button (funnel icon) with orange count badge (total selected values); border turns `#F97066` when any filter is active. Opens a 290 px popover: header `Filter cases` + `Clear all`; accordion groups (one open at a time; default open `product`), each with checkboxes and a right-aligned per-value count; group header shows `· N` selected in orange and caret ▲/▼:
   - `Product`, `Status` (in pipeline order), `Surgeon`, `Hospital`, `Priority` (fixed order Critical, High, Medium, Low), `Case state`. Values = distinct values present in cases (sorted alphabetically except Status/Priority). Within a group = OR, across groups = AND.
3. spacer
4. `Sort` select: `Due date` (default; surgery date asc), `Product`, `Surgeon`, `Status` (pipeline order), `Priority` (Critical→Low).
5. View toggle (segmented, 2 icon buttons): `Grid view` / `List view` (default list).
6. `Columns` button (list view only) → 210 px popover titled `Show columns` with checkboxes: `Image`, `Product`, `Surgeon`, `Patient`, `Hospital` (off by default), `Surgery date`, `Priority`, `Status`. `Case ID` is always shown.

Opening Filters closes Columns and vice versa. No click-outside handling. **No "New case" button, no pagination, no bulk actions, no row selection.**

**List view** — card (radius 14) with header row (11 px uppercase `#667085`, letter-spacing .6) and rows (whole row is a button → opens detail). Columns and grid widths:

| Column | Width | Cell |
|---|---|---|
| Image | 44px | 34×34 gradient tile (per product) with white line icon |
| Case ID | 0.8fr | Mono 12.5/600 orange `#E24E1B` |
| Product | 1.5fr | 9×9 colour square (product colour) + name 600, ellipsis |
| Surgeon | 1fr | `#475467` |
| Patient | 0.9fr | short form e.g. `R. Kulkarni` |
| Hospital | 1.3fr | ellipsis |
| Surgery date | 0.9fr | `Oct 09, 2026` format |
| Priority | 0.7fr | badge (see §7) |
| Status | 1.3fr | status badge + optional `● CANCELLED` / `● ON HOLD` text in edge colour |

Row: padding 11×18 (left 15 + 3 px left border), font 13.5. Left edge colour: Cancelled `#F04438`, On hold `#F79009`, else transparent. Cancelled rows have opacity 0.6. Empty state: `No cases match these filters.`

**Grid view** — 3 columns, gap 16; card = 48×48 gradient tile, product name 14/700, priority badge (uppercase, 10 px), case ID mono, `{surgeon} · {hospital}`; footer: status badge left, `Due {Mon DD}` right. Card border/left-edge uses the state edge colour (else `#E4E7EC`). No empty state in grid view.

---

### 2.3 Cases — detail (`openId` set)

Top to bottom:

1. `← Back to cases` text button.
2. **Header card**: 56×56 gradient product tile; `h2` product name (19/700) + status badge + optional `● {STATE}` (shown when state ≠ Active; colour Cancelled `#B42318`, On hold `#B54708`, else `#475467`); sub-line mono `{caseId} · {patient} · {surgeon}`; right: dark button `Open 3D Viewer` (cube icon stroked `#FF8A5C`) → toast `3D viewer would open the latest design model here`.
3. **Status timeline card**: title `Status timeline · current progress`; 9 equal columns, one per case stage. Circle 26 px: done = filled orange with white check; current = white with orange ring and orange number; todo = grey ring `#D0D5DD`, grey number. Connector line 2 px (orange when the left step is done). Label 11.5 px (bold for current, grey for future). Steps index 4 (`Design Approval`) and 6 (`QA & Sterilization`) show an amber `APPROVAL` tag.
4. **Tabbed card** — tabs (icon + label, 48 px high, selected = orange text + 2 px orange underline): `Case Information` (default), `Status`, `Manufacturing`.

**Tab: Case Information** (read-only; heading `Case Information`). Sections with orange uppercase headers, 2-col grids of label (11 px uppercase grey) / value (14/500):
- `CASE IDENTIFICATION`: `PRODUCT`, `SCOPE / APPLICATION`.
- `CLINICAL TEAM`: `SURGEON`, `SALES REP` (blue pills `#EFF8FF/#175CD3`, one per rep), `HOSPITAL`.
- `PATIENT INFORMATION`: header also has consent pill (`Consent attested` green / `Consent not attested` grey) and amber button `View patient details` / `Hide patient details`. Fields: `PATIENT FIRST NAME`, `PATIENT LAST NAME`, `DATE OF BIRTH`, `AGE`. Masked by default: first/last show first letter + `·······`; DOB `••/••/••••`; age `••`. Unmasking writes an audit entry `Viewed patient details` / `Unmasked patient identifiers`.
- `SCHEDULING & LOGISTICS`: `SURGERY DATE`, `ANTICIPATED SHIP DATE`, `SHIPPING ADDRESS` (full width, `—` when empty).

**Tab: Status** — heading `Workflow statuses`, sub `Statuses, forms and tasks come from the product configuration. Owners, due dates and completion for each status.` Table, one row per case stage (current row bg `#FFFCF5`):

| # | Status | Quality forms | Tasks | Assigned to | Due date | Completed by | Completed time |
|---|---|---|---|---|---|---|---|
| numbered circle (check when done) | stage name + `APPROVAL` tag on stages 5 & 7 | chips `● {form name} · {status}` (dot colour by form status) or `—` | bullet list of case-level tasks for that stage (Done = strike-through + green dot; In progress = orange dot; Open = grey dot) | name or `Unassigned` | `Mon DD, YYYY` or `—` | name or `—` | stamp or `—` |

All read-only in the rendered template.

**Tab: Manufacturing** — heading `Part requests`, sub `{n} part(s) · production runs through the Production Master workflow`, button `+ Request a part` (opens request modal with case pre-selected and locked). One card per part: cube icon chip; name + underlined mono part ID (click → opens that part on the Parts page and calls `onNavigate('parts')`); meta `{tech} · {material} · qty {n} · due {YYYY-MM-DD}`; workflow name (orange) + sourcing tag `IN-HOUSE` (blue) / `OUTSOURCED` (amber); right pill = current stage name; below, a mini stepper of all workflow stages (20 px dots; done = green with check, current = orange ring, future grey).

---

### 2.4 Parts — list (`page=parts`)

**Tiles** (same style as cases):

| key | Label | Rule | Seed count (derived) |
|---|---|---|---|
| `all` | All parts | all | 23 |
| `new` | New request | stage 0 and case not Archived/Cancelled | 5 |
| `progress` | In progress | 0 < stage < last and case not Archived/Cancelled | 6 |
| `completed` | Completed | stage = last | 10 |
| `archived` | Archived | case Archived or Cancelled | 6 |

**Toolbar**: search (300 px, placeholder `Search part, ID, material, case…`; matches part ID, name, case ID, material, printer); spacer; `Sort` select: `Due date` (default), `Part name`, `Part ID`, `Material`, `Stage progress` (stage/last ratio); `☰ Columns` popover (checkboxes `Case`, `Material`, `Machine`, `Status`, `Due`; all on); primary button `+ Request a part` (bg `#C4320A`).

**Table**: `Part ID` (mono, 1fr) | `Part` (1.7fr: name 600 + meta `{tech} · qty {n} · {workflow name}`) | `Case` (0.7fr, underlined orange mono link → opens case + `onNavigate('cases')`) | `Material` (1fr) | `Machine` (1fr) | `Status` (1.1fr, pill = current stage name; colour: stage 0 indigo `#EEF4FF/#3538CD`, last stage green `#ECFDF3/#067647`, else orange `#FFF1EB/#C4320A`) | `Due` (0.7fr mono, ISO date or `—`). Part ID and Part cells open the part. Empty: `No parts match.` No filters popover, no pagination.

---

### 2.5 Parts — detail (`partOpen` set)

1. `‹ Back to parts`.
2. **Header card**: icon chip, `h2` part name + mono part ID, sub `Case {id} · {product} · {patient}`, right pill = current stage (colour rule as list).
   - **Stepper** of all workflow stages (22 px dots, green done / orange current).
   - **Owner + movement row**: `ASSIGNED TO` {name | `Unassigned`}; if not mine → `Assign to me` (orange outline); if mine → `Unassign`; spacer; `← Back: {prev stage}` (or `← Back`) and `Next: {next stage} →` (or `Completed →`). Both disabled unless the part is assigned to me (Next is grey `#D0D5DD` when disabled, orange when enabled). When not mine, hint: `Assign this part to yourself to move its stage.`
3. **Two-column body**: main (flex) + sticky right sidebar 290 px.

**Main — tabs**: `Current stage` (default), `Part info`, `Stages`, `Quality Forms`, `Tasks`, `Activity log`. (Template placeholder count says 5; there are 6.)

**Tab: Current stage**
- If the current stage has quality forms (whose template still exists): orange-tinted banner `CURRENT STAGE · {stage}` + title `{n} quality form(s) to complete at this stage` or `All quality forms for this stage are approved`; right: one pill-button per form at this stage (`{name}` + status chip) to choose which form is shown. Below, the selected form is rendered **inline** (same body as the form-fill modal, §2.9, incl. footer buttons). Default selection: previously picked form → first non-Approved → first.
- Else: `CURRENT STAGE · {stage}`, `No quality forms at this stage`, hint `Complete the stage tasks below, then use “Next” to move to {next}.` (or `This part has completed all stages.`), then buttons for each task at this stage `{task name} · {status}` (opens task modal).

**Tab: Part info**
- Header `Part info` + sub (`As submitted in the part request form` / `Editing production details for this part`) + `Edit` / `Done` toggle.
- Meta strip: `REQUESTED BY`, `REQUESTED ON`, `PART ID`, `CASE` (link).
- **View mode**: renders the *current part-request form definition* (all shown sections/fields from Part Request Setup) filled with this part's values; text fields as dashed-underline values (`—` grey if empty), image fields as a 150 px preview box (`No image`), file fields as chips `⤓ {filename}` (toast `Downloading {name}`) and `Link · {url}` (toast `Opening link`), or `No files attached`.
- **Edit mode** (all changes apply immediately, each logs to part activity):
  - `PRODUCTION WORKFLOW` select (5 workflows). Changing it **resets the part**: stage 0, default printer, forms/stageMeta/default tasks rebuilt; log `Changed production workflow` / `{old} → {new} (stages reset)`; toast `Workflow changed — stages reset to Request received`.
  - `PART TYPE` select: `— Select —`, `Implant`, `Surgical guide`, `Jig`, `Anatomical model`, `Instrument` (log `Set part type`).
  - `MANUFACTURING TECH` (read-only, from workflow).
  - `SOURCING` select: `In-house` / `Outsourced` (log `Changed sourcing`).
  - `OUTSOURCE VENDOR` (only when Outsourced): `— choose vendor —`, `Precision AddCorp`, `BioForm Labs`, `MedMill CNC`, `RapidCast Inc` (log `Set outsource vendor`).
  - `ASSIGNED TO` select: `Unassigned` + people (log `Reassigned part`).
  - `DUE DATE` date input (no log).
  - `PRINTER / RESOURCE` select: `EOS M 290`, `Formlabs Form 3B+`, `HP Jet Fusion 5200`, `Haas VF-2 CNC` (log `Set printer / resource`).
  - `REQUEST DETAILS` box (label/value list of stored request details), `NOTES` textarea (placeholder `Production notes for this part`), `FILES FOR PRINTING` (teal chips `↓ {file}` → toast; blue link chips `🔗 {url} ↗` open in new tab; `No files or links attached.`).
- **Traceability — recorded in quality forms** table (always shown): sub `Printer, lots, equipment, operators and parameters picked in this part’s QA forms. Each record also appears on that item’s page.` Columns `Type` | `Item` | `Recorded in` (form name + `(status)`, sub `{field} · {stage}`) | `By · when`. Empty: `Nothing recorded yet — records appear when a QA form with library dropdowns (printer, lot, equipment, operator…) is saved.`
- **Inspection drawing** (if the part has one): `INSPECTION DRAWING · {n} drawing(s) · {n} balloons`; 2-col grid of drawings with balloons + leader arrows overlaid (read-only); table `Sl. No.` | `Balloon ID` (+ sub `Drawing N` / `Manual`) | configured columns (default `Characteristics`, `Specification`, `LSL`, `USL`).
- Dark button `→ Advance to {next stage}` (hidden on last stage). If not mine: toast `Assign this part to yourself to move its stage`.

**Tab: Stages** — heading `Stages`, sub `Stages and quality forms come from the production workflow. Assign an owner, set a due date, and fill the forms per stage.` Table per workflow stage:

| # | Stage | Forms | Tasks | Assigned to | Due date | Completed by | Completed on |
|---|---|---|---|---|---|---|---|
| circle (green check when done) | name + label chip `Completed` (green) / `In progress` (orange) / `Pending` (grey) | pill buttons per form (open form-fill **modal**) or `—` | task buttons (dot + name + type chip `Default`/`Manual`; opens task modal) | **editable** select `Unassigned` + people (log `Assigned stage owner` / `{stage} → {name}`) | **editable** date | name or `—` | stamp or `—` |

**Tab: Quality Forms** — heading `Quality forms`, sub `ISO 13485 records for this part, attached to its production stages. Forms at the current stage must be approved to advance.` One row per form: clipboard icon; name + status pill + `Unassigned` pill; mono meta `{code} · {stage name} · {clause}`; `● Required to advance` (red; shown whenever status ≠ Approved, for any stage); `ASSIGNEE` line (name, or `Assign to…` select + `Assign to me`; log `Assigned quality form` / `{form} → {name}`); `✓ Last saved by {by} · {at}` when a response exists; right button `Open form` / `View record` (Approved) → form-fill modal. Empty: `No quality forms attached to this part's workflow.`

**Tab: Tasks** — heading `Tasks`, sub `{n} task(s) · default tasks come from the production workflow stages`, button `+ New task` (task modal pre-set to this case + part, ref = part ID, refSub = current stage). Rows (Default tasks first, by stage): name, sub `{stage}{ · assignee}`, type chip (`Default` indigo / `Manual` grey), status chip. Click → task modal.

**Tab: Activity log** — heading `Activity log`, sub `Every action on this part — with who and when.`, `↓ Export PDF` (toast `Exporting part activity as PDF`). Timeline rows: orange dot, title (700), mono time right, detail, who. Empty: `No activity recorded yet for this part.`

**Sidebar (`Part summary` aside, sticky)**
- `PROGRESS`: `Stage {k} of {N} · {stage}` and `{pct}%` + 8 px orange progress bar; three counter buttons: `Quality forms approved a / b` (→ Quality Forms tab), `Tasks done a / b` (→ Tasks), `Traceability records n` (→ Part info). Counter value green when complete else amber.
- `PART SUMMARY` key/values: `Case`, `Patient`, `Surgeon` (`{surgeon} · {hospital}`), `Part type`, `Workflow`, `Material`, `Machine`, `Due date` (`{ISO} · in {n}d` / `· overdue {n}d`), `Assigned`; link `Open case {id} ›`.
- `QUICK ACTIONS`: `All quality forms`, `Activity log`.

---

### 2.6 Request a part — modal (780 px, overlay `rgba(12,21,36,.55)`)

Header `Request a part` + ×. Dark strip `PART ID` + live preview of the generated ID (orange mono; `—` if no case). Body = the configurable form (sections/fields from Part Request Setup, only `show` fields; section grid 1/2/3 columns; textarea, file and balloon fields span the full row in 2-col sections). Required marker: orange ` *`. Footer: red inline error (`role=alert`), `Cancel`, `Request part`.

Field renderers by type:
- `text` / `number` / `date` → input. `textarea` → 3-row textarea. `checkbox` → checkbox labelled `Yes`.
- select-like (`case`, `workflow`, `parttype`, `priority`, `material`, `printer`, `sourcing`, `vendor`, `select`) → select with first option `Select…`. Option lists:
  - `case`: non-Archived, non-Cancelled cases as `{id} — {product}` (disabled/locked when opened from a case).
  - `workflow`: the 5 workflows (§3.5). `parttype`: `Implant`, `Surgical guide`, `Jig`, `Anatomical model`, `Instrument`. `priority`: `Low`, `Medium`, `High`, `Critical`. `material`: `Ti-6Al-4V ELI`, `BioMed Clear Resin`, `PA12 Nylon`, `PLA / PETG`, `PEEK-OPTIMA`. `sourcing`: `In-house`, `Outsourced`. `vendor`: `None — in-house`, `Precision AddCorp`, `BioForm Labs`, `MedMill CNC`, `RapidCast Inc`. `printer`: `EOS M 290`, `Formlabs Form 3B+`, `HP Jet Fusion 5200`, `Haas VF-2 CNC`. Custom `select`: its comma-separated options.
- `image` → 120×84 preview (`No image`) + dark button `Upload image` / `Replace image` (`accept="image/*"`). Image is read client-side, downscaled so the longest side ≤ 900 px, stored as PNG data-URL.
- `file` → dashed drop zone `Drag & drop or click to choose {types} files` (multiple). Only **file names** are kept (teal removable chips). If links are allowed: URL input `Or paste a download link (Google Drive, OneDrive, WeTransfer…)` + `+ Add link` (Enter also adds). Link rule: prepend `https://` if no scheme; must match `^https?://[^\s.]+\.[^\s]+$` else toast `Enter a valid link, e.g. https://drive.google.com/…`; duplicates ignored. Links shown as blue rows (label = URL without scheme, max 60 chars) with ×.
- `balloon` (drawing + balloon table) → button `+ Add drawing image(s)` (multiple images) and help text `Click a drawing to place a numbered balloon (each adds a row below). Drag the balloon or its arrow point to adjust — or focus one and use the arrow keys.` Per drawing: header `Drawing N`, file name, `{n} balloons`, `Remove`; the image (crosshair cursor) with SVG leader lines + arrowheads and two draggable handles per balloon (arrow point 16 px ring, numbered balloon 26 px). Below: table `Sl. No.` | `Balloon ID` (editable; sub `Drawing N` or `Manual`) | configured columns (editable inputs) | × ; empty text `No characteristics yet — place balloons on a drawing or add a row.`; `+ Add row`.

Defaults on open: `case` = given case or first Active case; `workflow='dmls'`, `qty='1'`, `priority='Medium'`, `sourcing='In-house'`; plus each shown field's configured default value.

---

### 2.7 Part Request Setup (`page=partsetup`)

Two columns (`1fr` / `0.95fr`, gap 20): builder left, sticky live preview right.

**Header card**: `Part Request Configuration` — `Set the part ID rule and design the form people fill in when they request a part. The right panel previews it live.` Buttons `Reset` (restores default sections + ID rule; toast `Part request setup reset to defaults`) and `Save setup` (toast only: `Part request setup saved — new part requests use this form and ID rule`; changes are already live).

**Part ID Rule card** (`#` chip; `The identifier generated for every new part request.`):
- `Prefix` input (mono; forced uppercase, whitespace stripped, max 8 chars; default `JM`).
- `Separator` 4 buttons: `-` (default), `_`, `.`, `none`.
- `Token sequence`: dashed box showing prefix chip then each token chip (`{CODE}` + sample) with `‹` `›` reorder and `×` remove, separated by the separator glyph (`·` when none).
- Token library pills (click to append; added ones show `✓`, others `+`; tooltip `{description} · e.g. {sample}`):

| Token | Description | Sample | Real value |
|---|---|---|---|
| `PRODUCT` | Product code | `CRANIO` | product code map (§3.2), fallback `PART` |
| `CASE_SEQ` | Case number | `0428` | case id without `JM-` |
| `PART_SEQ` | Part sequence | `01` | (existing part count + 1) zero-padded to 2 |
| `PART_TYPE` | Part type code | `IMP` | Implant `IMP`, Surgical guide `GDE`, Jig `JIG`, Anatomical model `MDL`, Instrument `INS`, Prototype `PRT`; fallback `PRT` |
| `MATERIAL` | Material code | `TI64` | by workflow: dmls `TI64`, sla `BMC`, sls `PA12`, fdm `PLA`, cnc `PEEK`; fallback `MAT` |
| `YYYY` | Year | current year | |
| `MM` | Month | current month 2-digit | |
| `SPACE` | Company space code | `JM` | constant `JM` |

Default rule: prefix `JM`, sep `-`, tokens `PRODUCT, CASE_SEQ, PART_SEQ` → preview `JM-CRANIO-0428-01`.

**Section cards** (one per form section): editable title; `{n} field(s)`; layout toggle `1 col` / `2 col` / `3 col`; `↑` `↓` reorder; `×` delete (only if the section contains no locked field). Column header `FIELD | SHOW | REQ.`. Each field card:
- Row 1: label input (rename), type tag (`text`, `textarea`, `number`, `date`, `select`, `checkbox`, `file`, `image`, `drawing`, `case`, `workflow`), tag `LOCKED` or `CUSTOM`; `Show` switch; `Req.` switch (locked fields cannot be toggled; turning Show off also clears Required; turning Required on forces Show); `↑` `↓`; `×` (custom fields only).
- Row 2 `VARIABLE`: built-in fields show a fixed token chip (e.g. `{part.name}`); custom fields show editable `{request.` _name_ `}` (chars limited to `A-Za-z0-9_`; renaming rewrites the token inside every QA template's item values/labels); `Copy` (clipboard + toast `{token} copied`); usage text `Used in N QA form(s): …` or `Not used in any QA form yet`; warning `Another field already uses this variable`; file fields: `Files are not available as a QA variable`.
- Custom text/textarea: `Default value` input (`Pre-filled in every new request (optional)`).
- Custom select: `Options` input (`Comma separated, e.g. Left, Right`).
- Balloon: `Table columns · Sl. No. and Balloon ID are always first` — fixed chips + editable column chips (rename, `‹` `›`, `×`) + `+ Add column` (`New column`).
- File: `Allowed file types` toggle chips `STL`, `3MF`, `STEP`, `OBJ`, `DICOM`, `PDF`, `Image`, `ZIP` + toggle `🔗 Allow download links` (default on).
- `+ Add field` → inline form: label (`Field label, e.g. Laterality`), type select (`Short text`, `Long text`, `Number`, `Date`, `Dropdown`, `Checkbox`, `File upload`, `Image upload`, `Drawing + balloon table`), options input when Dropdown; `Cancel` / `Add field`. Validation: empty label → toast `Enter a field label`. Variable name = camelCase slug of the label, de-duplicated with numeric suffix. New file field default types `STL, PDF`; new balloon field gets the 4 default columns.
- Bottom: `+ Add section` (`New section`, 2 cols, empty).

**Live preview** (right): chip `● LIVE PREVIEW` + `How the request-part form will appear`; card with dark header `GENERATED PART ID` + sample; greyed skeleton of every shown field; `No visible fields in this section.`; fake `Request part` button.

---

### 2.8 QA Form Setup (`page=qaforms`)

Top segmented tabs (hidden while editing): `QA forms` | `Variable library`.

**(a) List (`qaMode=list`)** — card header `QA forms`, sub `{n} form(s) · click a form to edit it`; search (`Search name, code or standard…`, matches name+code+clause); view toggle Table / Card; `+ New QA form`.
- Table columns: `FORM` (name + orange mono code; click = edit) | `STANDARD / CLAUSE` | `SECTIONS` | `ITEMS` | `MEASUREMENTS` (count of `number` + `table` items) | `VARIABLES` (distinct `{tokens}` in values/labels) | `USED ON PARTS` (parts having a form from this template) | `ACTIONS`: `Edit`, `Duplicate`, `Delete` (Delete hidden when only one template remains).
- Card view: 3-col cards (left orange edge, clipboard tile, name/code/clause, 4 stats `sections`/`items`/`variables`/`parts`, same actions).
- Empty: `No QA forms match your search.`
- New: creates `New QA form`, code `QMS-NEW-{NN}`, one section `Identification` with two Auto fields (`Part name` = `{part.name}`, `Part ID` = `{part.id}`), opens editor.
- Duplicate: name + ` (copy)`, code + `-C`, new ids; toast `Duplicated {name}`.
- Delete: no confirmation; toast `QA form deleted — existing part records are kept`.

**(b) Editor (`qaMode=edit`)**
- Top bar: `← All QA forms`; inline-editable form name; meta line `{code} · {n} section(s) · {n} field(s) · {n} required · ` + link `Added to parts at: {stages}` / `Not added to any workflow stage yet` (amber) → Form details; variable-check pill (title `All variables recognised and filled for the preview part` green / `All variables recognised — some have no value for this part` amber / `Some variables are not recognised` red; sub `Variable check with the preview part — click to preview`); `Variable library`; `Save form` (returns to list, toast `QA form saved`).
- 3 columns (`200px | 1fr | 390px`; `170px | 1fr | 560px` when preview is open):
  - **Outline** (sticky): numbered section list with item counts (click scrolls to section), `+ Add section`.
  - **Sections**: title input; column layout `1 col`–`4 col`; `↑` `↓` `×`. Item rows (click selects → highlighted orange): type icon chip, label, red `*` if required, mapping warning chip, `{Type} · {summary}`, buttons `↑` `↓` `⧉` (duplicate, label + ` (copy)`) `×`. `+ Add field to this section` opens an 8-tile palette (below). `+ Add section`.
  - **Right panel** tabs: `Field settings` | `Live preview` | `Form details`.

Item types (palette):

| type | Name | Description | New-item defaults |
|---|---|---|---|
| `info` | Auto field | Fetched from part, case or request — read-only | label `Part name`, value `{part.name}`, not required |
| `image` | Image | Picture from the part request | `Product image`, `{request.productImage}` |
| `text` | Text entry | Operator types a value — can be pre-filled | `New entry` |
| `number` | Measurement | Measured value with LSL / USL — auto Pass / Fail | `Measurement` |
| `check` | Pass / Fail check | Pass · Fail · N/A buttons | `Check item` |
| `table` | Balloon table | Drawing balloons with measured values | `Balloon inspection`, `{balloon.table}` |
| `sign` | Signature | Name and date sign-off | `Signed by`, `{user.name}` |
| `select` | Dropdown | Pick from a library (printers, lots, operators…) or a custom list | `Printer used`, source `printers` |

**Field settings** (or empty state `Select a field to edit it` / `Click any row in the form. Its type, label, variables, limits and dropdown options appear here. Use “+ Add field” inside a section to add new ones.`): header `FIELD · {section}` + label; `Duplicate` / `Delete`; `Label` input; `Field type` 8 cards; required switch (`Required — the form cannot be submitted without it` / `Optional`; not for Auto fields); per type:
- Dropdown: `Options come from` select — `Printers & machines`, `Post-processing equipment`, `Measuring equipment`, `Tooling & fixtures`, `Sterilization cycles`, `Materials`, `Material lots`, `Standard components`, `Packaging & labelling`, `Suppliers & vendors`, `Operators (qualified people)`, `Process parameter sets`, `Software & versions`, `Manufacturing technologies`, `Part types`, `Custom list (type choices)` (keys: `printers, postproc, measuring, tooling, steril, materials, lots, components, packaging, vendors, operators, params, software, techs, partTypes, custom`). Custom → `Choices (comma separated)` (`e.g. Accepted, Rework, Rejected`); otherwise hint `Live list from the left panel — N option(s) now. Pre-select with a variable in the value box, e.g. {part.printer}.` For sources `lots`, `components`, `packaging`: checkbox `Also record quantity used — deducted from stock, shown on the item’s page`.
- Measurement: `Lower limit (LSL)` (`e.g. 1.95 or {variable}`), `Upper limit (USL)` (`e.g. 2.05`), note `Pass / Fail is calculated automatically when the operator enters the measured value.`
- Balloon table: `Balloon source (part request field)` select (`— Select a balloon field —` or `{balloon.table} · {field label} ({section})`), checkbox `Capture measured values (Measured + Pass / Fail columns)`.
- Value box (all except check/table): label `Value (use variables)` (Auto) / `Default signer` (Signature) / `Pre-fill (optional)`; `Clear`; mapping chip + resolved preview `→ {value for preview part}`; variable picker `Insert a variable — click to add it to the value` with search and grouped list (label, `e.g. {example}`, token) — clicking appends the token (space-separated).
- Footer: `Section` select (move item to another section), `↑ Up`, `↓ Down`.

Mapping chip states: `Mapped · N variable(s)` (green) · `Mapped, but {x} is/are blank for the preview part` (amber) · `Unknown variable {x} — not in the variable library` (red) · `No variable — shows fixed text` / `No variable — will show blank` (grey; info/image/table) · `Operator input · pre-filled with fixed text` / `Operator input · starts blank` (grey).

**Live preview**: `● LIVE PREVIEW` + `with part` select (all parts, `{pid} · {name}` + ` (has balloons)`); dark header (form name, `{code} · {clause}`, `{pid} · {part name}`); the form rendered read-only with that part's data. Default preview part = first part that has an inspection drawing.

**Form details**: `Form name`, `Document code` (forced uppercase), `Standard / clause reference` (`e.g. ISO 13485 §8.2.6`), `Issue No.` (`e.g. 02`), `Effective date` (free text, `e.g. 06-03-2023`), `Rev. No.`; switch `Controlled-document layout (logo header with document no., issue, rev and effective date)`; `Add this form to parts at these workflow stages` — `When a part reaches a selected stage, this form appears on its Current stage tab.` — toggle chips for all 25 distinct stage names across workflows (`✓ `/`+ ` prefix); `Delete this QA form` (if >1 templates).

**(c) Variable library (`qaMode=vars`)**
- Card 1 `Variable library`: `Type a variable such as {part.id} in any QA form field and it is filled automatically from the part, case or request. Click a token to copy it.`; back button (`← All QA forms` or `← Back to {form}`); search (`Search name, token or source…`); `Example values from` part select; count `{shown} of {total} variables · {n} in use`; group filter chips `All · n`, `Part request setup · n`, `Case · n`, `Part & production · n`, `Equipment, material & people · n`, `General · n`. Table: `Variable` (label + copyable token chip `{token} ⧉`, toast `Copied {token}`) | `Where the value comes from` (group in colour + description) | `Type` (`Text`, `Number`, `Date`, `Choice`, `Image`, `Balloon table`) | `Example value` (or `No value for this part`; images show `[image]`) | `Used in forms` (`Used in N form(s)` / `Not used yet` + code chips that open that form's editor). Empty: `No variables match.`
- Card 2 `Dropdown libraries`: `Live lists from the left panel, for “Dropdown” fields. What is picked is saved as a traceability record on the part and on that item’s Usage records tab.` Table: `Library` (name + `Managed on: {setup page}`) | `Options` (count) | `Current entries` (first 3 + `+N more`, or `No entries yet`) | `Used in` (`Dropdowns in {codes}` / `Not used in any dropdown yet`). 15 libraries; "Managed on" pages: Printers & Machines, Post-processing Equipment, Measuring Equipment, Tooling & Fixtures, Sterilization, Materials, Materials → Lots, Standard Components, Packaging & Labelling, Suppliers & Vendors, Operator Qualifications, Process Parameters, Software & Versions, Manufacturing Tech, Part Types.

---

### 2.9 QA form fill — modal (860 px) and inline

Modal header (dark `#0C1524`): form name; orange mono meta `{code} · Issue {x} · Rev {y} · Effective {d} · {clause} · Stage: {stage}`; grey `{pid} · {part name}`; status pill; ×. (Inline variant has no header, starts at the doc header / status strip.)

Optional **controlled-document header** (when template `doc` is on): 3-cell bordered block — brand `jajal` / `MEDICAL`; `Reference Standards` over the form title; clause over rows `Document No.:`, `Issue No:`, `Effective Date:`, `Rev. No.:`. In doc mode section titles are hidden and Auto fields render as bordered `Label: value` rows.

**Status strip**: `● Identification values are fetched automatically from the part, case and request`; right-hand chips: `{n} out of specification` (red), `⚠ {n} item(s) not fit for use` (red), `{n} required item(s) empty` (amber), or `All items complete and in specification` (green).

**Body**: sections (orange uppercase titles; 1–4 column grid) with items:
- Auto field: label + resolved value (`—` if blank). Image: resolved data/http URL image or `—`.
- Text: input (pre-filled with resolved value). Signature: input in `'Brush Script MT', cursive` 18 px + `Date: {today ISO}`.
- Measurement: label, input (`Measured`), `Spec {lsl} – {usl}`, result chip `Pass` (green) / `Fail` (red) / blank.
- Check: label + three toggle buttons `Pass` / `Fail` / `N/A` (click again to clear).
- Dropdown: label (+ red `*`), select (`Select…` + options). Options with a master-data warning are disabled and suffixed `  —  ⚠ {warning}`; stock-tracked options suffixed ` · {n} {unit} left`; for lots, lots of another material sort after matching ones. Optional `Quantity used` input + unit + note (`Pick an item first` / `Available {n} {unit}` / `Available n u  →  m u left after this` green / `Only {n} {unit} available` red / read-only `Used {q} {unit}`). Info box under a picked library item: `{k: v  ·  k: v …}` from master data, `⚠ {warning}` if any, and footnote `Live from {setup page}` or `Recorded when the form was submitted` (snapshot on locked forms).
- Balloon table: warning box if no source (`No balloon source selected — pick the part request balloon variable {balloon.table} for this table in QA Form Setup.`); drawings with balloons (2-col); table `Balloon` | request columns | `Measured` | `Result` (last two only if measuring is enabled); empty text `This part's request has no balloon characteristics — rows appear here automatically when the requester adds them.`
- (`criteria` type — renderer exists: bordered table `Requirement Type | Feature | Specification | Testing / Acceptance Method` with the 10 QAC rows — but no template or palette entry uses it.)

**Footer**: `↓ Export PDF` (toast `Exporting {code} record as PDF`); if editable: `Save draft`, `Submit for approval` (purple `#6941C6`), `Approve` (green `#067647`); if Approved (locked, all inputs disabled): `Close`.

---

### 2.10 Tasks (`page=tasks`) — only tasks of type `Manual` are listed

**Tiles** (6 across; selected border `#101828`; number coloured per tile):

| key | Label | Rule | Seed count (derived, `me`=Platform Admin) |
|---|---|---|---|
| `all` | All tasks | all manual | 9 |
| `mine` | Assigned to me | assignee = me | 0 |
| `soon` | Due soon | not Done, today ≤ due ≤ today+3 | 4 |
| `overdue` | Overdue | not Done, due < today | 0 |
| `unassigned` | Unassigned | no assignee | 1 |
| `done` | Completed | status Done | 1 |

**Toolbar**: search (280 px, `Search tasks, case, assignee…`; matches name, caseId, ref, assignee); `Filters` popover (280 px, `Filter tasks`, `Clear all`; groups `Priority` [Critical, High, Medium, Low], `Status` [Open, In progress, Done], `Assignee` [Unassigned + people], with counts); `Tag` select (`All tags` + sorted distinct tags); `Sort` select (`Due date` default — blank dues last, `Priority`, `Status`, `Task name`, `Assignee`); view toggle `List` / `Board`; `☰ Columns` (list only: `Reference`, `Assignee`, `Priority`, `Status`, `Due`); spacer; primary `+ Assign task`.

**List**: `Task` (2.2fr: name button; chips: type, tags (indigo), checklist progress `☑ a/b` green) | `Reference` (1fr: `ref` or case ID as an orange link to the case when the case exists, sub = `refSub` or case stage name) | `Assignee` (`Unassigned` grey) | `Priority` badge | `Status` badge | `Due` (mono ISO; red when overdue). Empty: `No tasks match. Assign one to get started.`

**Board**: 3 columns `Open`, `In progress`, `Done` (header chip + count). Card: name, priority chip + tags, `{assignee} · {due}`, and `‹` `›` buttons moving the task one status left/right (disabled at the ends). Column empty: `No tasks`. No drag-and-drop.

**Task modal** (600 px; title `New task` / `Edit task`):
- `Status` stepper: 3 buttons `Open › In progress › Done`; hint `Move one step at a time — Open → In progress → Done, or step back the same way.` Only an adjacent status can be picked.
- `Task title` (`What needs to be done?`).
- `Scope` select: `Case` / `General (no case)`. When Case: `Case ID` select (`Select a case…` + all cases `{id} — {product}`) and `Associated status` select (`Any stage (optional)` + 9 case stages).
- `Assignee` (`Unassigned` + people), `Priority` (`Low`, `Medium`, `High`, `Critical`), `Due date`.
- `Reminders`: numeric input (`Days before due date (0 = on due date)`, digits only, max 3 chars) + `Add reminder`; chips `On due date` / `{n} day(s) before due` (sorted descending, no duplicates). Default `[2]`.
- `Tags`: input (`e.g. Quality, Urgent, Materials`) + `Add tag` (Enter adds; no duplicates).
- `Checklist`: input (`Add a checklist point…`) + `Add point` (Enter adds); rows with checkbox (strike-through when done) and ×.
- Error (`Enter a task title.`); footer: `Delete task` (edit only, no confirmation; toast `Task deleted`), `Cancel`, `Save task` (toast `Task created` / `Task updated`).

---

## 3. Data model

All ids are `prefix + counter` (`nid`, counter starts at 5000): `t` task, `p` part, `pf` part form, `f` case form, `d` file, `m` material draw, `r` balloon row, `img` drawing, `col` balloon column, `ff` request field, `sec` request section, `qs`/`qi` QA section/item, `tpl` template, `c` checklist point.

### 3.1 Case (list record) — `state.cases[]`

| Field | Type | Notes |
|---|---|---|
| `id` | string | `JM-0430` format (`JM-` + 4 digits). No generator in this file. |
| `product` | enum | Cranial Plate, Subperiosteal Implant, Anatomical Model, Spinal Fusion Cage, Orthognathic Splint, Hip Implant, Mandible Implant, Shoulder Implant, Knee Cutting Guide |
| `surgeon` | string | Dr. R. Mehta, Dr. A. Iyer, Dr. S. Kapoor, Dr. N. Patel |
| `hospital` | string | Sunrise Dental Hospital, City Care Hospital, Lakeview Ortho Centre, Westside Multispecialty |
| `patient` | string | short form `R. Kulkarni` |
| `date` | ISO date | surgery date |
| `priority` | enum | Low, Medium, High, Critical |
| `status` | enum (pipeline) | Case Created, Scan Review, Segmentation, Design, Design Approval, Manufacturing, QA & Sterilization, Shipped, Completed |
| `state` | enum | Active, On hold, Cancelled, Archived |

**Full seed (15):**

| id | product | surgeon | hospital | patient | date | priority | status | state |
|---|---|---|---|---|---|---|---|---|
| JM-0430 | Cranial Plate | Dr. R. Mehta | Sunrise Dental Hospital | R. Kulkarni | 2026-10-09 | High | Manufacturing | Active |
| JM-0414 | Subperiosteal Implant | Dr. R. Mehta | Sunrise Dental Hospital | K. Shah | 2026-10-06 | Medium | Design Approval | Active |
| JM-0407 | Anatomical Model | Dr. A. Iyer | City Care Hospital | P. Nair | 2026-10-08 | Low | Segmentation | Active |
| JM-0412 | Spinal Fusion Cage | Dr. S. Kapoor | Lakeview Ortho Centre | F. Qureshi | 2026-10-11 | High | Design | Cancelled |
| JM-0413 | Anatomical Model | Dr. A. Iyer | City Care Hospital | L. Desai | 2026-10-19 | Critical | Scan Review | Active |
| JM-0405 | Orthognathic Splint | Dr. A. Iyer | City Care Hospital | T. Rao | 2026-09-17 | Low | Shipped | Active |
| JM-0403 | Hip Implant | Dr. N. Patel | Westside Multispecialty | S. Joshi | 2026-09-20 | High | QA & Sterilization | Active |
| JM-0401 | Cranial Plate | Dr. R. Mehta | Sunrise Dental Hospital | A. Verma | 2026-10-02 | Critical | Design Approval | Active |
| JM-0410 | Cranial Plate | Dr. A. Iyer | City Care Hospital | E. Pillai | 2026-09-27 | High | QA & Sterilization | On hold |
| JM-0402 | Mandible Implant | Dr. S. Kapoor | Lakeview Ortho Centre | M. Khan | 2026-09-29 | High | Segmentation | Active |
| JM-0404 | Shoulder Implant | Dr. R. Mehta | Westside Multispecialty | K. Bose | 2026-09-30 | Medium | Scan Review | On hold |
| JM-0406 | Anatomical Model | Dr. S. Kapoor | Lakeview Ortho Centre | B. Ahmed | 2026-10-03 | Medium | Design | Cancelled |
| JM-0409 | Knee Cutting Guide | Dr. S. Kapoor | Lakeview Ortho Centre | H. Menon | 2026-10-05 | Critical | Manufacturing | Active |
| JM-0398 | Cranial Plate | Dr. N. Patel | Westside Multispecialty | R. Gupta | 2026-08-28 | Medium | Completed | Archived |
| JM-0396 | Mandible Implant | Dr. R. Mehta | Sunrise Dental Hospital | D. Kulkarni | 2026-08-21 | Low | Completed | Archived |

### 3.2 Case detail — `state.details[caseId]` (1:1 with case)

| Field | Type | Seed rule |
|---|---|---|
| `scope` | string | by product: Cranial Plate → `Plate + Cutting Guide`; Mandible Implant → `Implant + Cutting Guide`; Subperiosteal/Spinal/Hip/Shoulder → `Implant only`; Anatomical Model → `Model only`; Orthognathic Splint → `Splint set`; Knee Cutting Guide → `Guide set`. Option list in (unrendered) edit form: Implant only, Implant + Cutting Guide, Plate + Cutting Guide, Guide set, Model only, Splint set |
| `salesReps` | string[] | `['Rohan Shah']` |
| `scanCenter` | string `"{name} — {email}"` | by hospital: `Vadodara Imaging Centre — scans@vic.example`, `CityScan Diagnostics — ops@cityscan.example`, `Lakeview Radiology — pacs@lakeview.example`, `Westside Imaging — imaging@westside.example` |
| `scanAccess` | bool | true |
| `consent` | bool | false (patient consent attested) |
| `showPatient` | bool | false (PHI unmasked — UI state stored on the record) |
| `first`, `last` | string | first name derived from the initial via a lookup (A→Anita, B→Bilal, D→Deepak, E→Esha, F→Farhan, H→Harsh, K→Kavya, L→Lata, M→Mohan, P→Pooja, R→Rahul, S→Sneha, T→Tanvi); last = rest of `patient` |
| `dob` | ISO date | synthetic: year `1950 + n%45`, month `n%12+1`, day `n%27+1` (n = case number) |
| `shipDate` | ISO date | surgery date − 5 days |
| `address` | string | `''` |
| `rxSigned` | bool | true when stage index ≥ 5 (prescription signed) |
| `shares` | `{email, perm:'Can view'}[]` | `[]` |
| `assignee` | string | `''` (case owner) |
| `stageMeta` | `{assignee, due, by, at}[9]` | per case stage: due = base+2(k+1) days (base = surgery date − 24 d); `by` = `Rohan Shah` for stage 0, `Priya Nair` for other completed stages; `at` stamp |
| `forms` | CaseForm[] | see 3.3 |
| `parts` | Part[] | see 3.6 |
| `files` | CaseFile[] | see 3.4 |
| `activity` | Activity[] | newest first |

Product code map (`CODE`): Cranial Plate `CRANIO`, Mandible Implant `MANDIB`, Subperiosteal Implant `SUBPER`, Anatomical Model `MODEL`, Spinal Fusion Cage `SPINE`, Orthognathic Splint `ORTHO`, Hip Implant `HIP`, Shoulder Implant `SHLD`, Knee Cutting Guide `KNEE`.

### 3.3 Case-level quality form — `details.forms[]`

`{id, name, code, ver, stageIdx, mandatory, status, records, assignee, updated}`; status enum `Not started` / `In progress` / `Pending approval` / `Approved`. Seeded from a fixed list for every case (status: stage < current → Approved (records 1, assignee Priya Nair, `updated: "{date} by Priya Nair"`), = current → In progress, else Not started):

| name | code | ver | stage | mandatory |
|---|---|---|---|---|
| Quotation Preparation | QMS-QUO-06 | v1 | 0 Case Created | yes |
| Scan Quality Review | QMS-SQR-05 | v1 | 1 Scan Review | yes |
| Design Verification | QMS-DV-04 | v5 | 4 Design Approval | yes |
| Sterilization Checklist | QMS-STE-02 | v2 | 6 QA & Sterilization | yes |
| Biocompatibility Statement | QMS-BIO-07 | v1 | 6 QA & Sterilization | no |
| Device History Record | QMS-DHR-01 | v3 | 8 Completed | no |

These are name/status only — no fillable body (they are not linked to QA templates).

### 3.4 Case file — `details.files[]`

`{id, name, type, by, date, shared}`; types `DICOM`, `STL`, `PDF` (upload maps `.dcm`/`.zip` → DICOM, else uppercase extension, else `FILE`). Seed by stage reached: ≥1 `CT / CBCT dataset` (DICOM, by scan centre); ≥3 `Segmented anatomy` (STL, Priya Nair); ≥4 `Design model` (STL, Divya Patel), `Design for approval` (STL, shared), `Surgical plan report` (PDF, shared). Type colours: DICOM `#1570EF`, STL `#0E9384`, PDF `#6941C6`. (Files tab is not rendered — see §8.)

### 3.5 Production workflow — `WF` (hard-coded here; conceptually owned by ProductionMaster)

Tuple `[name, sourcing, stages[], material, technology]`:

| key | Name | Sourcing | Stages | Material | Tech | Default printer | Lots (unit) |
|---|---|---|---|---|---|---|---|
| `dmls` | Titanium Implant — DMLS | In-house | Request received → Design prep & nesting → Build queued → Printing (DMLS) → Heat treatment & depowdering → Support removal & finishing → Inspection & QC → Cleaning & sterilization → Packaging & dispatch (9) | Ti-6Al-4V ELI | 3D Printing | EOS M 290 | TI64-2406-A, TI64-2407-B (kg) |
| `sla` | Surgical Guide / Jig — SLA Resin | In-house | Request received → Design prep → Build queued → Printing (SLA) → Washing & post-cure → Support removal → QC inspection → Packaging & dispatch (8) | BioMed Clear Resin | 3D Printing | Formlabs Form 3B+ | BMC-2408-01, BMC-2409-02 (L) |
| `fdm` | Model / Prototype — FDM | In-house | Request received → Slicing & build prep → Printing (FDM) → Support removal & cleanup → Visual QC → Packaging & dispatch (6) | PLA / PETG | 3D Printing | Ultimaker S5 | PLA-2409-03, PETG-2408-01 (spool) |
| `sls` | Model / Prototype — SLS (PA12) | In-house | Request received → Segmentation check → Build queued → Printing (SLS) → Depowdering & cleaning → Visual QC → Packaging & dispatch (7) | PA12 Nylon | 3D Printing | EOS Formiga P 110 | PA12-2407-11, PA12-2409-04 (kg) |
| `cnc` | PEEK Implant — CNC | Outsourced | Request received → CAM programming → Sent to vendor → Machining at vendor → Incoming inspection → Cleaning & sterilization → Packaging & dispatch (7) | PEEK-OPTIMA | CNC Machining | Haas VF-2 CNC | PEEK-2405-7, PEEK-2408-2 (kg) |

**Default tasks per part stage** (keyword match on stage name, `partTasksFor`):
- starts with `request` → `Confirm part request & attached files`
- contains `design prep` / `cam programming` / `segmentation check` → `Prepare build layout / nesting`, `Engineer sign-off on layout`
- starts with `printing` or contains `machining at` → `Load material & verify lot`, `Record build parameters`
- `heat treatment` → `Log heat-treat cycle`
- `support removal` / `washing` / `depowdering` → `Post-process & clean part`
- `inspection` / `qc` → `Dimensional inspection`, `Attach material certificate`
- `sterilization` → `Run sterilization / cleaning cycle`, `Record cycle parameters`
- `packaging` → `Issue Certificate of Conformity`, `Package & label for dispatch`
- `sent to vendor` → `Send build files & PO to vendor`
- otherwise none (e.g. `Build queued`, `Slicing & build prep`).
(Rules are evaluated in this order; first match wins — e.g. `Heat treatment & depowdering` gets the heat-treat task only.)

**Default tasks per case stage** (`STAGE_TASKS`): 0 `Confirm patient & product details`; 1 `Verify scan quality & protocol`; 2 `Segment anatomy`, `Export STL`; 3 `Design implant / guide`; 4 `Surgeon design sign-off`; 5 `Produce part`, `In-process check`; 6 `QA inspection`, `Sterilize & pack`; 7 `Ship to hospital`; 8 `Close & archive case`.

### 3.6 Part — `details[caseId].parts[]`

| Field | Type | Notes |
|---|---|---|
| `id` | string | internal |
| `caseId` | FK → Case | |
| `name` | string | |
| `pid` | string | human part ID, e.g. `JM-CRANIO-0430-03` |
| `wf` | enum | dmls / sla / fdm / sls / cnc |
| `qty` | number | default 1 |
| `due` | ISO date or `''` | |
| `stage` | int | index into workflow stages |
| `requestedBy`, `requestedOn` | string, `Mon DD` string | |
| `partType` | enum/'' | Implant, Surgical guide, Jig, Anatomical model, Instrument (+ `Prototype` appears in seed and ID codes only) |
| `sourcing` | enum | In-house / Outsourced |
| `vendor` | string | Precision AddCorp, BioForm Labs, MedMill CNC, RapidCast Inc (seed: `MedMill CNC` for cnc) |
| `assignee` | string | owner |
| `printer` | string | machine name |
| `notes` | string | seed `Implantable — full traceability required.` for implants |
| `draws` | `{id, qty, date, lot, machine, ps?}[]` | material consumption records; seeded with one record when the part is past its printing stage (qty sla 0.2 / sls 0.4 / fdm 0.3 / else 0.6; date today−3; first lot; default printer) |
| `stageMeta` | `{assignee, due, by, at}[]` | one per workflow stage |
| `forms` | PartForm[] | see 3.7 |
| `activity` | Activity[] | newest first |
| `details` | `{label, var, value}[]` | answers from the request form (non-core fields) — drives `{request.*}` variables |
| `inspection` | `{seq?, images[], points[], columns[], rows[]}` or null | balloon drawing data (3.8) |
| `printFiles` | string[] | file **names** only |
| `links` | string[] | URLs |

Material is not stored on the part — it is always the workflow's material (the requester's "Material preference" goes into `details`).

**Seeded parts per product** (generic cases): Cranial Plate → `Patient-specific cranial plate` (dmls) + `Cranial cutting guide` (sla); Mandible Implant → `Patient-specific mandible implant` (dmls) + `Mandible cutting guide` (sla); Subperiosteal Implant → `Subperiosteal implant framework` (dmls); Hip Implant → `Patient-specific acetabular component` (dmls); Shoulder Implant → `Patient-specific glenoid component` (dmls); Spinal Fusion Cage → `PEEK fusion cage` (cnc); Anatomical Model → `Anatomical model` (sls); Orthognathic Splint → `Occlusal splint set` (sla); Knee Cutting Guide → `Tibial cutting guide` + `Femoral cutting guide` (sla). Part ID `JM-{CODE}-{caseNo}-0{k+1}`; due = surgery date − 6 + k days; requested by `Rohan Shah`; part type: first part of implant products → `Implant`, sls → `Anatomical model`, else `Surgical guide`. Seed part stage from case stage index `cur`: `cur<3` → 0; `cur<5` → 1; `cur==5` → `floor(stageCount/2)`; else last stage. Total seeded parts = 23 (derived).

**Showcase case JM-0430** (hand-built, replaces the generic parts; all requested by Rohan Shah 12 days ago):

| pid | name | wf | stage | type | due | assignee |
|---|---|---|---|---|---|---|
| JM-CRANIO-0430-01 | Skull model — defect region | fdm | 5 Packaging & dispatch (last) | Anatomical model | today−5 | Pooja Desai |
| JM-CRANIO-0430-02 | Cranial plate prototype (fit check) | sls | 6 Packaging & dispatch (last) | Prototype | today−3 | Pooja Desai |
| JM-CRANIO-0430-03 | Patient-specific cranial plate — titanium | dmls | 6 Inspection & QC | Implant | today+4 | Neha Shah |

- Parts 01/02: all forms Approved, all tasks Done. Part 03: QAC + BMR approved with responses; Final Inspection in progress with 3 of 5 balloons measured (0.61, 2.01, 96.1).
- Each has `details` = Priority `High`, Material preference, Notes for production, Dimensions, Polishing requirement, and for each of the 10 QAC requirement categories a Feature / Specification / Testing-acceptance-method triple (vars `request.{category}Feature|Specification|TestMethod`), plus `request.productImage` (inline SVG data-URL).
- Inspection drawings (inline SVG data-URLs, 600×360): part 03 `cranial_plate_R2_drawing.png` with 5 balloons — `Plate thickness` 0.60 mm (0.55–0.65), `Screw hole diameter` Ø2.00 mm (1.95–2.05), `Overall length` 96.0 mm (95.7–96.3), `Overall width` 72.0 mm (71.7–72.3), `Hole pitch (holes 1–2)` 8.0 mm (7.9–8.1); part 02 `cranial_plate_R2_prototype.png` 3 balloons; part 01 `skull_defect_model_R1.png` 3 balloons.
- Print files: 01 `skull_defect_model_R1.stl`; 02 `cranial_plate_R2_prototype.stl`; 03 `cranial_plate_R2_final.stl`, `cranial_plate_R2_drawing.pdf`, link `https://files.3dsurgical.example/JM-0430/plate_R2_final.3mf`.
- Notes: 01 `Non-sterile planning model. Print defect region with 1 mm margin.`; 02 `Prototype only — not for implantation.`; 03 `Implantable — full traceability required. Parameter set PPS-DMLS-TI-01 rev B.`
- Form responses reference master-data labels such as `Ultimaker S5`, `EOS Formiga P 110`, `EOS M 290`, `PLA-2409-03 — PLA / PETG`, `PA12-2407-11 — PA12 Nylon`, `TI64-2407-B — Ti-6Al-4V ELI`, `Ravi Patel — Manufacturing operator`, `Neha Shah — QC inspector`, `Creaform HandySCAN`, `Mitutoyo digital caliper 150 mm`, `Zeiss Contura CMM`, `PETG / PLA — anatomical models · PPS-FDM-PETG-01 rev A`, `PA12 — SLS prototypes · PPS-SLS-PA12-01 rev A`, `Ti-6Al-4V ELI — implants 30 µm · PPS-DMLS-TI-01 rev B` — i.e. the option-label formats used by ProductionMaster libraries (`{lot} — {material}`, `{person} — {role}`, `{set name} · {code} rev {x}`).
- Also JM-0401's first part gets a 3-row balloon table without drawings and details `Priority: High`, `Laterality: Left`.

### 3.7 Part quality form — `part.forms[]`

`{id, templateId, response, name, code, clause, stageIdx, status, assignee}`.
- `status`: `Upcoming` / `In progress` / `Pending approval` / `Approved`.
- `response`: `null` or `{values: {[itemId]: string, [itemId+'__qty']: string}, measured: {[balloonRowId]: string}, snap: {[itemId]: {line, warn}}, by, at}`.
- Created when the part is created (or its workflow changes): for each workflow stage, every QA template whose `attach` keyword list has a keyword contained (case-insensitive) in the stage name yields one form at that stage. Name/code/clause are **copied** from the template at that moment. Seed status: stage < part stage → Approved; = → In progress; > → Upcoming; assignee `Priya Nair` for stages ≤ current.

### 3.8 Inspection (balloon) data

- `images[]`: `{id, img (data URL), name, w, h}`.
- `points[]`: `{n, imgId, x, y, bx, by}` — all in % of the image; `x,y` = arrow tip, `bx,by` = balloon centre (defaults `x+9`, `y−14`).
- `columns[]`: `{id, label}` — default `Characteristics`, `Specification`, `LSL`, `USL` (copied from the request-form field config at request time).
- `rows[]`: `{id, imgId ('' = manual), balloon (string id), vals: {[colId]: string}}`.
- `seq`: last balloon number.

### 3.9 Task — `state.tasks[]`

| Field | Type | Notes |
|---|---|---|
| `id` | string | |
| `name` | string | required |
| `type` | enum | `Manual` (user-created; listed on Tasks page) / `Default` (generated from case or part stages) |
| `caseId` | FK or `''` | `''` = general task |
| `partId` | FK or `''`/undefined | part-level task |
| `ref`, `refSub` | string | display reference (part ID) and sub-label (stage) |
| `stageIdx` | int | case-stage index (case tasks) or workflow-stage index (part default tasks); `-1` = any |
| `status` | enum | `Open` / `In progress` / `Done` |
| `assignee` | string | |
| `priority` | enum | Low / Medium / High / Critical (default Medium) |
| `due` | ISO date or `''` | |
| `reminders` | int[] | days before due (0 = on due date); default `[2]` |
| `tags` | string[] | free text |
| `checklist` | `{id, text, done}[]` | |
| `by`, `at` | string | completed by / stamp |

**Manual seed (9), in list order:**

| name | case | ref / refSub | stageIdx | assignee | priority | status | due | tags |
|---|---|---|---|---|---|---|---|---|
| Book CMM slot for titanium plate inspection | JM-0430 | JM-CRANIO-0430-03 / Inspection & QC | −1 | Neha Shah | High | In progress | today+1 | Quality |
| Surgeon sign-off on SLS prototype fit | JM-0430 | JM-CRANIO-0430-02 / Visual QC | −1 | Rohan Shah | High | Done | today−3 | Follow-up |
| Nest tibial guide for print run | JM-0409 | JM-KNEE-0409-01 / Design prep | 5 | Priya Nair | Critical | Open | today+2 | Production, Urgent |
| Verify segmentation against CT rev B | JM-0402 | — | 2 | Priya Nair | High | In progress | today+3 | Quality |
| Confirm Ti-6Al-4V lot traceability | JM-0401 | JM-CRANIO-0401-01 | −1 | Priya Nair | High | In progress | today+3 | Materials, Quality |
| Follow up with surgeon on design feedback | JM-0414 | — | 4 | Rohan Shah | High | Open | today+4 | Follow-up |
| DMLS build quality inspection | JM-0410 | JM-CRANIO-0410-01 / QA & inspection | 6 | Divya Patel | High | Open | today+5 | — |
| Order BioMed Clear resin restock | — | — | −1 | — | Medium | Open | today+7 | Materials |
| Quarterly printer calibration audit | — | — | −1 | Karan Mehta | Low | In progress | today+14 | Maintenance |

Default tasks: 12 per case (180) + per-part stage tasks; status Done (by Priya Nair) before the current stage, In progress at it, Open after.

### 3.10 Activity entry

`{title, time, detail, who}` — all display strings. `time` format `Mon DD · HH:MM` (no year). `who` = `{name} · {role}`.

### 3.11 People

`STAFF = ['Priya Nair', 'Rohan Shah', 'Divya Patel', 'Karan Mehta', 'Anil Joshi']`; every people dropdown = `[me] + STAFF without me`. Other names that appear only in seed data: Neha Shah, Ravi Patel, Pooja Desai.

### 3.12 Part-ID rule — `state.idRule`

`{prefix: 'JM', sep: '-', tokens: ['PRODUCT','CASE_SEQ','PART_SEQ']}`.

### 3.13 Part-request form definition — `state.formSections[]`

Section: `{id, title, cols (1|2|3), fields[]}`. Field: `{id, key (built-in key or ''), var (custom variable name), def (default value), label, type, show, req, locked, options[], fileTypes[], columns[] (balloon), allowLinks (file; default true)}`.
Types: `text, textarea, number, date, select, checkbox, file, image, balloon` + built-in special selects `case, workflow, parttype, priority, material, printer, sourcing, vendor`.

**Default sections (16):**

| Section | cols | Fields (key · label · type · show · req · locked) |
|---|---|---|
| Part Identification | 2 | `case` Case (case, ✓, req, locked); `name` Part name (text, ✓, req, locked); `type` Part type (parttype, ✓); `qty` Quantity (number, ✓, req, locked) |
| Production | 2 | `workflow` Production workflow (workflow, ✓, req, locked); `material` Material preference (material, ✓); `printer` Printer / resource (printer, **hidden**); `sourcing` Sourcing (sourcing, ✓, req); `vendor` Outsource vendor (vendor, ✓) |
| Scheduling | 2 | `due` Required by (due date) (date, ✓, req); `priority` Priority (priority, ✓); `notes` Notes for production (textarea, ✓) |
| QAC — Product details | 2 | custom: Product image (image, var `productImage`); Dimensions (textarea, `dimensions`); Polishing requirement (textarea, `polishingRequirement`) |
| Dimensional Requirements | 3 | Feature (`dimensionalFeature`, default `Size and shape`); Specification (`dimensionalSpecification`); Testing / acceptance method (`dimensionalTestMethod`) |
| Material Requirements | 3 | same triple, prefix `material`, Feature default `Material` |
| Workmanship Requirements | 3 | prefix `workmanship`, default `Smoothness` |
| Process Capability Requirements | 3 | prefix `processCapability`, default `Process & layer thickness` |
| Aesthetic Requirements | 3 | prefix `aesthetic`, default `Finish` |
| Performance Requirements | 3 | prefix `performance`, default `Strength` |
| Documentation Requirements | 3 | prefix `documentation`, default `Material datasheet` |
| Packaging & Labelling Requirements | 3 | prefix `packagingLabelling`, default `Standard packaging` |
| Lab Test Requirements | 3 | prefix `labTest`, default `No` |
| Other Requirements | 3 | prefix `other`, default `No` |
| Files | 1 | `files` Files for printing (file; types STL, 3MF, STEP, PDF) |
| Inspection Drawing | 1 | `balloon` Drawing with balloon characteristics (balloon; 4 default columns) |

Field → variable mapping (`fieldVar`): built-ins `sourcing→part.sourcing, vendor→part.vendor, case→case.id, name→part.name, type→part.type, qty→part.qty, workflow→part.workflow, material→part.material, printer→part.printer, due→part.due, notes→part.notes, balloon→balloon.count`; files → none; everything else → `request.{var || key || camelCaseSlug(label)}` (so `priority` → `request.priority`).

### 3.14 QA form template — `state.qaTemplates[]`

Template: `{id, name, code, clause, issue?, effective?, rev?, doc? (controlled-document layout), attach: string[] (stage-name keywords), sections[]}`.
Section: `{id, title, cols (1–4, default 1), items[]}`.
Item: `{id, type, label, value (pre-fill / variable expression), req (default true except info), lsl, usl, src? (dropdown source), opts? (custom choices CSV), qty? (record quantity), noMeasure? (balloon table without measured columns)}`.

**Seed templates (6):**

1. **Quality Plan & Acceptance Criteria (QAC)** — `tpl-qac`, code `JM-F-DND-004`, clause `ISO 13485:2016 & India MDR 2017`, issue `02`, effective `06-03-2023`, rev `02`, attach `Request received`.
   - `Product details` (2 col): info Case ID `{case.id}`; Product name `{part.name} (Component: {part.component})`; Category `{part.type}`; STL file / link `{part.files}`; image Product image `{request.productImage}` (optional); Dimensions `{request.dimensions}`; Polishing requirement `{request.polishingRequirement}`.
   - Ten 3-col sections — `Dimensional / Material / Workmanship / Process Capability / Aesthetic / Performance / Documentation / Packaging & Labelling / Lab Test / Other Requirements` — each with info Feature / Specification / Testing / acceptance method bound to `{request.<prefix>Feature|Specification|TestMethod}`.
   - `Drawing & balloon characteristics`: info No. of balloon characteristics `{balloon.count}`; table Balloon characteristics `{balloon.table}` (optional, no measured columns).
   - `Sign-off` (2 col): sign Prepared by `{user.name}`; sign Approved by.
2. **Batch Manufacturing Record (BMR)** — `tpl-bmr`, `QMS-BMR-01`, `ISO 13485 §7.5.1`, attach `Printing (DMLS)`, `Machining at`.
   - `Part & build identification`: info Part ID `{part.id}`; Part name; Part type; Case `{case.id} · {case.product}`; Workflow; Machine `{part.printer}`; Material & lot `{part.material} · lot {material.lot}`; Quantity.
   - `Build parameters`: info QAC process requirement `{request.processCapabilitySpecification}`; text Build job number `{part.id}-B1`; select Printer used (src printers, pre-select `{part.printer}`); select Process parameter set (params); select Powder lot (lots, with quantity); select Build operator (operators); number Layer thickness (µm) 20–60; number Chamber O₂ (%) 0–0.13; check Powder lot verified against CoA; check Build plate inspected and cleaned.
   - `Sign-off`: sign Operator `{user.name}`.
3. **Polymer Build Record** — `tpl-pbr`, `QMS-PBR-02`, `ISO 13485 §7.5.1`, attach `Printing (FDM)`, `Printing (SLS)`, `Printing (SLA)`. Identification (Part ID, Part name, Machine, Material & lot, Quantity); Build parameters (QAC process requirement; Build job number; Printer used; Process parameter set; Material lot (lots, qty); Operator; Layer thickness (µm) 50–300; checks Material lot verified, Build completed without errors); Sign-off Operator.
4. **Final Inspection** — `tpl-fi`, `QMS-FI-03`, `ISO 13485 §8.2.6`, attach `Inspection`, `QC`. `Identification` (Part ID; Part name / type; Patient; Surgeon / hospital; Priority `{request.priority}`; Balloon characteristics `{balloon.count}`); `Acceptance criteria (from QAC)` (info Dimensional, Material, Workmanship, Aesthetic, Performance from request vars; check Part meets all QAC acceptance criteria); `Dimensional inspection (from drawing balloons)` (select Measuring equipment used (measuring); select Inspector (operators); table Balloon inspection `{balloon.table}` with measured values); `Visual inspection` (checks No visible defects, burrs or residue; Surface finish acceptable; text Remarks optional); `Sign-off` Inspector.
5. **Sterilization Checklist** — `tpl-ste`, `QMS-STE-02`, `ISO 13485 §7.5.7`, attach `Sterilization`. `Identification`; `Cycle record` (select Sterilization cycle (steril); select Packaging (packaging, qty); text Cycle ID; number Temperature (°C) 132–137; number Exposure time (min) 4–10; check Chemical / biological indicator passed); Sign-off Operator.
6. **Device History Record** — `tpl-dhr`, `QMS-DHR-01`, `ISO 13485 §4.2.5`, attach `Packaging`, `dispatch`. `Device identification` (Part ID / UDI; Part name / type; Case / patient; Workflow; Material drawn `{material.drawn} (lot {material.lot})`; Characteristics inspected); `Release checks` (All stage quality forms approved; Label verified against part ID {part.id}; IFU and packaging complete); `Release` sign QA release.

### 3.15 Variable catalogue (tokens usable in QA item values / limits / labels)

- **Part request setup** group: one per request field (built-in tokens above or `request.<var>`), plus `balloon.table`.
- **Case**: `case.id, case.product, case.scope, case.status, case.priority, case.surgeon, case.salesRep, case.hospital, case.scanCenter, case.patient, case.patientFirst, case.patientLast, case.dob, case.age, case.surgeryDate, case.shipDate, case.address` (also resolvable: `case.state`).
- **Part & production**: `part.id, part.component` (numeric part sequence), `part.files, part.stage, part.material, part.printer, part.sourcing, part.vendor, part.due, part.notes, material.lot, material.drawn, balloon.count` (plus `part.name, part.type, part.qty, part.workflow` via the request group).
- **Equipment, material & people** (from `valCheck.details`): `printer.assetId, printer.serial, printer.status, printer.qualStatus, printer.nextMaintenance, material.grade, material.stock, material.qualStatus, lot.number, lot.coa, lot.supplier, lot.received, lot.expiry, lot.grn, params.name, params.code, params.keyParams, params.validationRef, params.status, owner.name, owner.role, owner.qualStatus`.
- **General**: `user.name`, `today` (ISO), `space.name` (constant `Jajal Medical`).

---

## 4. Workflows & state machines

### 4.1 Case status pipeline

`Case Created → Scan Review → Segmentation → Design → Design Approval* → Manufacturing → QA & Sterilization* → Shipped → Completed` (* flagged `APPROVAL` in the UI).

`moveCase(case, ±1)` exists in the script (owner-gated by `details.assignee === me`; cannot go below `Scan Review`; reaching `Completed` sets `state = Archived`; forward: default tasks of the stage left → Done, tasks of the stage entered → In progress, case forms at the stage left → Approved (`records+1`), forms at the new stage `Not started → In progress`, stageMeta by/at stamped; back: reverses tasks/stageMeta; log `Advanced status` / `Moved status back`; toast `Moved to {stage}` / `Moved back to {stage}`). **But no control in the template calls it** — in the prototype a case's status never changes. Same for the case state machine (`Active ⇄ On hold`, `Active ⇄ Cancelled`, `→ Archived` via a kebab menu with labels `Put on hold`/`Resume case`, `Cancel case`/`Reopen case`, archive) — logic present, UI absent. See §8.

### 4.2 Part request

1. Open modal (Parts list `+ Request a part`; case Manufacturing tab (case locked); dashboard `newpart`).
2. `Request part` validates every shown + required field: value missing / blank / `false` / empty file-or-balloon object → error `Please fill in: {label, label, …}`. Default required: Case, Part name, Quantity, Production workflow, Sourcing, Required by (due date).
3. Creates the part at stage 0 with: generated part ID (rule in §2.7), qty, due, part type, sourcing (vendor only kept if Outsourced), notes, printer (if the field is shown, else workflow default), `details` (every other shown non-empty field as `{label, var, value}`; checkbox → `Yes`), `printFiles`/`links` from all file fields, `inspection` from the balloon field (columns copied from field config).
4. Generates part forms and default tasks from the workflow; appends to the case; logs `Requested a part` / `{pid} · {name} via {workflow}` on the case and `Part requested` on the part; toast `Part {pid} requested`.

### 4.3 Part stage machine

- States = the workflow's ordered stage list; `stage` index.
- **Who**: only the part's assignee (`Assign to me` / `Unassign` / edit-mode assignee select / dashboard `assign`). `Assign to me` logs `Assigned part` / `Part assigned to {me}`; unassign logs `Unassigned part` / `Part owner cleared`.
- **Forward gate**: every form at the current stage must be `Approved`; otherwise toast `Approve "{form name}" before advancing` and nothing changes.
- **Forward effects**: `stage+1`; `stageMeta[cur] = {by: me, at: now}`; forms at the new stage `Upcoming → In progress`; Default tasks at the stage left → `Done` (by me, now); Default tasks at the new stage → `In progress`; part activity `Advanced stage` / `{from} → {to}`; case activity `Updated part stage` / `{pid} · {from} → {to}`; toast `{pid} → {to}`.
- **Back** (no gate other than ownership): `stage−1`; clears `stageMeta[new].by/at`; Default tasks at the stage left → `Open`, at the stage entered → `In progress`; part activity `Moved stage back`. Form statuses are not reverted.
- Bounds: cannot go below 0 or past the last stage (`Next` shows `Completed`, disabled).
- Workflow change (edit mode) → reset to stage 0 with rebuilt forms/tasks (form responses are lost).

### 4.4 Part quality form lifecycle

```
Upcoming ──(part reaches stage)──▶ In progress
Upcoming / In progress ──Save draft──▶ In progress (Pending approval stays Pending approval)
any non-Approved ──Submit for approval──▶ Pending approval
any non-Approved ──Approve──▶ Approved (locked, read-only)
```
- Forms can be opened and filled at any stage (even `Upcoming`).
- **Save draft**: no validation; stores response + `by/at`; log `Saved quality form draft`; toast `Draft saved`.
- **Submit for approval**: blocked by missing required items (toast `Fill all required items before submitting`) or "not fit for use" items (toast `{first block message} — pick another item or fix it first`); log `Submitted quality form for approval`; toast `Submitted for approval`.
- **Approve**: blocked by missing (`Fill all required items before approving`), blocked items (`{msg} — cannot approve`), or any out-of-spec result (`{n} item(s) out of specification — raise an NCR / rework before approving`); log `Approved quality form`; toast `Form approved`.
- Log detail: `{form name} ({code})` + ` · {n} out of spec` when there are failures.
- Storing sets `assignee = existing || me`, and saves a **snapshot** (`snap`) of each picked library item's info line + warning, shown later as `Recorded when the form was submitted`.
- No reject / send-back / re-open action; no separation between submitter and approver; no e-signature challenge (signature = typed name in a script font + today's date).
- Closing the modal (or switching inline form) discards unsaved edits.

Validation counters (`qaFormView`):
- `missing`: required items of type text/number/check/sign/select with blank value; each balloon row without a measured value when the table is required and measuring is on; a required quantity-tracking dropdown with an item picked but no quantity.
- `fails`: measurements and balloon rows whose result is `Fail`, and checks set to `Fail`.
- `blocked`: a picked library item carrying a master-data warning (message `{label}: {warning}`), or quantity > available (`{label}: only {n} {unit} available`).

### 4.5 Task lifecycle

`Open ⇄ In progress ⇄ Done`, one step at a time (modal stepper or board arrows).
- Save: title required (`Enter a task title.`). Status `Done` stamps `by = me`, `at = now` (if not already); any other status clears them. Scope `General` clears case and stage. `partId` is kept only if the case was not changed.
- Logging: case activity `Added task` (`{name} · assigned to {assignee}`) / `Updated task` (`{name} · {status}`) / `Deleted task`; part activity `Added task` / `Updated task` for part tasks. Board `›` logs `Updated task` / `{name} → {status}` on the case; board `‹` does not log.
- Default tasks are additionally driven by part stage moves (§4.3) (and by case stage moves in the unused `moveCase`).
- Reminders are stored only; nothing sends them.

### 4.6 QA template lifecycle

No draft/published/versioning state: edits mutate the template immediately (the `Save form` button only navigates back). Templates attach to parts **at part creation / workflow change** only; editing `attach` does not retro-fit existing parts. Existing part forms render with the *current* template content (by `templateId`), so template edits change how already-saved (even Approved) records display; deleting a template makes its part forms un-openable (toast `This form’s template was deleted in QA Form Setup`) and hides them from the Current stage tab, while they still count for the stage gate.

---

## 5. Computed values & business rules

- **Dates**: `today` = local midnight at load. Stored dates are ISO `YYYY-MM-DD` strings; `fmtDate` → `Mon DD, YYYY`; `shortD`/`short` → `Mon DD`; activity stamps `Mon DD · HH:MM`. Due/overdue comparisons are ISO string comparisons.
- **Age**: full years from DOB to now.
- **PHI masking**: see §2.3.
- **Case tiles / part tiles / task tiles**: rules in §2.2, §2.4, §2.10.
- **Case row edge**: Cancelled `#F04438` (+ opacity 0.6), On hold `#F79009`.
- **Part progress %** = `round(stage / max(1, lastIndex) × 100)`; label `Stage {stage+1} of {count} · {name}`.
- **Part due label**: `{ISO} · in {n}d` / `{ISO} · overdue {n}d`; colour red if overdue, amber if ≤ 3 days, else default.
- **Task overdue**: not Done and `due < today` → due text red. **Due soon**: not Done and due within today..today+3.
- **Checklist badge**: `☑ {done}/{total}`.
- **Part stage pill colour**: first stage indigo, last stage green, otherwise orange.
- **Sort "Stage progress"**: `stage / lastIndex`.
- **Pass/Fail judge**: parse numbers (comma accepted as decimal point); result blank if no value or both limits blank; `Pass` if `value ≥ LSL` (when set) and `value ≤ USL` (when set), else `Fail`. LSL/USL of a Measurement item may themselves contain variables. For balloon tables the limits come from the request columns whose label is exactly `LSL` / `USL` (case-insensitive).
- **Variable resolution** (`qaResolve`): replaces `{group.key}` / `{today}` tokens from the context; unknown dotted tokens and blank values → `—`; undotted unknown tokens are left as typed. Stored operator input overrides the pre-fill; checks never pre-fill.
- **`material.lot`**: lot picked in the latest saved QA dropdown with source `lots` (text before ` — `), else the last material draw's lot. **`material.drawn`**: sum of draw quantities (2 dp) + unit. **`part.component`**: trailing number of the part ID. **`balloon.count`**: inspection row count. **`balloon.table`**: `{n} balloon characteristic(s) on {m} drawing(s)`. **`owner.qualStatus`**: `Not in operator list` when the assignee is not a known operator.
- **Traceability records** (`usesOf`): for every saved form response, each Dropdown item with a library source and a non-blank value (stored value, or resolved pre-fill) → `{src, value, qty, field, form, code, status, by, at, stage}`. Shown on the part and exported through `onPartsSync` (so ProductionMaster can show "Usage records" per item and deduct stock **(inferred)**).
- **Quantity available** = master `availN` + the quantity already saved in this same form for the same item (so re-editing does not double count), rounded to 3 dp.
- **Dropdown option ordering**: usable first; for lots, other-material lots next; items with warnings last and disabled (unless already selected).
- **Request-field variable slug**: camelCase of alphanumeric words; `field` if empty; de-duplicated with 2, 3, ….
- **Balloon placement**: click adds balloon `seq+1` at the click point (arrow tip), balloon offset `+9%, −14%` (flipped to `−9%` if `x+9 > 95`, to `+14%` if `y−14 < 5`), and appends a table row with that number. Dragging either handle clamps to 0–100 %; arrow keys nudge 1 % (Shift = 5 %); a click within 350 ms after a drag is ignored. Removing a drawing removes its balloons and rows; removing a row removes the matching balloon. Leader-line geometry: arrowhead length 2.2 % and stroke 0.35 % of the larger image dimension.
- **QA list metrics**: measurements = `number` + `table` items; variables = distinct tokens in values and labels; used-on-parts = parts holding a form of that template.
- **Counts text**: `{n} field` / `fields`, `{n} form` / `forms`, etc. pluralised as quoted.

---

## 6. Backend / integration implications

- **Persistence for everything**: cases, case details, parts, part forms + responses (+ snapshots), tasks, activity logs, ID rule, request-form definition, QA templates. Setup screens need real save semantics (the prototype's Save buttons are toasts).
- **Part ID generation** server-side from the configurable rule (prefix / separator / ordered tokens), with a per-case sequence.
- **File storage**: print files (STL, 3MF, STEP, OBJ, DICOM, PDF, images, ZIP — prototype keeps names only), product image (client-side downscale to ≤ 900 px PNG), inspection drawing images (kept at original size as data-URLs), case files (DICOM / STL / PDF; "share with surgeon" flag). External download links (Drive / OneDrive / WeTransfer) as URLs.
- **3D viewer**: `Open 3D Viewer` and "view STL" are stubs.
- **PDF export**: QA form record (`Exporting {code} record as PDF`), part activity log, (case audit trail, case quality records in unrendered code). The controlled-document layout (logo header, document no., issue, rev, effective date) is clearly meant for printable ISO 13485 records.
- **Audit trail**: every mutation appends `{title, time, detail, who}` to the case and/or part; PHI unmasking is audited. A real system needs immutable, timestamped (with year/timezone), user-id-based audit rows.
- **E-signature**: signature items are typed names; no authentication step. Approval has no role check.
- **Notifications / reminders**: task reminders (days before due) are data only. `Requested scan data` / sharing by email exist only in unrendered code.
- **Master data from Manufacturing setup (ProductionMaster)** via `valCheck`: dropdown libraries (printers, post-processing, measuring equipment, tooling, sterilization cycles, materials, lots, standard components, packaging, vendors, operators, parameter sets, software, technologies, part types), per-item detail rows, fitness warnings (e.g. qualification/calibration/expiry — **inferred** from "not fit for use"), stock availability + units, machine↔material parameter sets, lot suppliers. Cases pushes back part snapshots + usage/traceability records via `onPartsSync`.
- **Stock deduction**: "Also record quantity used — deducted from stock" implies inventory transactions when a form is saved **(inferred; the deduction itself happens outside this file)**.
- **Goods receipt (GRN) integration**: the `advance|GRN|…` focus command advances outsourced parts when a supplier receipt is accepted elsewhere.
- **Clipboard**: copy-token buttons use `navigator.clipboard`.
- No import, no CSV/Excel export, no printing in this file.

---

## 7. Visual design tokens

**Fonts**: `IBM Plex Sans` 400/500/600/700 (UI), `IBM Plex Mono` 400/500/600 (IDs, numbers, dates, tokens, measurements), `'Brush Script MT', cursive` 18 px (signature inputs). Base text 13–13.5 px; table header 10.5–11 px uppercase, weight 600–700, letter-spacing 0.4–0.8 px; section eyebrow 11 px/700 orange uppercase; card heading `h3` 15/700; page-level `h2` 18–19/700 (letter-spacing −0.3); modal title 16/700; tile numbers mono 18–19/600.

**Colours**

| Role | Hex |
|---|---|
| Text primary / secondary / tertiary / muted | `#101828` / `#344054`, `#475467` / `#667085` / `#98A2B3` |
| Surfaces | `#FFFFFF`, subtle `#F9FAFB`, `#FCFCFD`, segmented/neutral chip `#F2F4F7` |
| Borders | card `#E4E7EC`, divider `#EAECF0`, row divider `#F2F4F7`, input `#D0D5DD` |
| Brand primary (buttons, active tab, accents) | `#E24E1B`; text/link variant `#C4320A`; tints `#FFF1EB`, `#FFF6F2`; selected border `#F97066`; on-dark accent `#FF8A5C`; misc `#FBD5C5`, `#F4C7B7`, `#FDA283` (locked switch), `#F9DBAF`, current-row bg `#FFFCF5`, `#FFF6ED` |
| Dark | button/toast `#101828`; dark header `#0C1524`; muted-on-dark `#8391A5`; overlay `rgba(12,21,36,.55)` |
| Success | `#067647` on `#ECFDF3`, border `#75E0A7` |
| Error / destructive | `#B42318` on `#FEF3F2` / `#FEE4E2`; `#D92D20`; borders `#FDA29B`, `#FECDCA`; edge `#F04438` |
| Warning | `#B54708` on `#FFFAEB`; borders `#FEDF89`, `#FDB022`; edge `#F79009` |
| Info blue | `#175CD3` on `#EFF8FF`; link `#155EEF` on `#F5F8FF` border `#D1E0FF`; `#1570EF` |
| Indigo | `#3538CD` on `#EEF4FF` |
| Purple | `#5925DC` on `#F4F3FF`; `#6941C6` (submit button, "mine" tile); `#7A5AF8` |
| Teal | `#107569` on `#F0FDF9` border `#5FE9D0`; `#0E9384` |
| Pink | `#C11574` on `#FDF2FA` |

**Badges**
- Priority (bg / text): Low `#EFF8FF/#175CD3`, Medium `#FFFAEB/#B54708`, High `#FFF1EB/#C4320A`, Critical `#FEE4E2/#B42318`. Shape: padding 2×8, radius 6, 11.5/700.
- Case status: Case Created `#F2F4F7/#344054`; Scan Review `#EFF8FF/#175CD3`; Segmentation `#FFF6ED/#C4320A`; Design `#F4F3FF/#5925DC`; Design Approval `#FFFAEB/#B54708`; Manufacturing `#FEF3F2/#B42318`; QA & Sterilization `#EFF8FF/#175CD3`; Shipped `#ECFDF3/#067647`; Completed `#F2F4F7/#344054`.
- Task status: Open `#FFF6ED/#C4320A`; In progress `#EFF8FF/#175CD3`; Done `#ECFDF3/#067647`.
- Form status: Not started / Upcoming `#F2F4F7/#475467`; In progress `#FFFAEB/#B54708`; Pending approval `#F4F3FF/#5925DC`; Approved `#ECFDF3/#067647`.
- Task type: Manual `#F2F4F7/#475467`; Default `#EEF4FF/#3538CD`. Tags `#EEF4FF/#3538CD`.
- Pills (radius 999) for part stage, sales reps, file chips, filter chips; rectangular chips (radius 4–6) for `APPROVAL`, `LOCKED`, `CUSTOM`, sourcing.

**Product identity** (dot colour / tile gradient / 24-px line icon): Subperiosteal Implant `#0E7490` `#22D3EE→#0E7490`; Anatomical Model `#DC2626` `#F87171→#DC2626`; Spinal Fusion Cage `#667085` `#98A2B3→#667085`; Orthognathic Splint `#7C3AED` `#A78BFA→#7C3AED`; Hip Implant `#0284C7` `#38BDF8→#0284C7`; Cranial Plate `#0F766E` `#2DD4BF→#0F766E`; Mandible Implant `#4F46E5` `#818CF8→#4F46E5`; Shoulder Implant `#D97706` `#FBBF24→#D97706`; Knee Cutting Guide `#475467` `#667085→#344054`. Gradients are `linear-gradient(135deg, …)`.

**Radii**: cards 14; tiles / popovers / toast / inner cards 12; sub-cards 10; buttons & inputs 9 (toolbar) or 8 (forms); small buttons 7; badges 6; tiny chips 4–5; pills 999; circles = half size.

**Spacing**: page gap 16; card padding 16–22 (20×22 typical); table row padding 11–13 × 18–22; grid gaps 12–16; tile grid gap 14 (cases/parts) / 12 (tasks); form field gap 5–6 (label→control), 12–18 between fields.

**Shadows**: popover `0 12px 34px rgba(16,24,40,.16)`; modal `0 24px 48px rgba(16,24,40,.25)`; toast `0 12px 30px rgba(16,24,40,.3)`; segmented active `0 1px 2px rgba(16,24,40,.08)`; balloon `0 1px 4px rgba(0,0,0,.35)`; switch knob `0 1px 2px rgba(0,0,0,.2)`.

**Component dimensions**: toolbar controls 38 high; modal inputs 40; form inputs 36; small buttons 28–34; primary buttons 38–40; tabs 48 high with 2 px underline; stat tile icon 34 (tasks 32); list product tile 34, grid 48, detail header 56; timeline circles 26, part stepper dots 20–22; switches 38×22 (setup) / 36×20 (QA); checkboxes 16 with `accent-color #E24E1B`; part-detail sidebar 290; modals 600 (task) / 780 (request) / 860 (form fill), top-aligned with 32–40 px page padding, z-index 50/55, toast 60; popovers 200–290 wide, offset 46 px below the trigger.

**Icons**: inline SVG, 24-unit viewBox, stroke `currentColor`, stroke-width 1.8–2, round caps/joins (Feather/Lucide style): grid, list, funnel, search, plus, clock, check-circle, archive, cube, info, factory, clipboard-check, bolt, user, alert-triangle, upload, link, arrow-left, chevron. Text glyphs are also used as icons: `☰`, `×`, `‹ ›`, `↑ ↓`, `← →`, `⧉`, `↓`, `⤓`, `🔗`, `↗`, `✓`, `●`, `⚠`, `☑`, `▲ ▼`.

---

## 8. Stubbed, inconsistent or unfinished

**Logic present in the script but with no UI in the template (dead code)**
- Case detail has only 3 tabs. The script still computes **Forms**, **Tasks**, **Files** (internal/shared toggle, upload, share with surgeon, 3D view, download, delete) and **Activity** tabs, plus case **edit mode** (scope / surgeon / hospital / scan centre / patient / dates / address), sales-rep add/remove, scan-centre request & access toggle, consent toggle, prescription sign / preview / download, share-by-email, case owner assign/unassign, **case stage Back/Next**, and the hold / cancel / archive menu. None is reachable. Consequently: case status and state cannot change, consent cannot be attested, and a case's activity log is never visible. Leftover `<label for="ed-…">` attributes point at inputs that no longer exist.
- **No case creation** anywhere in this file (log text says cases are "created from the {product} template").
- Material consumption ("draw") form with validated-parameter-set checks (`valCheck.mode` off / warn / `block`, messages such as `Validation check failed — recording is blocked`, `Select the validated parameter set used for this build.`) is fully coded but not rendered; seeded `draws` only feed `{material.lot}` / `{material.drawn}`.
- Older quick "part form" (`partForm`, `savePart`), per-part inline `back/next/remove` on the case Manufacturing tab, `rqCaseOpts`/`onRq*` handlers, `partFormFor()`, template-selector `templates`/`onSel`, per-item inline variable picker (`toggleVar`, `varKey`), per-form `statusOpts/onStatus`, `isCasesPage`/`isPartsPage` — unused.
- `criteria` QA item type is rendered by the form view but cannot be created and is unused by seeds.

**Stubs (toast only)**: Open 3D Viewer; all PDF exports; file downloads / link opening in Part info view mode; `Save setup`; `Save form` (no real save — edits are live, no cancel/discard).

**Inconsistencies**
- People: dropdowns offer `me` + 5 staff, but seed data uses Neha Shah, Ravi Patel, Pooja Desai (not selectable).
- Printers: request/edit dropdown lists `EOS M 290, Formlabs Form 3B+, HP Jet Fusion 5200, Haas VF-2 CNC`, while workflow defaults also use `EOS Formiga P 110` and `Ultimaker S5`; `HP Jet Fusion 5200` is used nowhere else.
- Part type `Prototype` exists in seed data and in the ID code map but not in the dropdown options.
- `Outsource vendor` is always shown in the request modal regardless of Sourcing (only the saved value is cleared for In-house); the vendor list has `None — in-house` in the request form but `— choose vendor —` in edit mode.
- Part IDs: seed uses a hard-coded `JM-{CODE}-{case}-0{n}` format; new requests use the configurable rule; changing the rule does not rename existing parts. Sequence = current part count + 1, so deleting a part could produce duplicates.
- Seed activity text for part 03 says lot `TI64-2406-A` while the BMR response recorded `TI64-2407-B`.
- `● Required to advance` is shown on every non-approved form, though only current-stage forms gate the move; case-level forms have a `mandatory` flag that is never enforced.
- Status-tab `APPROVAL` tags (Design Approval, QA & Sterilization) are decorative — no approval logic.
- Tasks page counts/filters only `Manual` tasks; Default tasks are visible only inside part/case views.
- Task `stageIdx` means a case stage for case tasks but a workflow stage for part tasks; the modal's `Associated status` select always lists case stages.
- QA form `attach` matching is substring-based (`QC` matches three different stage names; `Design prep` would also match `Design prep & nesting`), applied only when a part is created.
- Part forms copy name/code/clause at creation but read sections live from the template → no template versioning; approved records can change retroactively.
- Activity timestamps have no year; "who" role is always `Administrator` for live actions.
- `showPatient` (PHI unmasked) is stored on the case record rather than per user/session.
- Dates in QA template metadata (`effective`) are free text (`06-03-2023`), unlike ISO dates elsewhere.
- Company naming: part IDs/prefix `JM`, `space.name` = `Jajal Medical`, doc header brand `jajal MEDICAL`, while the product is "3D Surgical" and the seed link host is `files.3dsurgical.example`.
- No click-outside / Escape handling for popovers and modals; no confirmation for any delete (task, QA form, section, field); grid view has no empty state; template `hint-placeholder-count` values are out of date in places (e.g. 5 part tabs vs 6, 5 doc rows vs 4).
- Responsive behaviour: fixed multi-column grids only (designed for ~1184 px content width); no mobile layout.
