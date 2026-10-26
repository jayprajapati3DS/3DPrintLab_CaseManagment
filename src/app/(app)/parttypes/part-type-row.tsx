"use client";

import { useState } from "react";

import { S_BTN_SMALL, S_INPUT, S_TD } from "@/components/setup/ui";
import { useFormAction } from "@/components/setup/use-form-action";
import { removePartTypeAction, updatePartTypeAction } from "@/lib/resources/actions";

export function PartTypeRow({ id, name, code, canEdit }: { id: string; name: string; code: string; canEdit: boolean }) {
  const [draft, setDraft] = useState({ name, code });
  const { state, pending, onSubmit } = useFormAction(updatePartTypeAction);
  const dirty = draft.name !== name || draft.code !== code;

  if (!canEdit) {
    return (
      <tr>
        <td className={`${S_TD} font-semibold`}>{name}</td>
        <td className={`${S_TD} font-mono`}>{code}</td>
        <td className={S_TD} />
      </tr>
    );
  }

  return (
    <tr>
      <td className={S_TD}>
        <input
          form={`pt-${id}`}
          name="name"
          aria-label="Part type"
          value={draft.name}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          className={S_INPUT}
        />
      </td>
      <td className={S_TD}>
        <input
          form={`pt-${id}`}
          name="code"
          aria-label="Code"
          maxLength={6}
          value={draft.code}
          onChange={(e) => setDraft({ ...draft, code: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6) })}
          className={`${S_INPUT} w-[110px] font-mono`}
        />
        {!state.ok && state.message ? (
          <span role="alert" className="text-bad mt-1 block text-[12px]">
            {state.message}
          </span>
        ) : null}
      </td>
      <td className={`${S_TD} whitespace-nowrap`}>
        <span className="flex items-center justify-end gap-1.5">
          <form id={`pt-${id}`} onSubmit={onSubmit}>
            <input type="hidden" name="id" value={id} />
            <button type="submit" disabled={!dirty || pending} className={S_BTN_SMALL}>
              Save
            </button>
          </form>
          <form action={removePartTypeAction}>
            <input type="hidden" name="id" value={id} />
            <button
              type="submit"
              aria-label={`Remove ${name}`}
              title="Remove"
              className="text-muted hover:text-bad h-7 w-7 rounded-md border-0 bg-transparent text-base"
            >
              ×
            </button>
          </form>
        </span>
      </td>
    </tr>
  );
}
