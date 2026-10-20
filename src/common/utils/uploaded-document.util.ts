import { BadRequestException } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { getUploadsRoot } from './runtime-paths.util';

// Wider than uploaded-image.util's whitelist (diplomas/CNI/contracts are
// usually scanned as PDF or photographed) but still a fixed, deliberate
// list - trusted callers only (routes are role-gated), never arbitrary
// executables.
const ALLOWED_DOCUMENT_EXTENSIONS = [
  '.pdf',
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.doc',
  '.docx',
];

export type UploadedDocumentFile = {
  buffer: Buffer;
  originalname: string;
};

// Persists an uploaded document under uploads/<subdir>/<entityId>/<unique
// filename>, unlike saveUploadedImage this NEVER replaces an existing file -
// an entity can hold several attachments at once (diploma + CNI + CV...),
// so each upload gets its own filename derived from the current timestamp.
// Returns the path to store on the attachment's own document, relative to
// the uploads root.
export function saveUploadedDocument(
  subdir: string,
  entityId: string,
  file: UploadedDocumentFile | undefined,
): string {
  if (!file?.buffer) {
    throw new BadRequestException('Aucun fichier reçu');
  }
  const ext = path.extname(file.originalname).toLowerCase();
  if (!ALLOWED_DOCUMENT_EXTENSIONS.includes(ext)) {
    throw new BadRequestException(
      'Format de fichier non supporte (formats acceptes : pdf, png, jpg, jpeg, webp, doc, docx)',
    );
  }

  const dir = path.join(getUploadsRoot(), subdir, entityId);
  fs.mkdirSync(dir, { recursive: true });
  const uniqueName = `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`;
  fs.writeFileSync(path.join(dir, uniqueName), file.buffer);

  return `${subdir}/${entityId}/${uniqueName}`;
}

// Absolute filesystem path for a relative uploads path stored on a
// TeacherDocumentFile, or null when it's absent or no longer resolves to a
// real file on disk - same contract as resolveUploadedImagePath.
export function resolveUploadedDocumentPath(
  relativePath: string | null | undefined,
): string | null {
  if (!relativePath) {
    return null;
  }
  const absolute = path.join(getUploadsRoot(), relativePath);
  return fs.existsSync(absolute) ? absolute : null;
}

// Deletes the file backing a TeacherDocumentFile from disk - best-effort,
// never throws (the DB row is the source of truth for "does this
// attachment exist"; a missing file on disk is logged, not fatal).
export function deleteUploadedDocument(
  relativePath: string | null | undefined,
): void {
  const absolute = resolveUploadedDocumentPath(relativePath);
  if (absolute) {
    try {
      fs.unlinkSync(absolute);
    } catch {
      // Best-effort only.
    }
  }
}
