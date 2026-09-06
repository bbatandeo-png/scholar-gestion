import { BadRequestException } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { getUploadsRoot } from './runtime-paths.util';

// Trusted callers only (routes are role-gated) but still restricted to
// plain image formats a browser and PDFKit can both read - anything else
// is rejected outright rather than stored.
const ALLOWED_IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp', '.gif'];

export type UploadedImageFile = {
  buffer: Buffer;
  originalname: string;
};

// Persists an uploaded image under uploads/<subdir>/<entityId>/<baseName>.<ext>
// (see runtime-paths.util - never inside pkg's read-only bundled assets),
// replacing whatever was there before regardless of its previous extension
// (a re-upload in a different format must not leave the old file behind,
// unreferenced but never cleaned up). Returns the path to store on the
// entity's document, relative to the uploads root. A no-op (returns null)
// when no file was submitted - callers treat that as "leave the existing
// image untouched".
export function saveUploadedImage(
  subdir: string,
  entityId: string,
  baseName: string,
  file: UploadedImageFile | undefined,
): string | null {
  if (!file?.buffer) {
    return null;
  }
  const ext = path.extname(file.originalname).toLowerCase();
  if (!ALLOWED_IMAGE_EXTENSIONS.includes(ext)) {
    throw new BadRequestException(
      'Format d image non supporte (formats acceptes : png, jpg, jpeg, webp, gif)',
    );
  }

  const dir = path.join(getUploadsRoot(), subdir, entityId);
  fs.mkdirSync(dir, { recursive: true });
  for (const existing of fs.readdirSync(dir)) {
    if (existing.startsWith(`${baseName}.`)) {
      fs.unlinkSync(path.join(dir, existing));
    }
  }
  fs.writeFileSync(path.join(dir, `${baseName}${ext}`), file.buffer);

  return `${subdir}/${entityId}/${baseName}${ext}`;
}

// Absolute filesystem path for a relative uploads path stored on a
// document (as returned by saveUploadedImage), or null when it's absent or
// no longer resolves to a real file on disk.
export function resolveUploadedImagePath(
  relativePath: string | null | undefined,
): string | null {
  if (!relativePath) {
    return null;
  }
  const absolute = path.join(getUploadsRoot(), relativePath);
  return fs.existsSync(absolute) ? absolute : null;
}
