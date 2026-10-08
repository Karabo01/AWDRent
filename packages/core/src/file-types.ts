// Upload type checks from the file's own bytes. The browser's content type
// and the file extension are ignored: a renamed .exe is still refused.

export interface DetectedType {
  contentType: "application/pdf" | "image/jpeg" | "image/png";
  extension: "pdf" | "jpg" | "png";
}

const starts = (b: Uint8Array, sig: number[]) => sig.every((v, i) => b[i] === v);

export function detectFileType(bytes: Uint8Array): DetectedType | null {
  if (starts(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return { contentType: "application/pdf", extension: "pdf" }; // %PDF-
  if (starts(bytes, [0xff, 0xd8, 0xff])) return { contentType: "image/jpeg", extension: "jpg" };
  if (starts(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { contentType: "image/png", extension: "png" };
  return null;
}

/** Display/download name: no paths, no control characters, at most 120 characters. */
export function cleanFilename(name: string, extension: string): string {
  const base = (name.split(/[\\/]/).pop() ?? "")
    // eslint-disable-next-line no-control-regex -- stripping control characters is the point
    .replace(/[\u0000-\u001f\u007f"<>|:*?]/g, "")
    .replace(/\.[^.]*$/, "")
    .trim()
    .slice(0, 100);
  return `${base || "document"}.${extension}`;
}
