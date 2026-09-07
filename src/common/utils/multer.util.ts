import { Request } from 'express';

// multer ships its own types since v2, but this project has no @types/multer
// and noImplicitAny is off - `require` keeps this untyped rather than
// fighting a module declaration that isn't installed.
// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-assignment
const multer = require('multer');

// A single shared instance, mounted as Express-level middleware (see
// main.ts) ahead of csurf() - csurf only knows how to read a CSRF token out
// of an already-parsed urlencoded/JSON body, and multipart/form-data never
// gets parsed into req.body until multer runs. Running multer here, before
// csurf, is what lets csurf find `_csrf` at all on a multipart POST; without
// this every file-upload form (ecole logo, student photo, student Excel
// import) failed CSRF validation and logged the user out (csrfErrorHandler
// destroys the session on any EBADCSRFTOKEN, indistinguishable from a
// genuinely stale session).
//
// .any() (not .single()/.fields()) because this one instance is shared
// across every multipart route in the app, each with its own field name
// ('logo', 'photo', 'file') - it accepts whatever field is present rather
// than validating an exact name.
//
// Routes that need multipart parsing must NOT also declare
// @UseInterceptors(FileInterceptor(...)) - the request body stream can only
// be consumed once, and this middleware already consumes it. Read the
// uploaded file via pickUploadedFile(req, fieldname) instead of
// @UploadedFile().
// eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
export const multipartUpload = multer({ storage: multer.memoryStorage() });

export function pickUploadedFile(
  req: Request,
  fieldname: string,
): { buffer: Buffer; originalname: string } | undefined {
  const files = (req as unknown as { files?: Array<{ fieldname: string }> })
    .files;
  return files?.find((file) => file.fieldname === fieldname) as
    | { buffer: Buffer; originalname: string }
    | undefined;
}
