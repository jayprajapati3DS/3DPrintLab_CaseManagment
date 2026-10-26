"use client";

import { useRef, useState, useTransition } from "react";

import { S_BTN_PRIMARY, S_BTN_SMALL, S_INPUT, S_LABEL } from "@/components/setup/ui";
import { useFormAction } from "@/components/setup/use-form-action";
import {
  removePhotoAction,
  saveOverviewAction,
  setPhotoAction,
  suggestIdAction,
} from "@/lib/resources/actions";
import { KINDS, NEW_ID, SWATCHES, type FieldDef, type ResourceKind } from "@/lib/resources/config";
import type { IdRule } from "@/lib/resources/ids";

export interface OverviewOptions {
  technologies: string[];
  /** Records a select may point at, by kind. */
  refs: Partial<Record<ResourceKind, Array<{ id: string; name: string }>>>;
  /** Names offered as suggestions on a free-text field, by kind. */
  suggestions: Partial<Record<ResourceKind, string[]>>;
}

export function OverviewForm({
  resourceId,
  kind,
  name,
  status,
  data,
  options,
  canEdit,
  photoUrl,
  idRule = null,
}: {
  resourceId: string;
  kind: ResourceKind;
  name: string;
  status: string;
  data: Record<string, unknown>;
  options: OverviewOptions;
  canEdit: boolean;
  photoUrl: string | null;
  /** How this kind's ID is made, when it has one. */
  idRule?: IdRule | null;
}) {
  const config = KINDS[kind];
  const { state, pending: saving, onSubmit } = useFormAction(saveOverviewAction);
  const [color, setColor] = useState(String(data.color ?? SWATCHES[0]));

  const value = (key: string) => String(data[key] ?? "");

  function control(field: FieldDef) {
    const common = { id: `f-${field.key}`, name: `f.${field.key}`, disabled: !canEdit };

    if (field.type === "swatch") {
      return (
        <div className="flex gap-2">
          <input type="hidden" name={common.name} value={color} />
          {SWATCHES.map((swatch) => (
            <button
              key={swatch}
              type="button"
              disabled={!canEdit}
              aria-label={`Colour ${swatch}`}
              aria-pressed={color.toLowerCase() === swatch.toLowerCase()}
              onClick={() => setColor(swatch)}
              className="h-[30px] w-[30px] rounded-full border-0"
              style={{
                background: swatch,
                boxShadow: color.toLowerCase() === swatch.toLowerCase() ? "0 0 0 2px #fff, 0 0 0 4px #101828" : undefined,
              }}
            />
          ))}
        </div>
      );
    }

    if (field.type === "select") {
      const choices: Array<{ value: string; label: string }> = field.ref
        ? (options.refs[field.ref] ?? []).map((r) => ({ value: r.id, label: r.name }))
        : (field.optionsFrom ? options.technologies : (field.options ?? [])).map((o) => ({ value: o, label: o }));
      const current = value(field.key);
      // A value that is no longer offered (a technology since removed) still
      // shows, rather than silently becoming something else on the next save.
      const orphan = current && !choices.some((c) => c.value === current);
      return (
        <select {...common} defaultValue={current} className={S_INPUT}>
          {field.ref || field.empty ? <option value="">{field.empty ?? "— select —"}</option> : null}
          {orphan && !field.ref ? <option value={current}>{current}</option> : null}
          {choices.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
      );
    }

    if (field.type === "textarea") {
      return <textarea {...common} defaultValue={value(field.key)} rows={3} className={`${S_INPUT} h-auto py-2`} />;
    }

    if (config.ids && field.key === config.ids.field && idRule) {
      return <IdInput field={field} common={common} initial={value(field.key)} resourceId={resourceId} kind={kind} typeKey={config.ids.type} rule={idRule} canEdit={canEdit} />;
    }

    const listId = field.suggest ? `suggest-${field.key}` : undefined;
    return (
      <>
        <input
          {...common}
          type={field.type === "number" ? "number" : field.type === "date" ? "date" : "text"}
          step={field.step ?? (field.type === "number" ? "any" : undefined)}
          defaultValue={value(field.key)}
          placeholder={field.placeholder}
          list={listId}
          className={S_INPUT + (field.type === "date" || field.type === "number" ? " font-mono" : "")}
        />
        {listId ? (
          <datalist id={listId}>
            {(options.suggestions[field.suggest!] ?? []).map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        ) : null}
      </>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {config.photo && resourceId !== NEW_ID ? <PhotoBlock resourceId={resourceId} photoUrl={photoUrl} canEdit={canEdit} word={config.photoWord ?? "photo"} /> : null}

      <form onSubmit={onSubmit} className="flex flex-col gap-5">
        <input type="hidden" name="id" value={resourceId} />
        <input type="hidden" name="kind" value={kind} />
        <div className="grid grid-cols-1 gap-x-4 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
          <label className="flex flex-col gap-[5px]">
            <span className={S_LABEL}>{config.nameLabel}</span>
            <input name="name" defaultValue={name} disabled={!canEdit} required className={S_INPUT} />
          </label>
          {config.fields.map((field) => (
            <label key={field.key} className="flex flex-col gap-[5px]" htmlFor={`f-${field.key}`}>
              <span className={S_LABEL}>{field.label}</span>
              {control(field)}
            </label>
          ))}
          {config.statuses.length > 0 ? (
            <label className="flex flex-col gap-[5px]">
              <span className={S_LABEL}>Status</span>
              <select name="status" defaultValue={status} disabled={!canEdit} className={S_INPUT}>
                {config.statuses.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </div>

        {canEdit ? (
          <div className="flex items-center gap-3">
            <button type="submit" disabled={saving} className={S_BTN_PRIMARY}>
              {saving ? "Saving…" : "Save changes"}
            </button>
            {state.message ? (
              <span role="status" className={"text-[13px] " + (state.ok ? "text-ok" : "text-bad")}>
                {state.message}
              </span>
            ) : null}
          </div>
        ) : null}
      </form>
    </div>
  );
}

/**
 * A record's ID: typed by hand, or filled from the kind's pattern with
 * Generate. With automatic IDs on, leaving it blank assigns one on save.
 */
function IdInput({
  field,
  common,
  initial,
  resourceId,
  kind,
  typeKey,
  rule,
  canEdit,
}: {
  field: FieldDef;
  common: { id: string; name: string; disabled: boolean };
  initial: string;
  resourceId: string;
  kind: ResourceKind;
  typeKey: string;
  rule: IdRule;
  canEdit: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [pending, startTransition] = useTransition();
  const [note, setNote] = useState<{ text: string; bad: boolean } | null>(null);

  function generate() {
    // The type as currently chosen on the form, for {TYPE}.
    const type = (document.getElementById(`f-${typeKey}`) as HTMLInputElement | HTMLSelectElement | null)?.value ?? "";
    startTransition(async () => {
      try {
        const result = await suggestIdAction(resourceId, type, kind);
        if (result.ok && result.id && input.current) {
          input.current.value = result.id;
          setNote({ text: "Generated — save to keep it.", bad: false });
        } else setNote({ text: result.message ?? "No ID could be generated.", bad: true });
      } catch {
        setNote({ text: "The server could not be reached. Try again.", bad: true });
      }
    });
  }

  return (
    <span className="flex flex-col gap-1">
      <span className="flex gap-2">
        <input
          ref={input}
          {...common}
          type="text"
          defaultValue={initial}
          placeholder={rule.auto ? "Leave blank — assigned on save" : field.placeholder}
          className={S_INPUT + " min-w-0 flex-1 font-mono"}
        />
        {canEdit ? (
          <button type="button" disabled={pending} onClick={generate} className={S_BTN_SMALL + " flex-none"} title={`Fill in the next ID in the format ${rule.pattern}`}>
            {pending ? "…" : "Generate"}
          </button>
        ) : null}
      </span>
      <span className={"text-[11.5px] " + (note?.bad ? "text-bad" : "text-muted")}>
        {note?.text ?? <>Format <span className="font-mono">{rule.pattern}</span>{rule.auto ? " · automatic" : ""} — or type your own</>}
      </span>
    </span>
  );
}

/** Shrink a photo in the browser before it is sent: 640 px is all a list needs. */
async function resize(file: File, logo: boolean): Promise<File> {
  // A logo keeps its own format: an SVG as drawn, a PNG with its transparency.
  if (logo && (file.type === "image/svg+xml" || file.size <= 512 * 1024)) return file;
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 640 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const type = logo ? "image/png" : "image/jpeg";
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, 0.85));
  if (!blob) throw new Error("Could not read that image.");
  return new File([blob], file.name.replace(/\.[^.]+$/, "") + (logo ? ".png" : ".jpg"), { type });
}

function PhotoBlock({ resourceId, photoUrl, canEdit, word }: { resourceId: string; photoUrl: string | null; canEdit: boolean; word: string }) {
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function upload(file: File | undefined) {
    if (!file) return;
    setError(null);
    startTransition(async () => {
      try {
        const form = new FormData();
        form.set("resourceId", resourceId);
        form.set("photo", await resize(file, word === "logo"));
        const result = await setPhotoAction({ ok: true }, form);
        if (!result.ok) setError(result.message ?? `Could not save the ${word}.`);
      } catch {
        setError("Could not read that image.");
      }
      if (input.current) input.current.value = "";
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-4">
      <div className="border-line bg-subtle text-faint flex h-[100px] w-[140px] flex-none items-center justify-center overflow-hidden rounded-[10px] border">
        {photoUrl ? (
          // A stored upload served by this application.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={photoUrl} alt="" className={"h-full w-full " + (word === "logo" ? "bg-white object-contain p-2" : "object-cover")} />
        ) : (
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M3 5h18v14H3zM3 16l5-5 4 4 3-3 6 6M8.5 9.5a1 1 0 1 0 0-2 1 1 0 0 0 0 2z" />
          </svg>
        )}
      </div>
      <div className="flex flex-col gap-2">
        <span className="text-muted text-[12.5px]">{word === "logo" ? "JPG, PNG or SVG" : "JPG or PNG"} — the {word}, shown on cards and in the list.</span>
        {canEdit ? (
          <div className="flex gap-2">
            <input
              ref={input}
              type="file"
              accept={word === "logo" ? ".jpg,.jpeg,.png,.svg,image/jpeg,image/png,image/svg+xml" : "image/*"}
              className="hidden"
              onChange={(e) => upload(e.target.files?.[0])}
            />
            <button type="button" disabled={pending} onClick={() => input.current?.click()} className={S_BTN_SMALL}>
              {pending ? "Uploading…" : photoUrl ? `Replace ${word}` : `Upload ${word}`}
            </button>
            {photoUrl ? (
              <form action={removePhotoAction}>
                <input type="hidden" name="resourceId" value={resourceId} />
                <button type="submit" className={S_BTN_SMALL}>
                  Remove
                </button>
              </form>
            ) : null}
          </div>
        ) : null}
        {error ? (
          <span role="alert" className="text-bad text-[12.5px]">
            {error}
          </span>
        ) : null}
      </div>
    </div>
  );
}
