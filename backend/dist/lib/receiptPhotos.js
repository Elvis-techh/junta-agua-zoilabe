/**
 * Photos of expense receipts and invoices (App Plan, Module 2).
 *
 * Until the private storage bucket is connected they stay on the computer
 * (App Plan, Phase 2): one JPEG per photo in the receipts folder, beside the
 * database file. `receipt_files` says which entry each belongs to, by a
 * `storage_key` that is already the name the photo will have in the bucket,
 * so moving them later is a copy, not a change to any row.
 *
 * The phone shrinks a photo before sending it (frontend/src/photo.ts), so it
 * fits in one request on weak signal and under Nginx's 1 MB limit.
 */
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { HttpError } from "./http.js";
/** The largest photo kept. As base64 in the request it stays under Nginx's 1 MB. */
export const MAX_PHOTO_BYTES = 700_000;
export const PHOTO_CONTENT_TYPE = "image/jpeg";
const NOT_A_PHOTO = new HttpError(400, "invalid_photo", "No se pudo leer la foto. Tómela de nuevo.");
/** The photo's bytes from its base64 form, checked to be a JPEG of a size the phone would send. */
export function decodePhoto(base64) {
    if (base64.length > Math.ceil((MAX_PHOTO_BYTES * 4) / 3) + 4) {
        throw new HttpError(400, "photo_too_large", "La foto es demasiado grande. Tómela de nuevo.");
    }
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) {
        throw NOT_A_PHOTO;
    }
    const bytes = Buffer.from(base64, "base64");
    // Every JPEG starts with these three bytes. Nothing else is kept or served as a photo.
    if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) {
        throw NOT_A_PHOTO;
    }
    return bytes;
}
/** The name a photo has in the receipts folder and, later, in the bucket. */
export function photoKey(id) {
    return `receipts/${id}.jpg`;
}
/** Where the photo with this key sits on the computer. */
export function photoFile(receiptsPath, storageKey) {
    return join(receiptsPath, storageKey.slice(storageKey.lastIndexOf("/") + 1));
}
/** Write a photo for the receipt file `id`. Refuses to write over one that is already there. */
export async function savePhoto(receiptsPath, id, bytes) {
    const storageKey = photoKey(id);
    await mkdir(receiptsPath, { recursive: true, mode: 0o700 });
    await writeFile(photoFile(receiptsPath, storageKey), bytes, { flag: "wx", mode: 0o600 });
    return storageKey;
}
/**
 * Take away a photo that no entry points to: its expense was refused, or
 * was a retry of one already saved. Not a record, so nothing is lost; a
 * photo that stays behind does no harm either.
 */
export async function discardUnusedPhoto(receiptsPath, storageKey) {
    await unlink(photoFile(receiptsPath, storageKey)).catch(() => undefined);
}
//# sourceMappingURL=receiptPhotos.js.map