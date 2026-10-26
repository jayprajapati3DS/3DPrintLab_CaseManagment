"use client";

import { useState, useTransition, type FormEvent } from "react";

import type { ActionResult } from "@/lib/resources/actions";

/**
 * Submit a form to a server action without losing what was typed.
 *
 * React resets an uncontrolled form after its `action` runs — fine on success,
 * maddening when the action answers "that date is in the future" and the whole
 * form is blank again. Submitting by hand keeps the fields as they are; the
 * caller resets or closes the form on success if that is what it wants.
 */
export function useFormAction(
  action: (previous: ActionResult, formData: FormData) => Promise<ActionResult>,
  onSuccess?: (form: HTMLFormElement) => void,
) {
  const [state, setState] = useState<ActionResult>({ ok: true });
  const [pending, startTransition] = useTransition();

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    startTransition(async () => {
      const result = await action({ ok: true }, formData);
      setState(result);
      if (result.ok) onSuccess?.(form);
    });
  }

  return { state, pending, onSubmit };
}
