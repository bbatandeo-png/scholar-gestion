import { createHmac, timingSafeEqual } from 'crypto';
import { getLicenseHmacSecret } from './licensing.constants';

export interface LicensePayload {
  ecoleId: string;
  issuedAt: string;
  expiresAt: string;
}

function sign(payloadB64: string, secret: string): string {
  return createHmac('sha256', secret).update(payloadB64).digest('base64url');
}

// `secret` defaults to this install's own LICENSE_SECRET (the normal case:
// signing/verifying against the install's own env). Explicit callers that
// manage several ecoles' secrets at once - EcolesService.
// streamInstallationPackage (signs with a given ecole's own persisted
// provisioningLicenseSecret, never this process's own env) and the
// `license-cli` tool - pass theirs directly instead.
export function createLicenseToken(
  payload: LicensePayload,
  secret: string = getLicenseHmacSecret(),
): string {
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${payloadB64}.${sign(payloadB64, secret)}`;
}

// Returns null for anything that isn't a validly-signed, well-formed token -
// callers must treat null as "no license" (fail closed), never as "skip the
// check".
export function verifyLicenseToken(
  rawToken: string,
  secret: string = getLicenseHmacSecret(),
): LicensePayload | null {
  const parts = rawToken.trim().split('.');
  if (parts.length !== 2) {
    return null;
  }
  const [payloadB64, signature] = parts;

  const expected = Buffer.from(sign(payloadB64, secret));
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
