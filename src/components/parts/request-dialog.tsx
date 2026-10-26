"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";

import { BalloonEditor, emptyBalloons, type BalloonState } from "@/components/parts/balloons";
import {
  earlierPartRequest,
  previewPartNumber,
  requestPart,
  searchEarlierParts,
  searchRequestCases,
  type EarlierPart,
  type RequestCopy,
} from "@/lib/parts/actions";
import type { CaseChoice, RequestOptions } from "@/lib/parts/queries";
import {
  askedOnRequest,
  buildPartNumber,
  extensionsFor,
  fieldVar,
  fileAllowed,
  IMAGE_SIZE_LABELS,
  IMAGE_SIZES,
  linkLabel,
  normaliseLink,
  PRIORITIES,
  SOURCING,
  type FieldType,
  type ImageSize,
  type RequestField,
  type RequestFormDef,
  type RequestForms,
  sitesFor,
} from "@/lib/parts/request-form";

/**
 * Request a part: the form a space configured in Part Request Setup, filled in
 * for one case. The part's ID is worked out as the form is filled, from the
 * space's ID rule.
 */

const MAX_FILE_BYTES = 25 * 1024 * 1024;

const GRID: Record<1 | 2 | 3, string> = {
  1: "grid-cols-1",
  2: "grid-cols-1 sm:grid-cols-2",
  3: "grid-cols-1 sm:grid-cols-3",
};
const isWide = (type: FieldType) => type === "textarea" || type === "file" || type === "balloon";

const CONTROL = "border-field text-ink h-[38px] w-full min-w-0 rounded-lg border bg-white px-2.5 text-[13.5px] disabled:bg-subtle disabled:text-ink-3";

interface Picked {
  file: File;
  /** A local preview, for images. */
  url?: string;
}

export function RequestDialog({
  setup,
  initialFormId = null,
  initialCopy = null,
  options,
  lockedCase,
  recentCases,
  spaceName,
  closeHref,
  from,
}: {
  setup: RequestForms;
  /** Open on this form — an earlier part's, say; the default otherwise. */
  initialFormId?: string | null;
  /** Fill the form from this earlier part as it opens. */
  initialCopy?: RequestCopy | null;
  options: RequestOptions;
  /** Set when the form is opened from a case: the case cannot be changed. */
  lockedCase: CaseChoice | null;
  recentCases: CaseChoice[];
  spaceName: string;
  closeHref: string;
  from: "parts" | "case";
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const dialog = useRef<HTMLDivElement>(null);

  const defaultForm = setup.forms.find((f) => f.isDefault) ?? setup.forms[0];
  const [formId, setFormId] = useState(() => (setup.forms.some((f) => f.id === initialFormId) ? initialFormId! : defaultForm.id));
  const form = setup.forms.find((f) => f.id === formId) ?? defaultForm;
  const shownOf = (f: RequestFormDef) => f.sections.flatMap((sec) => sec.fields).filter(askedOnRequest);
  const fields = useMemo(() => shownOf(form), [form]);
  const byKey = (key: string) => fields.find((f) => f.key === key);

  /** What a form starts with: defaults, and the obvious answers. */
  const startValues = (list: RequestField[]) => {
    const initial: Record<string, string> = {};
    for (const f of list) {
      if (f.def) initial[f.id] = f.def;
      if (f.key === "qty") initial[f.id] = "1";
      if (f.key === "priority") initial[f.id] = "Medium";
      if (f.key === "sourcing") initial[f.id] = "In-house";
      if (f.key === "workflow" && f.req && options.workflows.length === 1) initial[f.id] = options.workflows[0].id;
    }
    return initial;
  };
  const [values, setValues] = useState<Record<string, string>>(() => startValues(fields));
  const [chosenCase, setChosenCase] = useState<CaseChoice | null>(lockedCase);
  const [files, setFiles] = useState<Record<string, File[]>>({});
  const [links, setLinks] = useState<Record<string, string[]>>({});
  const [linkDrafts, setLinkDrafts] = useState<Record<string, string>>({});
  const [images, setImages] = useState<Record<string, Picked>>({});
  // How large each image is shown on the part and its QA forms.
  const [imageSizes, setImageSizes] = useState<Record<string, ImageSize>>({});
  const [balloons, setBalloons] = useState<Record<string, BalloonState>>({});
  const [error, setError] = useState<string | null>(null);
  /** The earlier part the form was filled from, and what could not be carried over. */
  const [copied, setCopied] = useState<{ partNumber: string; skipped: string[] } | null>(null);

  const set = (id: string, value: string) => setValues((v) => ({ ...v, [id]: value }));

  /** A field's identity across forms: its built-in key, or its variable. */
  const sameAs = (f: RequestField) => f.key || fieldVar(f) || `id:${f.id}`;

  /**
   * Open another form. Answers to fields the two forms share — the same
   * built-in field, or the same variable — are kept; the rest start afresh.
   */
  function chooseForm(nextId: string) {
    const next = setup.forms.find((f) => f.id === nextId);
    if (!next || next.id === form.id) return;
    const nextFields = shownOf(next);
    const carried = new Map(fields.map((f) => [sameAs(f), f.id]));
    const nextValues = startValues(nextFields);
    const nextLinks: Record<string, string[]> = {};
    for (const f of nextFields) {
      const from = carried.get(sameAs(f));
      if (!from) continue;
      if (values[from] !== undefined && values[from] !== "") nextValues[f.id] = values[from];
      if (links[from]?.length) nextLinks[f.id] = links[from];
    }
    setFormId(next.id);
    setValues(nextValues);
    setLinks(nextLinks);
    setFiles({});
    setImages({});
    setBalloons({});
    setError(null);
  }

  /**
   * Fill the form from an earlier part's request. Only what still fits is
   * taken — a workflow, material or choice no longer on offer is left blank
   * and named. The case, the due date and files stay as they are.
   */
  function applyCopy(copy: RequestCopy) {
    // The earlier part's own form, when it is still offered.
    const target = setup.forms.find((f) => f.id === copy.requestFormId) ?? form;
    const targetFields = shownOf(target);
    const switching = target.id !== form.id;
    const next: Record<string, string> = switching ? startValues(targetFields) : { ...values };
    const skipped: string[] = [];
    const nextLinks: Record<string, string[]> = switching ? {} : { ...links };
    const nextBalloons: Record<string, BalloonState> = switching ? {} : { ...balloons };
    const details = new Map(copy.details.map((d) => [d.var, d.value]));
    const offer = (field: RequestField, value: string | null | undefined, allowed?: readonly string[]) => {
      if (!value) return;
      if (allowed && !allowed.includes(value)) {
        skipped.push(`${field.label} "${value}" (no longer available)`);
        return;
      }
      next[field.id] = value;
    };

    for (const field of targetFields) {
      switch (field.key) {
        case "name":
          offer(field, copy.name);
          break;
        case "type":
          offer(field, copy.partType, options.partTypes.map((t) => t.name));
          break;
        case "qty":
          offer(field, String(copy.quantity));
          break;
        case "workflow":
          if (copy.workflowId && options.workflows.some((w) => w.id === copy.workflowId)) next[field.id] = copy.workflowId;
          else if (copy.workflowId) skipped.push(`${field.label} (that workflow is no longer available)`);
          break;
        case "material":
          offer(field, copy.material, options.materials);
          break;
        case "printer":
          offer(field, copy.printer, options.printers);
          break;
        case "sourcing":
          offer(field, copy.sourcing, SOURCING);
          break;
        case "vendor":
          offer(field, copy.vendor, options.vendors);
          break;
        case "priority":
          offer(field, copy.priority, PRIORITIES);
          break;
        case "notes":
          offer(field, copy.notes);
          break;
        case "files":
          if (copy.links.length) nextLinks[field.id] = copy.links.slice(0, 10);
          break;
        case "balloon": {
          const columns = new Set(field.columns.map((c) => c.id));
          const rows = copy.balloonRows.map((r, i) => ({
            id: `m${i}-${Date.now().toString(36)}`,
            imgId: "",
            balloon: r.balloon,
            vals: Object.fromEntries(Object.entries(r.vals).filter(([k]) => columns.has(k))),
          }));
          if (rows.length) nextBalloons[field.id] = { ...emptyBalloons(), rows };
          break;
        }
        case "case":
        case "due":
          break;
        default: {
          if (field.type === "file" || field.type === "image" || field.type === "balloon") break;
          const name = fieldVar(field);
          const value = name ? details.get(name) : undefined;
          if (field.type === "select") offer(field, value, field.options);
          else offer(field, value);
        }
      }
    }
    if (switching) {
      setFormId(target.id);
      setFiles({});
      setImages({});
    }
    setValues(next);
    setLinks(nextLinks);
    setBalloons(nextBalloons);
    setCopied({ partNumber: copy.partNumber, skipped });
    setError(null);
  }

  const close = () => router.push(closeHref, { scroll: false });

  // Escape closes, as any dialog does; the page behind does not scroll.
  useEffect(() => {
    dialog.current?.focus();
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

  const workflow = options.workflows.find((w) => w.id === values[byKey("workflow")?.id ?? ""]);
  const sourcingField = byKey("sourcing");
  const outsourced = (sourcingField ? values[sourcingField.id] : workflow?.sourcing) === "Outsourced";

  // Which workflows fit how — and where — the part is made: its way of making it, and its sites.
  const fits = (w: (typeof options.workflows)[number], made: string, site: string) =>
    (!made || w.sourcing === made) && (!site || w.sites.length === 0 || w.sites.includes(site));
  const caseAllows = (w: (typeof options.workflows)[number]) => !chosenCase?.workflowIds || chosenCase.workflowIds.includes(w.id);
  /** The sites offered: those that fit how it is made, and that one of its workflows runs at. */
  const siteChoices = (made: string) => {
    const flows = options.workflows.filter((w) => (!made || w.sourcing === made) && caseAllows(w));
    const any = flows.length === 0 || flows.some((w) => w.sites.length === 0);
    return sitesFor(options.sites, made, "").filter((x) => any || flows.some((w) => w.sites.includes(x.id)));
  };

  /**
   * After Made or the site changes: the site is kept if it still fits, else the workflows'
   * default, else the only one; the workflow likewise; and the vendor is the site's.
   */
  function refit(next: Record<string, string>) {
    const made = sourcingField ? (next[sourcingField.id] ?? "") : "";
    const siteField = byKey("site");
    const wfField = byKey("workflow");
    if (siteField) {
      const fitting = siteChoices(made);
      if (!fitting.some((x) => x.id === next[siteField.id])) {
        const defaults = [...new Set(options.workflows.filter((w) => (!made || w.sourcing === made) && caseAllows(w) && w.site).map((w) => w.site))].filter((d) => fitting.some((x) => x.id === d));
        next[siteField.id] = defaults.length === 1 ? defaults[0] : fitting.length === 1 ? fitting[0].id : "";
      }
    }
    const site = siteField ? (next[siteField.id] ?? "") : "";
    if (wfField && sourcingField) {
      const allowed = options.workflows.filter((w) => fits(w, made, site) && caseAllows(w));
      const current = allowed.find((w) => w.id === next[wfField.id]);
      next[wfField.id] = current ? current.id : allowed.length === 1 ? allowed[0].id : "";
    }
    // The vendor is the site's — not asked.
    const vendorField = byKey("vendor");
    if (vendorField) next[vendorField.id] = made === "Outsourced" ? (options.sites.find((x) => x.id === site)?.vendor ?? "") : "";
    return next;
  }

  function onSourcing(fieldId: string, made: string) {
    setValues((v) => refit({ ...v, [fieldId]: made }));
  }

  function onSite(fieldId: string, site: string) {
    setValues((v) => refit({ ...v, [fieldId]: site }));
  }

  function onWorkflow(fieldId: string, id: string) {
    const picked = options.workflows.find((w) => w.id === id);
    setValues((v) => {
      const next = { ...v, [fieldId]: id };
      // A workflow knows whether it runs in-house and with which vendor.
      const sourcing = byKey("sourcing");
      const vendor = byKey("vendor");
      if (picked && sourcing) next[sourcing.id] = picked.sourcing;
      // A site already chosen stays when the workflow runs there; otherwise the workflow's default.
      const site = byKey("site");
      if (picked && site) {
        const kept = next[site.id] && sitesFor(options.sites, picked.sourcing, "").some((x) => x.id === next[site.id]) && (picked.sites.length === 0 || picked.sites.includes(next[site.id]));
        if (!kept) next[site.id] = picked.site || "";
      }
      if (picked && vendor) next[vendor.id] = picked.sourcing === "Outsourced" ? (options.sites.find((x) => x.id === next[site?.id ?? ""])?.vendor ?? picked.vendor) : "";
      return next;
    });
  }

  // Opened from a part's Duplicate: filled from that part once, as the dialog opens.
  const copiedOnOpen = useRef(false);
  useEffect(() => {
    if (!initialCopy || copiedOnOpen.current) return;
    copiedOnOpen.current = true;
    applyCopy(initialCopy);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, when the dialog opens
  }, []);

  const [now] = useState(() => new Date());
  const caseField = byKey("case");
  // Until a required case is chosen there is no ID to show; where the case is
  // optional, the ID is the one a part without a case would get.
  const typeName = values[byKey("type")?.id ?? ""] ?? "";
  const materialName = values[byKey("material")?.id ?? ""] ?? "";
  const noId = !chosenCase && Boolean(caseField?.req);
  // The next number depends on the IDs already given, so the server works it
  // out; only what the ID is made of asks again.
  const tokens = setup.rule.tokens;
  const idKey = JSON.stringify([
    chosenCase?.id ?? null,
    tokens.includes("PART_TYPE") ? typeName : "",
    tokens.includes("MATERIAL") ? materialName : "",
  ]);
  const [known, setKnown] = useState<{ key: string; id: string } | null>(null);
  useEffect(() => {
    if (noId) return;
    let live = true;
    const timer = setTimeout(async () => {
      try {
        const id = await previewPartNumber(chosenCase?.id ?? null, typeName, materialName);
        if (live) setKnown({ key: idKey, id });
      } catch {
        // The ID is given when the part is saved; the preview can wait for the next change.
      }
    }, 250);
    return () => {
      live = false;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- idKey holds what the ID depends on
  }, [idKey, noId]);
  const idReady = known?.key === idKey;
  const partId = noId
    ? "—"
    : idReady
      ? known.id
      : buildPartNumber(setup.rule, {
          noCase: !chosenCase,
          product: chosenCase?.product,
          caseNumber: chosenCase?.number,
          sequence: 1,
          partTypeCode: options.partTypes.find((t) => t.name === typeName)?.code,
          material: materialName || null,
          spaceName,
          now,
        });

  function addFiles(field: RequestField, list: FileList | null) {
    if (!list) return;
    const current = files[field.id] ?? [];
    const next = [...current];
    const refused: string[] = [];
    for (const file of Array.from(list)) {
      if (!fileAllowed(file.name, field.fileTypes)) refused.push(`${file.name} (not ${field.fileTypes.join(", ")})`);
      else if (file.size > MAX_FILE_BYTES) refused.push(`${file.name} (over 25 MB — add it as a link)`);
      else if (!next.some((f) => f.name === file.name && f.size === file.size)) next.push(file);
    }
    setFiles((f) => ({ ...f, [field.id]: next.slice(0, 20) }));
    setError(refused.length ? `Not added: ${refused.join("; ")}` : null);
  }

  function addLink(field: RequestField) {
    const typed = linkDrafts[field.id] ?? "";
    if (!typed.trim()) return;
    const url = normaliseLink(typed);
    if (!url) {
      setError("Enter a valid link, e.g. https://drive.google.com/…");
      return;
    }
    setError(null);
    setLinks((l) => {
      const current = l[field.id] ?? [];
      return current.includes(url) || current.length >= 10 ? l : { ...l, [field.id]: [...current, url] };
    });
    setLinkDrafts((d) => ({ ...d, [field.id]: "" }));
  }

  async function pickImage(field: RequestField, file: File | undefined) {
    if (!file) return;
    try {
      const small = await downscale(file, 900);
      setImages((current) => {
        if (current[field.id]?.url) URL.revokeObjectURL(current[field.id].url!);
        return { ...current, [field.id]: { file: small, url: URL.createObjectURL(small) } };
      });
      setError(null);
    } catch {
      setError(`"${file.name}" could not be read as an image.`);
    }
  }

  function isFilled(field: RequestField): boolean {
    if (field.type === "case") return Boolean(chosenCase);
    if (field.type === "file") return (files[field.id]?.length ?? 0) > 0 || (links[field.id]?.length ?? 0) > 0;
    if (field.type === "image") return Boolean(images[field.id]);
    if (field.type === "balloon") {
      const b = balloons[field.id];
      return Boolean(b && (b.images.length > 0 || b.rows.length > 0));
    }
    return (values[field.id] ?? "").trim() !== "";
  }

  function submit() {
    const missing = fields
      .filter((f) => f.req && !isFilled(f) && !(f.key === "vendor" && (!outsourced || Boolean(byKey("site")))))
      .map((f) => f.label);
    if (missing.length > 0) {
      setError(`Please fill in: ${missing.join(", ")}`);
      return;
    }
    setError(null);

    const formData = new FormData();

    const inspection: Record<string, unknown> = {};
    for (const field of fields) {
      if (field.type === "file") {
        for (const file of files[field.id] ?? []) formData.append(`file:${field.id}`, file);
      } else if (field.type === "image" && images[field.id]) {
        formData.append(`image:${field.id}`, images[field.id].file);
        formData.append(`imageSize:${field.id}`, imageSizes[field.id] ?? "M");
      } else if (field.type === "balloon" && balloons[field.id]) {
        const b = balloons[field.id];
        for (const image of b.images) if (image.file) formData.append(`drawing:${image.id}`, image.file);
        inspection[field.id] = {
          images: b.images.map(({ id, name, w, h }) => ({ id, name, w, h })),
          points: b.points,
          rows: b.rows,
        };
      }
    }
    formData.set("payload", JSON.stringify({ formId: form.id, caseId: chosenCase?.id ?? "", values, links, inspection }));

    startTransition(async () => {
      try {
        const result = await requestPart(formData);
        if (!result.ok) {
          setError(result.message ?? "The part could not be requested.");
          return;
        }
        // From the parts list, open the new part; from a case, go back to its
        // Manufacturing tab, where the part now appears.
        router.push(from === "parts" && result.partId ? `/parts/${result.partId}` : closeHref);
        router.refresh();
      } catch {
        setError("The request did not reach the server — the files may be too large together. Try fewer files, or add them as links.");
      }
    });
  }

  function choices(field: RequestField): Array<{ v: string; l: string }> {
    const plain = (list: readonly string[]) => list.map((o) => ({ v: o, l: o }));
    switch (field.type) {
      case "workflow":
        // The case's product may allow only some workflows for its parts.
        return options.workflows
          .filter((w) => !chosenCase?.workflowIds || chosenCase.workflowIds.includes(w.id))
          // Asked how it is made (and by whom) first: only the workflows that fit.
          .filter((w) => !sourcingField || fits(w, values[sourcingField.id] ?? "", values[byKey("site")?.id ?? ""] ?? ""))
          .map((w) => ({ v: w.id, l: w.sourcing === "Outsourced" && !/outsourc/i.test(w.name) ? `${w.name} · outsourced` : w.name }));
      case "parttype":
        return plain(options.partTypes.map((t) => t.name));
      case "priority":
        return plain(PRIORITIES);
      case "material":
        return plain(options.materials);
      case "printer":
        return plain(options.printers);
      case "sourcing":
        return plain(SOURCING);
      case "vendor":
        return plain(options.vendors);
      case "site":
        // The sites that fit how the part is made, and that its workflows run at.
        return siteChoices(sourcingField ? (values[sourcingField.id] ?? "") : "").map((x) => ({ v: x.id, l: `${x.name} · ${x.type}${x.vendor ? ` (${x.vendor})` : ""}` }));
      default:
        return plain(field.options);
    }
  }

  const emptyHint: Partial<Record<FieldType, string>> = {
    workflow: "No workflows with stages yet — add one in Manufacturing Workflow Setup.",
    parttype: "No part types yet — add them under Part Types.",
    material: "No materials yet — add them under Materials.",
    printer: "No machines yet — add them under Printers & Machines.",
    vendor: "No suppliers yet — add them under Suppliers & Vendors.",
    site: "No site fits — add one under Manufacturing Sites.",
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-[rgba(12,21,36,.55)] px-2 py-3 sm:px-4 sm:py-10">
      <div
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="rq-title"
        tabIndex={-1}
        className="shadow-modal flex w-[780px] max-w-full flex-col overflow-hidden rounded-[14px] bg-white outline-none"
      >
        <div className="border-line-2 flex items-center gap-3 border-b px-4 py-[18px] sm:px-[22px]">
          <h2 id="rq-title" className="m-0 flex-1 text-base font-bold">
            Request a part
          </h2>
          <button
            type="button"
            onClick={close}
            aria-label="Close"
            className="bg-chip text-ink-3 h-[34px] w-[34px] rounded-lg border-0"
          >
            ×
          </button>
        </div>

        <div className="bg-navy flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3.5 sm:px-[22px]">
          <span className="text-navy-muted text-[10.5px] font-semibold tracking-[1px]">PART ID</span>
          <span
            data-testid="part-id"
            data-ready={noId || idReady ? "1" : undefined}
            aria-busy={!noId && !idReady}
            className={"text-brand-glow font-mono text-base font-semibold break-all " + (noId || idReady ? "" : "opacity-50")}
          >
            {partId}
          </span>
        </div>

        {setup.forms.length > 1 ? <FormChooser forms={setup.forms} value={form.id} disabled={pending} onChange={chooseForm} /> : null}

        <CopyFromPart disabled={pending} copied={copied} onPick={applyCopy} onError={setError} />

        <fieldset disabled={pending} className="m-0 flex min-w-0 flex-col gap-[18px] border-0 px-4 py-[18px] sm:px-[22px]">
          {form.sections.map((section) => {
            const shown = section.fields.filter(
              (f) => askedOnRequest(f) && !(f.key === "vendor" && (!outsourced || Boolean(byKey("site")))),
            );
            if (shown.length === 0) return null;
            return (
              <div key={section.id} className="flex flex-col gap-2.5">
                <div className="border-line-3 text-brand border-b pb-1.5 text-[11px] font-bold tracking-[0.8px] uppercase">
                  {section.title}
                </div>
                <div className={`grid gap-3 ${GRID[section.cols]}`}>
                  {shown.map((field) => {
                    const id = `rq-${field.id}`;
                    const list = choices(field);
                    return (
                      <div key={field.id} className={"flex min-w-0 flex-col gap-[5px] " + (isWide(field.type) ? "col-span-full" : "")}>
                        <label htmlFor={id} className="text-ink-2 text-[12.5px] font-semibold">
                          {field.label}
                          {field.req ? <span className="text-brand"> *</span> : null}
                        </label>

                        {field.type === "case" ? (
                          <CasePicker
                            id={id}
                            optional={!field.req}
                            locked={Boolean(lockedCase)}
                            value={chosenCase}
                            recent={recentCases}
                            onChange={setChosenCase}
                          />
                        ) : field.type === "text" || field.type === "number" || field.type === "date" ? (
                          <input
                            id={id}
                            type={field.type}
                            min={field.key === "qty" ? 1 : undefined}
                            step={field.key === "qty" ? 1 : field.type === "number" ? "any" : undefined}
                            inputMode={field.type === "number" ? "decimal" : undefined}
                            value={values[field.id] ?? ""}
                            onChange={(e) => set(field.id, e.target.value)}
                            className={CONTROL}
                          />
                        ) : field.type === "textarea" ? (
                          <textarea
                            id={id}
                            rows={3}
                            value={values[field.id] ?? ""}
                            onChange={(e) => set(field.id, e.target.value)}
                            className="border-field text-ink resize-y rounded-lg border px-2.5 py-2 text-[13.5px]"
                          />
                        ) : field.type === "checkbox" ? (
                          <span className="flex items-center gap-2 text-[13px]">
                            <input
                              id={id}
                              type="checkbox"
                              checked={values[field.id] === "Yes"}
                              onChange={(e) => set(field.id, e.target.checked ? "Yes" : "")}
                              className="m-0 h-4 w-4"
                            />
                            Yes
                          </span>
                        ) : field.type === "image" ? (
                          <div className="border-field flex flex-wrap items-center gap-3 rounded-lg border border-dashed bg-[#FCFCFD] p-2.5">
                            <div className="bg-chip flex h-[84px] w-[120px] flex-none items-center justify-center overflow-hidden rounded-lg">
                              {images[field.id]?.url ? (
                                // eslint-disable-next-line @next/next/no-img-element -- a local preview of the picked file
                                <img src={images[field.id].url} alt={field.label} className="h-full w-full object-contain" />
                              ) : (
                                <span className="text-faint text-[11px]">No image</span>
                              )}
                            </div>
                            <label className="bg-ink relative inline-flex h-[34px] cursor-pointer items-center overflow-hidden rounded-lg px-3.5 text-[12.5px] font-semibold text-white">
                              {images[field.id] ? "Replace image" : "Upload image"}
                              <input
                                id={id}
                                type="file"
                                accept="image/png,image/jpeg,image/webp,image/gif"
                                onChange={(e) => {
                                  void pickImage(field, e.target.files?.[0]);
                                  e.target.value = "";
                                }}
                                className="absolute inset-0 cursor-pointer opacity-0"
                              />
                            </label>
                            {images[field.id] ? (
                              <label className="text-ink-2 flex items-center gap-1.5 text-[12.5px] font-semibold">
                                Display size
                                <select
                                  aria-label={`${field.label} display size`}
                                  value={imageSizes[field.id] ?? "M"}
                                  onChange={(e) => setImageSizes((s) => ({ ...s, [field.id]: e.target.value as ImageSize }))}
                                  className="border-field h-[34px] rounded-lg border bg-white px-2 text-[12.5px] font-normal"
                                >
                                  {IMAGE_SIZES.map((size) => (
                                    <option key={size} value={size}>
                                      {IMAGE_SIZE_LABELS[size]}
                                    </option>
                                  ))}
                                </select>
                              </label>
                            ) : null}
                            {images[field.id] ? (
                              <button
                                type="button"
                                onClick={() =>
                                  setImages((current) => {
                                    const next = { ...current };
                                    if (next[field.id]?.url) URL.revokeObjectURL(next[field.id].url!);
                                    delete next[field.id];
                                    return next;
                                  })
                                }
                                className="text-muted border-0 bg-transparent p-0 text-[12.5px] font-semibold underline"
                              >
                                Remove
                              </button>
                            ) : null}
                          </div>
                        ) : field.type === "file" ? (
                          <div className="flex flex-col gap-2">
                            {field.fileTypes.length > 0 ? (
                              <span
                                onDragOver={(e) => e.preventDefault()}
                                onDrop={(e) => {
                                  e.preventDefault();
                                  addFiles(field, e.dataTransfer.files);
                                }}
                                className="border-field text-muted relative flex flex-col items-center gap-1 rounded-lg border border-dashed bg-[#FCFCFD] p-4 text-center text-[12.5px]"
                              >
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#E24E1B" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12" />
                                </svg>
                                Drag &amp; drop or click to choose {field.fileTypes.join(", ")} files
                                <span className="text-faint text-[11.5px]">Up to 25 MB each — use a download link for anything larger</span>
                                <input
                                  id={id}
                                  type="file"
                                  multiple
                                  accept={extensionsFor(field.fileTypes).join(",")}
                                  onChange={(e) => {
                                    addFiles(field, e.target.files);
                                    e.target.value = "";
                                  }}
                                  className="absolute inset-0 cursor-pointer opacity-0"
                                />
                              </span>
                            ) : null}
                            {(files[field.id]?.length ?? 0) > 0 ? (
                              <div className="flex flex-wrap gap-1.5">
                                {files[field.id].map((file) => (
                                  <span
                                    key={`${file.name}-${file.size}`}
                                    className="inline-flex min-h-7 max-w-full items-center gap-1.5 rounded-full border border-[#5FE9D0] bg-[#F0FDF9] py-0.5 pr-1 pl-2.5 text-xs font-semibold text-[#107569]"
                                  >
                                    <span className="truncate">{file.name}</span>
                                    <button
                                      type="button"
                                      aria-label={`Remove file ${file.name}`}
                                      onClick={() =>
                                        setFiles((f) => ({ ...f, [field.id]: f[field.id].filter((x) => x !== file) }))
                                      }
                                      className="h-5 w-5 flex-none rounded-full border-0 bg-transparent text-[#107569]"
                                    >
                                      ×
                                    </button>
                                  </span>
                                ))}
                              </div>
                            ) : null}
                            {field.allowLinks ? (
                              <div className="flex gap-2">
                                <input
                                  type="url"
                                  aria-label="File download link"
                                  value={linkDrafts[field.id] ?? ""}
                                  onChange={(e) => setLinkDrafts((d) => ({ ...d, [field.id]: e.target.value }))}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") {
                                      e.preventDefault();
                                      addLink(field);
                                    }
                                  }}
                                  placeholder="Or paste a download link (Google Drive, OneDrive, WeTransfer…)"
                                  className="border-field h-9 min-w-0 flex-1 rounded-lg border px-2.5 text-[13px]"
                                />
                                <button
                                  type="button"
                                  onClick={() => addLink(field)}
                                  className="border-field text-ink-2 h-9 flex-none rounded-lg border bg-white px-3 text-[12.5px] font-semibold"
                                >
                                  + Add link
                                </button>
                              </div>
                            ) : null}
                            {(links[field.id]?.length ?? 0) > 0 ? (
                              <div className="flex flex-col gap-1.5">
                                {links[field.id].map((url) => (
                                  <div key={url} className="flex items-center gap-2 rounded-lg border border-[#D1E0FF] bg-[#F5F8FF] px-2.5 py-1.5">
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#155EEF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="flex-none">
                                      <path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" />
                                    </svg>
                                    <a href={url} target="_blank" rel="noopener noreferrer" className="min-w-0 flex-1 truncate text-[12.5px] text-[#155EEF]">
                                      {linkLabel(url)}
                                    </a>
                                    <button
                                      type="button"
                                      aria-label="Remove link"
                                      onClick={() => setLinks((l) => ({ ...l, [field.id]: l[field.id].filter((x) => x !== url) }))}
                                      className="text-faint h-6 w-6 flex-none border-0 bg-transparent"
                                    >
                                      ×
                                    </button>
                                  </div>
                                ))}
                              </div>
                            ) : null}
                          </div>
                        ) : field.type === "balloon" ? (
                          <BalloonEditor
                            columns={field.columns}
                            value={balloons[field.id] ?? emptyBalloons()}
                            onChange={(next) => setBalloons((b) => ({ ...b, [field.id]: next }))}
                            onError={setError}
                          />
                        ) : (
                          <>
                            <select
                              id={id}
                              value={values[field.id] ?? ""}
                              onChange={(e) =>
                                field.type === "workflow"
                                  ? onWorkflow(field.id, e.target.value)
                                  : field.type === "sourcing"
                                    ? onSourcing(field.id, e.target.value)
                                    : field.type === "site"
                                      ? onSite(field.id, e.target.value)
                                      : set(field.id, e.target.value)
                              }
                              className={`${CONTROL} px-2`}
                            >
                              <option value="">{field.type === "workflow" && !field.req ? "Not decided yet — choose later" : "Select…"}</option>
                              {list.map((o) => (
                                <option key={o.v} value={o.v}>
                                  {o.l}
                                </option>
                              ))}
                            </select>
                            {list.length === 0 && emptyHint[field.type] ? (
                              <span className="text-warn text-[11.5px]">{emptyHint[field.type]}</span>
                            ) : field.type === "workflow" && !values[field.id] ? (
                              <span className="text-muted text-[11.5px]">
                                The part gets its stages and quality forms once a workflow is chosen on it.
                              </span>
                            ) : null}
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}

          {error ? (
            <div role="alert" className="text-bad text-[13px]">
              {error}
            </div>
          ) : null}
          <div className="flex flex-col-reverse gap-2.5 sm:flex-row sm:justify-end">
            <button type="button" onClick={close} className="border-field h-10 rounded-[9px] border bg-white px-4 text-[13px] font-semibold">
              Cancel
            </button>
            <button
              type="button"
              onClick={submit}
              className="bg-brand h-10 rounded-[9px] border-0 px-4 text-[13px] font-semibold text-white disabled:opacity-60"
            >
              {pending ? "Requesting…" : "Request part"}
            </button>
          </div>
        </fieldset>
      </div>
    </div>
  );
}

// --- Case picker ------------------------------------------------------------------------

const caseLabel = (c: CaseChoice) => [c.number, c.product || c.scope].filter(Boolean).join(" — ");

/**
 * A space can hold thousands of cases, so the case is searched for rather than
 * picked from one long list: type part of the number, product or surgeon.
 */
/**
 * "What are you requesting?" — the request forms side by side when there are
 * a few, a dropdown when there are many. Shown only when there is a choice.
 */
function FormChooser({
  forms,
  value,
  disabled,
  onChange,
}: {
  forms: RequestFormDef[];
  value: string;
  disabled: boolean;
  onChange: (id: string) => void;
}) {
  const current = forms.find((f) => f.id === value);
  return (
    <div className="border-line-2 flex flex-col gap-2 border-b px-4 py-3.5 sm:px-[22px]">
      <span id="rq-form-label" className="text-ink text-[13px] font-bold">
        What are you requesting?
      </span>
      {forms.length <= 4 ? (
        <div role="radiogroup" aria-labelledby="rq-form-label" className="grid grid-cols-1 gap-2 sm:grid-cols-2">
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
                className={
                  "flex min-w-0 items-start gap-2.5 rounded-[10px] border px-3 py-2.5 text-left " +
                  (on ? "border-brand bg-brand-wash" : "border-field bg-white hover:bg-subtle")
                }
              >
                <span
                  className={"mt-0.5 flex h-4 w-4 flex-none items-center justify-center rounded-full border-2 " + (on ? "border-brand" : "border-field")}
                  aria-hidden="true"
                >
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
          <select
            aria-labelledby="rq-form-label"
            value={value}
            disabled={disabled}
            onChange={(e) => onChange(e.target.value)}
            className={`${CONTROL} px-2 font-semibold`}
          >
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

/**
 * "Start from an earlier part": search the space's parts and fill the form
 * with what one of them was requested with.
 */
function CopyFromPart({
  disabled,
  copied,
  onPick,
  onError,
}: {
  disabled: boolean;
  copied: { partNumber: string; skipped: string[] } | null;
  onPick: (copy: RequestCopy) => void;
  onError: (message: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<{ query: string; rows: EarlierPart[] } | null>(null);
  const [loading, startLoading] = useTransition();
  const typed = query.trim();

  // Search as the person types; an answer that arrives late is not shown against newer typing.
  useEffect(() => {
    if (!open) return;
    let stale = false;
    const timer = setTimeout(async () => {
      try {
        const rows = await searchEarlierParts(typed);
        if (!stale) setFound({ query: typed, rows });
      } catch {
        if (!stale) setFound({ query: typed, rows: [] });
      }
    }, typed ? 250 : 0);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [typed, open]);

  const rows = found?.query === typed ? found.rows : null;

  function pick(part: EarlierPart) {
    startLoading(async () => {
      try {
        const copy = await earlierPartRequest(part.id);
        if (!copy) {
          onError("That part could not be found.");
          return;
        }
        onPick(copy);
        setOpen(false);
        setQuery("");
      } catch {
        onError("The earlier part could not be loaded. Try again.");
      }
    });
  }

  return (
    <div className="border-line-2 bg-subtle flex flex-col gap-2 border-b px-4 py-3 sm:px-[22px]">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="text-ink-2 min-w-0 flex-1 text-[12.5px]">
          {copied ? (
            <>
              Filled from <b className="font-mono">{copied.partNumber}</b> — check every field before requesting. The case, due date,
              files, image and drawings are not copied.
            </>
          ) : (
            "Making something like an earlier part? Fill this form from it."
          )}
        </span>
        <button
          type="button"
          disabled={disabled}
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
          className="border-field text-ink-2 h-[32px] rounded-lg border bg-white px-3 text-[12.5px] font-semibold disabled:opacity-60"
        >
          {open ? "Close" : copied ? "Choose another part" : "Start from an earlier part"}
        </button>
      </div>
      {copied && copied.skipped.length > 0 ? (
        <span className="text-warn text-[12px]">Not filled: {copied.skipped.join("; ")}.</span>
      ) : null}
      {open ? (
        <div className="flex flex-col gap-2">
          <input
            autoFocus
            aria-label="Search earlier parts"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by part ID, name, type or workflow…"
            className={CONTROL}
          />
          <div className="border-line-2 max-h-[240px] overflow-y-auto rounded-lg border bg-white" role="listbox" aria-label="Earlier parts">
            {rows === null ? (
              <div className="text-muted px-3 py-3 text-[12.5px]">Searching…</div>
            ) : rows.length === 0 ? (
              <div className="text-muted px-3 py-3 text-[12.5px]">{typed ? "No parts match." : "No parts requested yet."}</div>
            ) : (
              rows.map((part) => (
                <button
                  key={part.id}
                  type="button"
                  role="option"
                  aria-selected={false}
                  disabled={loading}
                  onClick={() => pick(part)}
                  className="border-line-3 hover:bg-brand-wash flex w-full flex-col items-start gap-0.5 border-0 border-b bg-white px-3 py-2 text-left last:border-b-0 disabled:opacity-60"
                >
                  <span className="flex w-full flex-wrap items-baseline gap-x-2">
                    <span className="text-[13px] font-semibold">{part.name}</span>
                    <span className="text-muted font-mono text-[11.5px] break-all">{part.partNumber}</span>
                  </span>
                  <span className="text-ink-3 text-[11.5px]">
                    {[part.partType, part.workflowName || "No workflow", part.caseNumber ? `Case ${part.caseNumber}` : "No case", part.requestedOn]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function CasePicker({
  id,
  optional,
  locked,
  value,
  recent,
  onChange,
}: {
  id: string;
  /** The part may be requested for no case at all. */
  optional: boolean;
  locked: boolean;
  value: CaseChoice | null;
  recent: CaseChoice[];
  onChange: (next: CaseChoice | null) => void;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  // What the last search returned, and for which text — so an answer that
  // arrives late is never shown against newer typing.
  const [found, setFound] = useState<{ query: string; rows: CaseChoice[] } | null>(null);
  const box = useRef<HTMLDivElement>(null);

  const typed = query.trim();
  const results = !typed ? recent : found?.query === typed ? found.rows : null;

  useEffect(() => {
    if (!open || !typed) return;
    let stale = false;
    const timer = setTimeout(async () => {
      try {
        const rows = await searchRequestCases(typed);
        if (!stale) setFound({ query: typed, rows });
      } catch {
        if (!stale) setFound({ query: typed, rows: [] });
      }
    }, 250);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [typed, open]);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [open]);

  if (locked || (value && !open)) {
    return (
      <div className="flex gap-2">
        <input id={id} readOnly disabled={locked} value={value ? caseLabel(value) : ""} className={CONTROL} />
        {!locked ? (
          <button
            type="button"
            onClick={() => {
              onChange(null);
              setQuery("");
              setOpen(!optional);
            }}
            className="border-field text-ink-2 h-[38px] flex-none rounded-lg border bg-white px-3 text-[12.5px] font-semibold"
          >
            {optional ? "Clear" : "Change"}
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <div ref={box} className="relative">
      <input
        id={id}
        role="combobox"
        aria-expanded={open}
        aria-controls={`${id}-list`}
        aria-autocomplete="list"
        autoComplete="off"
        placeholder={optional ? "No case — or search number, product, surgeon…" : "Search case number, product or surgeon…"}
        value={query}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        className={CONTROL}
      />
      {open ? (
        <ul
          id={`${id}-list`}
          role="listbox"
          className="border-line shadow-popover absolute top-[42px] right-0 left-0 z-10 m-0 max-h-[260px] list-none overflow-y-auto rounded-xl border bg-white p-1"
        >
          {results === null ? (
            <li className="text-muted px-3 py-2.5 text-[12.5px]">Searching…</li>
          ) : results.length === 0 ? (
            <li className="text-muted px-3 py-2.5 text-[12.5px]">No open case matches.</li>
          ) : (
            results.map((c) => (
              <li key={c.id} role="option" aria-selected={false}>
                <button
                  type="button"
                  onClick={() => {
                    onChange(c);
                    setOpen(false);
                  }}
                  className="hover:bg-subtle flex w-full flex-col gap-0.5 rounded-lg border-0 bg-transparent px-3 py-2 text-left"
                >
                  <span className="text-ink text-[13px] font-semibold">
                    <span className="text-brand font-mono text-[12.5px]">{c.number}</span>
                    {c.product ? ` — ${c.product}` : ""}
                  </span>
                  <span className="text-muted truncate text-[11.5px]">{[c.scope, c.surgeon].filter(Boolean).join(" · ") || "—"}</span>
                </button>
              </li>
            ))
          )}
        </ul>
      ) : null}
      {optional ? (
        <span className="text-muted mt-[5px] block text-[11.5px]">
          Leave empty for a part that belongs to no case — stock, a test piece, a demonstration model.
        </span>
      ) : null}
    </div>
  );
}

// --- Images -----------------------------------------------------------------------------

/**
 * A product photo straight from a phone is several megabytes; the record only
 * needs it large enough to recognise the part. Anything bigger than `max` on
 * its longest side is drawn smaller and saved as PNG.
 */
async function downscale(file: File, max: number): Promise<File> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("not an image"));
      el.src = url;
    });
    const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    if (scale === 1 && file.size < 2 * 1024 * 1024) return file;
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) return file;
    context.drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob) return file;
    return new File([blob], file.name.replace(/\.[^.]+$/, "") + ".png", { type: "image/png" });
  } finally {
    URL.revokeObjectURL(url);
  }
}
