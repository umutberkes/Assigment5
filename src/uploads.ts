// STUDENT NAME, STUDENT NUMBER
// Bonus 12: checks for an uploaded image.

export const MAX_UPLOAD_BYTES = 1_000_000;
export const ALLOWED_TYPES = ["image/png", "image/jpeg"] as const;
export type ImageType = (typeof ALLOWED_TYPES)[number];

/**
 * The browser's content type is only a claim. Look at the first bytes ("magic numbers") to
 * see what the file really is: PNG starts with 89 50 4E 47 0D 0A 1A 0A, JPEG with FF D8 FF.
 */
export function sniffImage(bytes: Uint8Array): ImageType | null {
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (png.every((b, i) => bytes[i] === b)) return "image/png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  return null;
}

export function isAllowedType(type: string): type is ImageType {
  return (ALLOWED_TYPES as readonly string[]).includes(type);
}

export const extensionOf = (type: ImageType) => (type === "image/png" ? "png" : "jpg");
