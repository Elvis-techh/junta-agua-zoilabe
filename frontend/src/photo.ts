/**
 * A photo of a receipt, made small enough to send on weak signal.
 *
 * A phone camera's photo is several megabytes. Before it is sent it is drawn
 * again, smaller, as a JPEG: readable for a receipt, and under the size the
 * server keeps (backend/src/lib/receiptPhotos.ts) and Nginx lets through in
 * one request.
 */

/** The size a photo is brought under before it is sent. The server keeps up to 700,000 bytes. */
export const PHOTO_TARGET_BYTES = 600_000;

/** The sizes and qualities tried in turn, until one fits: the longest side in pixels, and the JPEG quality. */
export const PHOTO_ATTEMPTS: ReadonlyArray<{ side: number; quality: number }> = [
  { side: 1600, quality: 0.75 },
  { side: 1400, quality: 0.65 },
  { side: 1200, quality: 0.55 },
  { side: 1000, quality: 0.5 },
  { side: 800, quality: 0.45 },
];

/** A width and height brought within `side` on their longest side, never enlarged, with the same shape. */
export function fitWithin(width: number, height: number, side: number): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= side) {
    return { width, height };
  }
  const scale = side / longest;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

export interface Photo {
  /** The JPEG, in base64, as the server takes it. */
  base64: string;
  /** An address for showing it on this phone. Let go of with `URL.revokeObjectURL`. */
  previewUrl: string;
}

const UNREADABLE = "No se pudo leer la foto. Tómela de nuevo.";

/** The photo the treasurer took or chose, shrunk to a JPEG that fits. */
export async function shrinkPhoto(file: Blob): Promise<Photo> {
  const picture = await loadPicture(file);
  try {
    for (const attempt of PHOTO_ATTEMPTS) {
      const size = fitWithin(picture.width, picture.height, attempt.side);
      const canvas = document.createElement("canvas");
      canvas.width = size.width;
      canvas.height = size.height;
      const context = canvas.getContext("2d");
      if (!context) {
        throw new Error(UNREADABLE);
      }
      // White behind it: a picture with see-through parts would turn black as a JPEG.
      context.fillStyle = "#fff";
      context.fillRect(0, 0, size.width, size.height);
      context.drawImage(picture.source, 0, 0, size.width, size.height);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", attempt.quality));
      if (blob && blob.size <= PHOTO_TARGET_BYTES) {
        return { base64: await toBase64(blob), previewUrl: URL.createObjectURL(blob) };
      }
    }
  } finally {
    picture.close();
  }
  throw new Error("La foto es demasiado grande. Tómela de nuevo, más de cerca.");
}

/** The picture ready to draw, turned the way it was taken. */
async function loadPicture(file: Blob): Promise<{ source: CanvasImageSource; width: number; height: number; close: () => void }> {
  if ("createImageBitmap" in window) {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
      return { source: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() };
    } catch {
      // An older phone: the <img> below reads it instead.
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    return { source: image, width: image.naturalWidth, height: image.naturalHeight, close: () => undefined };
  } catch {
    throw new Error(UNREADABLE);
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function toBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let text = "";
  // In pieces: one call with every byte as an argument is more than a phone allows.
  for (let at = 0; at < bytes.length; at += 0x8000) {
    text += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
  }
  return btoa(text);
}
