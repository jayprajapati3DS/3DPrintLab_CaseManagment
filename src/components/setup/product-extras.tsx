"use client";

import Link from "next/link";
import { useState, useTransition } from "react";

import { Row, SectionHead } from "@/components/setup/stage-board";
import type { ProductExtras } from "@/lib/cases/catalog";
import { uploadProductFileAction } from "@/lib/resources/actions";
import { NEW_ID } from "@/lib/resources/config";

/**
 * A product's — or a sub-scope's — image, viewers and scan protocols. Files
 * are uploaded to the product straight away and kept when it is saved.
 */

export interface ViewerOption {
  id: string;
  name: string;
  type: string;
}

export function ProductExtrasPanel({
  title,
  hint,
  productId,
  value,
  onChange,
  viewers,
  canEdit,
  embedded = false,
  withImage = true,
}: {
  title: string;
  hint: string;
  productId: string;
  value: ProductExtras;
  onChange: (patch: Partial<ProductExtras>) => void;
  viewers: ViewerOption[];
  canEdit: boolean;
  /** Inside another card: a section of it rather than a card of its own. */
  embedded?: boolean;
  /** Off where the image is shown elsewhere — at the top of the product page. */
  withImage?: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const saved = productId !== NEW_ID;

  // One file or several (scan protocols), each kept with who uploaded it and when.
  function upload(kind: "Photo" | "Scan protocol", files: File[]) {
    if (files.length === 0) return;
    setError(null);
    startTransition(async () => {
      const added: NonNullable<Awaited<ReturnType<typeof uploadProductFileAction>>["file"]>[] = [];
      try {
        for (const file of files) {
          const data = new FormData();
          data.set("productId", productId);
          data.set("kind", kind);
          data.set("file", file);
          const result = await uploadProductFileAction(data);
          if (!result.ok || !result.file) {
            setError(result.message ?? `"${file.name}" could not be uploaded.`);
            break;
          }
          added.push(result.file);
        }
      } catch {
        setError("The server could not be reached. Try again.");
      }
      if (added.length === 0) return;
      if (kind === "Photo") onChange({ imageId: added[0].id });
      else onChange({ protocols: [...value.protocols, ...added] });
    });
  }

  const fileButton = (label: string, kind: "Photo" | "Scan protocol", accept?: string) => (
    <label
      className={
        "border-field text-ink-2 relative inline-flex h-8 items-center overflow-hidden rounded-lg border bg-white px-3 text-[12px] font-semibold " +
        (saved && canEdit && !pending ? "cursor-pointer hover:bg-subtle" : "opacity-50")
      }
      title={saved ? undefined : "Save the product first"}
    >
      {pending ? "Uploading…" : label}
      <input
        type="file"
        aria-label={label}
        accept={accept}
        multiple={kind === "Scan protocol"}
        disabled={!saved || !canEdit || pending}
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = "";
          upload(kind, kind === "Photo" ? files.slice(0, 1) : files);
        }}
        className="absolute inset-0 cursor-pointer opacity-0"
      />
    </label>
  );

  const Shell = embedded ? "div" : "section";
  return (
    <Shell className={embedded ? "" : "border-line overflow-hidden rounded-[14px] border bg-white"} aria-label={title} role={embedded ? "group" : undefined}>
      {embedded ? <SectionHead title={title} /> : null}
      <div className={"border-line-2 flex flex-col gap-0.5 border-b px-4 sm:px-[22px] " + (embedded ? "py-2" : "py-3")}>
        {embedded ? null : <h3 className="m-0 text-sm font-bold">{title}</h3>}
        <p className="text-muted m-0 text-[12.5px]">{hint}</p>
        {!saved ? <p className="text-warn m-0 text-[12px] font-semibold">Save the product first — then add its image and scan protocols.</p> : null}
      </div>

      {withImage ? (
      <Row label="Image" hint="Shown on the case form and the case list.">
        <span className="flex flex-wrap items-center gap-3">
          {value.imageId ? (
            // eslint-disable-next-line @next/next/no-img-element -- a stored upload, served by the files route
            <img src={`/api/files/${value.imageId}`} alt="" className="border-line h-14 w-14 rounded-lg border bg-white object-contain" />
          ) : (
            <span className="border-field text-faint flex h-14 w-14 items-center justify-center rounded-lg border border-dashed text-[10.5px]">No image</span>
          )}
          {canEdit ? fileButton(value.imageId ? "Change image" : "Upload image", "Photo", "image/png,image/jpeg,image/webp,image/gif") : null}
          {canEdit && value.imageId ? (
            <button type="button" onClick={() => onChange({ imageId: "" })} className="text-bad border-0 bg-transparent p-0 text-[12px] font-semibold">
              Remove
            </button>
          ) : null}
        </span>
      </Row>
      ) : null}

      <Row label="Viewers" hint={value.viewerIds.length ? `${value.viewerIds.length} associated — each stage sets its buttons below.` : "None associated."}>
        {viewers.length ? (
          <div role="group" aria-label={`${title} viewers`} className="flex flex-wrap gap-1.5">
            {viewers.map((v) => {
              const on = value.viewerIds.includes(v.id);
              return (
                <button
                  key={v.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => onChange({ viewerIds: on ? value.viewerIds.filter((x) => x !== v.id) : [...value.viewerIds, v.id] })}
                  className={"flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold " + (on ? "border-brand-edge bg-brand-wash text-brand-ink" : "border-field text-ink-2 bg-white")}
                >
                  <span aria-hidden="true">{on ? "✓" : "+"}</span>
                  {v.name}
                  {v.type && v.type !== v.name ? <span className="text-muted font-normal"> · {v.type}</span> : null}
                </button>
              );
            })}
          </div>
        ) : (
          <span className="text-muted text-[12px]">
            No viewers yet — add them on the{" "}
            <Link href="/viewers" className="text-brand-ink font-semibold">
              Viewer list
            </Link>
            .
          </span>
        )}
      </Row>

      <Row label="Scan protocol" hint="One or more — the scan settings to send the hospital (PDF, Word…).">
        <span className="flex flex-wrap items-center gap-1.5">
          {value.protocols.length ? (
            <ul className="m-0 contents list-none p-0" aria-label={`${title} scan protocols`}>
              {value.protocols.map((f) => (
                <li key={f.id} className="bg-chip flex max-w-full items-center gap-1.5 rounded-full py-1 pr-1.5 pl-2.5 text-xs font-semibold">
                  <a href={`/api/files/${f.id}`} target="_blank" rel="noopener noreferrer" className="text-brand-ink truncate underline">
                    {f.name}
                  </a>
                  {f.by || f.at ? (
                    <span className="text-muted font-normal whitespace-nowrap">
                      {[f.by, f.at ? f.at.slice(0, 16).replace("T", " ") : null].filter(Boolean).join(" · ")}
                    </span>
                  ) : null}
                  {canEdit ? (
                    <button
                      type="button"
                      aria-label={`Remove ${f.name}`}
                      onClick={() => onChange({ protocols: value.protocols.filter((x) => x.id !== f.id) })}
                      className="text-muted hover:text-bad h-4 w-4 rounded-full border-0 bg-transparent p-0 leading-none"
                    >
                      ×
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <span className="text-faint mr-1 text-[12px]">None yet.</span>
          )}
          {canEdit ? fileButton("Upload protocols", "Scan protocol") : null}
        </span>
      </Row>
      {error ? (
        <p role="alert" className="text-bad m-0 px-4 pb-3 text-[12px] sm:px-[22px]">
          {error}
        </p>
      ) : null}
    </Shell>
  );
}

/**
 * The product's image, large, at the top of its page: click to upload or
 * change it. Uploaded to the product straight away, kept when it is saved.
 */
export function ProductImage({
  productId,
  imageId,
  onChange,
  canEdit,
}: {
  productId: string;
  imageId: string;
  onChange: (imageId: string) => void;
  canEdit: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const saved = productId !== NEW_ID;
  const usable = saved && canEdit && !pending;

  function upload(file: File | undefined) {
    if (!file) return;
    const data = new FormData();
    data.set("productId", productId);
    data.set("kind", "Photo");
    data.set("file", file);
    setError(null);
    startTransition(async () => {
      try {
        const result = await uploadProductFileAction(data);
        if (!result.ok || !result.file) return setError(result.message ?? "The image could not be uploaded.");
        onChange(result.file.id);
      } catch {
        setError("The server could not be reached. Try again.");
      }
    });
  }

  return (
    <div className="flex flex-none flex-col items-center gap-1" data-testid="product-image-top">
      <label
        title={saved ? (imageId ? "Change the image" : "Upload an image") : "Save the product first"}
        className={
          "border-field relative flex h-[96px] w-[96px] items-center justify-center overflow-hidden rounded-[14px] border bg-white " +
          (imageId ? "" : "border-dashed ") +
          (usable ? "hover:border-brand-edge cursor-pointer" : "")
        }
      >
        {imageId ? (
          // eslint-disable-next-line @next/next/no-img-element -- a stored upload, served by the files route
          <img src={`/api/files/${imageId}`} alt="" className="h-full w-full object-contain p-1.5" />
        ) : (
          <span className="text-faint px-2 text-center text-[11px] leading-[1.3]">{pending ? "Uploading…" : saved ? "Add image" : "Image after the first save"}</span>
        )}
        <input
          type="file"
          aria-label={imageId ? "Change image" : "Upload image"}
          accept="image/png,image/jpeg,image/webp,image/gif"
          disabled={!usable}
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            upload(file);
          }}
          className="absolute inset-0 cursor-pointer opacity-0 disabled:cursor-default"
        />
      </label>
      {imageId && canEdit ? (
        <button type="button" onClick={() => onChange("")} className="text-bad border-0 bg-transparent p-0 text-[11px] font-semibold">
          Remove
        </button>
      ) : null}
      {error ? (
        <span role="alert" className="text-bad max-w-[120px] text-center text-[11px]">
          {error}
        </span>
      ) : null}
    </div>
  );
}
