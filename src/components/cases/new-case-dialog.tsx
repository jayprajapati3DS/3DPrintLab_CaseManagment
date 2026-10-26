"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

import { createCase, updateCase } from "@/lib/cases/actions";
import { extrasFor } from "@/lib/cases/catalog";
import { departmentsFor } from "@/lib/cases/hospitals";
import { askedOnCreate, CASE_PRIORITIES, caseFieldVar, formsInOrder, type CaseField, type CaseFormDef, type CaseSetup } from "@/lib/cases/case-form";
import type { CaseHospital, CasePerson, CatalogProduct, CatalogSubscope } from "@/lib/cases/queries";
import { extensionsFor, normaliseLink } from "@/lib/parts/request-form";
import { idDate, initialsOf, nextId } from "@/lib/resources/ids";

/**
 * "+ New case": one of the space's case forms — chosen first when there are
 * several — filled in and sent. The case ID is given when it is saved; the
 * preview shows the one it will get.
 */

const defaults = (form: CaseFormDef) => Object.fromEntries(form.sections.flatMap((s) => s.fields).filter((f) => f.def).map((f) => [f.id, f.def]));

const INPUT = "border-field text-ink h-[38px] w-full min-w-0 rounded-lg border bg-white px-2.5 text-[13px]";
const GRID: Record<1 | 2 | 3, string> = { 1: "grid-cols-1", 2: "grid-cols-1 sm:grid-cols-2", 3: "grid-cols-1 sm:grid-cols-3" };

export function NewCaseDialog({
  setup,
  products,
  subscopes,
  people,
  hospitals,
  used,
  closeHref,
  edit,
}: {
  setup: CaseSetup;
  products: CatalogProduct[];
  subscopes: CatalogSubscope[];
  /** Everyone active, with their roles and hospitals — surgeon and sales fields list them by role. */
  people: CasePerson[];
  hospitals: CaseHospital[];
  used: string[];
  closeHref: string;
  /**
   * Editing a case opened here: its form, every field it shows, and the
   * answers it holds. The case ID, product and sub-scope are not changed.
   */
  edit?: {
    caseId: string;
    caseNumber: string;
    formId: string;
    product: string;
    scope: string | null;
    values: Record<string, string>;
    links: Record<string, string[]>;
    /** Files already uploaded, by field id. */
    held: Record<string, string[]>;
  };
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const forms = edit ? setup.forms.filter((f) => f.id === edit.formId).concat(setup.forms.filter((f) => f.id !== edit.formId)) : formsInOrder(setup);
  const [formId, setFormId] = useState(forms[0].id);
  const form = forms.find((f) => f.id === formId) ?? forms[0];
  const [values, setValues] = useState<Record<string, string>>(() => (edit ? edit.values : defaults(forms[0])));
  const [files, setFiles] = useState<Record<string, File[]>>({});
  const [links, setLinks] = useState<Record<string, string[]>>(() => edit?.links ?? {});
  const [linkDraft, setLinkDraft] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [now] = useState(() => new Date());

  // Opening a case asks the fields meant for then; editing it, every field the form shows.
  const shownField = (f: CaseField) => (edit ? f.show : askedOnCreate(f));
  // The sub-scope belongs to the product: asked only when the product chosen has sub-scopes.
  const chosenProductId = values[form.sections.flatMap((s) => s.fields).find((f) => f.key === "product")?.id ?? ""];
  const chosenProduct = products.find((p) => p.id === chosenProductId);
  const asked = (f: CaseField) => shownField(f) && (f.type !== "subscope" || (edit ? Boolean(edit.scope) : chosenProduct?.mode === "scopes"));
  const fields = form.sections.flatMap((s) => s.fields).filter(asked);
  const productField = fields.find((f) => f.key === "product");
  const subscopeField = fields.find((f) => f.key === "subscope");
  const surgeonField = fields.find((f) => f.key === "surgeon");
  const surgeon = people.find((x) => x.id === values[surgeonField?.id ?? ""]);
  const listFor = (f: CaseField) => {
    const wanted = (f.roles ?? []).map((r) => r.toLowerCase());
    return wanted.length ? people.filter((x) => x.roles.some((r) => wanted.includes(r.toLowerCase()))) : people;
  };
  const chosenIds = (f: CaseField) => (values[f.id] ?? "").split(",").filter(Boolean);
  // A hospital field may offer only the chosen surgeon's hospitals.
  const hospitalsFor = (f: CaseField) => (f.hospitalSource === "surgeon" && surgeon ? hospitals.filter((h) => surgeon.hospitalIds.includes(h.id)) : hospitals);
  // A form can be for some products only.
  const offered = form.productIds.length ? products.filter((p) => form.productIds.includes(p.id)) : products;
  const product = offered.find((p) => p.id === values[productField?.id ?? ""]);
  // The chosen product's — or sub-scope's — scan protocols, to send the hospital.
  const chosenExtras = product ? extrasFor(product, values[subscopeField?.id ?? ""] || null) : null;
  const protocols = chosenExtras?.protocols ?? [];
  // The image of the product chosen — or of its sub-scope, when that has its own.
  const chosenImage = chosenExtras?.imageId ?? "";

  function chooseForm(id: string) {
    const next = forms.find((f) => f.id === id);
    if (!next || next.id === formId) return;
    setFormId(next.id);
    setValues(defaults(next));
    setFiles({});
    setLinks({});
    setLinkDraft({});
    setError(null);
  }
  // The case's own answers, as far as filled in, for an ID made from them.
  const answerOf = (key: string) => values[fields.find((x) => x.key === key)?.id ?? ""] ?? "";
  const idFields = {
    SURGEON: initialsOf(surgeon?.name ?? ""),
    PATIENT: answerOf("patientInitials"),
    PID: answerOf("patientId"),
    SURGERY: idDate(answerOf("surgeryDate")),
    DELIVERY: idDate(answerOf("deliveryDate")),
    HOSPITAL: hospitals.find((h) => h.id === values[fields.find((x) => x.type === "hospital")?.id ?? ""])?.code ?? "",
  };
  const idPreview = product ? nextId(setup.idPattern, { type: product.code || product.name, now, fields: idFields, start: setup.idStart }, used) : null;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") router.push(closeHref, { scroll: false });
    };
    window.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, [router, closeHref]);

  const set = (id: string, value: string) => setValues((v) => ({ ...v, [id]: value }));

  function submit() {
    const missing = fields.filter(
      (f) =>
        (f.req || (!edit && f.type === "subscope" && product?.mode === "scopes")) &&
        f.type !== "caseid" &&
        !(edit && (f.type === "product" || f.type === "subscope")) &&
        (f.type === "file" ? !(files[f.id]?.length || links[f.id]?.length || edit?.held[f.id]?.length) : !(values[f.id] ?? "").trim()),
    );
    if (missing.length) {
      setError(`Fill in: ${missing.map((f) => f.label).join(", ")}.`);
      return;
    }
    const data = new FormData();
    data.set("form", form.id);
    for (const f of fields) {
      if (f.type === "file") {
        for (const file of files[f.id] ?? []) data.append(`file:${f.id}`, file);
        data.set(`links:${f.id}`, JSON.stringify(links[f.id] ?? []));
      } else if (values[f.id]) data.set(`v:${f.id}`, values[f.id]);
    }
    setError(null);
    startTransition(async () => {
      try {
        const result = edit ? await updateCase(edit.caseId, data) : await createCase(data);
        // Success redirects to the new case; a result means it did not save.
        if (result && !result.ok) setError(result.message ?? "The case could not be saved.");
      } catch (e) {
        if (e && typeof e === "object" && "digest" in e && String((e as { digest: unknown }).digest).startsWith("NEXT_REDIRECT")) throw e;
        setError("The server could not be reached. Try again.");
      }
    });
  }

  function control(f: CaseField) {
    const id = `case-${f.id}`;
    switch (f.type) {
      case "caseid":
        return (
          <div data-testid="case-id" className="bg-navy text-brand-glow flex h-[38px] items-center rounded-lg px-3 font-mono text-[13.5px] font-semibold">
            {edit ? edit.caseNumber : (idPreview ?? "Choose the product first")}
          </div>
        );
      case "product":
        if (edit) return <span className="border-line bg-subtle text-ink-2 flex h-[38px] items-center rounded-lg border px-2.5 text-[13px] font-semibold">{edit.product}</span>;
        if (f.display === "cards") {
          if (!offered.length) return <span className="text-muted text-[12.5px]">No products yet — add them on the Products page.</span>;
          const pick = (value: string) => {
            set(f.id, value);
            // A sub-scope belongs to one product.
            if (subscopeField) set(subscopeField.id, "");
          };
          const listed = offered;
          return (
            <div className="flex flex-col gap-2">
            <div id={id} role="radiogroup" aria-label={f.label} className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {listed.map((p) => {
                const on = values[f.id] === p.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => pick(p.id)}
                    className={"flex min-w-0 flex-col items-start gap-1 rounded-[10px] border px-3 py-2.5 text-left " + (on ? "border-brand bg-brand-wash" : "border-field hover:bg-subtle bg-white")}
                  >
                    {p.imageId ? (
                      // eslint-disable-next-line @next/next/no-img-element -- a stored upload, served by the files route
                      <img src={`/api/files/${p.imageId}`} alt="" className="mb-1 h-[84px] w-full rounded-md bg-white object-contain" />
                    ) : null}
                    <span className="flex w-full items-center gap-2">
                      <span className="text-ink min-w-0 flex-1 text-[13.5px] font-semibold">{p.name}</span>
                      {p.code ? <span className="bg-chip text-ink-3 rounded px-1.5 py-px font-mono text-[11px] font-semibold">{p.code}</span> : null}
                    </span>
                    {p.category ? <span className="text-muted text-[11.5px] font-semibold">{p.category}</span> : null}
                    {p.description ? <span className="text-muted line-clamp-2 text-[12px] leading-[1.4]">{p.description}</span> : null}
                  </button>
                );
              })}
            </div>
            </div>
          );
        }
        return (
          <select
            id={id}
            value={values[f.id] ?? ""}
            onChange={(e) => {
              set(f.id, e.target.value);
              // A sub-scope belongs to one product.
              if (subscopeField) set(subscopeField.id, "");
            }}
            className={INPUT}
          >
            <option value="">{offered.length ? "Select…" : "No products yet — add them on the Products page"}</option>
            {offered.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.code ? ` (${p.code})` : ""}
              </option>
            ))}
          </select>
        );
      case "subscope": {
        if (edit) return <span className="border-line bg-subtle text-ink-2 flex h-[38px] items-center rounded-lg border px-2.5 text-[13px]">{edit.scope ?? "—"}</span>;
        const own = subscopes.filter((s) => s.productId === product?.id);
        if (f.display === "cards" && product) {
          return (
            <div id={id} role="radiogroup" aria-label={f.label} className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {product.scopes
                .filter((sc) => own.some((o) => o.id === sc.id))
                .map((sc) => {
                  const on = values[f.id] === sc.id;
                  return (
                    <button
                      key={sc.id}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      onClick={() => set(f.id, sc.id)}
                      className={"flex min-w-0 flex-col items-start gap-1 rounded-[10px] border px-3 py-2.5 text-left " + (on ? "border-brand bg-brand-wash" : "border-field hover:bg-subtle bg-white")}
                    >
                      {sc.imageId ? (
                        // eslint-disable-next-line @next/next/no-img-element -- a stored upload, served by the files route
                        <img src={`/api/files/${sc.imageId}`} alt="" className="mb-1 h-[72px] w-full rounded-md bg-white object-contain" />
                      ) : null}
                      <span className="flex w-full items-center gap-2">
                        <span className="text-ink min-w-0 flex-1 text-[13px] font-semibold">{sc.name}</span>
                        {sc.code ? <span className="bg-chip text-ink-3 rounded px-1.5 py-px font-mono text-[11px] font-semibold">{sc.code}</span> : null}
                      </span>
                      {sc.description ? <span className="text-muted line-clamp-2 text-[12px] leading-[1.4]">{sc.description}</span> : null}
                    </button>
                  );
                })}
            </div>
          );
        }
        return (
          <select id={id} value={values[f.id] ?? ""} disabled={!product || own.length === 0} onChange={(e) => set(f.id, e.target.value)} className={`${INPUT} disabled:bg-subtle`}>
            <option value="">{!product ? "Choose the product first" : own.length ? "Select…" : "None for this product"}</option>
            {own.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        );
      }
      case "person": {
        const list = listFor(f);
        return (
          <select
            id={id}
            value={values[f.id] ?? ""}
            onChange={(e) => {
              set(f.id, e.target.value);
              // A hospital chosen for the previous surgeon may not be one of this one's (only when the hospital follows the surgeon).
              if (f.key === "surgeon") for (const h of fields.filter((x) => x.type === "hospital" && x.hospitalSource === "surgeon")) set(h.id, "");
            }}
            className={INPUT}
          >
            <option value="">{list.length ? "Select…" : "Nobody with this role yet — add people on Users & Roles"}</option>
            {list.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </select>
        );
      }
      case "people": {
        const chosen = chosenIds(f);
        const left = listFor(f).filter((x) => !chosen.includes(x.id) && !(f.key === "secondarySurgeons" && x.id === surgeon?.id));
        return (
          <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={f.label}>
            {chosen.map((pid) => (
              <span key={pid} className="bg-chip text-ink-2 flex items-center gap-1.5 rounded-full py-1 pr-1.5 pl-2.5 text-xs font-semibold">
                {people.find((x) => x.id === pid)?.name ?? "—"}
                <button type="button" aria-label={`Remove ${people.find((x) => x.id === pid)?.name ?? "person"}`} onClick={() => set(f.id, chosen.filter((x) => x !== pid).join(","))} className="text-muted hover:text-bad h-4 w-4 rounded-full border-0 bg-transparent p-0 leading-none">
                  ×
                </button>
              </span>
            ))}
            <select
              id={id}
              value=""
              onChange={(e) => e.target.value && set(f.id, [...chosen, e.target.value].join(","))}
              className="border-field text-ink-2 h-[34px] min-w-[160px] rounded-lg border bg-white px-2 text-[12.5px] font-semibold"
            >
              <option value="">{left.length ? "+ Add…" : chosen.length ? "Everyone is added" : "Nobody with this role yet"}</option>
              {left.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </select>
          </div>
        );
      }
      case "department": {
        const hospitalField = fields.find((x) => x.type === "hospital");
        const hospital = hospitals.find((h) => h.id === values[hospitalField?.id ?? ""]);
        const list = hospital ? departmentsFor(hospital.departments, surgeon?.id ?? null) : [];
        const current = values[f.id] ?? "";
        return (
          <select id={id} value={current} disabled={Boolean(hospitalField) && !hospital} onChange={(e) => set(f.id, e.target.value)} className={`${INPUT} disabled:bg-subtle`}>
            <option value="">{hospitalField && !hospital ? "Choose the hospital first" : list.length ? "Select…" : "No departments set for this hospital"}</option>
            {current && !list.some((d) => d.name === current) ? <option value={current}>{current}</option> : null}
            {list.map((d) => (
              <option key={d.id} value={d.name}>
                {d.name}
              </option>
            ))}
          </select>
        );
      }
      case "hospital": {
        const bySurgeon = f.hospitalSource === "surgeon";
        const list = hospitalsFor(f);
        const waiting = bySurgeon && surgeonField && !surgeon;
        return (
          <select
            id={id}
            value={values[f.id] ?? ""}
            disabled={Boolean(waiting)}
            onChange={(e) => {
              set(f.id, e.target.value);
              for (const dep of fields.filter((x) => x.type === "department")) set(dep.id, "");
            }}
            className={`${INPUT} disabled:bg-subtle`}
          >
            <option value="">
              {waiting ? "Choose the surgeon first" : list.length ? "Select…" : bySurgeon && surgeon ? `No hospitals set for ${surgeon.name} — on Users & Roles` : "No hospitals yet — add them on the Hospitals page"}
            </option>
            {list.map((h) => (
              <option key={h.id} value={h.id}>
                {h.name}
                {h.code ? ` (${h.code})` : ""}
              </option>
            ))}
          </select>
        );
      }
      case "priority":
        return (
          <select id={id} value={values[f.id] ?? ""} onChange={(e) => set(f.id, e.target.value)} className={INPUT}>
            <option value="">Select…</option>
            {CASE_PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        );
      case "select":
        return (
          <select id={id} value={values[f.id] ?? ""} onChange={(e) => set(f.id, e.target.value)} className={INPUT}>
            <option value="">Select…</option>
            {f.options.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        );
      case "textarea":
        return <textarea id={id} rows={3} value={values[f.id] ?? ""} onChange={(e) => set(f.id, e.target.value)} className={`${INPUT} h-auto py-2`} />;
      case "checkbox":
        return (
          <span className="flex h-[38px] items-center gap-2 text-[13px]">
            <input id={id} type="checkbox" checked={values[f.id] === "Yes"} onChange={(e) => set(f.id, e.target.checked ? "Yes" : "")} className="h-4 w-4" />
            Yes
          </span>
        );
      case "file": {
        const accept = extensionsFor(f.fileTypes).join(",");
        return (
          <div className="border-field flex flex-col gap-2 rounded-lg border border-dashed bg-[#FCFCFD] p-2.5">
            <label className="bg-ink relative inline-flex h-[34px] cursor-pointer items-center self-start overflow-hidden rounded-lg px-3.5 text-[12.5px] font-semibold text-white">
              Choose files{f.fileTypes.length ? ` (${f.fileTypes.join(", ")})` : ""}
              <input
                id={id}
                type="file"
                multiple
                accept={accept || undefined}
                onChange={(e) => {
                  const picked = Array.from(e.target.files ?? []);
                  e.target.value = "";
                  const big = picked.filter((p) => p.size > 25 * 1024 * 1024);
                  if (big.length) setError(`Over 25 MB — add as a link instead: ${big.map((b) => b.name).join(", ")}`);
                  setFiles((x) => ({ ...x, [f.id]: [...(x[f.id] ?? []), ...picked.filter((p) => p.size <= 25 * 1024 * 1024)] }));
                }}
                className="absolute inset-0 cursor-pointer opacity-0"
              />
            </label>
            {(edit?.held[f.id] ?? []).map((name) => (
              <span key={`held-${name}`} className="text-ink-2 flex items-center gap-2 text-[12.5px]">
                ✓ {name} <span className="text-muted">(uploaded)</span>
              </span>
            ))}
            {(files[f.id] ?? []).map((file, i) => (
              <span key={`${file.name}-${i}`} className="text-ink-2 flex items-center gap-2 text-[12.5px]">
                {file.name} <span className="text-muted">({(file.size / 1024 / 1024).toFixed(1)} MB)</span>
                <button type="button" aria-label={`Remove ${file.name}`} onClick={() => setFiles((x) => ({ ...x, [f.id]: x[f.id].filter((_, j) => j !== i) }))} className="text-bad border-0 bg-transparent p-0">
                  ×
                </button>
              </span>
            ))}
            {f.allowLinks ? (
              <div className="flex gap-2">
                <input
                  aria-label={`${f.label} link`}
                  value={linkDraft[f.id] ?? ""}
                  placeholder="Or paste a link to the study (PACS, cloud drive, transfer…)"
                  onChange={(e) => setLinkDraft((d) => ({ ...d, [f.id]: e.target.value }))}
                  className={INPUT}
                />
                <button
                  type="button"
                  onClick={() => {
                    const url = normaliseLink(linkDraft[f.id] ?? "");
                    if (!url) return setError("That is not a valid link.");
                    setLinks((l) => ({ ...l, [f.id]: [...(l[f.id] ?? []), url] }));
                    setLinkDraft((d) => ({ ...d, [f.id]: "" }));
                  }}
                  className="border-field h-[38px] flex-none rounded-lg border bg-white px-3 text-[12.5px] font-semibold"
                >
                  + Add link
                </button>
              </div>
            ) : null}
            {(links[f.id] ?? []).map((url, i) => (
              <span key={url} className="flex items-center gap-2 text-[12.5px] text-[#155EEF] [overflow-wrap:anywhere]">
                {url}
                <button type="button" aria-label="Remove link" onClick={() => setLinks((l) => ({ ...l, [f.id]: l[f.id].filter((_, j) => j !== i) }))} className="text-bad border-0 bg-transparent p-0">
                  ×
                </button>
              </span>
            ))}
          </div>
        );
      }
      default:
        return (
          <input
            id={id}
            type={f.type === "date" ? "date" : f.type === "number" ? "number" : "text"}
            step={f.type === "number" ? "any" : undefined}
            value={values[f.id] ?? ""}
            onChange={(e) => set(f.id, e.target.value)}
            className={INPUT}
          />
        );
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-[rgba(12,21,36,.55)] px-2 py-3 sm:px-4 sm:py-8">
      <div role="dialog" aria-modal="true" aria-labelledby="new-case-title" className="shadow-modal w-[860px] max-w-full overflow-hidden rounded-[14px] bg-white">
        <div className="border-line-2 flex items-center gap-3 border-b px-4 py-4 sm:px-[22px]">
          <h2 id="new-case-title" className="m-0 flex-1 text-[17px] font-bold">
            {edit ? `Edit case ${edit.caseNumber}` : "New case"}
          </h2>
          <button type="button" aria-label="Close" onClick={() => router.push(closeHref, { scroll: false })} className="bg-chip text-ink-3 h-[34px] w-[34px] rounded-lg border-0">
            ×
          </button>
        </div>
        {forms.length > 1 && !edit ? <FormChooser forms={forms} value={form.id} disabled={pending} onChange={chooseForm} /> : null}
        <fieldset key={form.id} disabled={pending} className="m-0 flex flex-col gap-5 border-0 px-4 py-4 sm:px-[22px]">
          {form.sections.map((section) => {
            const shown = section.fields.filter(asked);
            if (!shown.length) return null;
            return (
              <div key={section.id} className="flex flex-col gap-2.5">
                <div className="border-line-3 text-brand-ink border-b pb-1.5 text-[11px] font-bold tracking-[0.8px] uppercase">{section.title}</div>
                <div className={`grid gap-3 ${GRID[section.cols]}`}>
                  {shown.map((f) => (
                    <div key={f.id} className={"flex min-w-0 flex-col gap-[5px] " + (f.type === "textarea" || f.type === "file" || f.type === "people" || ((f.type === "product" || f.type === "subscope") && f.display === "cards") ? "col-span-full" : "")}>
                      <label htmlFor={`case-${f.id}`} className="text-ink-2 text-[12.5px] font-semibold">
                        {f.label}
                        {(f.req || (f.type === "subscope" && product?.mode === "scopes")) && f.type !== "caseid" ? <span className="text-bad"> *</span> : null}
                        <span className="text-faint ml-1.5 font-mono text-[10.5px] font-normal">{`{${caseFieldVar(f)}}`}</span>
                      </label>
                      {control(f)}
                      {f.type === "product" && chosenImage && f.display !== "cards" ? (
                        <span className="border-line flex items-center gap-3 rounded-lg border bg-white p-2" data-testid="product-image">
                          {/* eslint-disable-next-line @next/next/no-img-element -- a stored upload, served by the files route */}
                          <img src={`/api/files/${chosenImage}`} alt="" className="h-16 w-16 rounded-md bg-white object-contain" />
                          <span className="text-ink-2 text-[12.5px] font-semibold">{product?.name}</span>
                        </span>
                      ) : null}
                      {f.type === "product" && protocols.length ? (
                        <span className="text-muted flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px]" data-testid="scan-protocols">
                          Scan protocol:
                          {protocols.map((file) => (
                            <a key={file.id} href={`/api/files/${file.id}`} target="_blank" rel="noopener noreferrer" className="text-brand-ink font-semibold underline">
                              {file.name}
                            </a>
                          ))}
                        </span>
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </fieldset>
        <div className="border-line-2 flex flex-wrap items-center gap-2.5 border-t px-4 py-3.5 sm:px-[22px]">
          <span role="status" className={"min-w-[160px] flex-1 text-[12.5px] " + (error ? "text-bad" : "text-muted")}>
            {error ?? (edit ? "Fields left out when the case was opened are here too." : "The case ID is given when the case is saved.")}
          </span>
          <button type="button" onClick={() => router.push(closeHref, { scroll: false })} className="border-field h-[38px] rounded-lg border bg-white px-3.5 text-[13px] font-semibold">
            Cancel
          </button>
          <button type="button" disabled={pending} onClick={submit} className="bg-brand h-[38px] rounded-lg border-0 px-4 text-[13px] font-bold text-white disabled:opacity-60">
            {pending ? "Saving…" : edit ? "Save changes" : "Create case"}
          </button>
        </div>
      </div>
    </div>
  );
}

/** "Which case form?" — side by side when there are a few, a dropdown when there are many. */
function FormChooser({ forms, value, disabled, onChange }: { forms: CaseFormDef[]; value: string; disabled: boolean; onChange: (id: string) => void }) {
  const current = forms.find((f) => f.id === value);
  return (
    <div className="border-line-2 flex flex-col gap-2 border-b px-4 py-3.5 sm:px-[22px]">
      <span id="case-form-label" className="text-ink text-[13px] font-bold">
        Which case form?
      </span>
      {forms.length <= 4 ? (
        <div role="radiogroup" aria-labelledby="case-form-label" className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {forms.map((f) => {
            const on = f.id === value;
            return (
              <button
                key={f.id}
                type="button"
                role="radio"
                aria-checked={on}
                disabled={disabled}
                onClick={() => onChange(f.id)}
                className={"flex min-w-0 items-start gap-2.5 rounded-[10px] border px-3 py-2.5 text-left " + (on ? "border-brand bg-brand-wash" : "border-field hover:bg-subtle bg-white")}
              >
                <span className={"mt-0.5 flex h-4 w-4 flex-none items-center justify-center rounded-full border-2 " + (on ? "border-brand" : "border-field")} aria-hidden="true">
                  {on ? <span className="bg-brand h-2 w-2 rounded-full" /> : null}
                </span>
                <span className="flex min-w-0 flex-col">
                  <span className="text-ink text-[13.5px] font-semibold">{f.name}</span>
                  {f.description ? <span className="text-muted text-[12px] leading-[1.4]">{f.description}</span> : null}
                </span>
              </button>
            );
          })}
        </div>
      ) : (
        <>
          <select aria-labelledby="case-form-label" value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} className={`${INPUT} font-semibold`}>
            {forms.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
          {current?.description ? <span className="text-muted text-[12px]">{current.description}</span> : null}
        </>
      )}
    </div>
  );
}
