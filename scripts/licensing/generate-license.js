#!/usr/bin/env node
// Outil de secours - depuis que /platform/ecoles peut generer et appliquer
// une licence directement sur le poste concerne (voir EcolesController), ce
// script ne sert plus qu'a produire un code hors-ligne quand on n'a pas
// acces a cet ecran (ex. avant d'avoir cree le compte platform_admin local).
//
// Chaque ecole a maintenant son PROPRE secret (LICENSE_SECRET dans le .env
// de son poste), plus un secret unique partage par tous les clients -
// passe-le explicitement via --secret, ne le mets jamais en dur ici.
//
// Usage :
//   node scripts/licensing/generate-license.js --ecoleId <id> --secret <valeur du LICENSE_SECRET> [--days 365]
//
// L'ecoleId a utiliser est le "code d'installation" affiche sur l'ecran
// /licence (ou /platform/ecoles/<id>/edit) du poste concerne.

const crypto = require('crypto');

function sign(payloadB64, secret) {
  return crypto
    .createHmac('sha256', secret)
    .update(payloadB64)
    .digest('base64url');
}

function createLicenseToken({ ecoleId, issuedAt, expiresAt }, secret) {
  const payloadB64 = Buffer.from(
    JSON.stringify({ ecoleId, issuedAt, expiresAt }),
  ).toString('base64url');
  return `${payloadB64}.${sign(payloadB64, secret)}`;
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i].startsWith('--')) {
      args[argv[i].slice(2)] = argv[i + 1];
      i += 1;
    }
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const ecoleId = args.ecoleId;
  const secret = args.secret;
  const days = Number(args.days ?? 365);

  if (!ecoleId || !/^[a-f0-9]{24}$/i.test(ecoleId)) {
    console.error(
      'Usage: node generate-license.js --ecoleId <id Mongo de 24 caracteres> --secret <LICENSE_SECRET de ce poste> [--days 365]',
    );
    process.exit(1);
  }
  if (!secret) {
    console.error(
      "--secret est requis (valeur de LICENSE_SECRET dans le .env du poste concerne - propre a chaque ecole)",
    );
    process.exit(1);
  }
  if (!Number.isFinite(days) || days <= 0) {
    console.error('--days doit etre un nombre de jours positif');
    process.exit(1);
  }

  const issuedAt = new Date();
  const expiresAt = new Date(issuedAt.getTime() + days * 24 * 60 * 60 * 1000);
  const token = createLicenseToken(
    {
      ecoleId,
      issuedAt: issuedAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
    },
    secret,
  );

  console.log('');
  console.log(`Ecole (code d'installation) : ${ecoleId}`);
  console.log(`Valide jusqu'au              : ${expiresAt.toLocaleDateString('fr-FR')}`);
  console.log('');
  console.log('Code a communiquer au client (a coller dans /licence) :');
  console.log('');
  console.log(token);
  console.log('');
}

main();
