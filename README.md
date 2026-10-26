# 3D Surgical — Manufacturing Management

Manufacturing management for patient-specific devices: cases come in from the
3D Surgical Platform, and everything that happens to them on the shop floor —
parts, stages, quality forms, equipment, materials, goods receipt — is managed
here.

It is being built in phases from an interactive design. **Phases 1–5 are
built, except tasks**: sign-in, company spaces, the platform connection and
cases; the manufacturing setup — workflows, machines, materials, suppliers and
the equipment registries; part requests and parts; quality forms; and goods
receipt. Every screen works on a phone, a tablet and a desktop. See
[docs/build-plan.md](docs/build-plan.md) for what comes next, and
[docs/spec/](docs/spec/) for the design written out as a specification.

---

## Getting started

Requirements: Node 22+. Nothing else — no Docker, and no PostgreSQL install.

**Setting up on a new laptop?** Follow [SETUP.md](SETUP.md) — it walks through
every step from a fresh clone, including moving data across from another
machine.

```bash
# 0. Dependencies and the database client
npm install
npx prisma generate

# 1. Environment — generate real secrets, do not reuse another project's
cp .env.example .env
#    then fill in ENCRYPTION_KEY, SESSION_SECRET, CRON_SECRET and the
#    SUPER_ADMIN_* values; the file says how to generate each.

# 2. Database — leave this running in its own terminal
npm run db:start

# 3. Schema and the first super admin (first time only, in a second terminal)
npm run db:deploy
npm run db:seed

# 4. Run
npm run dev
```

Day to day that is two terminals: `npm run db:start` and `npm run dev`.

### The development database

`npm run db:start` runs a real PostgreSQL server from the `embedded-postgres`
package, which carries the PostgreSQL binaries with it. It needs no Docker, no
virtualization and no administrator rights. Data is kept in `.pgdata/` in the
project folder and survives restarts; delete that folder to start from empty.
It listens on localhost port 5433 only.

This is for development. In production, point `DATABASE_URL` at a real
PostgreSQL server and do not run `db:start`. Any PostgreSQL works the same way
in development too, if you would rather install one.

There are two sites, at two addresses:

| Site | Development address | Who signs in |
|---|---|---|
| **Admin console** | <http://admin.localhost:3100> | Platform administrators — the super admin from `.env` |
| **A company space** | `http://<space-id>.localhost:3100` | That company's people |

Browsers resolve every `*.localhost` name to this machine, so these work with no
hosts-file changes. Opening plain <http://localhost:3100> leads to the admin
console.

### Sample data

To see every screen with something in it, without a platform connection:

```bash
npm run seed:dev
```

This creates a space of its own, **Demo Medical** (`demo`), holding the design's
sample data: 15 cases and their parts, 5 workflows, 6 machines, 6 materials
with their lots, 9 suppliers, the nine equipment registries, the six standard
QA forms and three goods receipts (closed, awaiting inspection, draft). Sign in at
<http://demo.localhost:3100> as `demo@3dsurgical.example`, with the same
password as the super admin in `.env`.

It only ever touches the `demo` space, replacing its contents on each run, and
never reads or writes a real company space. It refuses to run with
`NODE_ENV=production`.

A second person, for trying the rule that a QA form is approved by someone
other than its submitter, is added with `npm run seed:demo-user`: a QA
reviewer, `qa@3dsurgical.example`, with the same password.

---

## Two sites, one deployment

The admin console and every company space are separate sites with their own
address, their own sign-in page and their own sessions. Which one a request is
for is decided by the address it arrives on (`src/lib/realm.ts`):

| Address | Site |
|---|---|
| `admin.<BASE_DOMAIN>` | The admin console |
| `<space-id>.<BASE_DOMAIN>` | One company space |
| A space's custom domain | The same space, under the company's own name |
| Anything else | "No space at this address" |

A session is only honoured on the site it was issued for. A platform
administrator does not work inside a space, and a space user's session opens
neither the admin console nor another company's space.

**The admin console** is for platform administrators: create company spaces,
suspend and reactivate them, reset a space admin's password, and read the admin
activity log. Suspending a space signs everyone in it out at once.

**A company space** is the manufacturing application itself.

## How sign-in works

| At | Who | Checked by |
|---|---|---|
| The admin console | Platform administrators | A local password (scrypt) |
| A company space | The space's first admin | A local password (scrypt) |
| A company space | Everyone else | That company's tenant on the 3D Surgical Platform |

Most space users have **no password here**. Their credentials go to the
company's platform tenant, and an account is provisioned from the profile it
returns, so people use the login they already have.

The exception is the admin a space is created with. Somebody has to be able to
sign in before the space is connected to the platform, so creating a space
generates a temporary password for that admin. It is shown to the platform
administrator once, to pass on, and the space admin can change it under Account.

Who else gets in is decided per space under **Users & Roles**: a platform role
must be on the allow-list, because the platform also holds surgeons and
distributors. A new space allows the platform's `Admin` role.

The platform issues a working API token *before* the second factor is verified.
That is not accepted here: for a two-factor account the token is parked in a
short-lived encrypted cookie and no session exists until the code is confirmed.

## Setting up a company

1. Sign in at the admin console and create the space under **Company Spaces**.
   Copy the sign-in page, email and temporary password it shows, and send them
   to the space's admin.
2. The space admin signs in at the space's address and opens
   **Integrations & API**.
3. They enter the platform URL (e.g. `https://jajal.3dsurgical.com`) and a
   service account, and save. The service account **must be an Admin on the
   platform**: the platform only returns the cases the caller's role may see, so
   any other account syncs part of the data and still looks successful.
4. **Test connection**, then **Sync now**.
5. The company's people can now sign in at the space's address with their
   platform accounts.

## How the sync works

Cases flow one way, from the platform. Each run pulls active and archived cases
and upserts on the platform's case id. Nothing is ever deleted: a case that
disappears upstream stays, because parts may already have been made against it.

Platform quirks handled in `src/lib/platform/mapper.ts`:

- Dates arrive preformatted in the tenant's date format, not ISO-8601. The
  connection test detects the format from real data and warns when the
  configured one disagrees.
- Surgeon, sales rep and product arrive as display names with no ids.

### The case edit page

`/cases/<id>/edit` reproduces the platform's own case edit page: the status
stepper, and the Case Info, Documents, Preferences, Status, Links and Files tabs
with the same fields in the same order.

The platform's API has a case list and no endpoint for one case in full, so
priority, scan type, shipping address, the status table, documents and share
links are not in it. They are read from the platform's case edit page instead:
the server signs in to the platform's web application with the space's service
account, fetches that one page and parses it (`src/lib/platform/web.ts` and
`case-detail.ts`). The result is cached on the case, encrypted, and re-read
when it is more than ten minutes old or when someone presses Refresh.

Two things follow from that:

- **It depends on the platform's markup.** A change to that page can blank a
  field here. Each field is read independently, so it costs a field, not the
  page. A case-detail endpoint on the platform would replace all of it.
- **It is a copy.** Nothing here writes to the platform; the page links to the
  platform for changes. The service account must not have two-factor sign-in,
  or its pages cannot be read.

To sync on a schedule, have cron call:

```bash
curl -X POST https://admin.$BASE_DOMAIN/api/cron/sync -H "Authorization: Bearer $CRON_SECRET"
```

## Cases managed here

A space without a platform connection opens its own cases. **Case Form Setup**
(`/casesetup`) chooses the **case source** — synced from the platform, or
managed here — and, when managed here:

- **Case ID**: a pattern such as `SYN-{YYYY}-{####}`; `{TYPE}` is the product's
  code. One running part, given when the case is saved.
- **Case forms**: built like part request forms — the same editor, with show /
  required switches, variables to copy, reuse of a field from another form and
  a live preview with its own scroll. A space can keep several — one per
  kind of case — each with a name, a description, the products it opens cases
  for (or any), and sections of fields. Built-in fields (case ID, product,
  sub-scope, priority, surgery date, surgeon, hospital, patient ID and
  initials) are read by the app; the rest are the space's own. A new form is
  created on its first save; one that cases were opened with cannot be
  deleted.
- The default form asks body part, side and hospital department from
  dropdowns (lists a space can change). The product field can show as a
  **list** (dropdown) or as **cards** to click — "Show as" on the field.
- **Surgeon**, **Secondary surgeons** and **Sales person(s)** list people of the
  space by role (each field chooses the roles — e.g. only "Surgeon"); the
  **Hospital** field lists the **Hospitals** list — all of it, or only the
  chosen surgeon's hospitals. People who never sign in (surgeons, sales) are
  added on Users & Roles, with the hospitals each works at.
- **Sub-scope** follows the product: asked only for a product with sub-scopes,
  then required; it and Product can show as a list or as cards (with images).
- Each field has a **Create** switch: off, it is not asked in "+ New case" and
  is filled later from **Edit case** (managed-here cases). Part request forms
  have the same switch; such answers are given on the part's Part info tab
  (**Edit details**).
- The default form, in order: Case (ID, project type, sub-scope) · Patient (ID,
  initials, body part, procedure) · Hospital (**surgeon first**, hospital,
  department) · Team (priority, assigned project manager, secondary surgeons,
  sales) · Dates (delivery, surgery) · Diagnosis & comments · Imaging (DICOM).
  **Hospital department** lists the chosen hospital's departments — the
  surgeon's own when linked to some. Case start / end dates are shown by the
  app (opened; marked completed), not asked.
- **Hospitals** keep their **departments** and their **people** (who works
  there, and in which departments) on the hospital's page.
- The case ID can use the case's answers: {SURGEON} and {PATIENT} initials,
  {PID}, {SURGERY} and {DELIVERY} dates (DDMMYY); its running part counts up
  across all cases — e.g. `{######}_{SURGEON}_{PID}_{PATIENT}` → 000123_HR_2606_MA.
- Hovering any stored image in the app shows it larger.
- The case page shows when it was created and last updated, by whom, and an
  **Activity** tab with everything done to the case and its parts.
- Every answer is a variable, `{case.<var>}`, that QA forms can read; a
  variable on two forms must be the same kind of answer.

Stages — a product's case stages and a manufacturing workflow's — are set up
on one board: the stages down the left (click one, drag to reorder) and the
chosen stage on the right as a settings sheet in sections — Viewer buttons
(products), General, Forms, Tasks, Emails — a row per setting.

**Products** (Case Setup in the menu) are what a case is opened for, listed as
a table or cards. "+ Add product" first asks its kind:

- **Product with one workflow** — its details, then its **case stages**, edited
  like a manufacturing workflow's: each stage with quality forms, emails, tasks,
  expected time, owner, approvers and "forms must be approved to move on".
- **Product with sub-scopes** — the sub-scopes are kept inside the product (PSI:
  orthognathic, mandible…), one tab each, each with its own name, code,
  manufacturing workflow and case stages. A case of it must pick a sub-scope;
  one that cases were opened for cannot be removed.

Each product — and each sub-scope — also has an **image** (shown on the
product cards of the case form and in the case list), the **viewers** its
cases are seen in, and its **scan protocol** documents (offered in "+ New case"
and on the case page); a sub-scope without its own uses the product's. Files
are the product's documents, uploaded once it is saved. Every associated
viewer gets a **Viewer buttons** setting on each case stage: shown at that
stage or not, and to everyone or one or more roles — the case page shows the
buttons of the stage the case is at, for the viewer's roles.

The **Viewer list** (Case Setup) holds the viewers — 3D Viewer, Orthognathic
Planner and Fibula Flap Planner to start (`npx tsx scripts/seed-viewers.ts <space…>`),
each renamable, with a logo (JPG, PNG or SVG; an SVG is served sandboxed).

The kind can be changed later on the product's page. Its details: name, code, **tags** (one or more, to find and filter it — the
new-case cards can be filtered by tag), the **manufacturing workflows** its
parts may use (all, or a selection), description; status and kind sit at the
top with its image, and who created and last updated it. A new product starts from
the full path (Case received → … → Case completed); remove what it does not
need. The manufacturing workflow its parts are made by is a separate, optional
choice. A new case starts at its first stage.
"+ New case" on the Cases page asks which form (when there are several), then
opens the case at its first case stage: the patient ID is encrypted and masked, and
DICOM files (or study links) are kept with it (`case_files`, 25 MB per file).
The case page lays the answers out by the form the case was opened with.

## Manufacturing setup

Everything parts and quality forms will point at. Machines, materials, suppliers
and the nine registries (measuring equipment, post-processing equipment,
sterilization cycles, standard components, tooling, software, process
parameters, operator qualifications, packaging) are **one list screen and one
detail screen**, driven by `src/lib/resources/config.ts`. A registry is an entry
in that file — its words, fields, statuses and tabs — not a screen of its own.

What they share:

- **Schedules and records.** A maintenance, a calibration, a qualification or a
  supplier evaluation is an item with a due date and an optional repeat.
  *Recording* it — date, who, result, the report — is the only thing that moves
  the due date on. Records are kept even if the item is later removed.
- **Status is worked out, not just set.** A caliper marked "In service" whose
  calibration has lapsed shows "Calibration overdue". The rules are in one
  place, `src/lib/resources/status.ts`, and feed the list, the detail page and
  the alert panel alike.
- **Change control.** A maintenance record marked "affects validation" opens a
  review on the Qualification tab that stays open until somebody closes it.
- **Documents.** Manuals, SOPs, certificates, and the evidence attached to a
  record. Files are kept in `STORAGE_DIR` and served only to someone signed in
  to the space they belong to.
- **Archive, and two-person deletion.** Archiving hides a record and keeps
  everything. Permanent deletion is requested by one signed-in person and
  approved by a different one, who must type the record's name.
- **Audit log.** Every change is recorded with who, when and what; the log has
  no edit or delete.
- **IDs — typed or generated.** Every list has an **ID format** (admins): a
  pattern such as `PR-{TYPE}-{##}` with one running part — `{###}` numbers,
  `{AA}` letters or `{XXX}` letters and numbers — and optionally `{TYPE}` (from
  the record's type or technology), `{YYYY}`, `{YY}`, `{MM}`. The next ID is
  one past the highest already given in the same format, so IDs typed by hand
  in that format count too. **Generate** beside the ID field fills the next
  one in; with **Assign automatically** on, an ID left blank is given on save.
  An ID typed by hand is always kept, and no two records of a list may share
  one (archived ones included). Materials, suppliers and software have an ID
  field too (material code, supplier code, software ID). Formats are stored in
  the space setting `ids`; the logic is `src/lib/resources/ids.ts`.

**Workflows** have their own editor: ordered stages, each with its quality
forms, emails, auto-created tasks, expected working days and owner role.
**Materials** carry lots, with stock that changes only through a receipt or an
adjustment with a reason.

Setting master data up (create, edit, archive) is for a space's admins.
Recording a maintenance or a calibration, attaching its report and adjusting
stock are for anyone in the space — the person who did the work records it.

## Parts

A part is what is actually manufactured — for a case, or for no case at all (a
stock item, a test coupon, a demonstration model).

- **Part Request Setup** (`/partsetup`, space admins) holds two things per
  space: the **part-ID rule** (a prefix, a separator and an ordered list of
  tokens — product, case number, part sequence, part type, material, year,
  month, space) and the **request form** (sections of fields; built-in fields
  can be hidden or made required, custom ones added, each with the variable
  quality forms will read it by). A live preview shows both. Nothing changes
  for anyone until *Save setup*; until the first save the defaults in
  `src/lib/parts/request-form.ts` apply.
- **Part-ID numbering.** The rule card chooses what PART_SEQ counts
  (`idScope`): **per case** (default), **per case and part type**
  (`E123-IMP-01`, `E123-IMP-02`, `E123-MDL-01` with
  `CASE_ID-PART_TYPE-PART_SEQ`), **per part type** across cases, **per
  month**, **per year** (UTC, as YYYY/MM read it), **across all parts**, or
  **match the ID** — counted among the IDs that start the same up to PART_SEQ,
  so token order decides (`E123-01-IMP` counts per case, the type only
  labels). Labelled examples show the choice; a warning appears when the ID
  lacks what it counts by (per part type without PART_TYPE…), since two parts
  would then share an ID and the sequence is added at the end. Digits: 01,
  001…. Allocation is in `src/lib/parts/numbering.ts`; the request form's
  Part ID preview asks the server for the same number. `CASE_ID` is the case
  ID as on the platform; `CASE_SEQ` drops a lettered prefix (JM-0430 → 0430).
- **Several request forms.** Part Request Setup opens on a list: the part-ID
  rule all forms share (saved on its own), then the forms as cards — sections,
  fields, parts requested, who saved last. **+ New form** starts from the
  default fields or as a copy of any form; each card has **Edit**,
  **Duplicate**, **Make default** and **Delete**. Edit opens the form on its
  own page (`/partsetup?form=<id>`) — name, description, sections, live
  preview, **Save form** — with "← All request forms" back. With more than one, the
  request asks **"What are you requesting?"** (buttons, or a dropdown past
  four forms); with one, it opens straight away. Switching keeps the answers
  to fields both forms share. A field's variable is what QA forms read, so a
  variable on two forms is one variable: duplicate a form, or **reuse a field
  from another form**, and QA forms read both; giving one variable two types
  is refused. The QA variable library says which forms ask each variable.
  Each part keeps its form (`parts.requestFormId`), and its Part info shows
  that form; a form that parts were requested with is archived, not deleted.
  **Duplicate** on a part opens a new request filled from it, on its form.
- **Requesting a part** opens over the Parts list or a case's Manufacturing
  tab. The ID is worked out as the form is filled. Without a case the case
  number becomes `GEN` and the product is left out: `JM-GEN-07`. Print files
  (25 MB each; larger ones as download links), a product image (downscaled to
  900 px in the browser) and inspection drawings are kept in the file store.
- **Start from an earlier part**: the bar under the part ID searches the
  space's parts (by ID, name, type or workflow) and fills the form with what
  the chosen one was requested with — name, type, quantity, workflow,
  material, machine, sourcing, vendor, priority, notes, the custom and QAC
  fields, download links and the balloon table's characteristics. Choices no
  longer on offer are left blank and named. The case, due date and stored
  files (print files, product image, drawings) are not copied.
- **The parts list** shows a table or cards — the switch beside Sort, kept
  per browser; a phone always shows cards. A card has the stage, "Stage n of
  m" with a progress bar, case, due date, material and machine. Where the
  request had a product image, it shows on the card and in the table row.
- **Inspection drawings** carry numbered balloons: click to place one, drag it
  or its arrow point, or nudge with the arrow keys. Each balloon is a row of
  the characteristics table; positions are percentages, so they hold at any
  size.
- **The production workflow is optional when requesting**, in-house or
  outsourced. A part without one has no stages, no quality forms and no
  Next / Back — it shows *No workflow yet*, counts as New, and its page offers
  *Set workflow*. Choosing one creates the stage map and the forms, starting
  at the first stage. An outsourced part without a workflow can still be
  received on a goods receipt.
- **A part keeps the workflow it started on**: the stages are copied onto the
  part when its workflow is set. Editing a workflow changes new parts only.
- **Only the person a part is assigned to can move its stage.** Every change —
  owner, stage, production details, files — is written to the part's own
  activity log and to the audit trail.

Tasks are not built yet; their tab says so.

## Quality forms

- **QA Form Setup** (`/qaforms`) holds the space's form templates: sections
  of fields — auto fields filled from the part, case and request, images,
  text, measurements with limits, pass / fail checks, balloon tables,
  signatures, and dropdowns that pick from a library (machines, lots,
  operators, parameter sets…). In the editor, fields are dragged by their ⋮⋮
  grip — within a section or into another — and sections by theirs; the ↑ ↓
  buttons stay for touch screens. Values and limits take variables such as
  `{part.id}` or `{part.requestedBy}` / `{part.requestedOn}` (who requested
  the part and on which date; `{part.requestedAt}` adds the time); the
  **Variable library** lists them all with example values from a real part. A new space starts empty, with a button that adds the six
  standard forms; the demo space has them.
- **Dates, times and calculations.** *Date*, *Date & time* (pre-fill with
  `{now}`), *Time* and *Duration* (h:mm — "90" and "1h 30m" are read too —
  with optional min / max) fields, and **Calculated** fields whose formula
  names other fields by `[label]` and variables by `{token}`:
  `[Print start] + [Print time]` gives the end, `[End] - [Start]` the time
  taken, `[Printed] - [Rejected]` a count, `round([Accepted] / {part.qty} *
  100, 1)` a yield with optional limits, `addMonths([Mfd. date], 24)` an
  expiry. The kinds decide the arithmetic (date & time + duration = date &
  time); renaming a field in the editor updates the formulas that use it, and
  a formula naming a field that is not on the form cannot be saved. A
  calculated result is stored with the record when it is saved. The engine is
  `src/lib/qa/calc.ts`.
- **Data tables** — columns you define (text, number, date, date & time,
  time, duration, yes / no, choice, or calculated within the row such as
  `[Start] + [Time]`); the operator adds rows. Other fields total them:
  `sum([Runs], "Qty")`, `avg(…)`, `count([Runs])`.
- **Yes / No** buttons, optionally with the answer that passes.
- **Show only when…** — a field shows when another is / is not / is more or
  less than a value, or is filled / empty. Hidden, it is not required, not
  checked and not saved.
- **Photo / attachment** — a picture or PDF attached on the form, kept with
  the part (`part_files` kind `evidence`) and printed with the record.
- **Signatures** record the account that signed and when; one can be kept
  for roles (the app role or the platform role, e.g. "QA") — anyone else
  cannot sign it, and the server refuses a save that tries. Each has a
  **style**: *Name*, *Name and role* (the signer's role shown under it), or
  *Signature image* — the image the person drew or uploaded under **My
  account → My signature**. Signing copies that image onto the record
  (`part_files` kind `signature`), so replacing or removing it later never
  changes what was signed; someone without one is sent to My account.
  **Signed by** tags the field (the label follows the tag): **Prepared by** —
  shows the name (and role / image, by style) of the person filling the form,
  no box to type, signed as they submit; **Reviewed by** / **Approved by** —
  whoever fills the form picks one or more people per field from a dropdown
  (the field's roles, or for approval the stage's approver roles). On submit
  the form goes to the first of them; each signs in turn — reviewers first
  ("Sign as reviewer"), then approvers — and the last approver's signature
  approves the form. Each step lands in that person's My Approvals and can be
  passed on. Or **Typed** by anyone, as before; a form with no
  Reviewed/Approved field still uses the "Send for approval to" panel.
  Stored beside the field as `to:<id>` / `sigs:<id>` (`src/lib/qa/signoff.ts`).
  New signature fields default to Prepared by; the standard QAC uses Prepared
  by + Approved by.
- **Company details** on QA Form Setup — `{company.name}`,
  `{company.licence}`, `{company.address}`… — printed at the foot of every
  controlled-document form.
- **A template is added to a part** at the workflow stages chosen in its Form
  details (or listed on the stage in the workflow editor). Its content is
  **copied onto the part** when the part is requested, so an approved record
  never changes when the template is edited later. Parts requested before any
  template existed get their forms the first time they are opened.
- **Who approves.** Each workflow stage has a *stage owner* and *approves
  this stage's forms* — both chosen from real roles (Space Admin, Member and
  the platform roles allowed in). **Submit for approval** asks who to send it
  to, offering only people with an approver role; **only that person can
  approve it**. The person it was sent to — or a space admin — can **pass it
  on** to someone else eligible. **My Approvals** lists what is waiting for
  you and what you sent that is still waiting.
- **Filling**: Save draft → Submit for approval → Approve. A stage cannot be
  left until its forms are approved. Approving needs every required item, no
  item that is unfit for use (an overdue machine, an expired lot), and every
  measurement within its limits. By default **the approver must be a
  different person from the submitter** — a switch on the QA Form Setup page.
  Signatures are typed names, recorded with the signed-in account and time.
  A signature image that is missing can be drawn or uploaded right on the
  form — while preparing, or beside Approve — and is kept on the profile
  (`SignaturePad`, shared with My account).
- **Sent back, and versions.** Once submitted the form is locked for its
  sender, who sees **Revert to draft** (they or an admin, until everyone has
  signed; signatures given so far are cleared). The person whose turn it is
  sees **Reject** (a reason is required — it goes back to the sender as a
  draft with the reason shown) and **Approve**. Every approval and rejection
  keeps the record as it stood in `part_form_versions`. An approved record can
  be **revised** by an admin or its approver: the approved version stays, and
  the form opens as version N+1 (`part_forms.version`). **Versions kept** at
  the foot of the form opens any of them read-only (`?version=<id>`), with
  the fields that differ from the current version (`src/lib/qa/versions.ts`).
- **Traceability**: every library pick is written down with the form, shown on
  the part, on the item's **Usage records** tab and on a machine's **Build
  history**. A quantity used of a lot, component or packaging item is taken
  off its stock; re-saving with another quantity moves only the difference.
- **Print / PDF**: each record has a printable page (the browser's "Save as
  PDF" makes the file), with who saved, submitted and approved it.

### In-house anatomical models (QAC + BMR JM-F-PRD-015)

`npx tsx scripts/setup-anatomical-model.ts <space-slug> [--as <email>]` sets a
space up for in-house anatomical models, and leaves anything that already
exists untouched, so it can be run again:

- two workflows, **Anatomical Model — SLA (In-house)** (11 stages) and
  **— FDM (In-house)** (9: no washing or curing);
- the **QAC** (JM-F-DND-004) at *Request received*: filled from the part
  request and approved before anything else happens;
- the **Batch Manufacturing Record for 3D Model — Inhouse** (JM-F-PRD-015,
  issue 02, rev 03) as ten forms, `JM-F-PRD-015/1` to `/10`, one per stage:
  batch identification (with Prepared by / Approved by), design receipt & file
  check, 3D printing setup and 3D printing run (each with Done by / Checked
  by), washing, curing, support removal, quality check & final
  yield (each QAC requirement checked), packaging & label check, batch review
  & release;
- the technology *3D Printing*, the part type *Anatomical model* (MDL) and the
  six packaging & labelling items the BMR names.

Machines, wash / cure units, materials, suppliers and operators are not
created — they are the company's own records.

BMR 1 used to hold the design receipt & file check too. A space set up before
that change is split with `npx tsx scripts/split-bmr1.ts <space-slug> --dry`
(to see it) and then `--backup <file.json>`: BMR 1 keeps Batch identification
plus Prepared by / Approved by, its other sections (edits included) become BMR
2, BMR 2–8 become 3–9, and the workflows get a *Batch identification* stage.
Parts already requested keep their forms. Done for demo and jajal-medical on
2026-10-02 (backup in `backups/`). `scripts/split-bmr3.ts` then splits BMR 3
the same way: setup stays BMR 3, the run becomes BMR 4 at a new *3D printing
run* stage, BMR 4–9 become 5–10 — also done for both spaces that day.

**My Approvals** has tabs — *Waiting for my approval*, *Sent by me* — built
from one list in the page, so another tab is one more entry. The sidebar shows
how many forms wait for you beside it, checked on every page change, on window
focus, each minute, and after any approval action.

## One way in: goods receipt

Everything that arrives from outside comes in through a goods receipt, so it
is inspected before it is used and every quantity can be traced to a delivery.

- **Stock is a sum of lots** — for materials, standard components and
  packaging alike. Nothing on an item's page lets stock be typed: it changes
  by a receipt, by a quality form recording what was used, or by an
  adjustment with a reason. Each item's Overview shows its stock, the lot in
  use, the next expiry and who supplied it.
- **"+ Receive via GRN"** on an item's Lots & stock tab starts a draft receipt
  with that item already on a line and its usual supplier filled in.
- **Opening stock** (admins only) records a lot that was already on the shelf
  when the space started; the lot register marks it "before GRN".
- **Suppliers are linked by record**, not by name. A supplier's **Receipts**
  tab shows its deliveries, lines accepted, rejected (whole or part) and on
  hold, and its rejection rate — the record behind its evaluation.
- **Every item has a Receipts tab** listing the receipt lines that brought it.
- **An outsourced part at its vendor stage** moves on only when it is received
  and accepted on a goods receipt; Next is refused until then.
- **An instrument's calibration lab and certificate** are read from its latest
  calibration record — a calibration return on a GRN writes that record.

## Goods receipt

- **GRN list and detail** (`/grn`): a receipt is a draft until confirmed;
  then each line is inspected against its acceptance tests — piece by piece,
  with pass criteria such as "8 of 10" — and released, partly released (with a
  rejected quantity and reason), held in quarantine, or rejected.
- **Accepting a line** puts it where it belongs: a new material lot or a
  top-up of one; component or packaging stock; a calibration recorded on the
  instrument with its next due date; new equipment added with an IQ due; or
  outsourced parts logged and moved to their next stage when their forms allow.
- **Lot register** (`/grnlots`) and **lot trace**: every lot's receipt,
  inspection, release, use in production, adjustments and expiry, with a
  running balance and the parts made from it.
- **GRN setup** (`/grnsetup`): numbering, lot ID format, receipt fields, the
  item types and their tests and extra fields, acceptance rules (including
  whether an unapproved supplier is a warning or a block), and the lists.
  Unsaved, the defaults apply.

## Small screens

Below desktop width the navigation is a drawer opened from the header. Lists
that are tables on a desktop (cases, parts, master data) become cards; tables
that must stay tables scroll sideways inside their card, never the page.

## Privacy

A device is made for one patient, so — unlike the sales CRM — this system keeps
the patient's name. It is AES-256-GCM encrypted at rest, masked on the case
screen, and sent to the browser only in answer to an explicit "View patient
details", which is written to the audit log first. Lists show initial and
surname, as the design does. Patient identifiers are stripped from the raw
platform payload that is retained for replay.

---

## Architecture

```
src/
  app/
    (auth)/login/        sign-in — a different page at each site's address
    (app)/               everything behind the session gate
      spaces/            admin console: company spaces
      activity/          admin console: activity log
      page.tsx           space: dashboard
      cases/             space: list, detail, and the platform's edit page
      users/             space: people and the role allow-list
      integrations/      space: platform connection, test, sync
      account/           both: profile, and password for local accounts
    api/cron/sync/       scheduled sync endpoint
      [section]/         space: every setup list — and placeholders for what is not built
      [section]/[id]/    space: a machine, material, supplier, workflow…
      tech/ parttypes/   space: technologies and part types
      audit/             space: the audit log
    api/files/[id]/      stored documents and photos
  components/shell/      sidebar, header, and each site's navigation
  components/setup/      the shared list, detail, schedule, documents and lots screens
  lib/
    realm.ts             which site a request is for, from its address
    auth/                sessions, sign-in, roles, throttling, origin checks
    platform/            API client, mapper, sync, and the case-page reader
    cases/classify.ts    how free-text platform statuses are read
    resources/           master data: per-kind config, status rules, queries, actions
    files.ts             the file store
    queries/             list and detail queries, always scoped to a space
  proxy.ts               security headers and the cheap sign-in gate
```

**Stack**: Next.js 16 (App Router), React 19, TypeScript, Tailwind v4,
Prisma 7 + PostgreSQL — the same as the CRM, whose platform client, sessions
and sync this project started from.

## Commands

| Command | Does |
|---|---|
| `npm run dev` | Development server on port 3100 |
| `npm run build` | Production build |
| `npm run typecheck` | TypeScript, no emit |
| `npm run lint` | ESLint |
| `npm run db:start` | Run the development PostgreSQL (keep it open) |
| `npm run db:migrate` | Create and apply a migration |
| `npm run db:deploy` | Apply migrations |
| `npm run db:seed` | Create the first platform administrator from `.env` |
| `npm run seed:dev` | The `demo` space with the design's sample data (dev only) |

## Deploying

Beyond a PostgreSQL server and the secrets in `.env`, production needs the
addresses to exist:

- Set `BASE_DOMAIN` to the domain the application is served under.
- Put `STORAGE_DIR` on persistent storage and include it in backups: it holds
  qualification and calibration evidence.
- The database must be **UTF-8**. (The development database is created that
  way; on Windows, PostgreSQL otherwise defaults to the system code page, which
  cannot store names written in other scripts.)
- A **wildcard DNS record and TLS certificate** for `*.<BASE_DOMAIN>`, so the
  admin console and every space resolve and are served over https.
- For each space with a custom domain: the company points a CNAME at the space's
  address, and the server in front of the application needs a certificate for
  that domain too.
- The reverse proxy must pass the original `Host` header through unchanged.
  Which site a request is for is read from it.

## Recent behaviour (2026-10-02)

- **Add without saving leaves nothing.** "Add" on the master-data / equipment
  lists and workflows opens `<route>/new`; "+ New QA form" opens
  `/qaforms/new`; "+ New GRN" opens `/grn/new`. Nothing is stored — and no GRN
  number is taken — until the first Save / "Create receipt", which creates the
  record and opens it. (`NEW_ID` in `src/lib/resources/config.ts`.)
- **Stage setting "Forms must be approved to move on"** (on by default) in the
  workflow editor. Off: a part moves on with that stage's forms still open.
  The workflow's current setting decides, so it applies to parts already on
  the way (`formsRequiredAt` in `src/lib/parts/queries.ts`).
- **Parts list** sorts by Part ID, latest first, by default.
- **QA auto fields** show request links in full and clickable; request files
  named there open the file.
- **Request image display size** (Small / Medium / Large / Full width), chosen
  on upload and changeable on the part's Part info; the part, its QA forms,
  their print and preview follow it (`part_files.displaySize`).

### Sample space: Schneider Children's Medical Center of Israel

`npx tsx scripts/seed-schneider.ts` creates (or rebuilds) the space
`schneider` — <http://schneider.localhost:3100>, sign in as
`admin@scmc-3dlab.example` (admin) or `qa@scmc-3dlab.example` (QA), with the
`SUPER_ADMIN_PASSWORD` from `.env`. A hospital 3D printing lab with one
Stratasys J5 Medijet (PolyJet): anatomical models in VeroUltra / Agilus30,
patient-specific surgical guides and splints in MED610. It holds three
workflows, five QA forms (SCMC-QP-001 … SCMC-RL-005), the printer,
post-processing, measuring, software, process parameters, operators,
packaging, four materials with lots, four suppliers, eight pediatric cases,
thirteen parts (IDs `SCMC-<case>-<type>-<nn>`, per case and type) and three
goods receipts. Two part request forms follow what an ISO 13485 point-of-care
lab records on an order — **Anatomical model request** and **Patient-specific
device request (guide / splint)**: ordering clinician and intended use
(§7.2.1), imaging data as design input (§7.3.3), patient contact and sterility
(ISO 10993-1, §7.5.7, devices only), design review and surgeon approval
(§7.3.5–7.3.6), delivery and guardian consent — and the QAC (SCMC-QP-001)
shows those answers first. Software: MySegmenter and the 3D Surgical Platform
(3D Surgical), and GrabCAD Print. Everything in it is invented; each run
replaces its contents and touches no other space. Not for production.

Its cases are **managed here** (no platform sync): products **Orthognathic**
(ORTHO, the guide workflow) and
**Cranial Plate** (CP, any workflow), both with the 3D Viewer and tags, each with one
workflow — the surgical PSI case stages. The first products (Anatomical Model,
Surgical Guide, Splint) are archived — the sample cases were opened for them and keep them. One generic
case form, **Standard**, serves every product. Case
IDs continue from the samples as `SC-{####}`. `npx tsx scripts/schneider-case-setup.ts`
applies this to an existing Schneider space; the seed runs it last.
Its only QA form is **Incoming Medical File (DICOM)** (820/009 Ver. E), on the
**Customer requirement** stage of both products — `npx tsx scripts/schneider-dicom-form.ts`
(the seed runs it; it removes the other forms, whose copies on parts stay). It
uses the **banner** document header — effective · validity · form · ver. · page,
then the company line — chosen in QA Form Setup (Controlled-document layout →
Header style), with a **Validity** date beside the effective date.
Sub-scopes were once records of their own: `npx tsx scripts/fold-subscopes.ts <space…>`
moves them into their products, keeping the ids cases name.
