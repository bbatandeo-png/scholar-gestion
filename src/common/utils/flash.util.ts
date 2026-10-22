import { Request } from 'express';

// Champs jamais renvoyes au navigateur : jeton, secrets, fichiers.
const NEVER_REFILLED =
  /^(_csrf|_method|password|newPassword|confirmPassword|currentPassword)$/;

// { guardians: [{ fullname: 'X' }] } -> { 'guardians[0][fullname]': 'X' }
// (les noms exacts des champs du formulaire).
export function flattenFormBody(
  body: unknown,
  prefix = '',
  out: Record<string, string> = {},
) {
  if (body === null || body === undefined) {
    return out;
  }
  if (typeof body !== 'object') {
    if (prefix && !NEVER_REFILLED.test(prefix)) {
      out[prefix] = typeof body === 'string' ? body : JSON.stringify(body);
    }
    return out;
  }
  for (const [key, value] of Object.entries(body as Record<string, unknown>)) {
    const name = prefix ? `${prefix}[${key}]` : key;
    if (!prefix && NEVER_REFILLED.test(key)) {
      continue;
    }
    flattenFormBody(value, name, out);
  }
  return out;
}

export function setFlash(
  req: Request,
  type: 'success' | 'error',
  message: string,
) {
  if (req.session) {
    req.session.flash = { type, message };
    // Formulaire refuse : on garde la saisie pour la re-remplir au lieu de
    // vider tous les champs (rapport A04).
    if (type === 'error' && req.method === 'POST' && req.body) {
      req.session.oldInput = {
        action: (req.originalUrl ?? '').split('?')[0],
        values: flattenFormBody(req.body),
      };
    } else {
      delete req.session.oldInput;
    }
  }
}
