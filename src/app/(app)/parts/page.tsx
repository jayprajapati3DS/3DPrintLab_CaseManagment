import type { Metadata } from "next";

import { PartsBrowser } from "@/app/(app)/parts/parts-browser";
import { RequestPart } from "@/components/parts/request-part";
import { requireSpaceUser } from "@/lib/auth/rbac";
import { listParts, parsePartListParams } from "@/lib/parts/queries";

export const metadata: Metadata = { title: "Parts" };

export default async function PartsPage({ searchParams }: PageProps<"/parts">) {
  const user = await requireSpaceUser();
  const raw = await searchParams;
  const params = parsePartListParams(raw);
  const result = await listParts(user.space.id, params, user);

  // The request form opens over the list, and closes back to the same view.
  const back = new URLSearchParams();
  for (const [key, value] of Object.entries(raw)) {
    if (key !== "request" && key !== "copy" && typeof value === "string") back.set(key, value);
  }
  const closeHref = back.size ? `/parts?${back}` : "/parts";

  return (
    <>
      <PartsBrowser params={params} result={result} />
      {raw.request === "1" && !user.siteOnly ? (
        <RequestPart space={user.space} closeHref={closeHref} from="parts" copyFrom={typeof raw.copy === "string" ? raw.copy : undefined} />
      ) : null}
    </>
  );
}
