import type { Metadata } from "next";

import QaFormsPage from "@/app/(app)/qaforms/page";

export const metadata: Metadata = { title: "Variable List" };

/** The variable library — the {…} values QA forms can fetch — as a page of its own in the sidebar. */
export default async function VariablesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = await searchParams;
  return QaFormsPage({ params: Promise.resolve({}), searchParams: Promise.resolve({ ...query, view: "vars" }) } as unknown as Parameters<typeof QaFormsPage>[0]);
}
