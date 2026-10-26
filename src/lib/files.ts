import "server-only";

import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { env } from "@/lib/env";

/**
 * The file store: documents, reports and photos attached to records.
 *
 * Files are written to a directory on the server, one folder per company
 * space, under a random name — never the name they were uploaded with, so a
 * crafted filename can neither escape the directory nor collide with another
 * file. The original name, type and size live in the database beside the key.
 *
 * The directory must be on persistent storage and included in backups: it
 * holds qualification and calibration evidence. Swapping this for object
 * storage later means replacing these four functions.
 */

/** Per file. Reports and certificates are PDFs of a few megabytes at most. */
export const MAX_FILE_BYTES = 25 * 1024 * 1024;

const ROOT = path.resolve(env.STORAGE_DIR);

function resolveKey(key: string): string {
  // Keys are generated here as `<spaceId>/<uuid>`; refuse anything else, so a
  // key read back from the database can never point outside the store.
  if (!/^[a-z0-9]+\/[a-f0-9-]{36}$/.test(key)) throw new Error("Invalid storage key.");
  return path.join(ROOT, key);
}

export async function saveFile(spaceId: string, bytes: Buffer): Promise<string> {
  const key = `${spaceId}/${randomUUID()}`;
  const target = resolveKey(key);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, bytes, { flag: "wx" });
  return key;
}

export async function readStoredFile(key: string): Promise<Buffer> {
  return readFile(resolveKey(key));
}

export async function deleteStoredFile(key: string): Promise<void> {
  await rm(resolveKey(key), { force: true });
}

/** A name safe to put in a Content-Disposition header and show in a list. */
export function cleanFileName(name: string): string {
  const base = name.replace(/^.*[\\/]/, "").replace(/[\u0000-\u001f"<>|:*?]/g, "").trim();
  return (base || "file").slice(0, 180);
}
