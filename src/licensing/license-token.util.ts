import { createHmac, timingSafeEqual } from 'crypto';
import { LICENSE_HMAC_SECRET } from './licensing.constants';

export interface LicensePayload {
  ecoleId: string;
  issuedAt: string;
  expiresAt: string;
}

function sign(payloadB64: string): string {
  return createHmac('sha256', LICENSE_HMAC_SECRET)
    .update(payloadB64)
    .digest('base64url');
}

export function createLicenseToken(payload: LicensePayload): string {
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${payloadB64}.${sign(payloadB64)}`;
}

// Returns null for anything that isn't a validly-signed, well-formed token -
// callers must treat null as "no license" (fail closed), never as "skip the
// check".
export function verifyLicenseToken(rawToken: string): LicensePayload | null {
  const parts = rawToken.trim().split('.');
  if (parts.length !== 2) {
    return null;
  }
  const [payloadB64, signature] = parts;

  const expected = Buffer.from(sign(payloadB64));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(
      Buffer.from(payloadB64, 'base64url').toString('utf8'),
    );
    const candidate = parsed as Partial<LicensePayload> | null;
    if (
      typeof candidate?.ecoleId !== 'string' ||
      typeof candidate?.issuedAt !== 'string' ||
      typeof candidate?.expiresAt !== 'string' ||
      Number.isNaN(new Date(candidate.expiresAt).getTime())
    ) {
      return null;
    }
    return candidate as LicensePayload;
  } catch {
    return null;
  }
}
