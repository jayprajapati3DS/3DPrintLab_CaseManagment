"use client";

import { useState, useTransition } from "react";

import { revealPatientAction, type PatientDetails } from "@/app/(app)/cases/actions";

/**
 * Patient identifiers, masked until asked for. `initial` is the first letter of
 * the name only — the most the page itself ever carries.
 */
export function PatientPanel({
  caseId,
  initial,
  hasPatient,
}: {
  caseId: string;
  initial: string;
  hasPatient: boolean;
}) {
  const [details, setDetails] = useState<PatientDetails | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function toggle() {
    if (details) {
      setDetails(null);
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        const result = await revealPatientAction(caseId);
        if (result) setDetails(result);
        else setError("This case is no longer available.");
      } catch {
        setError("Could not load patient details. Please try again.");
      }
    });
  }

  const masked = !details;

  return (
    <section className="flex flex-col gap-3.5">
      <div className="flex items-center gap-3">
        <h4 className="text-brand m-0 text-[11px] font-bold tracking-[0.8px] uppercase">
          Patient information
        </h4>
        {hasPatient ? (
          <button
            type="button"
            onClick={toggle}
            disabled={pending}
            className="text-warn h-7 rounded-[7px] border border-[#FEDF89] bg-[#FFFAEB] px-2.5 text-xs font-semibold disabled:opacity-60"
          >
            {pending ? "Loading…" : masked ? "View patient details" : "Hide patient details"}
          </button>
        ) : null}
      </div>

      {hasPatient ? (
        <div className="grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2">
          <Value label="Patient name" mono={masked}>
            {masked ? `${initial}·······` : (details.name ?? "—")}
          </Value>
          <Value label="Age" mono={masked}>
            {masked ? "••" : (details.age ?? "—")}
          </Value>
          <Value label="Gender" mono={masked}>
            {masked ? "••••" : (details.gender ?? "—")}
          </Value>
        </div>
      ) : (
        <p className="text-muted m-0 text-[13px]">The platform sent no patient details for this case.</p>
      )}

      {masked && hasPatient ? (
        <p className="text-muted m-0 text-xs">
          Viewing patient details is recorded in the audit log.
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-bad m-0 text-[13px]">
          {error}
        </p>
      ) : null}
    </section>
  );
}

function Value({
  label,
  mono,
  children,
}: {
  label: string;
  mono: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className="text-muted text-[11px] font-semibold tracking-[0.5px] uppercase">{label}</div>
      <div className={"text-sm font-medium " + (mono ? "text-ink-3 font-mono" : "")}>{children}</div>
    </div>
  );
}
