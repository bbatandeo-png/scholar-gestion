import { NextFunction, Request, Response } from 'express';

// En-tetes de securite de l'application (rapport A15), sans dependance
// externe. La politique de contenu n'autorise que le site lui-meme et les
// polices Google utilisees par les pages ; le site vitrine (/vitrine), qui
// envoie son formulaire de contact a un service tiers, n'est pas concerne.
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  // Les pages contiennent des scripts et styles en ligne.
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com data:",
  "img-src 'self' data: blob:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'self'",
].join('; ');

export function securityHeaders(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader(
    'Permissions-Policy',
    'camera=(), microphone=(), geolocation=(), payment=()',
  );
  if (!req.path.startsWith('/vitrine')) {
    res.setHeader('Content-Security-Policy', CONTENT_SECURITY_POLICY);
  }
  // HSTS seulement derriere HTTPS (version en ligne), jamais sur le poste
  // local en http.
  if (req.secure) {
    res.setHeader(
      'Strict-Transport-Security',
      'max-age=31536000; includeSubDomains',
    );
  }
  next();
}
