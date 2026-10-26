import { RequestDialog } from "@/components/parts/request-dialog";
import type { SessionSpace } from "@/lib/auth/session";
import {
  findRequestCases,
  getRequestSetup,
  requestCase,
  requestCopy,
  requestOptions,
} from "@/lib/parts/queries";

/**
 * The "Request a part" dialog, with everything it needs loaded: the space's
 * form and ID rule, the choices its dropdowns offer, and the case — fixed when
 * the dialog is opened from a case, searched for otherwise.
 */
export async function RequestPart({
  space,
  caseId,
  closeHref,
  from,
  copyFrom,
}: {
  space: SessionSpace;
  caseId?: string;
  /** A part to start from — the part page's Duplicate. */
  copyFrom?: string;
  closeHref: string;
  from: "parts" | "case";
}) {
  const [setup, options, locked, recent, copy] = await Promise.all([
    getRequestSetup(space),
    requestOptions(space.id),
    caseId ? requestCase(space.id, caseId) : null,
    caseId ? [] : findRequestCases(space.id, "", 20),
    copyFrom ? requestCopy(space.id, copyFrom) : null,
  ]);

  return (
    <RequestDialog
      setup={{ rule: setup.rule, forms: setup.forms }}
      initialFormId={copy?.requestFormId ?? null}
      initialCopy={copy}
      options={options}
      lockedCase={locked}
      recentCases={recent}
      spaceName={space.name}
      closeHref={closeHref}
      from={from}
    />
  );
}
