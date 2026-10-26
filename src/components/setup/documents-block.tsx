"use client";

import { Icon, S_BTN_DARK, S_INPUT, SectionCard } from "@/components/setup/ui";
import { useFormAction } from "@/components/setup/use-form-action";
import { removeDocumentAction, uploadDocumentsAction } from "@/lib/resources/actions";
import { DOCUMENT_KINDS } from "@/lib/resources/config";

export interface DocumentRow {
  id: string;
  name: string;
  kind: string;
  /** Where it came from: "Uploaded in Documents", "Qualification · PQ"… */
  source: string;
  date: string;
  sizeLabel: string;
  /** True for evidence attached to a record, which stays with that record. */
  linked: boolean;
}

export function DocumentsBlock({
  resourceId,
  documents,
  canUpload,
  canRemove,
}: {
  resourceId: string;
  documents: DocumentRow[];
  canUpload: boolean;
  canRemove: boolean;
}) {
  const { state, pending, onSubmit } = useFormAction(uploadDocumentsAction, (form) => form.reset());

  return (
    <SectionCard title="Documents" hint="Manuals, SOPs, validation reports, service reports and certificates.">
      {canUpload ? (
        <form onSubmit={onSubmit} className="flex flex-wrap items-center gap-2.5">
          <input type="hidden" name="resourceId" value={resourceId} />
          <select name="kind" defaultValue={DOCUMENT_KINDS[0]} aria-label="Document kind" className={`${S_INPUT} sm:w-[220px]`}>
            {DOCUMENT_KINDS.map((k) => (
              <option key={k}>{k}</option>
            ))}
          </select>
          <input
            name="files"
            type="file"
            multiple
            required
            aria-label="Files"
            className="text-ink-2 max-w-full min-w-0 text-[12.5px] file:border-field file:text-ink file:mr-3 file:h-9 file:rounded-lg file:border file:bg-white file:px-3 file:text-[12.5px] file:font-semibold"
          />
          <button type="submit" disabled={pending} className={S_BTN_DARK}>
            {pending ? "Uploading…" : "+ Upload files"}
          </button>
          {state.message ? (
            <span role="status" className={"text-[12.5px] " + (state.ok ? "text-ok" : "text-bad")}>
              {state.message}
            </span>
          ) : null}
        </form>
      ) : null}

      <div className="border-line flex flex-col overflow-x-auto rounded-[10px] border">
        {documents.length === 0 ? (
          <div className="text-muted px-3 py-8 text-center text-[13px]">No documents attached.</div>
        ) : (
          documents.map((doc) => (
            <div
              key={doc.id}
              className="border-line-3 grid min-w-[680px] grid-cols-[22px_minmax(0,1.6fr)_170px_minmax(0,1.2fr)_100px_70px] items-center gap-3 border-b px-3 py-2.5 text-[13px] last:border-b-0"
            >
              <span className="text-faint">
                <Icon d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6" size={16} />
              </span>
              <a
                href={`/api/files/${doc.id}`}
                target="_blank"
                rel="noreferrer"
                className="text-brand-ink truncate font-semibold no-underline"
                title={doc.name}
              >
                {doc.name}
              </a>
              <span className="text-ink-2 truncate">{doc.kind}</span>
              <span className="text-muted truncate text-[12.5px]">{doc.source}</span>
              <span className="font-mono text-[12.5px]">{doc.date}</span>
              <span className="flex justify-end">
                {doc.linked ? (
                  <span
                    title="Evidence for a record — managed with that record"
                    className="bg-chip text-ink-3 rounded-full px-2 py-0.5 text-[11px] font-semibold"
                  >
                    Record
                  </span>
                ) : canRemove ? (
                  <form action={removeDocumentAction}>
                    <input type="hidden" name="documentId" value={doc.id} />
                    <button
                      type="submit"
                      aria-label={`Remove ${doc.name}`}
                      title="Remove"
                      className="text-muted hover:text-bad h-7 w-7 rounded-md border-0 bg-transparent text-base"
                    >
                      ×
                    </button>
                  </form>
                ) : null}
              </span>
            </div>
          ))
        )}
      </div>
    </SectionCard>
  );
}
