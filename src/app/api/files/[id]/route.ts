import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { readStoredFile } from "@/lib/files";

/**
 * Serve a stored document or photo.
 *
 * Only to someone signed in to the space the file belongs to: the file is
 * looked up by id *and* space, so an id from another company's space is a 404,
 * the same as one that does not exist.
 */

export const dynamic = "force-dynamic";

/**
 * Types a browser may display in place. Everything else is sent as a download
 * with a generic type, so an uploaded HTML or SVG file can never run as a page
 * of this application.
 */
const INLINE = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp", "image/gif"]);

export async function GET(_request: Request, { params }: RouteContext<"/api/files/[id]">) {
  const session = await getSession();
  if (!session?.user.space) return new NextResponse("Not found", { status: 404 });

  const { id } = await params;
  const document = await db.resourceDocument.findFirst({
    where: { id, spaceId: session.user.space.id },
  });
  if (!document) return new NextResponse("Not found", { status: 404 });

  let bytes: Buffer;
  try {
    bytes = await readStoredFile(document.storageKey);
  } catch {
    return new NextResponse("This file is no longer in the file store.", { status: 410 });
  }

  // An SVG logo shows as an image, sandboxed so its scripts can never run.
  const svg = document.contentType === "image/svg+xml" && document.kind === "Photo";
  const inline = svg || INLINE.has(document.contentType);
  // RFC 5987, so names with non-ASCII characters survive.
  const name = encodeURIComponent(document.name);

  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": inline ? document.contentType : "application/octet-stream",
      ...(svg ? { "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; img-src data:; sandbox" } : {}),
      "Content-Length": String(bytes.length),
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${name}`,
      "X-Content-Type-Options": "nosniff",
      // Patient-adjacent records: not for shared caches.
      "Cache-Control": "private, max-age=300",
    },
  });
}
