# Build plan

The design (`docs/design-source/`, specified in `docs/spec/`) is one interactive
prototype holding roughly 25 working modules in browser memory. This plan turns
it into real software in six phases, ordered by what depends on what: a part
needs a workflow, a quality form needs a part and the master data its dropdowns
read from, and the dashboards need all of it.

Each phase ends with something usable on its own.

| Phase | What | State |
|---|---|---|
| 1 | Foundation: sign-in, company spaces, platform connection, cases | **Built** |
| 2 | Master data: workflows, equipment, materials, suppliers, people | **Built** |
| 3 | Parts: request form, part ID rule, stages, tasks | **Built, except tasks** |
| 4 | Quality forms: template builder, filling, approval, traceability | **Built** |
| 5 | Goods receipt: GRNs, lots, acceptance tests | **Built** |
| 6 | Dashboards, schedule, quality records, settings | Planned |

---

## Phase 1 — Foundation (built)

- **Two separate sites**, as in the design: the admin console at
  `admin.<domain>` and each company space at `<space-id>.<domain>`, each with
  its own sign-in page and sessions that do not cross.
- **Admin console**: create company spaces (with an optional custom domain),
  copy or open a space's sign-in link, suspend and reactivate, reset a space
  admin's password, and an activity log.
- **Sign-in to a space**: the space's first admin has a local account with a
  temporary password; everyone else uses their own 3D Surgical Platform account.
  Two-factor accounts must enter their code before a session exists.
- Every business row carries its space, and every query is scoped to it.
- **Users & Roles**: the allow-list of platform roles that may sign in to a
  space, and the people who have.
- **Account**: profile, and a password change for local accounts.
- **Integrations & API**: platform URL and service account per space, a
  connection test, manual sync, sync history, and a cron endpoint.
- **Cases**: one-way sync from the platform; list with tiles, search, filters,
  sort, grid/list, column chooser and paging; case detail with masked patient
  identifiers and an audited reveal.
- **Case edit page**: a replica of the platform's own case edit page (status
  stepper; Case Info, Documents, Preferences, Status, Links, Files), read from
  the platform when a case is opened. Read-only.
- **Dashboard**: the design's layout, filled from cases until parts exist.
- **Audit log** is being written from day one (sign-ins, space and connection
  changes, patient reveals); its screen arrives in phase 2.

## Phase 2 — Master data (built)

The "Manufacturing setup" board. Everything here is reference data that parts
and quality forms point at, so it comes before them.

Built as drawn in the design, with these differences:

- **Saving is explicit.** The design changes data on every keystroke. Here a
  form has a Save button and a workflow has "Save workflow", so a half-typed
  edit is never stored and each save is one audit entry.
- **Lots are received by hand** until goods receipt exists (phase 5). A lot is
  available as soon as it is entered; incoming inspection comes with the GRN.
- **Left for the phase that feeds them:** a machine's Live status and Build
  history (parts, phase 3), and every Usage records tab (QA forms, phase 4).
- **Qualified operators** on a machine are read from Operator Qualifications —
  everyone whose "Qualified for" names the machine. The design's add-operator
  dialog, which edits that text from the machine's side, is not built.
- **Not built:** the design's unrendered logic — structured IQ/OQ/PQ approval,
  parameter-set approve / suspend / withdraw, breakdown close-out. The design
  itself shows the simpler "schedule + record" pattern, which is what is here.

- Manufacturing workflows and their stages (forms, auto-tasks, expected days,
  owner role, reorder).
- Printers & machines, with qualification (IQ/OQ/PQ), maintenance and build
  history.
- Materials and their lots and stock.
- Manufacturing technologies and part types.
- Suppliers & vendors.
- The nine registries that share one list/detail screen: measuring equipment,
  post-processing equipment, sterilization, standard components, tooling,
  software, process parameters, operator qualifications, packaging.
- The shared "schedule item → record → next due" pattern behind maintenance,
  calibration, qualification and supplier evaluation.
- Archive → restore, or request deletion → approval by a second person.
- The audit log screen.

## Phase 3 — Parts (built, except tasks)

- **Part Request Setup**: the part-ID rule and the request-form builder, with a
  live preview; saved per space.
- **Requesting a part** from the Parts list or a case — or for no case at all —
  including file uploads, download links, the product image and the
  drawing-balloon annotator.
- **Parts list** (tiles, search, sort, columns) and **part detail**: stage
  stepper, ownership, Back / Next, Part info (view and edit), Stages (owner and
  due date per stage), Activity log, the summary sidebar.
- **The case Manufacturing tab** lists a case's parts.
- **Responsive**: the whole application, not only these pages.
- **Still to do in this phase — tasks**: list, board, the task dialog, and
  default tasks created by a workflow's stages. The `tasks` table exists.
- **Left for phase 4:** quality forms on a part (the Current stage and Quality
  Forms tabs, the rule that a stage's forms must be approved before moving on)
  and the traceability table; variable renames reaching into QA templates.
- **Differences from the design, on purpose:** the case is searched for rather
  than picked from a list of every case; the vendor is only asked for when the
  part is outsourced; choosing a workflow fills in its sourcing and vendor;
  material and priority are columns on the part rather than free-form details;
  changing a part's workflow asks for confirmation before resetting its stages.

## Phase 4 — Quality forms (built)

- QA Form Setup: template list (table and cards, duplicate, delete), the
  editor (outline, sections, field settings, live preview with a real part,
  form details), the variable library and dropdown libraries.
- Filling a form inline on the part's Current stage tab or in the dialog;
  save draft → submit → approve; LSL/USL pass/fail on measurements and
  balloon tables; items unfit for use blocked.
- Forms at the current stage block moving on until approved.
- Traceability records; stock taken off lots, components and packaging by the
  quantity recorded; usage records on every library item; a machine's build
  history and live status.
- A printable record page per form (the browser saves it as PDF).
- **Decided here, for the open questions below:** the approver must be a
  different person from the submitter (a space switch); signatures are typed
  names stored with the signed-in account; a template is copied onto the part
  so records do not change with later edits; a part with quality records
  cannot change workflow; a space starts with no templates and adds the
  standard six by a button.

## Phase 5 — Goods receipt (built)

- GRN list (figures, filters, search) and detail: draft → confirm receipt →
  acceptance tests per piece → release, partial release, hold or reject;
  documents; history.
- Accepting a line creates or tops up a lot, adds component or packaging
  stock, records a calibration, adds new equipment with an IQ, or moves
  outsourced parts on.
- Lot register and lot trace with the running balance and the parts made from
  each lot.
- GRN setup: numbering, lot ID format and presets, receipt fields, item types
  with their tests and extra fields, acceptance rules, lists.

## After phase 5 — one way in (built)

Duplication between goods receipt and the master-data pages removed:
component and packaging stock moved into lots (existing figures migrated into
opening-stock lots); manual lot entry became admin-only opening stock;
"Receive via GRN" on every stock item; lots linked to the supplier record;
Receipts tabs on items and suppliers with a rejection rate; outsourced parts
held at the vendor stage until received; calibration lab and certificate read
from the calibration record. Components and packaging are picked by lot in QA
forms, so usage is traced to the lot.

## Phase 6 — Oversight

- The design's parts dashboard, production control and maintenance dashboard.
- Schedule, Quality Records and Settings — not designed yet.
- Admin console: Platform Admins, platform-wide Integrations & API and Platform
  Settings — named in the design, not designed yet.
- Notifications and task reminders.
- Languages (the design shows EN / HI / DE / ES).

---

## Decisions the design leaves open

These are gaps in the prototype that real software has to close. Each is noted
here with what phase 1 assumed, so it can be changed deliberately.

0. **Where a space's platform connection is set.** The design's admin console
   lists "Integrations & API — platform-wide connection for all spaces", but
   each company has its own platform tenant. Phase 1 has each space's admin
   enter their own tenant's URL and service account. If one platform account
   should serve every space instead, that page needs designing.
1. **Editing a case from here.** The case edit page is a copy. Making it save
   means writing to the production platform, and the platform's API has no
   update endpoint — it would have to submit the platform's own web forms.
   Needs a decision, and a test case that is safe to change.
1. **Roles inside a space.** The prototype logs every action as
   "Administrator". There are two roles so far, Space Admin and Member: admins
   set master data up, and anyone may record a maintenance, attach a report or
   adjust stock; who may *approve* a
   quality form or a deletion, as opposed to submit one, needs deciding before
   phase 4.
2. **Electronic signatures.** The prototype's signature is a typed name. For
   ISO 13485 / 21 CFR Part 11 records a signature normally re-checks the
   signer's password at the moment of signing.
3. **Patient identifiers.** The design shows them, masked. Phase 1 stores the
   patient's name encrypted, masks it on screen, and audits every reveal. The
   patient's initial and surname appear in lists, as drawn.
4. **Case status pipeline.** The design's nine-step status timeline is not the
   platform's. The real one has ten steps (Case Creation, Customer Requirement,
   Segmentation, Design, Surgeon Review, Design Transfer, Manufacturing,
   Shipping, Customer Feedback, Case Complete) and is shown on the case edit
   page. Tiles and badges still classify by wording
   (`src/lib/cases/classify.ts`).
5. **Hospital and priority.** The platform's case list carries neither.
   Priority is read from the platform's case edit page, so it shows there but
   not yet in the list. The platform has no hospital field at all; the surgeon
   field sometimes holds a hospital's name.
6. **Links by name.** As in the design, a parameter set names its machine and
   material, and a lot or component names its supplier, as text (with
   suggestions). Renaming a machine does not update the parameter sets that
   name it. Turning these into real links is straightforward if wanted.
6. **Logic the design computes but never shows** — machine qualification
   approval, breakdown close-out, the material-consumption form, the full case
   detail (forms, files, sharing). Build, or leave out?
7. **Template versioning.** In the prototype an approved record re-renders from
   the live template, so editing a template changes history. Real records need
   to freeze the template version they were filled against.
