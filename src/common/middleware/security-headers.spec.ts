import { Request, Response } from 'express';
import { securityHeaders } from './security-headers';

function run(path: string, secure = false) {
  const headers: Record<string, string> = {};
  const res = {
    setHeader: (name: string, value: string) => {
      headers[name] = value;
    },
  } as unknown as Response;
  const next = jest.fn();
  securityHeaders({ path, secure } as Request, res, next);
  return { headers, next };
}

describe('en-tetes de securite (rapport A15)', () => {
  it('protege les pages de l application', () => {
    const { headers, next } = run('/students');
    expect(headers['X-Content-Type-Options']).toBe('nosniff');
    expect(headers['X-Frame-Options']).toBe('SAMEORIGIN');
    expect(headers['Content-Security-Policy']).toContain("default-src 'self'");
    expect(headers['Content-Security-Policy']).toContain(
      'https://fonts.googleapis.com',
    );
    expect(headers['Strict-Transport-Security']).toBeUndefined();
    expect(next).toHaveBeenCalled();
  });

  it('active HSTS seulement en HTTPS', () => {
    expect(
      run('/dashboard', true).headers['Strict-Transport-Security'],
    ).toContain('max-age=');
  });

  it('laisse le site vitrine contacter son service de formulaire', () => {
    expect(
      run('/vitrine/index.html').headers['Content-Security-Policy'],
    ).toBeUndefined();
  });
});
