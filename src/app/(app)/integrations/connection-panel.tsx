"use client";

import { useRouter } from "next/navigation";
import { useActionState, useState, useTransition } from "react";

import {
  runSyncAction,
  saveConnectionAction,
  testConnectionAction,
  type ActionResult,
  type ConnectionTest,
} from "@/app/(app)/integrations/actions";
import { BTN_PRIMARY, BTN_SECONDARY, CARD, CARD_HEADER, INPUT, LABEL } from "@/components/ui/styles";

export interface ConnectionView {
  domainUrl: string;
  serviceEmail: string;
  hasPassword: boolean;
  dateFormat: string;
  timezone: string;
}

const DATE_FORMATS = ["dd-mm-yyyy", "dd/mm/yyyy", "mm/dd/yyyy", "mm-dd-yyyy", "yyyy-mm-dd"];

const IDLE: ActionResult = { ok: true };

export function ConnectionPanel({ connection }: { connection: ConnectionView | null }) {
  const router = useRouter();
  const [saved, save, saving] = useActionState(saveConnectionAction, IDLE);
  const [test, setTest] = useState<ConnectionTest | null>(null);
  const [notice, setNotice] = useState<ActionResult | null>(null);
  const [busy, startTransition] = useTransition();

  function runTest() {
    setNotice(null);
    startTransition(async () => {
      const result = await testConnectionAction();
      if (result.ok && result.data) setTest(result.data);
      else setNotice({ ok: result.ok, message: result.message });
      router.refresh();
    });
  }

  function runSync() {
    setNotice(null);
    startTransition(async () => {
      setNotice(await runSyncAction());
      router.refresh();
    });
  }

  return (
    <section className={CARD}>
      <div className={CARD_HEADER}>
        <div className="flex flex-col gap-0.5">
          <h2 className="m-0 text-[15px] font-semibold">3D Surgical Platform</h2>
          <p className="text-muted m-0 text-[12.5px]">
            Where this space&rsquo;s people sign in, and where its cases are pulled from.
          </p>
        </div>
      </div>

      <form action={save} className="flex flex-col gap-4 px-5 py-5">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label className="col-span-2 flex flex-col gap-1.5">
            <span className={LABEL}>Platform URL</span>
            <input
              name="domainUrl"
              type="url"
              required
              defaultValue={connection?.domainUrl ?? ""}
              placeholder="https://your-company.3dsurgical.com"
              className={`${INPUT} font-mono text-[13px]`}
            />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className={LABEL}>Service account email</span>
            <input
              name="serviceEmail"
              type="email"
              autoComplete="off"
              defaultValue={connection?.serviceEmail ?? ""}
              placeholder="service@company.com"
              className={INPUT}
            />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className={LABEL}>Service account password</span>
            <input
              name="servicePassword"
              type="password"
              autoComplete="new-password"
              placeholder={connection?.hasPassword ? "Saved — leave blank to keep it" : "Password"}
              className={INPUT}
            />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className={LABEL}>Platform date format</span>
            <select
              name="dateFormat"
              defaultValue={connection?.dateFormat ?? "dd-mm-yyyy"}
              className={`${INPUT} font-mono text-[13px]`}
            >
              {DATE_FORMATS.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1.5">
            <span className={LABEL}>Timezone</span>
            <input
              name="timezone"
              required
              defaultValue={connection?.timezone ?? "Asia/Kolkata"}
              className={`${INPUT} font-mono text-[13px]`}
            />
          </label>
        </div>

        <p className="text-muted m-0 text-[12.5px] leading-[1.5]">
          The service account must be an <strong>Admin</strong> on the platform. The platform only
          returns the cases the signed-in role may see, so any other account syncs part of the data
          and still looks successful.
        </p>

        {saved.message ? (
          <p role="status" className={"m-0 text-[13px] " + (saved.ok ? "text-ok" : "text-bad")}>
            {saved.message}
          </p>
        ) : null}

        <div className="flex flex-wrap items-center gap-2.5">
          <button type="submit" disabled={saving} className={BTN_PRIMARY}>
            {saving ? "Saving…" : "Save connection"}
          </button>
          <button
            type="button"
            onClick={runTest}
            disabled={busy || !connection}
            className={BTN_SECONDARY}
          >
            Test connection
          </button>
          <button
            type="button"
            onClick={runSync}
            disabled={busy || !connection}
            className={BTN_SECONDARY}
          >
            Sync now
          </button>
          {busy ? <span className="text-muted text-[13px]">Working…</span> : null}
          {notice?.message ? (
            <span role="status" className={"text-[13px] " + (notice.ok ? "text-ok" : "text-bad")}>
              {notice.message}
            </span>
          ) : null}
        </div>
      </form>

      {test ? <TestReport test={test} /> : null}
    </section>
  );
}

function TestReport({ test }: { test: ConnectionTest }) {
  const checks: Array<[string, boolean, string]> = [
    ["Domain", test.domainVerified, test.tenantName ?? "Recognised by the platform"],
    [
      "Service account",
      test.loginOk,
      test.loginOk ? `Signed in · role group ${test.roleGroup ?? "unknown"}` : "Not signed in",
    ],
    [
      "Cases",
      test.sampleTotal !== null,
      test.sampleTotal !== null
        ? `${test.sampleTotal.toLocaleString("en-IN")} active cases visible to this account`
        : "Not fetched",
    ],
  ];

  return (
    <div className="border-line-3 flex flex-col gap-3 border-t px-5 py-5">
      <h3 className="m-0 text-[13px] font-bold">Connection test</h3>
      <div className="flex flex-col gap-2">
        {checks.map(([label, ok, detail]) => (
          <div key={label} className="grid grid-cols-[110px_60px_minmax(0,1fr)] items-center gap-3 sm:grid-cols-[130px_70px_minmax(0,1fr)] text-[13px]">
            <span className="text-ink-2 font-semibold">{label}</span>
            <span
              className={
                "justify-self-start rounded-full px-2 py-0.5 text-[11px] font-semibold " +
                (ok ? "bg-ok-tint text-ok" : "bg-bad-tint text-bad")
              }
            >
              {ok ? "OK" : "Failed"}
            </span>
            <span className="text-ink-3">{detail}</span>
          </div>
        ))}
      </div>

      {test.warnings.length > 0 ? (
        <ul className="bg-warn-tint text-warn m-0 flex list-none flex-col gap-1.5 rounded-[10px] border border-[#FEDF89] px-3.5 py-3 text-[13px] leading-[1.45]">
          {test.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      ) : null}

      {test.availableKeys.length > 0 ? (
        <details className="text-[13px]">
          <summary className="text-ink-2 cursor-pointer font-semibold">
            Fields the platform returns on a case ({test.availableKeys.length})
          </summary>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {test.availableKeys.map((k) => (
              <code key={k} className="bg-chip text-ink-2 rounded-[5px] px-1.5 py-0.5 font-mono text-[11.5px]">
                {k}
              </code>
            ))}
          </div>
        </details>
      ) : null}
    </div>
  );
}
