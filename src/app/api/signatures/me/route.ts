import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { readStoredFile } from "@/lib/files";

/**
 * The signed-in person's own signature image — for My account and for the
 * preview when they sign a form. Nobody else's is ever served here; a signed
 * form shows the copy it holds.
 */

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getSession();
  if (!session) return new NextResponse("Not found", { status: 404 });
  const user = await db.user.findUnique({ where: { id: session.user.id }, select: { signatureKey: true, signatureType: true } });
  if (!user?.signatureKey) return new NextResponse("Not found", { status: 404 });

  let bytes: Buffer;
  try {
    bytes = await readStoredFile(user.signatureKey);
  } catch {
    return new NextResponse("This file is no longer in the file store.", { status: 410 });
  }
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": user.signatureType ?? "image/png",
      "Content-Length": String(bytes.length),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
