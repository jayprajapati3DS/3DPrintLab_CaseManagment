import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { readStoredFile } from "@/lib/files";

/**
 * Serve a file uploaded with a case opened in this app: DICOM, reports,
 * photos. Looked up by id *and* space, as every stored file is, so
 * an id from another company's space is a 404.
 */

export const dynamic = "force-dynamic";

/** Shown in place; everything else is a download, so nothing uploaded can run as a page. */
const INLINE = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp", "image/gif"]);

export async function GET(_request: Request, { params }: RouteContext<"/api/case-files/[id]">) {
  const session = await getSession();
  if (!session?.user.space) return new NextResponse("Not found", { status: 404 });

  const { id } = await params;
  const file = await db.caseFile.findFirst({ where: { id, spaceId: session.user.space.id } });
  if (!file) return new NextResponse("Not found", { status: 404 });

  let bytes: Buffer;
  try {
    bytes = await readStoredFile(file.storageKey);
  } catch {
    return new NextResponse("This file is no longer in the file store.", { status: 410 });
  }

  const inline = INLINE.has(file.contentType);
  const name = encodeURIComponent(file.name);

  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": inline ? file.contentType : "application/octet-stream",
      "Content-Length": String(bytes.length),
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${name}`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, max-age=300",
    },
  });
}
