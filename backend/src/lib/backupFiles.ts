/**
 * Encrypting backup files, and deciding which old ones to let go.
 *
 * A backup leaves the droplet for Spaces and for a board-owned drive, so it is
 * encrypted before it leaves: AES-256-GCM with BACKUP_ENCRYPTION_KEY. GCM also
 * proves on decryption that not one byte was changed or cut off.
 *
 * File layout: "ZOILABE1" (8 bytes) · IV (12 bytes) · ciphertext · tag (16 bytes).
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { open, stat } from "node:fs/promises";
import { pipeline } from "node:stream/promises";

const MAGIC = Buffer.from("ZOILABE1");
const IV_BYTES = 12;
const TAG_BYTES = 16;

/** The key from its base64 form, checked to be 32 bytes. */
export function parseBackupKey(base64: string | undefined): Buffer {
  const key = Buffer.from(base64 ?? "", "base64");
  if (key.length !== 32) {
    throw new Error(
      "BACKUP_ENCRYPTION_KEY must be 32 bytes in base64 (`openssl rand -base64 32`). " +
        "Keep a copy off the droplet: without it no backup can be opened.",
    );
  }
  return key;
}

export async function encryptFile(source: string, target: string, key: Buffer): Promise<void> {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const out = createWriteStream(target);

  out.write(MAGIC);
  out.write(iv);
  await pipeline(createReadStream(source), cipher, out, { end: false });
  out.end(cipher.getAuthTag());
  await new Promise<void>((resolve, reject) => {
    out.on("finish", resolve);
    out.on("error", reject);
  });
}

export async function decryptFile(source: string, target: string, key: Buffer): Promise<void> {
  const { size } = await stat(source);
  if (size < MAGIC.length + IV_BYTES + TAG_BYTES) {
    throw new Error("This file is too short to be a backup.");
  }

  const handle = await open(source, "r");
  const header = Buffer.alloc(MAGIC.length + IV_BYTES);
  const tag = Buffer.alloc(TAG_BYTES);
  try {
    await handle.read(header, 0, header.length, 0);
    await handle.read(tag, 0, TAG_BYTES, size - TAG_BYTES);
  } finally {
    await handle.close();
  }

  if (!header.subarray(0, MAGIC.length).equals(MAGIC)) {
    throw new Error("This file is not a Junta de Agua backup.");
  }

  const decipher = createDecipheriv("aes-256-gcm", key, header.subarray(MAGIC.length));
  decipher.setAuthTag(tag);

  await pipeline(
    createReadStream(source, { start: header.length, end: size - TAG_BYTES - 1 }),
    decipher,
    createWriteStream(target),
  );
}

/**
 * Which backups to delete so that only the newest `keep` remain. Names carry a
 * UTC timestamp, so sorting them sorts them by age.
 */
export function expiredBackups(names: readonly string[], keep: number): string[] {
  return [...names].sort().reverse().slice(keep);
}

/** zoilabe-2026-10-23T08-15-00Z.dump.enc — safe in a filename, and sorts by time. */
export function backupName(now: Date = new Date()): string {
  return `zoilabe-${now.toISOString().replace(/:/g, "-").replace(/\.\d+Z$/, "Z")}.dump.enc`;
}
