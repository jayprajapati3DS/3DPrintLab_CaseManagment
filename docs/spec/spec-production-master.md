# Functional spec — `ProductionMaster.dc.html` ("Manufacturing setup")

Source: `project/ProductionMaster.dc.html` (2003 lines, 717 KB). Template = lines 9–855, logic = lines 856–2001 (`class Component extends DCLogic`).
Everything below is read from the file unless marked **[inferred]**. Text in "quotes" / `code` is verbatim from the prototype.

The file contains no instruction-like content aimed at a reader/agent; it is pure UI + logic.

Conventions used in this spec
- "today" = the browser clock at render time, truncated to midnight. The seed data is written as if today ≈ **2026-09-30**.
- All state is in-memory React-style component state (`this.state`). Nothing is persisted; reload resets to seed.
- Almost every numeric field is stored as a **string** (`'12'`, `'2.4'`); parse on use.
- Dates are ISO `YYYY-MM-DD` strings. Lot expiry may also be `YYYY-MM` (7 chars) — code appends `-28`.

---

## 1. Props and embedding

### 1.1 Declared props (`data-props`)
| Prop | Editor | Default | Effect |
|---|---|---|---|
| `spaceName` | text | `"Jajal Medical"` | Company/space name, rendered bold inside the intro banner sentence (`introA + <b>spaceName</b> + introB`). |
| `tab` | text | `""` | Which section to show. When **empty**, the component shows its own pill tab strip (6 tabs) and manages `state.tab` itself (initial `workflows`). When **non-empty**, the internal tab strip is hidden (`showTabs: !pt`) and the host (Dashboard sidebar) drives the section. Changing the prop resets `sel`, `lotSel`, `openStage`, `resQ`. |
| `$preview` | — | `{width:1184,height:1100}` | Design-tool preview size only. Content area is designed for ~1184 px width. |

### 1.2 Undeclared props the script reads (host must supply — contract with Dashboard)
| Prop | Type | Use |
|---|---|---|
| `userName` | string | Acting user; default `'Platform Admin'`. Stamped on archive, GRN, records, audit entries. |
| `navN` | number | Navigation counter. When it changes and the `tab` prop is unchanged, the component clears `sel/lotSel/grnAdd/grnIns/grnEd` (i.e. clicking the same sidebar item again returns to the list). |
| `onNavigate(section)` | fn | Ask host to switch section. Section key = tab key, except `workflows → 'production'` and `types → 'parttypes'`. Also called with `'parts'`, `'cases'`, `'tasks'`, `'quality'`. Cross-links inside the component (`navTo(tab, sel, extra)`) stash the target selection in `_navSel` and call this; the selection is applied when the `tab` prop arrives. |
| `partsSnap` | array | Live snapshot of all parts from the Parts/Cases module (see §3.14). Drives live machine status, build history, usage records, stock consumption, control tower. |
| `onPartCmd(cmd, nav?)` | fn | Commands to the Parts module: `'newpart'`, `'part:<caseId>:<idx>:current'`, `'part:<caseId>:<idx>:info'`, `'assign:<caseId>:<idx>'`, `'advance|<GRN no>|<caseId:idx;caseId:idx…>'`. 2nd arg `'parts'` = also navigate there. |
| `onValSync(payload)` | fn | Pushes master data to siblings whenever it changes (JSON-hash de-duplicated). See §3.15. |

### 1.3 Role-based differences
**None.** There is no permission check anywhere. "Roles" exist only as data: the stage-owner role list (`Manufacturing, Engineer, Quality, Logistics, Administrator`) and operator roles. The only person-based rules are (a) permanent-deletion approver name must differ from requester name (typed text comparison), (b) "Assign me" is hidden when the part's assignee already equals `userName`.

### 1.4 Section keys (`tab` values)
| Key | Screen | In built-in tab strip? |
|---|---|---|
| `workflows` | Production workflows | yes — "Manufacturing Workflows" |
| `printers` | Printers & machines | yes — "Printers" |
| `materials` | Material inventory | yes — "Materials" |
| `tech` | Manufacturing technology | yes — "Manufacturing Tech" |
| `types` | Part types | yes — "Part Types" |
| `vendors` | Approved suppliers & vendors | yes — "Vendors" |
| `measuring` | Measuring & inspection equipment | no (host only) |
| `postproc` | Post-processing & finishing equipment | no |
| `steril` | Sterilization methods & cycles | no |
| `components` | Standard components | no |
| `tooling` | Tooling & fixtures | no |
| `software` | Software & versions | no |
| `params` | Process parameter sets | no |
| `operators` | Operator qualifications | no |
| `packaging` | Packaging & labelling materials | no |
| `grn` | Goods receipt notes (list + detail) | no |
| `grnlots` | Lot register / lot trace | no |
| `grnsetup` | GRN setup | no |
| `control` | Production control dashboard (3 sub-tabs) | no |
| `audit` | Audit log | no |
| `ids` | Part-ID format builder — **logic only, no template** | no |
| `maintplan` | Only an intro sentence exists — **no view** | no |

---

## 2. Global chrome

1. **Intro banner** (hidden on `control`): peach card (`border #FBD5C5`, `bg #FFF6F2`, radius 14, padding 16×18), 36 px white icon tile with orange factory icon, 13.5 px text `introA <b>{spaceName}</b> introB`.

| tab | introA | introB |
|---|---|---|
| grn | `Goods receipt for ` | ` — every delivery is received here, inspected, then accepted into stock (ISO 13485 §7.4.3).` |
| grnlots | `Lot register for ` | ` — every lot received, its stock, full log and the parts made from it (ISO 13485 §7.5.9 traceability).` |
| grnsetup | `Goods receipt setup for ` | ` — numbering, receipt fields, lot IDs, acceptance tests and rules. Changes apply to new and open GRNs.` |
| maintplan | `Maintenance and calibration planner for ` | ` — every due service, calibration, requalification and open breakdown in one list.` |
| audit | `Audit trail for ` | ` — every archive, restore and deletion approval, qualification, validation and change-control event. Entries cannot be edited or removed.` |
| workflows | `Set up manufacturing workflows for ` | ` — each workflow has its own status stages. When a part is requested, the chosen workflow drives its live status.` |
| printers | `Printers and machines available to ` | ` — assign them to workflows and parts.` |
| materials | `Materials and lot inventory for ` | ` — track lots, quantities and low-stock thresholds.` |
| tech | `Manufacturing technologies used by ` | ` — used to group printers and materials.` |
| types | `Part types offered by ` | ` — shown in the part request form.` |
| vendors | `Approved suppliers and vendors for ` | ` — outsourced manufacturers, material suppliers, calibration labs and sterilization contractors.` |
| measuring | `Calibrated measuring and inspection equipment for ` | ` — calibration status is tracked automatically.` |
| postproc | `Post-processing and finishing equipment at ` | ` — with validation references and maintenance schedule.` |
| steril | `Validated sterilization methods and cycles for ` | ` — each cycle links to its validation report and revalidation date.` |
| components | `Standard bought-in components used by ` | ` — screws, sleeves, pins and instruments with lot and stock.` |
| packaging | `Packaging and labelling materials for ` | ` — lot-controlled for the device history record.` |
| tooling | `Tooling and fixtures used at ` | ` — usage life is tracked against each limit.` |
| software | `Validated software used at ` | ` — installed vs validated versions and periodic review.` |
| params | `Validated process parameter sets for ` | ` — pick one when a part is built.` |
| operators | `Trained and qualified people at ` | ` — only qualified people should be assigned to a stage.` |
| (no `tab` prop) | `Configure manufacturing for ` | ` — workflows, printers, materials, technologies, part types and vendors.` |

2. **Built-in tab strip** (only when `tab` prop empty): segmented control, track `#EEF0F3` radius 11 padding 4; buttons 34 px high, radius 8, 12.5 px/600; selected = white bg, text `#C4320A`, shadow `0 1px 2px rgba(16,24,40,.1)`; unselected text `#475467`.
3. **List view toggle** (shared state `lv`: `table` default / `card`): two 32 px icon buttons (list icon / grid icon); active bg `#FFF1EB`, icon `#E24E1B`. One shared setting for workflows, printers, materials, vendors and all registries.
4. **Active / Archived bar** — on list pages for `workflows`, `printers`, `materials`, `vendors` and all 9 registries (not tech, types, GRN, control, audit): segmented tabs `Active (n)` / `Archived (n)` + right-aligned hint: active → "Archiving keeps the full record — nothing is lost."; archived → "Archived records are read-only."
5. **Toast**: fixed bottom-centre (`bottom 28px`), dark `#101828`, white 13 px/600, radius 10, auto-hides after **2600 ms**. Used only by GRN and stock-adjust actions.
6. **Modals**: backdrop `rgba(16,24,40,.45)`, z-index 60, card radius 14, padding 22, shadow `0 20px 40px rgba(16,24,40,.2)`, max-width 480 px (archive; others similar).
7. **Master–detail pattern**: every list row is a full-width button; clicking sets `sel` and replaces the list with the detail; detail has a "‹ Back to list" text button (workflow: chevron icon + "Back to list").
8. There is **no pagination and no column sorting anywhere**. Filtering is by free-text search and a few dropdown/KPI filters.

---

## 3. Data model (implied) and seed data

Entity list: `Workflow`, `Stage`, `StageTask`, `Printer` (machine) with `QualStep`, `ValidatedParamSet` (+history), `ScheduleItem` (maintenance/qualification), `MaintenanceLog`, `QualRecord`, `Document`; `Material`, `MaterialLot` (+`tops`, `adjs`); `Technology`; `PartType`; `Vendor`; nine **registries** (`measuring`, `postproc`, `steril`, `components`, `tooling`, `software`, `params`, `operators`, `packaging`); `GRN`, `GRNLine`, `GRNDoc`, `GRNLogEntry`; `GrnConfig`; `ArchiveEntry`; `AuditLogEntry` (`arcLog`); `PartIdFormat`; external `PartSnapshot`.

ID generation in prototype: `nid(prefix)` = prefix + incrementing counter starting at 1001 (e.g. `w1001`, `g1002`). Use DB ids in the real app.

### 3.1 Workflow (process route)
```
Workflow { id, name, method (Technology.name), sourcing: 'In-house'|'Outsourced', vendorId (Vendor.id | ''), stages: Stage[] (ordered) }
Stage    { id, name, role ('' | one of ROLES), forms: string[], emailsNext: string[], emailsBack: string[], tasks: StageTask[], days: string (working days, '' = not set) }
StageTask{ id, name, days: string (due offset in days from stage start) }
```
Enumerations
- `ROLES` = `Manufacturing`, `Engineer`, `Quality`, `Logistics`, `Administrator` (+ blank = "— Assign later —").
- `FORMS` (quality forms attachable to a stage) = `QAC (JM-F-DND-004)`, `Build inspection checklist`, `Dimensional QC report`, `Post-processing record`, `Cleaning & sterilization record`, `Labelling & packaging check`, `Final release record`.
- `EMAILS` = `Stage started — notify owner`, `Part ready for QC`, `Part dispatched — notify customer`, `Rework required — notify engineer`.

Seed helper rules (used only to build seed stages):
- forms: a stage named "Request received…" always gets `QAC (JM-F-DND-004)` first.
- `days` by name regex: `^request`→1; `design|slicing|segmentation|cam`→2; `queued|sent to`→1; `printing|machining`→2; `heat|depowder|washing|support|cleanup`→1; `inspection|qc`→1; `steril`→1; `packag`→1; else ''.
- emailsNext: `^request`→[Stage started — notify owner]; `inspection|qc`→[Part ready for QC]; `packag|dispatch`→[Part dispatched — notify customer].
- emailsBack: `inspection|qc`→[Rework required — notify engineer].

**Seed workflows (5)** — `#. Stage name | role | days | forms | tasks`

**w1 "Titanium Implant — DMLS"** — method `3D Printing`, In-house
1. Request received | Manufacturing | 1 | QAC (JM-F-DND-004) | — (email→ Stage started — notify owner)
2. Design prep & nesting | Engineer | 2 | — | Verify design sign-off (+1d), Prepare build file (+2d)
3. Build queued | Manufacturing | 1
4. Printing (DMLS) | Manufacturing | 2 | Build inspection checklist
5. Heat treatment & depowdering | Manufacturing | 1
6. Support removal & finishing | Manufacturing | 1 | Post-processing record
7. Inspection & QC | Quality | 1 | Dimensional QC report (email→ Part ready for QC; email← Rework required — notify engineer)
8. Cleaning & sterilization | Quality | 1 | Cleaning & sterilization record
9. Packaging & dispatch | Logistics | 1 | Labelling & packaging check (email→ Part dispatched — notify customer)

**w2 "Surgical Guide / Jig — SLA Resin"** — `3D Printing`, In-house
1 Request received (Manufacturing, QAC) · 2 Design prep (Engineer, 2d) · 3 Build queued (Manufacturing) · 4 Printing (SLA) (Manufacturing, 2d, Build inspection checklist) · 5 Washing & post-cure (Manufacturing) · 6 Support removal (Manufacturing) · 7 QC inspection (Quality, Dimensional QC report, QC emails) · 8 Packaging & dispatch (Logistics, Labelling & packaging check)

**w3 "Model / Prototype — SLS (PA12)"** — `3D Printing`, In-house
1 Request received · 2 Segmentation check (Engineer, 2d) · 3 Build queued · 4 Printing (SLS) (2d) · 5 Depowdering & cleaning · 6 Visual QC (Quality, Final release record) · 7 Packaging & dispatch (Logistics, no form)

**w5 "Model / Prototype — FDM"** — `3D Printing`, In-house
1 Request received · 2 Slicing & build prep (Engineer, 2d, task "Slice with PPS-FDM-PETG-01" +1d) · 3 Printing (FDM) (2d, form `Polymer build record`) · 4 Support removal & cleanup · 5 Visual QC (Quality, form `Final inspection`) · 6 Packaging & dispatch (Logistics)

**w4 "PEEK Implant — CNC"** — method `CNC Machining`, **Outsourced**, vendorId `v3` (MedMill CNC)
1 Request received · 2 CAM programming (Engineer, 2d) · 3 Sent to vendor (Logistics, 1d) · 4 Machining at vendor (Manufacturing, 2d) · 5 Incoming inspection (Quality, Dimensional QC report, QC emails) · 6 Cleaning & sterilization (Quality, Cleaning & sterilization record) · 7 Packaging & dispatch (Logistics)

(Array order in seed: w1, w2, w3, w5, w4. Unlisted stage `days` default to 1 per the regex rule. Note `Polymer build record` and `Final inspection` are **not** in the `FORMS` pick-list.)

### 3.2 Technology ("Manufacturing Tech" / process)
`{ id, name }` — seed: `k1 3D Printing`, `k2 CNC Machining`, `k3 Cast Urethane`. Referenced **by name** from `Workflow.method`, `Printer.process`, `Material.process`.
Separate hard-coded list `TECHTYPES` (the "Technology" select on printers and materials): `DMLS, SLM, SLA, SLS, MJF, FDM, FFF, PolyJet, Billet, Other`.

### 3.3 Part type
`{ id, name, code (≤6 chars, uppercase) }` — seed: `Implant/IMP`, `Surgical guide/GDE`, `Jig/JIG`, `Anatomical model/MDL`, `Instrument/INS`, `Prototype/PRT`. Used by the part-request form (sibling), parameter-set scope chips, and the `{PART_TYPE}` ID token.

### 3.4 Printer / machine
```
Printer {
  id, name, tech (TECHTYPES), process (Technology.name), materialId (default Material | ''), volume (text),
  status: 'Available'|'In use'|'Maintenance'|'Out of service',
  assetId, maker, model, serial, location, commissioned (date), img (data-URL JPEG ≤640 px),
  quals: { IQ|OQ|PQ: { status: 'Not started'|'In progress'|'Completed', ref, doc? } },
  qualDate, qualApprovedBy, qualApprovedOn, requalMonths,
  qualLog: [{ id, date, event, detail, by }],
  pmLast, pmMonths, serviceVendor, pmName?, pmSop?, pmAcc?, pmSteps?: string[], pmLead?, pmBlocks?,
  cals: [{ id, name, type?, last, months, lead?, provider?, sop?, acc?, steps?: string[], blocks?: 'yes'|'no' }],
  mItems?: ScheduleItem[],            // once edited in the UI, replaces the pm+cals derivation
  qItems?: ScheduleItem[], qRecords?: QualRecord[],   // once edited, replace the quals/valParams derivation
  valParams?: ValidatedParamSet[],
  logs: MaintenanceLog[], docs: Document[], opRefs?: { [operatorId]: trainingRef }, matIds?: []
}
ScheduleItem { id, name, due (date|''), months (repeat|''), last (date|''), res? ('Pass'|'Pass with remarks'|'Fail'|'') }
QualRecord   { id, date, itemId, itemName, who, result, ref, note, link: 'qrec:<id>' | 'qual:IQ' | 'vp:<id>' | 'qual:val' }
MaintenanceLog { id, date, type, who, hours, note, cc?: 'yes'|'no'|'auto', itemId?, itemName?, result?, status?: 'Open'|'Closed',
                 sev?: 'Machine down'|…, closedOn?, fix?, fixedBy?, verify?, verBy?, prevDate?, item?,
                 review?: { outcome, by, date }, impact?: { text, by, date }, voided?: { reason, by, date } }
Document { id, name (file name only), kind, date, link?, by?, supersededOn?, tag? }
ValidatedParamSet { id, psId (params registry id), rev, scope: PartType.name[], limits, supplier, ref, evidence, date, months,
                    status: 'Draft'|'In validation'|'Validated'|'Suspended'|'Withdrawn', approvedBy, approvedOn, note,
                    history: [{ id, date, event, detail, by }] }
```
Log `type` values seen: `Preventive maintenance`, `Calibration`, `Breakdown / repair`, `Software update`, `Major component replacement`, `Relocation`, `Inspection`, `Maintenance` (generic, written by the rendered "Record" form).
Document `kind` (upload select): `Manual`, `SOP`, `Validation report`, `Qualification report`, `Service report`, `Calibration certificate`, `Certificate / declaration`, `Other`; system-created kinds: `Maintenance record`, `Training record`.
Document `link` values: `log:<logId>`, `qrec:<recId>`, `qual:IQ|OQ|PQ|val`, `vp:<valParamId>`, `op:<operatorId>`, and `hist:<any of the above>` for superseded evidence.

**Seed printers (6)**

| id | name | tech | process | default material | volume | status | assetId | maker / model | serial | location | commissioned |
|---|---|---|---|---|---|---|---|---|---|---|---|
| p1 | EOS M 290 | DMLS | 3D Printing | m1 | 250 × 250 × 325 mm | Available | PR-DMLS-01 | EOS GmbH / EOS M 290 | M290-2140 | Metal AM room | 2023-04-12 |
| p2 | Formlabs Form 3B+ | SLA | 3D Printing | m2 | 145 × 145 × 185 mm | Available | PR-SLA-01 | Formlabs / Form 3B+ | F3B-88421 | Polymer lab | 2024-01-20 |
| p3 | HP Jet Fusion 5200 | MJF | 3D Printing | m3 | 380 × 284 × 380 mm | Maintenance | PR-MJF-01 | HP / Jet Fusion 5200 | HP5200-3319 | Polymer lab | 2024-06-05 |
| p5 | EOS Formiga P 110 | SLS | 3D Printing | m3 | 200 × 250 × 330 mm | Available | PR-SLS-01 | EOS GmbH / Formiga P 110 | P110-7765 | Polymer lab | 2024-09-10 |
| p6 | Ultimaker S5 | FDM | 3D Printing | m4 | 330 × 240 × 300 mm | In use | PR-FDM-01 | UltiMaker / S5 | S5-102938 | Model lab | 2025-01-15 |
| p4 | Haas VF-2 CNC | Billet | CNC Machining | m5 | 760 × 410 × 510 mm | Available | MC-CNC-01 | Haas / VF-2 | VF2-55120 | Machine shop | 2022-11-01 |

Qualification / PM seed

| id | IQ | OQ | PQ | qualDate | approved by/on | requal mo | pmLast | pm mo | serviceVendor |
|---|---|---|---|---|---|---|---|---|---|
| p1 | Completed IQ-DMLS-2023-01 | Completed OQ-DMLS-2023-01 | Completed PQ-DMLS-2025-03 (doc d13) | 2025-10-01 | Dr. Meera Iyer (QA) / 2025-10-01 | 12 | 2026-07-15 | 3 | EOS India service |
| p2 | Completed IQ-SLA-2024-01 | Completed OQ-SLA-2024-01 | Completed PQ-SLA-2025-01 | 2025-11-12 | same / 2025-11-12 | 12 | 2026-06-01 | 6 | In-house |
| p3 | Completed IQ-MJF-2024-01 | Completed OQ-MJF-2026-01 | In progress | — | — | 12 | 2026-03-10 | 6 | HP service partner |
| p5 | Completed IQ-SLS-2024-01 | Completed OQ-SLS-2025-02 | Completed PQ-SLS-2025-02 | 2025-12-02 | same / 2025-12-02 | 24 | 2026-08-05 | 6 | EOS India service |
| p6 | Completed IQ-FDM-2025-01 | Completed OQ-FDM-2026-01 | Not started | 2026-01-15 | same / 2026-01-15 | 24 | 2026-06-20 | 3 | In-house |
| p4 | Completed IQ-CNC-2022-01 | Completed OQ-CNC-2023-01 | Completed PQ-CNC-2023-02 | 2024-11-01 | same / 2024-11-01 | 24 | 2026-05-10 | 6 | Haas Factory Outlet |

p1 extra PM fields: `pmSop 'SOP-MNT-001'`, `pmAcc 'All OEM PM checklist items completed and signed'`, `pmSteps ['Replace circulation filter','Align and check recoater','Check chamber seals and door interlock','Clean optics window']`.

Scheduled items (`cals`)
- p1: `c11 Laser power calibration` (type Calibration, last 2026-04-10, 6 mo, lead 30, provider EOS India service, sop SOP-MNT-006, acc "Measured power within ±2 % of set point at 100 / 200 / 370 W", steps [Warm up laser 15 min; Measure at 100 W, 200 W and 370 W with calibrated power meter; Record readings and adjust if outside ±2 %], blocks yes) · `c14 Recoater blade inspection` (Inspection, 2026-09-01, 1 mo, lead 7, In-house, SOP-MNT-009, acc "No nicks or wear > 0.1 mm", steps [Visual check under light; Measure edge with feeler gauge], blocks no) · `c15 Inert gas filter replacement` (Consumable replacement, 2026-07-15, 3 mo, lead 14, EOS India service, blocks no) · `c12 Scanner / optics alignment` (2025-10-05, 12 mo) · `c13 O₂ sensor calibration` (2026-06-01, 6 mo)
- p2: `c21 Galvo / laser calibration` (2026-03-15, 12) · p3: `c31 Thermal camera calibration` (2025-08-20, 12) · p5: `c51 Laser power calibration` (2026-02-10, 12), `c52 Bed temperature sensor` (2026-02-01, 12) · p6: `c61 Bed levelling / XY calibration` (2026-08-01, 3) · p4: `c41 Ballbar / axis accuracy` (2025-11-10, 12)

Logs
- p1: `l14` 2026-09-02 Software update, EOS India service, 2 h, "EOSPRINT 2.14 → 2.16 and machine firmware update", **cc 'yes'** (open change-control review) · `l11` 2026-07-15 Preventive maintenance, EOS India service, 6 h, "Quarterly PM — filter change, recoater alignment, chamber seal check (SR-2607-114)", result Completed · `l12` 2026-05-22 Breakdown / repair, Ravi Patel, 3 h, "Recoater blade crash during build", status Closed, sev Machine down, closedOn 2026-05-22, fix "Blade replaced (TL-RB-07)", verify "Test coupon build + visual check passed", verBy "Neha Shah (QC)" · `l13` 2026-04-10 Calibration, EOS India service, 4 h, "Laser power calibration — 197 W at 200 W set point (CAL-LP-2604)", result Pass
- p2: `l21` 2026-06-01 PM, Ravi Patel, 1 h, "Resin tank replaced, optical window cleaned"
- p3: `l31` 2026-09-20 Breakdown / repair, HP service partner, 16 h, "Printhead failure — replacement ordered, machine on hold" (no `status`, so not counted as an *open* breakdown)
- p5: `l51` 2026-08-05 PM, EOS India service, 5 h, "Half-yearly PM — heaters and recoater checked"
- p6: `l61` 2026-06-20 PM, Ravi Patel, 2 h, "Nozzles cleaned, belts tensioned, firmware 8.3 installed"
- p4: none

Docs
- p1: d11 EOS_M290_operating_manual.pdf (Manual, 2023-04-12) · d12 SOP-PRD-011_DMLS_build_setup.pdf (SOP, 2025-02-01) · d15 IQ-DMLS-2023-01_report.pdf (Qualification report, 2023-04-20, link qual:IQ) · d16 OQ-DMLS-2023-01_report.pdf (Qualification report, 2023-04-25, qual:OQ) · d13 PQ-DMLS-2025-03_report.pdf (Qualification report, 2025-10-01, qual:PQ) · d17 VR-PPS-DMLS-TI-01_revB_validation.pdf (Validation report, 2025-10-01, vp:vp11) · d18 VR-PPS-DMLS-TI-01_revA_validation.pdf (Validation report, 2024-09-10, hist:vp:vp11, supersededOn 2025-08-18) · d19 OQ-DMLS-2023-02_CoCr_report.pdf (Validation report, 2023-09-14, vp:vp12) · d14 SR-2607-114_service_report.pdf (Service report, 2026-07-15, log:l11)
- p2: d21 Form3B_user_manual.pdf (Manual, 2024-01-20) · p5: d51 Formiga_P110_manual.pdf (Manual, 2024-09-10), d52 OQ-SLS-2025-02_report.pdf (Validation report, 2025-12-02) · p6: d61 UltiMaker_S5_manual.pdf (Manual, 2025-01-15) · p3, p4: none

p1 `qualLog`: 2023-05-02 "Qualification approved" (IQ IQ-DMLS-2023-01 · OQ OQ-DMLS-2023-01 · PQ PQ-DMLS-2023-01 · qualified 2023-04-28, by Dr. Meera Iyer (QA)) · 2025-08-18 "Requalification started" (Previous: … approved by Dr. Meera Iyer (QA), by Ravi Patel) · 2025-10-01 "Qualification approved" (… PQ PQ-DMLS-2025-03 · qualified 2025-10-01).

p1 `valParams` (explicit; other machines derive theirs from the `params` registry where `machine === printer.name`):
- `vp11` psId ps1, rev "PPS-DMLS-TI-01 rev B", scope [Implant], limits "Max 30 % recycled powder · O₂ < 0.13 % · min. wall 0.8 mm", supplier Precision AddCorp, ref PQ-DMLS-2025-03, date 2025-10-01, months 12, status Validated, approvedBy Dr. Meera Iyer (QA), approvedOn 2025-10-03, note "Stress relief per PPS-HT-TI-01 mandatory"; history: 2024-09-12 Approved (rev A · PQ-DMLS-2024-02 · for Implant · supplier Precision AddCorp) → 2025-08-18 Revalidation started (Superseded: rev A … — hatch 120 → 140 µm, by Ravi Patel) → 2025-10-03 Approved (rev B · PQ-DMLS-2025-03 …).
- `vp12` psId ps7, rev "PPS-DMLS-COCR-01 rev A", scope [Implant], limits "Dental frameworks only", supplier TitanPowder Metals, ref OQ-DMLS-2023-02, date 2023-09-14, months 24, Validated, approved 2023-09-15; history: 2023-09-15 Approved.

### 3.5 Material and lots
```
Material { id, name, process (Technology.name), tech (TECHTYPES), grade: 'Metal'|'Resin'|'Polymer'|'Ceramic', use (clinical use text),
           unit: 'kg'|'g'|'L'|'ml'|'spool'|'sheet'|'unit', threshold (low-stock), color (swatch hex),
           lots: Lot[], qItems: ScheduleItem[], qRecords: QualRecord[], docs: Document[], logs?: [] }
Lot { id, lot (own lot ID), supLot? (supplier batch), remaining, received, date (received), supplier (Vendor.name text), coa, expiry,
      grn? (GRN no), grnId?, rejQty?, tops?: [{ grn, qty, date }], adjs?: [{ qty (±), reason, by, date }] }
```
Swatch palette: `#6B7785 Slate`, `#2A9D8F Teal`, `#9B59B6 Violet`, `#C98A2E Amber`, `#98A2B3 Grey`, `#D6336C Rose`, `#3B82F6 Blue` (seed also uses `#8A8F98`, `#D4A017`, not in the palette).

**Seed materials (6)**

| id | name | process | tech | grade | use | unit | threshold | color |
|---|---|---|---|---|---|---|---|---|
| m1 | Ti-6Al-4V ELI | 3D Printing | DMLS | Metal | Implantable (ISO 10993) | kg | 2 | #6B7785 |
| m2 | BioMed Clear Resin | 3D Printing | SLA | Resin | Surgical guides (short contact) | L | 1 | #2A9D8F |
| m3 | PA12 Nylon | 3D Printing | SLS | Polymer | Anatomical models | kg | 3 | #9B59B6 |
| m4 | PLA / PETG | 3D Printing | FDM | Polymer | Anatomical models, jigs (non-sterile) | spool | 2 | #C98A2E |
| m6 | CoCr (ASTM F75) | 3D Printing | DMLS | Metal | Dental frameworks (ISO 10993) | kg | 1 | #8A8F98 |
| m5 | PEEK-OPTIMA | CNC Machining | Billet | Polymer | Implantable (ISO 10993) | kg | 1 | #D4A017 |

**Seed lots (8)**

| material | id | lot | remaining | received | date | supplier | coa | expiry | grn |
|---|---|---|---|---|---|---|---|---|---|
| m1 | l1 | TI64-2406-A | 2.4 | 5 | 2026-06-08 | Precision AddCorp | CoA-TI-88213 | 2028-06-30 | — |
| m1 | l2 | TI64-2407-B | 0.3 | 5 | 2026-07-14 | Precision AddCorp | CoA-TI-88540 | 2028-07-31 | GRN-2026-0031 (g31) |
| m2 | l3 | BMC-2408-01 | 3.2 | 4 | 2026-08-02 | BioForm Labs | CoA-BMC-1172 | 2027-08-31 | — |
| m3 | l4 | PA12-2407-11 | 6.8 | 10 | 2026-07-20 | BioForm Labs | CoA-PA-5530 | 2027-12-31 | — |
| m4 | l5 | PLA-2409-03 | 3.7 | 6 | 2026-09-01 | Local distributor | CoA-PLA-0903 | — | — |
| m4 | l7 | PETG-2408-01 | 2 | 3 | 2026-08-12 | Local distributor | CoA-PETG-0812 | — | — |
| m6 | l8 | COCR-2605-02 | 1.6 | 3 | 2026-05-04 | TitanPowder Metals | CoA-CC-4410 | 2028-05-31 | — |
| m5 | l6 | PEEK-2405-7 | 0.8 | 2 | 2026-05-18 | MedMill CNC | CoA-PK-2210 | 2029-05-31 | — |

Seeded material qualification items (`seedMatQ`, all `res 'Pass'`, record by "Dr. Meera Iyer (QA)", record ref `MQ-MET-<year>-<ID>` for metals / `MQ-POL-<year>-<ID>` otherwise, e.g. `MQ-MET-2025-M1`):
- every material: `mq1` — name "Material qualification & biocompatibility (ISO 10993-1)" if `use` matches `/implant|10993/i`, else "Material qualification (datasheet, CoA, fitness for use)"; last 2025-11-10; 36 months.
- grade Metal: `mq2` "Powder chemistry & reuse testing (ASTM F3001 / F2924)"; last 2026-04-02 (m6: 2026-02-20); 6 months → m6's is **overdue** (2026-08-20), m1's due 2026-10-02.
- grade Resin: `mq3` "Post-cure verification (per resin lot)"; last 2026-08-05; 12 months.

### 3.6 Vendor (supplier)
```
Vendor { id, kind, name, contact (email), specialty, location, lead (days), status: 'Approved'|'Trial'|'Suspended',
         qItems, qRecords, docs, logs? }
```
`kind` enum: `Outsourced manufacturing`, `Raw material supplier`, `Component supplier`, `Packaging supplier`, `Calibration lab`, `Sterilization contractor`, `Testing lab`, `Service / maintenance`.

**Seed vendors (9)**

| id | kind | name | contact | specialty | location | lead | status |
|---|---|---|---|---|---|---|---|
| v1 | Outsourced manufacturing | Precision AddCorp | orders@precisionadd.example | Metal DMLS · Ti / CoCr | Pune, MH | 8 | Approved |
| v2 | Outsourced manufacturing | BioForm Labs | production@bioform.example | SLA / SLS polymers | Bengaluru, KA | 5 | Approved |
| v3 | Outsourced manufacturing | MedMill CNC | jobs@medmill.example | CNC · PEEK / 316L | Ahmedabad, GJ | 6 | Approved |
| v4 | Outsourced manufacturing | RapidCast Inc | hello@rapidcast.example | Cast urethane · models | Chennai, TN | 4 | Trial |
| v5 | Raw material supplier | TitanPowder Metals | sales@titanpowder.example | Ti-6Al-4V ELI powder (ASTM F3001) | Hyderabad, TS | 21 | Approved |
| v6 | Component supplier | Orthomed Components | orders@orthomed.example | Bone screws, K-wires | Rajkot, GJ | 10 | Approved |
| v7 | Calibration lab | NABL lab — Vadodara | cal@nabllab.example | Dimensional calibration (NABL) | Vadodara, GJ | 7 | Approved |
| v8 | Sterilization contractor | SteriCare Services | ops@stericare.example | EtO sterilization (ISO 11135) | Ahmedabad, GJ | 5 | Approved |
| v9 | Packaging supplier | FlexiPack Medical | orders@flexipack.example | Sterile barrier pouches (ISO 11607) | Mumbai, MH | 14 | Approved |

Seeded supplier-evaluation items (`seedVenQ`): last-evaluation dates `v1 2025-10-15, v2 2026-02-12, v3 2025-08-20, v5 2025-09-05, v6 2026-03-18, v7 2026-01-09`, others `2026-01-15`; Trial vendors have none.
- `vq1` "Supplier re-evaluation (ISO 13485 §7.4.1)" (Trial: "Initial supplier evaluation (ISO 13485 §7.4.1)"), 12 months.
- `vq2` (only `Outsourced manufacturing`) "On-site supplier audit", last 2025-06-10 (v3: 2024-06-12), 24 months.
- `vq3` "Quality agreement / ISO 13485 certificate check", 12 months.
- due = last + months; for Trial vendors due = `2026-10-20`. Records: who "Dr. Meera Iyer (QA)", result Pass, ref `SE-<year>-<ID>` (e.g. `SE-2025-V1`).
- Consequence on 2026-09-30: v3 (evaluation 2026-08-20, audit 2026-06-12) and v5 (2026-09-05) show **"Re-evaluation overdue"**.

### 3.7 Registries (generic resource lists) — config `RES_CFG`
All nine share one list screen and one detail screen, driven by config. Field types: `text`, `number`, `date`, `select`, `computed` (next-due read-out), `computedLife`. `hide` = fields not shown on the Overview form (they are managed through the schedule tabs instead). All registries have `equip: true` (tabbed detail). `image: true` = photo upload.

| key | title | description | add button | eyebrow | "new" name | search placeholder | columns 1–4 (5th is always "Status") | detail tabs | photo |
|---|---|---|---|---|---|---|---|---|---|
| measuring | Measuring & inspection equipment | Calibrated instruments used for inspection and QA measurements (ISO 13485 §7.6). | + Add instrument | MEASURING EQUIPMENT | New instrument | Search instrument, asset ID or type… | Instrument · Type · Range · resolution · Next calibration | overview, maint (label "Calibration"), qual, usage, docs | yes |
| postproc | Post-processing & finishing equipment | Furnaces, EDM, blasting, cleaning and finishing equipment used after the build. | + Add equipment | POST-PROCESSING EQUIPMENT | New equipment | Search equipment, asset ID or type… | Equipment · Type · Next qualification · Next maintenance | overview, maint, qual, usage, docs | yes |
| steril | Sterilization methods & cycles | Validated sterilization cycles — in-house autoclaves or contract sterilizers. | + Add cycle | STERILIZATION CYCLE | New cycle | Search cycle, method or equipment… | Cycle · Method · Parameters · Next revalidation | overview, maint, qual ("Validation"), usage, docs | yes |
| components | Standard components | Bought-in screws, sleeves, pins and instruments supplied with implants and guides — lot-traceable. | + Add component | STANDARD COMPONENT | New component | Search component, part no. or supplier… | Component · Category · Size · material · Stock | overview, qual ("Incoming inspection & supplier CoC"), usage, docs | yes |
| tooling | Tooling & fixtures | Build plates, cutters, fixtures and recoater blades — with usage life tracking. | + Add tool | TOOLING / FIXTURE | New tool | Search tool, ID or machine… | Tool · Type · Used on · Life used | overview, maint, usage, docs | yes |
| software | Software & versions | Validated software used for segmentation, design, build preparation, CAM and inspection (ISO 13485 §4.1.6). | + Add software | SOFTWARE | New software | Search software, vendor or purpose… | Software · Purpose · Validated version · Next review | overview, qual ("Validation"), usage, docs | no |
| params | Process parameter sets | Validated machine + material + parameter profiles chosen when a part is built. | + Add parameter set | PROCESS PARAMETER SET | New parameter set | Search set, machine or material… | Parameter set · Machine · material · Key parameters · Next revalidation | overview, qual ("Validation"), usage, docs | no |
| operators | Operator qualifications | Who is trained and qualified on which machine or process — used when assigning stage tasks. | + Add person | OPERATOR QUALIFICATION | New person | Search person, role or process… | Person · Role · Qualified for · Requalification | overview, qual ("Training & qualification"), usage, docs | no |
| packaging | Packaging & labelling materials | Sterile barrier systems, trays, labels and IFUs — lot-controlled for the device history record. | + Add item | PACKAGING / LABELLING | New item | Search item, code or supplier… | Item · Type · Lot · expiry · Stock | overview, qual ("Packaging validation"), usage, docs | yes |

Fields per registry (`key — Label [type] {options}`; ✱ = hidden on Overview, managed via schedule)

**measuring** — name "Instrument name" · assetId "Asset ID" (ph `e.g. QC-CMM-01`) · kind "Type" [select] {CMM, 3D scanner, Caliper, Micrometer, Height gauge, Pin / thread gauge, Surface roughness tester, Hardness tester, Torque tester, Other} · location "Location" · range "Measuring range" · resolution "Resolution / accuracy" · calLast✱ "Last calibrated" [date] · calMonths✱ "Calibration interval (months)" [number] · calLab "Calibration lab" · certNo "Certificate no." · _due✱ "Next calibration due" [computed] · status [select] {In service, Out of service, Quarantined}. Due word "Calibration"; due derived from maintenance items. Seeds a maintenance item "Calibration" from calLast/calMonths (who = calLab, note "Certificate <certNo>").

**postproc** — name "Equipment name" · assetId "Asset ID" · kind "Type" {Heat treatment furnace, Vacuum furnace / HIP, Wire EDM, Band saw, Support removal station, Bead / sand blaster, Ultrasonic cleaner, Tumbler / polisher, Electropolishing, Passivation line, Anodizing line, Laser marker, UV post-cure, Other} · usedFor "Used for (process / materials)" · capacity "Capacity" · validation✱ "Validation ref (IQ/OQ/PQ)" (ph `e.g. VAL-HT-003`) · pmLast✱ "Last preventive maintenance" [date] · pmMonths✱ "Maintenance interval (months)" · _due✱ "Next maintenance due" · status {Available, In use, Maintenance, Out of service}. Extra seed-only fields: `usedStages: string[]` (stage names the equipment is used in), `valDate`, `revalMonths`, `docs`. Due word "Maintenance"; column 3 shows next qualification.

**steril** — name "Cycle name" · code "Cycle code" (ph `e.g. STE-PV-134`) · method {Steam — prevacuum, Steam — gravity, Ethylene oxide (EtO), Gamma irradiation, E-beam, Hydrogen peroxide plasma, Dry heat} · provider "Provided by" {In-house, Contract sterilizer} · equipment "Autoclave / contractor" · params "Cycle parameters" (ph `e.g. 134 °C · 4 min · 3 pulses · 20 min dry`) · sal "Sterility assurance level (SAL)" · standard "Standard" · bi "Biological / chemical indicator" · validation✱ "Validation report ref" · revalLast✱ "Last (re)validation" [date] · revalMonths✱ "Revalidation interval (months)" · _due✱ "Next revalidation due" · status {Validated, In validation, Retired}. Column 2 = method + " · contract" when provider is Contract sterilizer. Seeds qualification item "Cycle revalidation (ISO 17665 / 11135)".

**components** — name "Component name" · partNo "Part no. / catalogue no." · category {Bone screw, Locking screw, Drill sleeve, Guide pin / K-wire, Fixation plate, Surgical instrument, Other} · size "Size / specification" · material "Material" · supplier "Supplier" · lot "Current lot no." · sterile "Supplied" {Non-sterile, Sterile} · stock "In stock" [number] · reorder "Reorder level" [number] · udi "UDI-DI" (ph `optional`) · status {Active, On hold, Obsolete}. Stock-tracked (pcs). Extra runtime field `receipts[]`.

**tooling** — name "Tool name" · toolId "Tool ID" · kind "Type" {Build plate, Recoater blade, Powder sieve / mesh, CNC cutter / end mill, Drill bit, Holding fixture, Inspection fixture, Other} · usedOn "Used on (machine)" · material "Tool material" · location "Storage location" · lifeUnit "Life measured in" {builds, cycles, hours, parts} · lifeLimit "Life limit" [number] · used "Used so far" [number] · _life "Life used" [computedLife] · status {Available, In use, Needs regrind / resurface, Retired}. Life-tracked.

**software** — name "Software name" · vendor "Vendor" · purpose "Used for" {Segmentation, Implant / guide design, Build preparation / slicer, CAM programming, Inspection / metrology, Label / UDI printing, QMS / document control, Other} · version "Validated version" · installed "Installed version" · validation✱ "Validation report ref" · validatedOn✱ "Validated on" [date] · reviewMonths✱ "Periodic review (months)" · _due✱ "Next review due" · licence "Licence / seats" · status {Validated, Validation pending, Not for production use, Retired}. Column 3 = validated version + " · installed X" when different. Seeds qual item "Software validation / periodic review".

**params** — name "Parameter set name" · code "Code / revision" (ph `e.g. PPS-DMLS-TI-01 rev B`) · process {DMLS / LPBF, SLA, SLS, MJF, FDM, CNC milling, Heat treatment, Other} · machine "Machine" (free text = Printer.name or equipment name) · material "Material" (free text = Material.name) · layer "Layer thickness / step" · keyParams "Key parameters" (ph `e.g. 280 W · 1200 mm/s · 30 µm`) · validation✱ "Validation ref (IQ/OQ/PQ)" · validatedOn✱ [date] · revalMonths✱ "Revalidation interval (months)" · _due✱ "Next revalidation due" · status {Validated, In validation, Superseded}. Seeds qual item "Process validation / revalidation (IQ/OQ/PQ)".

**operators** — name "Name" · empId "Employee ID" · role {Manufacturing operator, Design engineer, Production engineer, QC inspector, Quality manager, Packaging operator} · qualifiedFor "Qualified for (machines / processes)" (ph `e.g. EOS M 290, heat treatment`; comma-separated free text) · trainingRef✱ "Training record ref" · trainer✱ "Trained / assessed by" · qualifiedOn✱ [date] · requalMonths✱ "Requalification interval (months)" · _due✱ "Requalification due" · status {Qualified, In training, Suspended}. Seeds qual item "Operator qualification" (who = trainer).

**packaging** — name "Item name" · code "Item code" · kind "Type" {Sterile barrier pouch, Tyvek header bag, Thermoformed tray, Inner box / carton, Device label, UDI label, IFU, Insert / desiccant, Other} · spec "Size / specification" · supplier "Supplier" · lot "Current lot no." · expiry "Lot expiry" [date] · validation✱ "Packaging validation ref (ISO 11607)" · stock "In stock" · reorder "Reorder level" · status {Approved, Quarantine, Obsolete}. Stock- and expiry-tracked. Seeds qual item "Packaging validation (ISO 11607-1/-2)" when a validation ref exists (no date in seed → "No date set").

Every registry item may additionally carry: `img`, `mItems[]`, `qItems[]`, `qRecords[]`, `logs[]`, `docs[]`, `receipts[]`.

**Seed registry data**

measuring (5)
| id | name | assetId | kind | location | range | resolution | calLast | mo | calLab | certNo | status |
|---|---|---|---|---|---|---|---|---|---|---|---|
| me1 | Zeiss Contura CMM | QC-CMM-01 | CMM | QC lab | 700 × 700 × 600 mm | ±1.8 µm | 2025-11-12 | 12 | OEM calibration service | ZM-25-11871 | In service |
| me2 | Creaform HandySCAN | QC-SCN-01 | 3D scanner | QC lab | 0.05–4 m | 0.025 mm | 2025-10-08 | 12 | OEM calibration service | CF-5540 | In service |
| me3 | Mitutoyo digital caliper 150 mm | QC-CAL-04 | Caliper | Finishing bay | 0–150 mm | 0.01 mm | 2026-03-20 | 6 | NABL lab — Vadodara | NB-26-0312 | In service |
| me4 | Mitutoyo outside micrometer | QC-MIC-02 | Micrometer | QC lab | 0–25 mm | 0.001 mm | 2026-04-15 | 12 | NABL lab — Vadodara | NB-26-0444 | In service |
| me5 | Surface roughness tester SJ-210 | QC-RA-01 | Surface roughness tester | QC lab | Ra 0.02–100 µm | 0.001 µm | 2025-09-01 | 12 | OEM calibration service | MT-25-2201 | Quarantined |

postproc (5)
| id | name | assetId | kind | usedFor | capacity | validation | pmLast | pm mo | valDate | reval mo | status | usedStages |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| pp1 | Nabertherm vacuum furnace | PP-FUR-01 | Heat treatment furnace | Ti-6Al-4V stress relief | 250 × 250 × 400 mm | VAL-HT-003 | 2026-06-10 | 6 | 2025-07-20 | 24 | Available | Heat treatment & depowdering |
| pp2 | Sodick wire EDM | PP-EDM-01 | Wire EDM | Part removal from build plate | 400 × 300 × 250 mm | VAL-EDM-001 | 2026-03-02 | 6 | 2025-02-10 | 24 | In use | Support removal & finishing |
| pp3 | Glass bead blaster | PP-BLS-01 | Bead / sand blaster | Metal surface finishing | Cabinet 900 mm | VAL-BB-002 | 2026-08-01 | 3 | 2024-11-05 | 24 | Available | Support removal & finishing; Depowdering & cleaning |
| pp4 | Elmasonic ultrasonic cleaner | PP-USC-01 | Ultrasonic cleaner | Final cleaning before packaging | 28 L | VAL-CLN-004 | 2026-05-15 | 6 | 2025-09-01 | 12 | Available | Cleaning & sterilization; Depowdering & cleaning |
| pp5 | Form Cure UV station | PP-UV-01 | UV post-cure | SLA resin guides & models | Ø 140 × 185 mm | VAL-UV-001 | 2026-01-20 | 12 | 2025-04-15 | 24 | Available | Washing & post-cure |

pp1 docs: `VAL-HT-003_furnace_IQ-OQ-PQ.pdf` (Qualification report, 2025-07-20, link qual:val), `Nabertherm_VHT_manual.pdf` (Manual, 2024-02-01).

steril (4)
| id | name | code | method | provider | equipment | params | sal | standard | bi | validation | revalLast | mo | status |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| st1 | Steam prevacuum 134 °C | STE-PV-134 | Steam — prevacuum | In-house | Tuttnauer 3870 ELV | 134 °C · 4 min · 3 pulses · 20 min dry | 10⁻⁶ | ISO 17665:2024 | G. stearothermophilus BI + Class 5 CI | VR-STE-2025-02 | 2025-10-20 | 12 | Validated |
| st2 | Steam prevacuum 121 °C (polymer guides) | STE-PV-121 | Steam — prevacuum | In-house | Tuttnauer 3870 ELV | 121 °C · 20 min · 3 pulses | 10⁻⁶ | ISO 17665:2024 | G. stearothermophilus BI | VR-STE-2025-03 | 2025-11-05 | 12 | Validated |
| st3 | EtO — contract | STE-ETO-01 | Ethylene oxide (EtO) | Contract sterilizer | SteriCare Services, Ahmedabad | 55 °C · 60% RH · 4 h exposure · 12 h aeration | 10⁻⁶ | ISO 11135:2014 | B. atrophaeus BI | VR-ETO-2024-01 | 2024-12-01 | 24 | Validated |
| st4 | Gamma 25 kGy — contract | STE-GAM-25 | Gamma irradiation | Contract sterilizer | Contract gamma facility — Mumbai | 25 kGy minimum dose | 10⁻⁶ | ISO 11137-2 | Dosimeters | — | — | 12 | In validation |

components (5)
| id | name | partNo | category | size | material | supplier | lot | sterile | stock | reorder | status |
|---|---|---|---|---|---|---|---|---|---|---|---|
| co1 | Cortical screw Ø2.0 mm self-tapping | SCR-20-06 | Bone screw | Ø2.0 × 6 mm | Ti-6Al-4V ELI | Orthomed Components | OM-2608-114 | Non-sterile | 240 | 100 | Active |
| co2 | Cortical screw Ø2.0 mm self-tapping | SCR-20-08 | Bone screw | Ø2.0 × 8 mm | Ti-6Al-4V ELI | Orthomed Components | OM-2608-115 | Non-sterile | 64 | 100 | Active |
| co3 | Locking screw Ø2.3 mm | LSC-23-10 | Locking screw | Ø2.3 × 10 mm | Ti-6Al-4V ELI | Orthomed Components | OM-2607-092 | Non-sterile | 180 | 80 | Active |
| co4 | Metal drill sleeve Ø2.0 | DSL-20-12 | Drill sleeve | ID 2.05 × 12 mm | SS 316L | Precision Sleeves Pvt Ltd | PS-2605-031 | Non-sterile | 35 | 40 | Active |
| co5 | K-wire Ø1.2 mm | KW-12-150 | Guide pin / K-wire | Ø1.2 × 150 mm | SS 316L | Orthomed Components | OM-2606-077 | Sterile | 90 | 50 | Active |

tooling (5)
| id | name | toolId | kind | usedOn | material | location | lifeUnit | limit | used | status |
|---|---|---|---|---|---|---|---|---|---|---|
| tl1 | Ti build plate 250 mm #1 | TL-BP-01 | Build plate | EOS M 290 | Ti-6Al-4V | Printer room rack A | builds | 40 | 31 | In use |
| tl2 | Ti build plate 250 mm #2 | TL-BP-02 | Build plate | EOS M 290 | Ti-6Al-4V | Printer room rack A | builds | 40 | 40 | Needs regrind / resurface |
| tl3 | HSS recoater blade | TL-RB-07 | Recoater blade | EOS M 290 | HSS | Consumables cabinet | builds | 15 | 6 | In use |
| tl4 | Carbide end mill Ø6 — PEEK | TL-EM-06 | CNC cutter / end mill | Haas VF-2 CNC | Carbide | CNC tool crib | hours | 30 | 12 | Available |
| tl5 | Cranial plate CMM fixture | TL-FX-03 | Inspection fixture | Zeiss Contura CMM | Aluminium | QC lab | cycles | — | — | Available |

software (5)
| id | name | vendor | purpose | version | installed | validation | validatedOn | review mo | licence | status |
|---|---|---|---|---|---|---|---|---|---|---|
| sw1 | MySegmenter | MySegmenter Technology | Segmentation | 3.2.0 | 3.2.0 | SV-SEG-2026-01 | 2026-02-10 | 12 | 6 seats | Validated |
| sw2 | 3-matic | Materialise | Implant / guide design | 18.0 | 18.0 | SV-CAD-2025-04 | 2025-09-15 | 12 | 3 seats | Validated |
| sw3 | Magics | Materialise | Build preparation / slicer | 27.0 | 28.0 | SV-BP-2025-02 | 2025-06-01 | 12 | 2 seats | Validation pending |
| sw4 | Fusion CAM | Autodesk | CAM programming | 2.0.19 | 2.0.19 | SV-CAM-2026-01 | 2026-01-12 | 12 | 1 seat | Validated |
| sw5 | Calypso | Zeiss | Inspection / metrology | 2024 | 2024 | SV-MET-2025-01 | 2025-11-20 | 24 | 1 seat | Validated |

params (8)
| id | name | code | process | machine | material | layer | keyParams | validation | validatedOn | reval mo | status |
|---|---|---|---|---|---|---|---|---|---|---|---|
| ps1 | Ti-6Al-4V ELI — implants 30 µm | PPS-DMLS-TI-01 rev B | DMLS / LPBF | EOS M 290 | Ti-6Al-4V ELI | 30 µm | 280 W · 1200 mm/s · 140 µm hatch | PQ-DMLS-2025-03 | 2025-10-01 | 12 | Validated |
| ps2 | BioMed Clear — surgical guides | PPS-SLA-BMC-01 rev A | SLA | Formlabs Form 3B+ | BioMed Clear Resin | 100 µm | Default BMC profile · 60 min UV cure @ 60 °C | PQ-SLA-2025-01 | 2025-08-12 | 12 | Validated |
| ps5 | PETG / PLA — anatomical models | PPS-FDM-PETG-01 rev A | FDM | Ultimaker S5 | PLA / PETG | 180 µm | 0.4 mm nozzle · 240 °C · bed 80 °C · 20% gyroid | OQ-FDM-2026-01 | 2026-01-15 | 24 | Validated |
| ps6 | PA12 — SLS prototypes | PPS-SLS-PA12-01 rev A | SLS | EOS Formiga P 110 | PA12 Nylon | 100 µm | Balanced · 50% refresh · 172 °C bed | OQ-SLS-2025-02 | 2025-12-02 | 24 | Validated |
| ps3 | PA12 — anatomical models | PPS-MJF-PA12-01 | MJF | HP Jet Fusion 5200 | PA12 Nylon | 80 µm | Balanced mode · 20% refresh | OQ-MJF-2026-01 | — | 12 | In validation |
| ps7 | CoCr — dental frameworks 20 µm | PPS-DMLS-COCR-01 rev A | DMLS / LPBF | EOS M 290 | CoCr (ASTM F75) | 20 µm | 195 W · 800 mm/s · 100 µm hatch | OQ-DMLS-2023-02 | 2023-09-14 | 24 | Validated |
| ps8 | PEEK-OPTIMA — implant milling | PPS-CNC-PEEK-01 rev A | CNC milling | Haas VF-2 CNC | PEEK-OPTIMA | — | 12 000 rpm · 0.05 mm finishing step · dry cut | PQ-CNC-2024-03 | 2024-06-20 | 36 | Validated |
| ps4 | Stress relief Ti-6Al-4V | PPS-HT-TI-01 | Heat treatment | Nabertherm vacuum furnace | Ti-6Al-4V ELI | — | 800 °C · 2 h · vacuum · furnace cool | VAL-HT-003 | 2025-07-20 | 24 | Validated |

operators (4)
| id | name | empId | role | qualifiedFor | trainingRef | trainer | qualifiedOn | requal mo | status |
|---|---|---|---|---|---|---|---|---|---|
| op1 | Ravi Patel | JM-E014 | Manufacturing operator | EOS M 290, wire EDM, heat treatment | TR-2025-031 | Production manager | 2025-11-02 | 12 | Qualified |
| op2 | Neha Shah | JM-E022 | QC inspector | CMM, 3D scanner, final inspection | TR-2025-044 | Quality manager | 2025-10-10 | 12 | Qualified |
| op3 | Arjun Mehta | JM-E031 | Design engineer | MySegmenter, 3-matic, Magics | TR-2026-007 | Engineering lead | 2026-02-18 | 24 | Qualified |
| op4 | Pooja Desai | JM-E037 | Packaging operator | Pouch sealing, labelling, autoclave loading | TR-2026-015 | Quality manager | — | 12 | In training |

packaging (5)
| id | name | code | kind | spec | supplier | lot | expiry | validation | stock | reorder | status |
|---|---|---|---|---|---|---|---|---|---|---|---|
| pk1 | Tyvek/film pouch 150 × 250 | PKG-PCH-150 | Sterile barrier pouch | 150 × 250 mm, steam & EtO | FlexiPack Medical | AM-26-4410 | 2029-03-31 | PV-PCH-2025-01 | 1200 | 500 | Approved |
| pk2 | PETG thermoformed tray — cranial | PKG-TRY-CR | Thermoformed tray | 220 × 180 × 40 mm | TrayForm Plastics | NP-26-0922 | — | PV-TRY-2025-02 | 140 | 100 | Approved |
| pk3 | Device label 70 × 40 (UDI) | LBL-DEV-7040 | UDI label | 70 × 40 mm, autoclavable | LabelTech Consumables | ZB-26-118 | 2027-12-31 | LV-LBL-2025-01 | 3000 | 1000 | Approved |
| pk4 | IFU — patient-specific implants rev C | IFU-PSI-C | IFU | A5 folded, EN/HI | In-house print | IFU-2609 | — | — | 220 | 100 | Approved |
| pk5 | Tyvek header bag 300 × 400 | PKG-HB-300 | Tyvek header bag | 300 × 400 mm | FlexiPack Medical | AM-26-3921 | 2026-11-30 | PV-HB-2024-02 | 80 | 150 | Quarantine |

### 3.8 GRN (goods receipt note)
```
GRN { id, no, date (received on), supplierId (Vendor.id), po, poDate?, invoice, invoiceDate?, dn, dnDate?, receivedBy, condition,
      extra: { [customFieldKey]: value }, received: boolean (false = draft), docs: [{ id, name, kind }],
      lines: GRNLine[], log: [{ date, by, text }] }
GRNLine { id, type: 'material'|'component'|'packaging'|'part'|'calibration'|'equipment'|'other',
  itemId, lotMode: 'new'|'existing', lot (own lot ID), lotId (existing Lot.id for top-ups), supLot (supplier batch), qty, expiry, coa,
  partKeys: string[] ('caseId:idx'), ref (supplier CoC ref),              // part
  mItemId, cert, calDate,                                                 // calibration
  cat: 'tooling'|'measuring'|'postproc'|'steril', mode: 'existing'|'new', newName, newAsset,   // equipment
  desc, unit,                                                             // other
  extra: { [extraFieldKey]: value },
  checks: boolean[] (legacy seed format), tests: { [checkId]: { n, res: string[] } },
  rejQty, decision: ''|'Accepted'|'Rejected'|'Quarantine', reason, inspBy, inspOn, testSummary }
```
**Seed GRNs (4)**
- `g31` **GRN-2026-0031**, 2026-07-14, supplier v1, PO-2026-118, INV-PA-7781, DN-44120, received by Ravi Patel, "Packaging intact", received. Docs: CoA-TI-88540.pdf (CoA), DN-44120.pdf (Delivery note). Line gl1: material m1, new lot TI64-2407-B, qty 5, exp 2028-07-31, CoA-TI-88540, checks all true, **Accepted**, inspBy Dr. Meera Iyer (QA) 2026-07-15. Log: 2026-07-14 Ravi Patel "Receipt confirmed — 1 line"; 2026-07-15 Dr. Meera Iyer (QA) "Line 1 accepted — TI64-2407-B · 5 kg added to stock".
- `g41` **GRN-2026-0041**, 2026-09-28, supplier v5, PO-2026-162 (poDate 2026-09-02), INV-TP-2231 (2026-09-25), DN-TP-0928 (2026-09-26), Ravi Patel, "Packaging intact", received. Doc CoA-TI-90112.pdf (CoA). Lines: gl2 material m1 new lot TI64-2609-C qty 10 exp 2028-09-30 CoA-TI-90112, undecided; gl3 material m6 new lot COCR-2609-01 qty 3 exp 2028-09-30 CoA-CC-4602, undecided. Log: "Receipt confirmed — 2 lines". → status **Awaiting inspection**.
- `g42` **GRN-2026-0042**, 2026-09-29, supplier v9, PO-2026-165, INV-FP-9910, DN-FP-1102, Pooja Desai, received. Lines: gl4 packaging pk5 lot AM-26-5120 qty 200 exp 2029-06-30, Accepted by Neha Shah 2026-09-29; gl5 packaging pk1 lot AM-26-5188 qty 300 exp 2029-08-31, checks [T,T,F,F], **Quarantine**, reason "Seal-strength test on 3 samples pending". Log: 3 entries. → **Partly inspected**.
- `g43` **GRN-2026-0043**, 2026-09-30, supplier v7, PO-2026-170, DN-NB-771, not received (**Draft**). Line gl6: calibration, itemId me3, mItemId `m-seed`, cert NB-26-0977, calDate 2026-09-27.

### 3.9 GRN configuration (`grnCfg`, default from `grnDefaults()`)
```
{ prefix: 'GRN', sep: '-' ('-'|'/'|'none'), year: true, pad: 4 (3|4|5),
  header: [{ k, label, type: 'text'|'number'|'date'|'select', show, req, custom?, opts? }],
  types: { <lineType>: { on, label, checks: [{ id, label, spec, n (pieces), rt: 'passfail'|'yesno', minPass ('' = all), req }], extra: [{ k, label, type, opts, req }] } },
  lotId: { mode: 'auto'|'manual', format, pad (2–6), scope: 'type'|'global', codes: { material, component, packaging } },
  rules: { allChecks: true, inspDays: '3', supplier: 'warn'|'block', reasonReq: true },
  conditions: 'Packaging intact, Minor outer damage — contents OK, Damaged — see notes, Temperature excursion',
  docKinds: 'Delivery note, CoA, Invoice, Certificate, Inspection report, Other' }
```
Default header fields (order): `po` "PO no." (text, shown, **required**) · `poDate` "PO date" (date) · `invoice` "Invoice no." (text) · `invoiceDate` "Invoice date" (date) · `dn` "Delivery note no." (text, **required**) · `dnDate` "Delivery date" (date) · `receivedBy` "Received by" (text, **required**) · `condition` "Delivery condition" (select, options from `conditions`) · `x_vehicle` "Transporter / AWB no." (text, **hidden**, custom).

Default line types and acceptance tests (`label — spec — pieces — result type — min pass`), all `req: true`:
| type key | label | tests |
|---|---|---|
| material | Raw material | CoA review — Grade & chemistry per ASTM F3001 / supplier spec — 1 — Pass/Fail · Quantity check — Matches PO / delivery note — 1 — Yes/No · Packaging & seals — Intact, no damage or moisture — 1 — Yes/No · Label check — Lot no. and expiry visible and legible — 1 — Yes/No |
| component | Standard component | Part / catalogue no. — Matches PO — 1 — Yes/No · Visual inspection — No burrs, damage or discoloration — **5** — Pass/Fail · Dimensional check — Thread Ø and length per drawing — **3** — Pass/Fail · Label, lot & expiry — Present and legible — 1 — Yes/No |
| packaging | Packaging & labelling | Item code & size — As per specification — 1 — Yes/No · Seal strength (peel test) — ≥ 1.5 N / 15 mm (ASTM F88) — **3** — Pass/Fail · Barrier integrity (visual) — No pinholes, tears or delamination — **10** — Pass/Fail — **min pass 8** · Label, lot & expiry — Present and legible — 1 — Yes/No |
| part | Outsourced part / service return | Part ID match — Matches PO and part IDs — Yes/No · Supplier CoC / certificate — Received and signed — Yes/No · Visual inspection — No transport damage — Pass/Fail · Incoming inspection form — Completed on the part — Yes/No |
| calibration | Calibration return | Certificate received — Accredited lab (NABL / ISO 17025) — Yes/No · Certificate matches instrument — Asset ID / serial no. — Yes/No · Results within tolerance — Per instrument tolerance — Pass/Fail · Calibration label — Attached with next due date — Yes/No |
| equipment | Equipment / tooling | Delivered complete — Accessories and manuals per PO — Yes/No · Serial / asset no. — Recorded — Yes/No · Transport damage — None — Pass/Fail · IQ planned — Installation qualification scheduled — Yes/No |
| other | Other (not stock-tracked) | Quantity — Matches delivery note — Yes/No · Visual — No damage — Pass/Fail |

Type chip colours (bg / text): material `#FFF1EB/#C4320A`, component `#EFF8FF/#175CD3`, packaging `#F0FDF9/#107569`, part `#F4F3FF/#5925DC`, calibration `#FDF2FA/#C11574`, equipment `#FFFAEB/#B54708`, other `#F2F4F7/#344054`.

Default lot ID: mode auto, format `{TYPE}-{YYYY}-{SEQ}`, pad 4, scope `type`, codes `RM` / `CP` / `PK`.

### 3.10 Archive and audit log
```
ArchiveEntry { id, kind: 'workflows'|'printers'|'materials'|'vendors'|'res:<registryKey>', name, archivedOn, archivedBy, reason,
               delReq: null | { by, on, reason }, item: <full snapshot of the record> }
AuditLogEntry (arcLog) { id, date, kind (same domain as above, or 'grn'), name, event, by, detail }
```
Seed archive: `ar1` printers "Formlabs Form 2" (archived 2026-03-15 by Ravi Patel, reason "Decommissioned — replaced by Form 3B+"; snapshot: id p9, SLA, asset PR-SLA-00, serial F2-11873, Formlabs Form 2, "Polymer lab (removed)", commissioned 2021-06-10, status Out of service, qualDate 2021-07-02, requal 12, 2 logs, 1 doc `Form2_decommissioning_record.pdf`) · `ar2` materials "Vero PureWhite (trial)" (archived 2025-12-01, reason "Trial only — never qualified", **deletion requested** by Ravi Patel on 2026-09-20: "Trial material, no parts produced — no record retention needed"; snapshot: m9, Material jetting, Resin, Evaluation, kg, one lot VPW-2507-T 0.4/1, Local distributor, CoA-VPW-001, exp 2026-07-31).
Seed arcLog: al1 2025-12-01 materials Archived · al2 2026-03-15 printers Archived · al3 2026-09-20 materials "Deletion requested".

Audit events written by the code: `Archived`, `Restored`, `Deletion requested`, `Request cancelled`, `Permanently deleted`, `Qualification recorded`, `Added to machine`, `Removed from machine`, `Stock adjusted`, `Goods received`, `Goods accepted`, `Goods rejected`, `Goods on hold`. The Audit screen additionally merges machine `qualLog`, parameter-set `history` and change-control reviews (see §4.13).

### 3.11 Part-ID format (state only; screen not rendered)
`idPrefix: 'JM'`, `idSep: '-'`, `idTokens: ['PRODUCT','CASE_SEQ','PART_SEQ']` → preview `JM-CRANIO-0428-01`.
Token library: `{PRODUCT}` Product code e.g. CRANIO · `{CASE_SEQ}` Case number e.g. 0428 · `{PART_SEQ}` Part sequence e.g. 01 · `{PART_TYPE}` Part type code e.g. IMP · `{MATERIAL}` Material code e.g. TI64 · `{YYYY}` Year · `{MM}` Month · `{SPACE}` Company space code e.g. JM. Separator choices: `-`, `_`, `.`, none. Prefix: uppercased, no spaces, max 8 chars. Tokens can be reordered left/right, removed, added once each.

### 3.12 Relationships (as implemented)
- Workflow.method → Technology.name · Workflow.vendorId → Vendor.id (vendor options limited to kind `Outsourced manufacturing`).
- Printer.process → Technology.name · Printer.materialId → Material.id.
- Params.machine → Printer.name or post-processing equipment name (**string match**) · Params.material → Material.name (**string match**).
- Printer.valParams[].psId → params registry id; `.scope[]` → PartType.name; `.supplier` → vendor name text.
- Operator ↔ machine: `operator.qualifiedFor` free text **contains** the machine name (case-insensitive). Printer.opRefs[operatorId] stores a machine-specific training ref.
- Lot.supplier / component.supplier / packaging.supplier / measuring.calLab / steril.equipment / software.vendor → Vendor.name (string match for the vendor "Supplied items" tab).
- GRN.supplierId → Vendor.id; GRNLine.itemId → Material / component / packaging / measuring / (tooling|measuring|postproc|steril) item; GRNLine.lotId → Lot.id; GRNLine.partKeys → parts.
- Lot.grnId → GRN.id; registry `receipts[].grnId` → GRN.id.
- Tooling.usedOn → machine/equipment name (text). Postproc.usedStages → stage names (text).
**[inferred]** the real app should replace the name-string joins with foreign keys.

### 3.13 Status vocabularies
- Printer stored status: Available, In use, Maintenance, Out of service. Effective (displayed) status, first match wins: `Down — breakdown` (red; an un-voided `Breakdown / repair` log with `status 'Open'` and sev `Machine down`) → `Out of service` (grey) → `Maintenance` (amber) → `Maintenance overdue` (red; any maintenance item overdue) → `Qualification overdue` (red; any qualification item overdue or last result Fail) → `Printing` (blue; a part in the snapshot with `printer === name && printing`) → `In use` (blue) / `Available` (green).
- Registry status colour: GOOD = {In service, Available, Validated, Active, Approved, Qualified, In use} → green (In use → blue); WARN = {In validation, On hold, Quarantine, Maintenance, In training, Validation pending, Needs regrind / resurface} → amber; {Retired, Obsolete, Superseded} → grey; anything else → red. Overrides when the stored status is GOOD: `<DueWord> overdue` (red), `<qLabel> failed` / `<qLabel> overdue` (red), `Lot expired` (red), `End of life` (red).
- Schedule item status: `Failed` (red) · `Overdue` (red) · `Due soon` (amber, ≤30 days) · `Scheduled` (green) · `Completed` (green, no due but has last) · `No date set` (grey).
- Material stock: `Out of stock` (red, qty ≤ 0) · `Low stock` (amber, qty < threshold) · `In stock` (green).
- Vendor displayed status: `Evaluation failed` / `Re-evaluation overdue` (red) override; else Approved (green), Trial (amber), other (red).
- GRN status: `Draft` (grey) · `Received — no lines` (amber) · `Awaiting inspection` (amber) · `Partly inspected` (blue) · `Closed` (green) · `Closed — with rejections` (amber).
- GRN line badge: `Draft` / `To inspect` / `Quarantine` (amber) / `Released` (stock types, accepted) / `Partly accepted` (accepted with rejQty>0) / `Accepted` (non-stock) / `Rejected` (red).
- Lot register status: `Released`, `Released (part rejected)`, `Used up`, `Expired`, `Quarantine`, `On hold`, `Rejected`, `Draft GRN`, `Released (before GRN)`.
- Validated parameter set (effective): `Validated`, `In validation`, `Draft`, `Suspended`, `Withdrawn`, `Expired`, `Review required`, `Revision changed`.
- Qualification result: `Pass`, `Pass with remarks`, `Fail`.

### 3.14 Consumed: `partsSnap[]` (from Parts/Cases)
Fields read: `pid` (part ID), `name`, `partType`, `caseId`, `idx`, `wfName`, `stage` (current stage name), `stageIdx`, `last` (index of final stage), `stageAt[]` (timestamps per stage, e.g. "Sep 28"), `requestedOn`, `caseState` (archived/cancelled excluded), `assignee`, `due`, `sourcing`, `printer` (name), `material` (name), `printing` (bool), `queued` (bool), `done` (bool), `lot`, `date` (build date), `formsPending[]`, `uses[]`.
`uses[]` = one row per QA-form field that selected a master-data item: `{ src, value, qty?, code?, form, field, stage?, status?, by?, at? }` where `src` ∈ `printers, postproc, measuring, tooling, steril, materials, lots, components, packaging, vendors, operators, params, software` and `value` is the library label (see §3.15).

### 3.15 Provided: `onValSync(payload)` — master data for Cases / QA forms
```
{ mode: 'warn'|'block'|'off',                     // "Material check when recording material used on a part"
  map: { [printerName]: materialName[] },           // materials with a currently usable (effective 'Validated') parameter set
  machines: { [printerName]: { simple: true, qualOk, qualMsg, sets: [{ id, name, rev, material, scope[], supplier, eff }] } },
  lotSup: { [lotNo]: supplierName },
  libs: { printers[], postproc[], measuring[], tooling[], steril[], materials[], lots[] ('<lot> — <material>'), components[], packaging[],
          vendors[], operators[] ('<name> — <role>'), params[] ('<name> · <code>'), software[] ('<name> <version>'), techs[], partTypes[] },
  details: { [src]: { [label]: { rows: [label, value][], warn: string, vars: {...} } }, paramsMM: { '<machine>|<material>': paramsLabel } } }
```
`details` gives, for every selectable item, an info card + a **warning string** the QA form should show, e.g. "`<status>` — do not use for production", "Machine qualification: …", "Life limit reached — regrind, resurface or retire", "Status is …", "Calibration overdue — …", "Installed version X is not the validated version Y", "Lot expired YYYY-MM-DD", "Out of stock", "Material qualification overdue — …", "Lot expired … — quarantine, do not use", "Lot is used up (0 remaining)", "Supplier status is Trial — not on the approved list", "Supplier evaluation overdue — …", "Person is in training — not yet qualified", "Requalification overdue — …", "Parameter set is in validation — not validated", "Revalidation overdue", and for quarantined GRN lots "In quarantine — GRN-… awaiting incoming inspection" (availN 0). `vars` carries merge fields (assetId, serial, status, qualStatus, nextMaintenance, availN, unit, number, coa, supplier, received, expiry, material, grn, grade, stock, name, role, code, validationRef, keyParams) — **[inferred]** used for auto-filling QA/eBMR form fields.

---

## 4. Screens, layouts and workflows

### 4.1 Workflows — list (`workflows`)
- Header: h2 "Production workflows"; sub "Click a workflow to view or edit its stages. Each carries its own ordered stages." Right: view toggle + dark button "New workflow" (plus icon).
- Table columns: **Workflow · Method · Stages** (e.g. "9 stages"). Empty: "No workflows yet. Create one to define its production stages."
- Card view: icon tile, name, "N stages", flow string `Stage → Stage → …`, grey pill (shows the method), stage count; left border 3 px.
- **New workflow**: creates `{ name 'New workflow', method = first technology (fallback '3D Printing'), sourcing 'In-house', vendorId '' }` with two stages — "Request received" (Manufacturing, no forms) and "Packaging & dispatch" (Logistics, form `Labelling & packaging check`) — and opens it.

### 4.2 Workflow — detail
- "Back to list"; card with **Workflow name** (input), **Manufacturing method** (select of technologies), red-outline button **"Archive workflow"** (opens archive dialog).
- Section "Status stages" — "Each stage shows the quality forms, emails, tasks, expected time and owner applied to it. Click Edit on a stage to change them." + button "Add stage".
- Stage card (border `#E4E7EC`, turns `#F97066` when open): number badge (26 px circle, `#FFF1EB`/`#C4320A`), name (input when open), ▲ / ▼ move buttons (disabled + 0.4 opacity at ends), **Edit / Done** toggle, remove (×) button.
  - Collapsed read-only summary grid: **Quality forms** (chips or "None") · **Email notifications** ("→ Advance" chips, "← Back" chips) · **Stage tasks** (`1. name +Nd`) · **Expected time** ("N working day(s)" / "Not set") · **Owner** (role / "Assign later").
  - Expanded editor:
    - "Quality forms" — "Forms the operator completes at this stage." chips with × + select "+ Add form" (only forms not yet added).
    - "Email notifications" — "Sent automatically when a part moves into or out of this stage." two groups: "→ On advancing to next step" and "← On moving back a step", each with chips + select "+ Add email".
    - "Stage tasks" (count) — "Tasks auto-created when a part reaches this stage, in sequence. Due offset is days from stage start." rows: number, "Task name" input, days number input + "d", remove; button "+ Add task" (new task: name '', days '1').
    - "Expected time to complete" — "Working days from stage start. Drives the part due date." number input + "days".
    - "Assigned role" — "Default owner for this stage, or assign a user later." select: "— Assign later —" + ROLES.
- Actions: `addStage` appends `{ name 'New stage', role 'Manufacturing', … }` and opens it; move up/down swaps adjacent stages; remove deletes immediately (no confirmation); all edits apply live (no Save button anywhere in this component).
- Only one stage can be open at a time (`openStage`).
- Not in UI: sourcing (In-house/Outsourced) and vendor pickers — the handlers `onSourcing`/`onVendor` and `vendorOpts` exist but no control is rendered.

### 4.3 Printers — list (`printers`)
- Header: h2 "Printers & machines"; sub "Identity, qualification, maintenance and build history for every machine. Live status comes from parts in production."; setting **"Material check when recording material used on a part"** select: `Warn if not validated on the machine` (warn, default) / `Block if not validated on the machine` (block) / `Off` (off) → broadcast via `onValSync.mode`. Right: view toggle + "+ Add machine".
- Summary cards (4): **Machines** (count) · **Available** (effective green) · **Printing now** · **Maintenance due / overdue** (`n (k overdue)`, red if any overdue, amber if due).
- **Alert panel** (red-tinted card): title "`N alert(s) need attention · K critical`", shows first 5, toggle "Show all (N)" / "Show less". Row: level pill (`Critical` red / `Due soon / action` amber), machine name, text, button "Open" (or "Review"). Sources: open breakdown ("Breakdown open since <date> — <note>"), out-of-tolerance calibration without impact assessment, each maintenance item overdue/soon ("<item> — overdue by N days (date)"), each qualification item failed/overdue/soon, each pending change-control review ("Change-control review pending — <type> on <date>", button "Review"). Clicking opens the machine on the relevant tab.
- Search: "Search name, asset ID, serial, technology…" (matches name, assetId, serial, tech, process, maker, model, location).
- Table columns: **Machine** (36 px photo or placeholder, name, `assetId · S/N serial`) · **Technology** (tech + process) · **Now** ("Printing <pids>" / "Idle" + "N part(s) in queue" / "Queue empty") · **Next maintenance** (date + "Due in N days"/"Overdue by N days") · **Status** pill. Empty: "No machines match your search."
- Card view: photo 52 px, name, id line, "tech · process", now text, status pill, "PM <date>" + relative.
- **+ Add machine**: `{ name '', tech 'DMLS', process = first technology, materialId '', volume '', status 'Available', quals all 'Not started', cals [], logs [], docs [] }`, opens Overview.

### 4.4 Printer — detail (tabs: Overview · Qualification `N · k due` · Maintenance `N` · Build history `N` · Documents `N`)
Header: eyebrow "PRINTER / MACHINE", name, id line `assetId · S/N serial · maker model`, status pill, **Archive** button.

**Overview**
- Photo block (140×100): "Upload photo" / "Replace photo" (accept image/*; client resizes to max 640 px, JPEG q 0.85, stored as data URL), "Remove".
- Fields: Machine name · Asset ID (ph `e.g. PR-DMLS-01`) · Serial number · Manufacturer · Model · Location · Technology (TECHTYPES) · Process (technologies) · Default material ("None" + materials) · Build volume (ph `e.g. 250 × 250 × 325 mm`) · Commissioned on (date) · Status (Available / In use / Maintenance / Out of service).
- **Qualified operators** — "Kept in sync with Operator Qualifications — adding or removing here updates the person's "Qualified for"." Button "+ Add operator" (opens dialog). Table: **Person** (name; `empId · machine training ref · N docs`) · **Role** · **Qualified on** · **Requalification** (date · relative) · **Status** (`Qualified` green / `Requal overdue` red / other amber) · × (remove → strips the machine name from the person's `qualifiedFor`, audit "Removed from machine"). Empty: "No qualified operators for this machine yet — add one above."
- **Live status** — "Parts printing on or waiting for this machine — updated from part stages." pill title: "Printing <pids>" / "Blocked — maintenance overdue" / "Maintenance" / "Out of service" / "Idle — ready for the next build". Table: **Part ID · Part · Case · Stage · Status** (`Printing` blue / `Waiting` grey). Empty: "No parts printing or waiting for this machine."

**Add qualified operator dialog** — title "Add qualified operator — <machine>"; "Search people from Operator Qualifications. Adding updates their "Qualified for"." Search "Search by name, employee ID or role…"; radio list of people not yet qualified on this machine (name, `empId · role`, "Qualified for: …" / "No machines yet", status pill). Empty: "No matching person. Add them first in Operator Qualifications." After picking: "Optional — machine-specific training record for <name>": "Training / qualification reference" (ph `e.g. TR-2026-012 — EOS M 290 operation`), "+ Upload training record / certificate". Footer: link "Manage people in Operator Qualifications ›", Cancel, **Add operator** (disabled look until a person is picked). Effect: appends machine name to `qualifiedFor`; stores ref in `printer.opRefs`; files become printer docs (kind `Training record`, link `op:<id>`); audit "Added to machine" ("Listed as qualified operator · <ref> · N document(s)").

**Qualification tab**
- Amber banner "Change control — review required" when pending: rows `date · <type> — note` with buttons **"No impact — close"** and **"Requalification required"**. For printers the second outcome is stored as "Revalidation required" and also sets every `Validated` parameter set on the machine to `Suspended` (history entry "Suspended — Change control: <type> on <date> — revalidation required").
- **Qualification schedule** — "IQ, OQ, PQ, process validations or any other qualification — add it with its due date, then Record it with the PDF report when done." Button "+ Add item" → inline form: Item (ph `e.g. OQ — Operational qualification, PQ — Ti-6Al-4V implants`), Next due date, Repeat every (months) (ph Optional), Cancel / **Add** (needs a name).
  - Table: **Item** (name + "Last result: Pass" / "Not yet performed") · **Next due** (`date · due in N days`) · **Repeat** ("Every N mo" / "One-time") · **Last done** · **Status** · buttons **Edit/Done**, **Record**.
  - Edit row: Item, Next due date, Repeat every (months), "Remove item".
  - Record form: Done on (date, default today) · Done / approved by (ph `Name, role`) · Result (Pass / Pass with remarks / Fail) · Report ref no. (ph `e.g. PQ-DMLS-2026-01`) · Notes · "+ Upload PDF / report" (accept .pdf,image/*; multiple) · hint "Next due will be set to <date>" / "One-time item." · Cancel / **Save record** (needs date + who).
  - Save: appends a QualRecord, sets item `last`, `res`, `due = date + months` (or '' if one-time), adds uploaded files as docs (`Qualification report`, linked to the record), writes audit "Qualification recorded" (`<result> · <ref> · N document(s)`).
  - Empty: "No qualification items yet — click "+ Add item"."
  - Default items when none stored: "IQ — Installation qualification" (one-time), "OQ — Operational qualification", "PQ — Performance qualification" (OQ/PQ repeat every `requalMonths`, due = qualDate + requalMonths when Completed), plus "Process validation — <parameter set name>" per approved non-withdrawn validated parameter set.
- **Qualification records** — "Saved records with their reports (also listed in the Documents tab). Past qualifications stay here." Columns **Date · Item · Done by · Result · Report ref · Notes · Documents**. Empty "No qualification recorded yet."

**Maintenance tab**
- **Maintenance schedule** — "Add an item with its next due date. When it's done, click Record, attach the PDF report and save — the record is kept below." "+ Add item" (ph `e.g. Preventive maintenance, laser calibration, filter change`). Same table/edit pattern: **Item · Next due · Repeat · Last done · Status**. Default items when none stored: "Preventive maintenance" (pmLast + pmMonths) + one per `cals` entry.
- Record form: Done on · Done by (ph `Name / service provider`) · Notes (ph `What was done (optional)`) · **Affects validation?** (No / Yes — review) · "+ Upload PDF / report" · hint ("Next due will be set to …" / "One-time item — set a new due date afterwards if needed.") · Save record. Save: prepends a log `{ type 'Maintenance', itemId, itemName, who, note, cc, status 'Closed' }`, updates item last/due, adds docs (`Maintenance record`, link `log:<id>`). `cc: 'yes'` opens a change-control review on the Qualification tab.
- **Maintenance records** — "Saved records with their uploaded reports (also listed in the Documents tab)." Columns **Date · Item · Done by · Notes (+ change-control line) · Documents**. CC line: "Change control — review pending (Qualification tab)" (amber) / "Change control closed — <outcome>" (green). Empty "No maintenance recorded yet."

**Build history tab**
- "Build history" — "Parts assigned to this machine, pulled live from Parts — use for traceability, NCRs and recalls." counter "`N parts · K built`". Columns **Part ID · Part · Case · Material lot · Build date · Current stage**. Empty "No parts have been assigned to this machine yet."
- "Recorded in quality forms" — "Every QA-form entry where this machine was selected (e.g. build record, print batch record)." = Usage-records block (§4.9) with empty text "Not selected in any quality form yet."

**Documents tab** — "Manuals, SOPs, validation reports, service reports and certificates." Kind select + "+ Upload files" (multiple). Rows: file icon, name (button, no-op), kind, **source** ("Uploaded in Documents" / "Maintenance · <type date>" / "Qualification · <item>" / "Parameter set · <name>" / "Operator training · <name>" + " (superseded <date>)"), date, × remove (only for free uploads) or a "Record" tag (title "Managed in the Qualification tab") for linked evidence. Empty "No documents attached."

### 4.5 Materials — list (`materials`)
- h2 "Material inventory"; "Stock is tracked by lot / batch with full traceability. Click a material to manage its lots." + view toggle + "+ Add material".
- Alert panel (same component): qualification items failed/overdue/soon; stock "`Low stock — 0.3 kg in stock (threshold 2)`"; lot "Lot X expired <date> — quarantine" (critical) / "Lot X expires <date>" (≤ 60 days).
- Table: **Material** (colour dot + name) · **Tech** · **In stock** (`2.7 kg`) · **Lots** (`2 lots`) · **Status** pill. Card view equivalent.
- "+ Add material": `{ name '', process first tech, tech 'DMLS', grade 'Metal', use '', unit 'kg', threshold '1', color '#6B7785' }`.

### 4.6 Material — detail (tabs: Overview · Lots & stock `N` · Material qualification `N` · Usage records `N` · Documents `N`)
Header eyebrow "MATERIAL", name, Archive.
- **Overview**: Material name · Process · Technology · Grade (Metal/Resin/Polymer/Ceramic) · Clinical use (ph `e.g. Implantable (ISO 10993)`) · Unit of measure (kg/g/L/ml/spool/sheet/unit) · Low-stock threshold (number, step 0.1) · Swatch colour (7 swatches, 30 px, selected ring `#101828`). Block "Validated on machines" — "From approved parameter sets on each machine's Qualification tab." rows: machine · `<set name> · <rev>` · date · `scope · supplier` · status pill (click → printer Qualification tab). Empty "Not validated on any machine yet." Also a "Receipts (GRN)" block when any exist (§4.9).
- **Lots & stock**: two stat cards — "In stock" (`qty unit`, note "Above threshold of N unit" / "<state> — reorder") and "Consumed to date" ("received minus remaining, across all lots"). Section "Lot / batch inventory" — "Each incoming batch is stored with its CoA and traceability number." button **"+ Receive via GRN"**.
  - Table: **Lot / batch # · Remaining · Received · Recv date · Supplier · CoA / trace # · Expiry · (remove)**. Every cell is an inline input; inputs are **disabled when the lot came from a GRN** (`l.grn` set). Supplier select options = vendor names with status ≠ 'Disqualified' + any supplier names already on lots ("— select —").
  - Under the lot number: GRN link label (`GRN-2026-0031 + <top-up GRNs> · batch <supLot> · N unit rejected`), button "± Adjust stock", button "⟲ Lot log" (→ lot register with this lot selected). Under Remaining: "− X unit used in QA forms (<pid qty>, …) → Y unit left" when parts consumed from it.
  - **Stock adjustment** inline: quantity (ph `e.g. -0.2`), reason (ph `Reason — spill, scrap, stock count…`), "Save adjustment" / Cancel. Validation toast "Enter a +/− quantity and a reason". Effect: remaining = max(0, remaining + q) rounded to 3 dp; appends `adjs`; audit "Stock adjusted" (`±q unit · reason`); toast "Stock adjusted — logged in the audit trail". History line "Adjustments: +q unit (reason, by, date) · …".
  - Empty: "No lots yet — receive the first batch with "+ Receive via GRN"."
  - Below: pending GRN lines for this material as rows `lot · qty · GRN no · ⏳ Quarantine — awaiting inspection — not in stock yet` / `⏳ On hold — <reason> — not in stock yet` (click → GRN).
  - **+ Receive via GRN**: creates a draft GRN (number `GRN-<year>-<max+1, 4 digits>`, receivedBy = user, condition "Packaging intact") with the add-line form pre-opened for this material, and navigates to it.
- **Material qualification**: generic schedule/records block (§4.9), hint "Material qualification, biocompatibility (ISO 10993) and periodic powder / resin testing — add with a due date, then Record it with the test report or CoA."
- **Usage records**, **Documents**: generic (§4.9).

### 4.7 Technology (`tech`) and Part types (`types`)
- **Manufacturing technology** — "Fabrication processes used by workflows, printers and materials. Counts update as you link them." Table: **Type · Materials · Printers · Workflows · (remove)** with counts ("5 materials", "1 printer", …). Remove is disabled (opacity 0.3, title "In use — unlink first") while any material/printer/workflow references it. Add row: input (ph `e.g. Laser Cutting`) + "Add technology" (Enter also adds). Rules: trimmed, non-empty, case-insensitive unique. No rename.
- **Part types** — "Categories of deliverable, chosen when a part is requested." Table: **Part type · Code · (remove)**, both cells inline-editable; code forced uppercase, max 6 chars. Add row (ph `e.g. Cutting guide`) + "Add part type" (Enter also adds); auto code = first 3 letters uppercased. Remove is immediate, no in-use check.

### 4.8 Vendors (`vendors`)
- List: h2 "Approved suppliers & vendors"; "Outsourced manufacturers, material and component suppliers, calibration labs, sterilization contractors and packaging suppliers." "+ Add supplier". Alert panel from evaluation items. Table: **Supplier** (name + contact) · **Type · specialty** · **Location** · **Lead** (`8 days`) · **Status**.
- New vendor: `{ kind 'Outsourced manufacturing', status 'Trial', everything else '' }`.
- Detail (eyebrow "SUPPLIER / VENDOR"; tabs Overview · Supplier evaluation `N` · Supplied items `N` · Usage records `N` · Documents `N`):
  - Overview fields: Supplier type (8 kinds) · Supplier name · Specialty (ph `e.g. Metal DMLS · Ti / CoCr`) · Location · Contact email · Typical lead time (days) · Status (Approved / Trial / Suspended).
  - Supplier evaluation: schedule/records, hint "Supplier evaluation, audits and certificate checks (ISO 13485 §7.4) — add with a due date, then Record it with the evaluation form or audit report."
  - Supplied items — "Material lots, components, packaging, services and outsourced workflows linked to this supplier — pulled live from the other pages." Columns **Type · Item · Detail · Date · Open**. Row types: `Material lot`, `Component`, `Packaging`, `Calibration service`, `Sterilization service`, `Software`, `Goods receipt` (`GRN no · PO …`, "N line(s) · k accepted · j rejected · partial rejections · draft"), `Outsourced workflow`. Empty: "Nothing linked to this supplier yet. Pick it as the supplier on a material lot, component or packaging item."

### 4.9 Registries — list and detail (9 keys, §3.7)
**List**: h2 title + description; view toggle; add button (label per registry). Summary cards (4), by type:
- has maintenance + qualification tabs (measuring, postproc, steril): **Equipment** · **Ready to use** · **Maintenance due / overdue** · **Qualification due / overdue**.
- due-tracked (software, params, operators): **Total** · **Ready to use** · **`<DueWord>` due ≤ 30 days** · **`<DueWord>` overdue** (DueWord = Review / Revalidation / Requalification).
- life-tracked (tooling): **Total** · **Ready to use** · **Nearing end of life (≥ 80%)** · **End of life reached**.
- stock (components, packaging): **Total items** · **Usable** · **Below reorder level** · **On hold** (components) / **Expired / expiring ≤ 90 days** (packaging).
Alert panel (maintenance items, qualification items, pending change control). Search (matches any field value). Table: 4 configured columns + **Status**; column 1 shows photo (if any), name, sub-id (assetId / partNo / code / toolId / empId / vendor); column 4 shows value + coloured sub-line (next due + "Due in N days", stock "`64 pcs` / Below reorder level (100)", life "`31 / 40 builds` / 78% used"). Empty "Nothing matches your search."
**Add**: creates a blank record (selects default to first option) and opens it.

**Detail**: eyebrow, name, status pill, Archive; tabs per config; single-line alert banner when applicable ("`<DueWord>` overdue by N days — do not use until … is completed." / "… due in N days (date)." / "Current lot has expired — quarantine and replace before use." / "Stock is below the reorder level — raise a purchase request." / "Life limit reached — regrind, resurface or retire before next use." / "Tool is nearing its life limit (…).").
- **Overview**: optional photo block ("JPG or PNG — shown on cards and in the list."), configured fields (inputs/selects/read-only computed), and a **"Receipts (GRN)"** block — "Every delivery of this item — stock only changes when a GRN line is accepted." rows `GRN no · date · lot/cert · qty · status` (Accepted/Released/… green; "Awaiting inspection", "On hold — …", "Draft GRN" amber; "Rejected — …" red) → opens the lot log or the GRN.
- **Maintenance / Calibration tab**: "`<Label>` schedule" + "`<Label>` records" — identical to §4.4 Maintenance. Empty texts "No `<label>` items yet — click "+ Add item"." / "No `<label>` recorded yet."
- **Qualification tab** (label per registry): change-control banner (outcomes stored as "No impact on validated state" / "Requalification required"); schedule + records identical to §4.4. Hints: operators "Training, competency assessments and requalification — add each with its due date, then Record it with the training record or certificate."; software "Software validation (ISO 13485 §4.1.6) and periodic reviews — add with a due date, then Record it with the validation report."; components "First-article / incoming inspection and supplier CoC checks — add with a due date, then Record it with the inspection report."; packaging "Sterile barrier validation (ISO 11607): seal strength, integrity, accelerated / real-time ageing — add with a due date, then Record it with the report."; default "IQ, OQ, PQ, process validations or any other qualification — add it with its due date, then Record it with the PDF report when done."
  - Recording on the seeded item also writes back the legacy field (e.g. measuring `calLast`; on non-Fail results `validatedOn`/`revalLast`/`qualifiedOn` and the ref field).
- **Usage records**: "Every quality-form entry where this item was selected — generated automatically from the QA forms filled on parts." KPI tiles **Records · Parts · Cases · Last recorded**; search "Search part ID, part, case, form or person…" + "`N of M records`"; table **Part ID · Part (+type) · Case · Recorded in (form code · form; field → lot · qty) · Stage · Form status (pill: Approved/Done/Completed green, Rejected red, Draft/Open grey, other blue) · By · when**. Empty: "Not recorded in any quality form yet. Add a "Dropdown" field with this library as its source in QA Form Setup, then fill the form on a part." / "No records match your search."
- **Documents**: as §4.4 Documents.

### 4.10 GRN — list (`grn`)
- h2 "Goods receipt notes (GRN)"; "Receive → incoming inspection → accept into stock. Materials, components, packaging, outsourced parts, calibration returns and equipment." Orange button **"+ New GRN"**.
- KPI buttons (click = status filter toggle): **Awaiting inspection** (count of Awaiting + Partly inspected; sub "`N line(s) to inspect`") · **Drafts** ("Receipt not confirmed yet") · **Closed** ("All lines decided") · **Rejected lines** ("Counted in supplier evaluation"; no filter).
- Search "Search GRN, supplier, PO, invoice…" + "`N of M receipts`".
- Table: **GRN** (number mono + "PO …") · **Date** · **Supplier** (+ red "Not approved") · **Lines** ("2 lines · 1 accepted · 1 pending") · **Item types** · **Status**. Empty "No receipts match."
- **+ New GRN**: number = prefix [+ year] + zero-padded (max existing trailing number + 1), joined by separator; `date today`, `receivedBy = user`, `condition = first configured condition`, draft; placed first; opens on Overview.

### 4.11 GRN — detail
"‹ All receipts". Header: eyebrow "GOODS RECEIPT NOTE", number, "`<supplier> · <date> · PO … · N line(s)`", status pill, **"Delete draft"** (drafts only; toast "`<no> draft deleted`").
- Draft banner: "Draft — goods not received into the system yet" + hint + orange **"Confirm receipt"**. Hints in priority order: "Select a supplier first." → "Supplier is not approved — receipt is blocked by GRN setup." → "Fill required fields on Overview: a, b." → "Add at least one line." → "Complete every line (item, lot and quantity)." → "Everything is ready — confirm to send the lines to incoming inspection." Failure toasts: "Supplier not approved — receipt blocked" / "Fill: …" / "Complete the supplier and every line first". Success: `received = true`; log "Receipt confirmed — N line(s) sent to incoming inspection"; audit "Goods received"; toast "`<no>` received — lines are in quarantine until inspected".
- Supplier warning strip (⚠): "Select the supplier this delivery came from." / "`<name>` is "`<status>`" — not on the approved supplier list. Accepting goods needs QA justification." / "`<name>` — supplier evaluation is overdue."
- Tabs: **Overview · Lines & inspection `N` · Documents `N` · History `N`** (default tab when opened from the list: Lines).
- **Overview**: Supplier (select; Approved first; label `name · kind (status)`), Received on (date), then every shown header field from setup (required ones suffixed " *"); PO / invoice / DN in mono.
- **Lines & inspection**: one card per line — number badge, type chip, title (item name / part IDs / "`<name>` (new)" / description), sub-line (Lot ID, supplier batch, exp, CoA, …), "Reason: …", "`<decision>` by `<who>` · `<date>`", "Received q · rejected r · released s unit", "Results: <test summary>"; right: decision pill, "Lot log", **Inspect / Re-inspect / Close**, **Edit / Done**, ×.
  - Edit/remove allowed until a line is decided or on hold; inspect allowed only after receipt is confirmed and the line is not Accepted/Rejected.
  - "No lines yet — add what arrived in this delivery." Footer "+ Add a line — what arrived?" with one pill per enabled type ("+ Raw material", …); hidden when the GRN is closed.
  - **Line form by type**:
    - material: Item (select `name · tech`, hint "Stock now X unit · N lot(s)") · toggle **New lot / Add to existing lot** · "Lot ID (auto)" preview "`<next id>` (assigned on add)" or manual "Lot ID" · "Supplier batch no." · "Existing lot" select (`lot · X unit left`) · "Quantity received (unit)" · Expiry · "CoA no."
    - component / packaging: Item (`name · partNo/code`, hint "Stock now N pcs · current lot X") · Lot ID (auto/manual) · Supplier batch no. · "Quantity received (pcs)" · Expiry.
    - part: "Parts returned (outsourced parts first)" toggle chips of active parts (`pid · stage · outsourced`) · "Supplier CoC / certificate ref" (ph `e.g. CoC-MM-2231 or sterilization cert.`).
    - calibration: Item (measuring instrument `name · assetId`) · "Calibration item" (its maintenance items, `name · due date`) · "Certificate no." · "Calibrated on".
    - equipment: Category (Tooling & fixtures / Measuring equipment / Post-processing equipment / Sterilization equipment) · toggle **Existing item / + New item** · Item select, or "New item name" (ph `e.g. Ti build plate 250 mm #3`) + "Asset / tool ID".
    - other: Description (ph `e.g. IPA 99% — 5 L cans`) · "Qty · unit".
    - plus any configured extra fields (text/number/date/dropdown).
    - Buttons Cancel / **Add line**. Validation toast "Fill the item, lot and quantity first". Line-complete rules: material → item + (existing lot or lot ID or auto mode) + qty > 0; component/packaging → item + lot (or auto) + qty > 0; part → ≥ 1 part; calibration → item + calibration item; equipment → new name or existing item; other → description; and all required extra fields filled. Auto lot ID is assigned at "Add line".
  - **Inspection panel** "Incoming inspection — acceptance tests and release": counters "`k / n tests passed · f failed`" + "Overall: PASS / FAIL / in progress". Grid **Inspection / test · Specification · Pieces observed (click to set result) · Result**. Each test: label (+ "(optional)"), rule text ("Pass / Fail · all 3 must pass" / "pass if ≥ 8 of 10" / "single check"), piece buttons `#1 —` cycling blank → Pass/Yes → Fail/No → blank, "+ piece", "−", "All Pass"/"All Yes", result pill "Pass (3/3)" / "Fail (1/3)" / "2 / 3 done".
    - "Notes / reason (required to hold or reject)" (ph `e.g. CoA grade mismatch — return to supplier`).
    - Stock types (material, component, packaging, other): "Quantity received" · "Rejected quantity" input · "Release to stock" (= received − rejected).
    - Effect text per type (e.g. "Release adds the released quantity to lot X on the material's Lots & stock tab. Rejected quantity never enters stock and is recorded against the supplier.").
    - Buttons **Reject** · **Hold (quarantine)** · primary **"Release `<q unit>` to stock"** / "Reject all" / "Accept".
  - **Decision rules** (toasts): not received → "Confirm the receipt first"; accept with rejected > received → "Rejected quantity is more than received"; accept with rejected ≥ received → converted to Rejected; accept with incomplete required tests → "Record a result for every piece of each required test first"; accept with a failed test and no rejected quantity → "A test has failed — enter the rejected quantity, or reject / hold the line"; accept with rejected qty but no reason → "Enter the rejection reason for the N rejected"; reject/hold without reason (when `reasonReq`) → "Enter a reason for rejection" / "… for the hold". A test passes when all pieces have a result and passes ≥ `minPass` (default all); it fails as soon as fails exceed `n − need`. With rule `allChecks` off only tests marked Req. must pass.
  - On decision: line gets `decision`, `inspBy`, `inspOn`, `testSummary` ("`<test>` PASS (3/3): #1 Pass, #2 Pass… \| …"); GRN log + audit (`Goods accepted` / `Goods rejected` / `Goods on hold`) + toast with the same sentence, e.g. "Line 1 accepted · Ti-6Al-4V ELI · released 5 kg to stock".
  - **Accept effects** (`applyLine`): material new lot → creates Lot `{ lot, supLot, remaining = received = released qty, rejQty, date = GRN date, supplier = vendor name, coa, expiry, grn, grnId }`; material top-up → adds qty to the lot's received & remaining, appends `tops`; component/packaging → stock += qty, current lot/expiry/supplier updated, `receipts` entry (status "Released" or "Released q · rejected r"); calibration → sets the instrument's maintenance item last = calDate, due = +months, adds a log ("Certificate X · received on GRN…"), a doc `<cert>.pdf` (Calibration certificate) and a receipt "Calibration returned"; equipment new → creates the registry item with an "Installation qualification (IQ)" qualification item due in 1 month and receipt "New equipment"; equipment existing → receipt "Received"; part → `onPartCmd('advance|<GRN no>|<keys>')` ("GRN logged on the part(s) and each moved to its next stage (if its current-stage forms are approved)").
- **Documents**: kind select (configured document types) + "+ Upload files"; rows name · kind · ×. Empty "No documents yet — attach the delivery note and CoA."
- **History**: newest first `date · by · text`. Empty "Nothing recorded yet."

### 4.12 Lot register (`grnlots`) and GRN setup (`grnsetup`)
**Lot register — list**: h2 "Lots"; "Search any lot ID, supplier batch, CoA or GRN to see its full history — receipt, inspection, release, every part made from it, adjustments and expiry (ISO 13485 §7.5.9 traceability)." Search "Lot ID, supplier batch, CoA, GRN, item…" + "`N of M lots`". Columns **Lot ID · Item (+kind) · Supplier · batch · GRN · Expiry · Remaining · Status**. Empty "No lots match." Rows come from: all material lots; GRN lines of stock types not yet released; component/packaging receipts and their current lots ("Released (before GRN)").
**Lot trace — detail** ("‹ All lots"): eyebrow "LOT TRACE", lot ID (mono 20 px), "`item · kind`", status pill; facts **Supplier · Supplier batch · CoA · GRN · Expiry**; quantity tiles **Received · Rejected · Used in parts · Remaining**.
- "Lot log" table **# · Date · Event · Details · Reference · Qty · Balance · By** — chronological events: `Draft receipt` / `Received` / `Received (top-up)` (+qty) · `Incoming inspection` · `Released to stock` / `Released — part rejected` (−rejected) · `Rejected` · `On hold (quarantine)` · `Recorded (before GRN)` (opening stock) · `Stock adjusted` · `Used in production` (−qty; "part name · form code form → field"; ref = part ID) / `Item used (item-level record)` · `Earlier consumption` (balancing row "Used before part-level tracking (from stock records, not linked to a part)") · `Expiry date` / `Expired` · `Used up`. Running balance shown for material lots.
- "Parts made from this lot" — "`N part record(s)` · Total used: X unit" — table **Part ID · Part name · Case · Recorded in (QA form) · Used on · Qty used · By · Current stage · Open ›** (opens the part via `onPartCmd('part:…:info','parts')`). Empty "Not used in any part yet."

**GRN setup**: h2 "GRN setup"; "Configure numbering, receipt fields, which item types can be received, their inspection checklists and extra fields, and the acceptance rules. Changes apply to new and open GRNs straight away." Button "Reset to defaults" (toast "GRN setup reset to defaults"). Sections:
1. **GRN number** — Prefix (uppercased, no spaces) · Separator (Dash - / Slash / / None) · Digits (3/4/5) · switch "Include year" · read-out "Next number".
2. **Lot ID** — "Your own lot ID for everything received (the supplier's batch no. is kept separately). Build any format from fixed text and tokens — generic like IIR001, or by what was received like RM-2026-0001." Quick-start presets: "Generic — IIR001" (`IIR{SEQ}`, 3, global) · "Generic — LOT00001" (`LOT{SEQ}`, 5, global) · "By type — RM-2026-0001" (`{TYPE}-{YYYY}-{SEQ}`, 4, type) · "By type & month — RM2609-001" (`{TYPE}{YY}{MM}-{SEQ}`, 3, type). Fields: Lot ID mode (Auto-assign / Manual entry) · Format (ph `e.g. IIR{SEQ}`) · Digits (2–6) · Running number (One sequence for everything / Separate sequence per item type). Token help: `{TYPE}` item-type code · `{YYYY}` year · `{YY}` short year · `{MM}` month · `{SEQ}` running number (added at the end if missing). Table **Received as · Type code ({TYPE}) · Next lot ID** for Raw material / Standard component / Packaging & labelling (codes A–Z0–9 uppercase).
3. **Receipt fields (GRN header)** — "Supplier and received date are always shown. Rename, show / hide, make required, reorder, or add your own fields." Columns **Field name · Type ("Text · built-in" / "Dropdown · custom") · Dropdown choices · Show · Required · ↑ ↓ ×** (× only for custom). Add row: name (ph `New field name, e.g. Gate entry no.`), type (Text / Number / Date / Dropdown), choices, "+ Add field" (toast "Enter a field name").
4. **What can be received — acceptance tests** — "Turn line types on or off, rename them, and customize each one's inspection checklist and extra fields (e.g. storage location, temperature on arrival, sample size)." Per type: enable switch, label input, summary "`4 acceptance tests · 0 extra fields · hidden`", "Customize"/"Close". Expanded: tests grid **Inspection / test · Specification · Pieces · Result (Pass / Fail | Yes / No) · Pass criteria (min pieces, blank = All; helper "Single check — pass/fail is the result" / "Pass if ≥ 8 of 10 pieces pass" / "Pass only if all N pieces pass") · Req. · ↑ ↓ ×**; add (ph `New test, e.g. Temperature on arrival`) "+ Add test". "Extra fields on this line": label, type, Req. switch, ×, choices; add (ph `e.g. Storage location`) "+ Add field"; "No extra fields."
5. **Acceptance rules** — switch "Every test must meet its pass criteria to accept (off = only tests marked "Req."). A failed test blocks full release — enter a rejected quantity, hold or reject." · switch "Reason is required to hold or reject a line" · "Inspect within (days)" · "Supplier not approved" (Warn only / Block receipt).
6. **Lists** — "Delivery condition choices" and "Document types" (comma-separated text).

### 4.13 Audit log (`audit`)
h2 "Audit log"; "Read-only, time-stamped record of archive, restore and deletion approvals, machine qualification, parameter-set validation and change-control reviews." Counter "`N of M entries`". Filters: search "Search record, detail or person…" · Module ("All modules") · Event type ("All event types") · From date · To date. Table **Date · Module · Event · Record · details · By**, newest first. Empty "No audit entries match these filters."
Rows = `arcLog` + each printer's `qualLog` (module "Machine qualification") + each validated-parameter-set history (module "Parameter-set validation", record "`<machine> · <set>`") + change-control ("Change control": "Review opened" / "Review closed"). Module names: Goods receipt, Manufacturing workflows, Printers & machines, Materials, Suppliers & vendors, or the registry title. Event pill colours: red = Permanently deleted / Suspended / Withdrawn; amber = requested / Revalidation / opened / started; green = Restored / Approved / Reinstated; blue = closed; else grey.

### 4.14 Archive / restore / permanent delete (all archivable kinds)
- **Archive dialog**: "Archive "`<name>`"?" — "It will be removed from active lists and selections. All its data, history and documents are kept in the Archived list, and you can restore it at any time." Field "Reason for archiving" (ph `e.g. decommissioned, replaced by new model`, **required**). Cancel / **Archive**. Effect: record removed from the active array, full snapshot stored in `archive`, audit "Archived" with the reason, back to list.
- **Archived list** (toggle "Archived (n)"): h2 "Archived `<kind title>`"; "Archived records keep all their data, history and documents and are hidden from active lists and selections. Restore them at any time, or delete permanently through an approved request." Columns **Record (name + first 3 field values) · Archived (date, by) · Reason · Status (`Archived` grey / `Deletion pending approval` amber) · Actions**. Actions: "View record"/"Hide record" (read-only key/value dump: humanised field names; arrays shown as "`N entries (kept)`"; "Archived: date · by"), **Restore** (back to active list; audit "Restored — Returned to active list"), **"Request permanent deletion"**, and when pending: **"Cancel request"** (audit "Request cancelled — Permanent deletion request withdrawn") + **"Approve deletion"**.
  - Request form: "Reason for permanent deletion" (ph `e.g. retention period ended — records no longer required`), "Requested by" (prefilled with user), Cancel / "Submit for approval" (both required) → audit "Deletion requested".
  - Pending strip: "**Deletion requested** by X on D — reason. Needs approval from a different person before anything is deleted."
  - Empty: "Nothing archived here yet. Use "Archive" on a record to move it here." Footer: "Every archive, restore and deletion action is recorded in the Audit Log (Quality › Audit Log)."
- **Approve deletion dialog**: "Approve permanent deletion — "`<name>`"" — "This erases the record and all its data (`<N logs, M docs…>`). It cannot be undone. Only a log entry — name, dates, requester, approver and reason — is kept as the audit trail." Shows Requested by / Reason. Fields: "Approved by (must be a different person from the requester)" (ph `Name, role`) · "Type the record name to confirm" (ph = the name) · checkbox "I approve that all data of this record — including its history, qualification and validation records, and documents — can be permanently deleted." Hint: "Enter the approver, type the exact record name and tick the confirmation." / "The approver must be a different person from the requester." / "All checks passed — the data will be erased." Cancel / red **"Delete permanently"**. Effect: archive entry removed; audit "Permanently deleted" by the approver with detail "Requested by X on D (reason) · archived D by Y · erased: …".

### 4.15 Production control (`control`) — sub-tabs Parts `N` · Live resources `k not ready` · Due & compliance
Top row: pill tabs (selected = dark) + quick links: **"+ New part request"** (orange; `onPartCmd('newpart','parts')`), **Parts**, **Cases**, **Tasks**, **Quality records** (→ `onNavigate`).
KPI row (hidden on Due tab): **New requests** ("`N blocked`" / "all ready to start") · **In progress** ("Across N cases") · **Late / at risk** (`L / R`, "Against the due date") · **Building now** ("N machines") · **Machines not ready** ("Down, overdue or out of service") · **Compliance items** (overdue + critical count; "overdue / critical · N due this week") → switches to Due tab.

**Parts tab**
- "New part requests" — "Checked automatically: owner, due date, machine status, validated parameter set and material stock." counter "`N waiting · K blocked`". Columns **Part ID · Part (name; type · material · case) · Waiting ("Today"/"N days", red if > 3) · Due · Risk · Readiness · Owner · actions ("Assign me", "Open")**. Readiness: "✓ Ready to start" / "✓ Ready · `<warnings>`" / "Blocked — `<blockers>`". Empty "No new requests waiting."
  - Blockers: "No owner", "No due date", (in-house only) "No machine", "`<machine>`: `<status>`" when red or out of service, "No parameter set for `<material>` on `<machine>`", "`<material>` out of stock". Warnings: "`<machine>` in maintenance", "Parameter set `<effective status>`", "`<material>` low stock".
  - Risk: "No due date" (grey) · "Late Nd" (red) · "At risk" (amber: ≤ 2 days left or fewer days than remaining stages) · "On track" (green).
- "In progress — by stage" — "Most urgent first in each column. Red border = late. Click a card to open the part." + "Bottleneck: `<phase>` — N part(s), avg Nd in stage". Five kanban columns by phase (stage-name regex): **Design & prep** (`#7A5AF8`), **Build** (`#E24E1B`), **Post-processing** (`#F79009`), **Inspection & QC** (`#2E90FA`), **Clean, sterile & pack** (`#12B76A`); header shows count and "avg Nd in stage"/"empty". Card: part ID + risk pill, name, stage, owner ("Unassigned" amber), "Nd here" (red ≥ 4), "⚠ blockers" (first two phases only), "N form(s) to approve".

**Live resources tab**
- "Printers & machines — live" — "What each machine is building, its queue and whether it is ready to use." cards with coloured left stripe: name, `tech · assetId`, status pill, "Building `<pids>`"/"Not building", "`N queued · next <pid>`"/"Queue empty", "Qualified · maintenance due in N days" (red if not qualified or overdue).
- Four equipment groups (Post-processing · Measuring & inspection · Sterilization · Tooling & fixtures): header "`N · k need attention`"/"all ready"; rows name, status (`Ready` / `Maintenance overdue` / `Qualification overdue` / stored status / `End of life` / `Near life limit`), next item "`<item> · due in N days`" or "`31 / 40 builds used`".
- "Materials — stock vs. demand" — "Parts waiting = active parts using this material that have not been built yet." **Material · In stock (+ "reorder at N") · Parts waiting · Expiring ("N lot(s) ≤ 90 d") · Status**.
- "Supplies to act on" — "Standard components and packaging that are low or expiring." **Item · Issue**. Empty "Nothing needs attention."
- "Process — parameter sets" — "Sorted by active parts that depend on each set." **Parameter set · Machine · material · Active parts · Next reval. · Status** (Validated / Revalidation soon / Revalidation overdue / stored status).
- "Software" — "Validated vs. installed version and periodic review." **Software · Version (`27.0 → 28.0`) · Status** (Validated / Version mismatch / Review overdue / stored).
- "People — workload & qualification" — "Active parts owned by each person, and whether their qualification is current." link "`N active part(s) without an owner`". **Person · Qualified for · Workload (bar = 20% per part, max 100%; green < 2, amber 2–3, red ≥ 4) · Late · Status** (Qualified / Requalification due / Not in operator list / stored).

**Due & compliance tab**
- KPI filter cards: **Critical** ("Breakdowns, failed results, expired or out of stock") · **Overdue** ("Past the due date") · **Due ≤ 7 days** ("Plan this week") · **Due ≤ 30 days** ("Plan this month") · **Action needed** ("Reorder, reviews, tool life").
- "Due by week — next 12 weeks" — "Scheduled maintenance, calibration, qualification and evaluations." 13-bar chart: "Late" (red `#F04438`), "This wk" (`#F79009`), then week-start labels "6 Oct" (`#E24E1B`); weeks start Monday.
- "By area" — "Click an area to filter the list." **Area · Overdue · Soon · Next due**. Areas: Goods receipt, Printers & machines, Post-processing, Measuring equipment, Sterilization, Tooling & fixtures, Software, Process parameters, Operators, Materials, Suppliers, Components, Packaging.
- "Due list": window chips **Overdue & urgent / Next 7 days / Next 30 days (default) / Next 90 days / All scheduled**; search "Search item, equipment, asset ID…"; selects "All areas", "All types" (Incoming inspection (GRN) · Maintenance & calibration · Qualification & validation · Stock, expiry & tool life · Breakdowns & change control); "Clear filters"; "`N of M items`". Columns **Status · Due (date / "Since date" + relative) · Item (+ "type · last done date") · Equipment / record (+id) · Area · Open**. Empty "Nothing due in this window — try "All scheduled"."
- Items collected: every maintenance and qualification schedule item with a due date or Fail result (all machines, registries, materials, vendors); open breakdowns ("Breakdown — note", Critical); open change-control reviews (Action "Review"); tool life ("Life limit reached — …" Critical "End of life" / "Nearing life limit — …" Action "Plan regrind"); stock below reorder (Action "Reorder"); lot expiry within 90 days (Critical "Expired" when past); material out of stock (Critical) / low (Action); draft GRNs (Action "Confirm receipt"); undecided GRN lines ("Line N — incoming inspection" / "on hold: reason", due = GRN date + `inspDays`).
- Status ranking: Critical(0) → Overdue(1) → Due ≤ 7 days(2) → Action(3) → Due ≤ 30 days(4) → Scheduled(5) → Not scheduled(6); then by days.

---

## 5. Computed values and business rules (summary)

1. **Due dates**: `due = last + N months` (calendar months). Relative label: "Overdue by N day(s)" (<0), "Due today", "Due in N day(s)". Classification: overdue (<0), soon (≤ 30 days), ok. Colours `#B42318` / `#B54708` / `#475467|#667085`.
2. **Recording an event** on a schedule item sets `last = done date` and `due = done date + repeat months` (blank for one-time items).
3. **Material stock** = Σ over lots of `max(0, remaining − quantity consumed in QA forms)`, where consumption is summed from `partsSnap[].uses[]` with `src 'lots'` and value "`<lot> — <material>`". Consumed to date = Σ received − stock. Displayed to 1 dp. Component/packaging stock = `stock − consumed (src components|packaging, value = item name)`.
4. **Low stock**: qty ≤ 0 → Out of stock; qty < threshold → Low stock. Component/packaging low when stock < reorder.
5. **Lot expiry alerts**: material list ≤ 60 days; control tower and registries ≤ 90 days; lots with 0 remaining ignored.
6. **Tool life**: `% = used / lifeLimit`; ≥ 80% "nearing end of life"; ≥ 100% "end of life"; no limit → "No life limit".
7. **Machine qualification state** (`qualState`): OK only if at least one qualification item has a last date and none is overdue or failed; message "`<item>` failed" / "`<item>` overdue" / "no qualification recorded".
8. **Validated parameter set effective status**: stored `Validated` becomes `Revision changed` (registry code ≠ validated rev) → `Expired` (revalidation date passed) → `Review required` (machine has a pending change-control log). A material is *usable on a machine* only if some set is effectively `Validated`. Default scope by tech: DMLS/SLM/Billet → Implant; SLA → Surgical guide, Jig; SLS/MJF → Anatomical model, Prototype; FDM → Anatomical model, Jig, Prototype.
9. **Change control triggers**: a log with `cc 'yes'`, or (`cc` not 'no' and type ∈ Software update, Major component replacement, Relocation), without a `review`.
10. **GRN number**: `[prefix][sep][year][sep][seq padded]`; seq = highest trailing number among existing GRNs + 1.
11. **Lot ID**: format string with tokens; next sequence = highest number among all known lot IDs matching the format's regex (per type code when scope = type; year/month tokens bind to the current period, so sequences restart each year/month) + 1.
12. **GRN status** derives from `received` and line decisions (§3.13). GRN lines are "in quarantine" (not in stock, exposed to QA forms with `availN 0` and a warning) until Accepted.
13. **Inspection deadline**: GRN date + `inspDays` (default 3).
14. **Workflow stage summaries**: "N quality form(s) · N email(s) · N task(s) · N day(s) · Owner: role".
15. **Technology in-use rule**: cannot delete while referenced by any material, printer or workflow.
16. **Part type code**: uppercase, ≤ 6 chars; default = first 3 letters.
17. **Operator–machine sync**: adding/removing on a machine edits the operator's `qualifiedFor` text.
18. **Kanban phase mapping** from stage name: stage 0 → Request; `design|segment|plan|prep|nest|slic|cam|queued|sent to vendor` → Design & prep; `print|machin|build` → Build; `heat|support|depowder|finish|post|wash|cure|cleanup|remov` → Post-processing; `inspect|qc|test` → Inspection & QC; `clean|steril|pack|dispatch|label` → Clean, sterile & pack; fallback Design & prep.
19. **Days in stage** = today − timestamp of entering the current stage (`stageAt[stageIdx−1]`, or `requestedOn` for stage 0).

---

## 6. Backend / integration implications
- **File uploads**: photos (image, resized client-side to ≤ 640 px JPEG); documents on machines, registry items, materials, vendors, GRNs; evidence attached to maintenance/qualification/training records. The prototype stores **file names only** and the "open document" action is a no-op → real storage, download/preview and versioning ("superseded" evidence) are needed.
- **Audit trail**: append-only log with actor, date, module, event, detail; filters by module/type/date/text. Entries "cannot be edited or removed".
- **Two-person approval** for permanent deletion (requester ≠ approver, typed-name confirmation, acknowledgement). Approver/requester are typed names — **[inferred]** should become authenticated users / e-signature. "Done / approved by" fields on records are also free text.
- **Email notifications** per workflow stage (on advance / on move back) — templates referenced by name; no sending logic here.
- **Auto-created tasks** per stage with day offsets; **expected working days** per stage "drives the part due date" — consumed by the Parts/Tasks modules.
- **Quality forms** referenced by name with a document code (`QAC (JM-F-DND-004)`); "QA Form Setup" (another module) can define "Dropdown" fields whose source is one of the libraries in `onValSync.libs`; usage and stock consumption flow back via `partsSnap[].uses`. This is the hook for eBMR/DHR-style records ("device history record", "build record", "print batch record" are mentioned in copy). No BMR/eBMR template is defined in this file.
- **Inventory**: GRN-driven stock receipts, lot traceability (ISO 13485 §7.5.9), manual adjustments with reasons, supplier performance (rejections "counted in supplier evaluation").
- **Cross-module commands**: advance parts on GRN acceptance; open/assign parts; create a part request.
- **Standards referenced in copy** (labels only): ISO 13485 §4.1.6, §7.4, §7.4.1, §7.4.3, §7.5.9, §7.6; ISO 10993(-1); ISO 11607(-1/-2); ISO 17665; ISO 11135; ISO 11137-2; ISO 17025/NABL; ASTM F3001, F2924, F75, F88.
- No import, export, print or PDF-generation feature exists in this file.

---

## 7. Visual design tokens
**Fonts**: `IBM Plex Sans` (400/500/600/700) for UI; `IBM Plex Mono` (400/500/600) for IDs, lot numbers, dates, quantities. Fallback `system-ui, sans-serif`.
**Type scale (px)**: 10.5 (table headers, uppercase, 700, letter-spacing 0.5) · 11 (eyebrows 700 / letter-spacing 0.8; field labels 600 uppercase letter-spacing 0.5, colour `#475467`) · 11.5 (pills, sub-lines) · 12 / 12.5 (secondary text, small buttons) · 13 (body, inputs, buttons) · 13.5 (table rows) · 14 (card titles h3, 700) · 15 (page h2, 700) · 16 (detail title) · 18–26 (KPI numbers, 700). Weights: 600 dominant, 700 headings/numbers, 400 body.

**Colours**
| Token | Hex | Role |
|---|---|---|
| Brand orange | `#E24E1B` | Primary CTA (GRN buttons, "+ New part request"), active tab underline, switch on, chart bars, icon accents |
| Brand orange dark | `#C4320A` | Selected tab text, eyebrows, mono IDs/links |
| Brand tints | `#FFF1EB`, `#FFF6F2`, `#FBD5C5`, `#F97066` | Selected backgrounds, intro banner, open-stage border |
| Ink | `#101828` | Text, dark buttons, selected chips, toast |
| Grey 700 / 600 / 500 / 400 | `#344054` / `#475467` / `#667085` / `#98A2B3` | Secondary text, labels, placeholders |
| Borders | `#D0D5DD` (inputs, outline buttons), `#E4E7EC` (cards), `#EAECF0` (dividers), `#F2F4F7` (row lines, neutral fills) |
| Surfaces | `#FFFFFF`, `#F9FAFB` (table header), `#FCFCFD` (zebra), `#EEF0F3` (segmented track) |
| Success | text `#067647`, bg `#ECFDF3`, border `#ABEFC6`/`#75E0A7`, tint `#F6FEF9`, solid `#12B76A` |
| Warning | text `#B54708`, bg `#FFFAEB`, border `#FEDF89`/`#FEC84B`, solid `#F79009` |
| Danger | text `#B42318`, bg `#FEF3F2`, border `#FECDCA`/`#FDA29B`, tint `#FFFBFA`, solid `#F04438`/`#D92D20` |
| Info | text `#175CD3`, bg `#EFF8FF`, solid `#2E90FA` |
| Neutral pill | text `#475467`, bg `#F2F4F7` |
| Extra accents | violet `#5925DC`/`#F4F3FF`/`#7A5AF8`, teal `#107569`/`#F0FDF9`, pink `#C11574`/`#FDF2FA` |

**Pills / badges**: `padding 3px 9px; radius 999px; 11.5px/600; nowrap` with the 5 tones green/amber/grey/blue/red (bg/text pairs above). Small variant `2px 8px; 11px`. Tab count badge: `1px 6px`, `#F2F4F7`/`#475467`, 10.5 px.
**Radii**: 7–9 (buttons, inputs; 8 is the norm), 10–12 (inner cards, tiles), 14 (section cards, modals), 999 (pills), 13 (26 px number circles).
**Spacing**: page column gap 20; section gap 14–16; card padding `18px 20px` / `18px 22px` / 22; table cell `10px 12px`–`12px 18px`; grid gaps 10–12; label→control gap 5; inline gaps 6–8.
**Shadows**: selected segment `0 1px 2px rgba(16,24,40,.1)`; modal `0 20px 40px rgba(16,24,40,.2)`; toast `0 12px 30px rgba(16,24,40,.25)`. Cards are flat (border only).
**Controls**: inputs/selects 38 px high (34 compact, 40 on workflow header), border `#D0D5DD`, radius 8, padding `0 10px`, 13 px. Buttons: primary orange 36 px radius 9 weight 700; dark (`#101828`) 36–38 px weight 600; outline 32–36 px border `#D0D5DD`; destructive outline border `#FDA29B` text `#B42318`; destructive solid `#B42318`; icon buttons 30–32 px. Disabled look = `opacity 0.45` (0.35–0.4 for arrows) — buttons stay clickable but no-op. Switch 36×20 track, 16 px knob, on = `#E24E1B`, off = `#D0D5DD`.
**Tabs**: (a) segmented pills on a grey track; (b) underline tabs in detail headers — 42 px high, 13 px/600, 2 px bottom border `#E24E1B`, selected text `#C4320A`; (c) dark pill tabs (control dashboard, due-window chips) selected `#101828`/white.
**Tables**: CSS-grid rows inside a bordered card (radius 14, overflow hidden); header row `#F9FAFB`, 10.5 px uppercase grey; rows are full-width buttons with bottom border `#F2F4F7`; status pill in the last column.
**Cards in card-view**: border `#E4E7EC`, 3 px coloured left border (status colour), radius 12. Control-tower machine cards: 4 px left stripe.
**Icons**: inline stroke SVGs (24-unit viewBox, stroke 1.6–2.4, round caps; Feather/Lucide style): factory (intro), list/grid toggles, plus, chevrons, × close, file, image placeholder, printer, layers (material), truck (vendor), warning triangle, and one per registry (ruler, flame, flask, pencil/edit, box, wrench, monitor-code, sliders, user-check). Text glyphs are also used: ‹ › ↑ ↓ × ✓ ⚠ ⏳ ⟲ ± ▲ ▼.
**Images**: thumbnails 36 px (table) / 52 px (card), detail photo 140×100, radius 8–10, `object-fit: cover`.

---

## 8. Stubbed, inconsistent or unfinished
1. **Large blocks of logic have no UI.** `renderVals()` computes, but the template never renders: the structured machine qualification flow (sub-nav Summary / Machine IQ / OQ / PQ / Parameter sets / History; KPI cards; "QA approval" step; approve & lock; "start requalification"; per-parameter-set validate / approve / suspend / reinstate / withdraw / revalidate with history; "validated materials" table), the rich maintenance model (KPI cards, per-item SOP / acceptance criteria / checklist steps / lead days / "blocks use when overdue", breakdown report & close-out with verification, out-of-tolerance impact assessment, log filter, free "Add log entry", void-with-reason), and the per-machine overdue banner. The rendered Qualification/Maintenance tabs use the simpler generic "schedule + record" pattern. The hidden logic still affects behaviour (machine status, `onValSync`, material "Validated on machines", audit rows) and the seed data (`quals`, `valParams`, `cals` with SOPs/steps, breakdown logs) is shaped for it. Decide explicitly whether to build the rich version.
2. **`ids` (part-ID format builder)** — full state and handlers, no template. **`maintplan`** — intro text only.
3. **GRN view switcher** (Receipts / Lot trace / GRN setup) is built but always hidden (`showVT: false`); `grnView` state is unused — the three views are reached via the `tab` prop.
4. **Built-in tab strip** lists only 6 of the ~20 sections; the rest are reachable only through the host.
5. **Workflow sourcing / vendor**: data and handlers exist, no controls. The card-view pill shows the *method* (`sourcing: w.method`), and the "outsourced" concept is only visible through seed data.
6. `FORMS` and `EMAILS` are hard-coded lists; seed stages reference forms not in the list (`Polymer build record`, `Final inspection`).
7. Inline "Operator to add" select on the machine Overview is `display: none` (superseded by the dialog); its handler `addOp` remains.
8. `addLot` (manual lot creation) has no button — lots can only be created through a GRN; manual (pre-GRN) lots remain fully inline-editable while GRN lots are read-only.
9. "+ Receive via GRN" on a material builds the GRN number with a hard-coded `GRN-<year>-0000` pattern and a hard-coded condition, ignoring GRN setup.
10. Vendor status select offers Approved / Trial / Suspended, but code filters on a non-existent `'Disqualified'` status.
11. Change-control button "Requalification required" stores "Revalidation required" for printers (and suspends parameter sets) but "Requalification required" with no side effect for other equipment, materials and vendors.
12. The "Rejected lines" KPI on the GRN list is clickable but applies no filter.
13. Seed GRN lines use a legacy `checks: boolean[]` format; the UI uses `tests{}`; a legacy checklist table (`CHK0`) is defined and unused.
14. No confirmation on destructive inline actions (remove stage, task, lot, part type, schedule item, GRN line, document). Only archive and permanent delete are guarded.
15. No Save/Cancel — every keystroke mutates state; no dirty tracking, no validation on master-data forms (names may be blank; blanks display as "New machine", "New material", "Untitled stage", …).
16. Relationships are by **display name** in many places (params ↔ machine/material, lot ↔ supplier, operator ↔ machine via substring). Renaming a machine silently breaks links.
17. Identity is weak: `userName` defaults to "Platform Admin"; approver / "done by" are free text; the operators registry is separate from system users.
18. Registry column text for tooling's Maintenance tab is always empty in seed (no seeded items); packaging validation items are seeded without dates ("No date set").
19. Alert thresholds differ by screen (60 vs 90 days for lot expiry); copy references "Quality › Audit Log" as the audit location.
20. No pagination, sorting, export, print or import. Dates use the client clock; seed data is anchored around 2026-09-30, so alerts and overdue states drift with the real date.
