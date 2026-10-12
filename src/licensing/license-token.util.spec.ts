import { createLicenseToken, verifyLicenseToken } from './license-token.util';

describe('createLicenseToken / verifyLicenseToken', () => {
  const payload = {
    ecoleId: '507f1f77bcf86cd799439011',
    issuedAt: '2026-01-01T00:00:00.000Z',
    expiresAt: '2027-01-01T00:00:00.000Z',
  };

  it('round-trips a token signed with the embedded secret', () => {
    const token = createLicenseToken(payload);
    expect(verifyLicenseToken(token)).toEqual(payload);
  });

  it('rejects a token whose payload was tampered with', () => {
    const token = createLicenseToken(payload);
    const [payloadB64, signature] = token.split('.');
    const tamperedPayload = Buffer.from(
      JSON.stringify({ ...payload, expiresAt: '2099-01-01T00:00:00.000Z' }),
    ).toString('base64url');
    expect(verifyLicenseToken(`${tamperedPayload}.${signature}`)).toBeNull();
    expect(payloadB64).not.toBe(tamperedPayload);
  });

  it('rejects a token signed with a different secret', () => {
    const forged =
      Buffer.from(JSON.stringify(payload)).toString('base64url') +
      '.not-a-real-signature';
    expect(verifyLicenseToken(forged)).toBeNull();
  });

  it('rejects malformed input instead of throwing', () => {
    expect(verifyLicenseToken('')).toBeNull();
    expect(verifyLicenseToken('not-a-token')).toBeNull();
    expect(verifyLicenseToken('a.b.c')).toBeNull();
  });

  // An explicit secret parameter is what lets EcolesService.
  // streamInstallationPackage and license-cli sign/verify with a given
  // ecole's own persisted secret, never this process's own env -
  // see the function's own comment.
  it('signs and verifies against an explicitly passed secret, independent of each other', () => {
    const tokenA = createLicenseToken(payload, 'secret-ecole-a');
    const tokenB = createLicenseToken(payload, 'secret-ecole-b');

    expect(verifyLicenseToken(tokenA, 'secret-ecole-a')).toEqual(payload);
    expect(verifyLicenseToken(tokenB, 'secret-ecole-b')).toEqual(payload);
    // Cross-verifying with the other ecole's secret must fail - this is the
    // whole point of each ecole having its own unique secret.
    expect(verifyLicenseToken(tokenA, 'secret-ecole-b')).toBeNull();
    expect(verifyLicenseToken(tokenB, 'secret-ecole-a')).toBeNull();
  });
});
