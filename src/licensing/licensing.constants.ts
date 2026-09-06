// Symmetric secret used to sign/verify this install's license tokens - unique
// per ecole/install (see .env's LICENSE_SECRET), not a single value shared
// across every client. This is what makes it safe for the local
// /platform/ecoles screen to generate a token directly (EcolesController):
// even if one client's exe is ever decompiled, whatever secret it exposes
// only ever forges licenses for that one install, never for any other
// client. Empty when unset (e.g. an online /platform/ecoles deployment that
// deliberately never provisions this) - see LicensingService, which treats
// that as "generation unavailable here" rather than falling back to a
// shared default.
export const LICENSE_HMAC_SECRET = process.env.LICENSE_SECRET ?? '';

// After expiresAt, the app keeps working normally for this many days (with an
// increasingly insistent banner) before switching to read-only - see
// LicensingService.getStatus(). Business choice, not a technical constraint.
export const LICENSE_GRACE_PERIOD_DAYS = 7;

// Days-remaining thresholds (while still in the 'ok' state) at which the
// pre-expiry warning banner starts showing, largest first.
export const LICENSE_WARNING_THRESHOLDS_DAYS = [30, 15, 7, 1];
