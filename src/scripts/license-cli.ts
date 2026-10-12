// Standalone license key-management tool for the developer's own machine -
// deliberately outside the NestJS app (no Mongo connection, starts
// instantly): generating or renewing a client's activation code should
// never require spinning up the whole stack, especially since this is run
// on the VENDOR's computer, never a client's.
//
// Keeps one local registry (outside the repo, never committed) mapping
// client name -> that client's own unique LICENSE_SECRET (see
// src/licensing/licensing.constants.ts - each install's exe gets its own
// secret, so forging one client's token never works for another). This is
// "la cle d'activation chez moi" - the one place the developer needs to
// look to reissue a renewal code for any client, at any time.
//
// Usage (see printHelp() below for the full list):
//   npm run license -- set-secret "Complexe Scolaire Saint Antoine" <secret deja genere par /platform/ecoles>
//   npm run license -- new-secret "Complexe Scolaire Saint Antoine"   (si vous ne passez pas par /platform/ecoles)
//   npm run license -- generate "Complexe Scolaire Saint Antoine" --device <code> --expires 2027-01-31
//   npm run license -- list
//   npm run license -- show "Complexe Scolaire Saint Antoine"
//   npm run license -- verify <token> --client "Complexe Scolaire Saint Antoine"

import { randomBytes } from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  createLicenseToken,
  verifyLicenseToken,
} from '../licensing/license-token.util';

type ClientRecord = {
  secret: string;
  createdAt: string;
  deviceCode: string | null;
  lastExpiresAt: string | null;
  notes: string;
  history: Array<{ issuedAt: string; expiresAt: string; deviceCode: string }>;
};

type Registry = { clients: Record<string, ClientRecord> };

export function registryPath(): string {
  return (
    process.env.SCOLAR_LICENSE_REGISTRY ??
    path.join(os.homedir(), '.scolar-gestion', 'licenses.json')
  );
}

export function loadRegistry(): Registry {
  try {
    const raw = fs.readFileSync(registryPath(), 'utf8');
    const parsed = JSON.parse(raw) as Partial<Registry>;
    return { clients: parsed.clients ?? {} };
  } catch {
    return { clients: {} };
  }
}

function saveRegistry(registry: Registry): void {
  const file = registryPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(registry, null, 2), 'utf8');
  try {
    // Best-effort on POSIX - this file holds every client's secret.
    // Windows ACLs aren't touched here; the registry already lives under
    // the developer's own user profile, which is the practical boundary
    // on that OS.
    fs.chmodSync(file, 0o600);
  } catch {
    // Not fatal - chmod is unsupported/no-op on some platforms (Windows).
  }
}

function newSecret(): string {
  return randomBytes(32).toString('hex');
}

export function parseFlags(args: string[]): Record<string, string> {
  const flags: Record<string, string> = {};
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const value =
        args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : 'true';
      flags[key] = value;
      if (value !== 'true') i += 1;
    }
  }
  return flags;
}

export function parseExpiry(raw: string | undefined): Date {
  if (!raw) {
    throw new Error('--expires <YYYY-MM-DD> est obligatoire');
  }
  // Midnight UTC on that date - same convention as
  // EcolesController.generateLicense()'s `new Date(dto.expiresAt)` on a
  // bare "AAAA-MM-JJ" string (per the ISO 8601 spec, a date-only string
  // parses as UTC midnight). Deliberately NOT end-of-day (23:59:59Z): for
  // every client this app actually ships to (Europe, Afrique de l'Ouest -
  // UTC+0 to UTC+2, no negative offset), converting 23:59:59Z to local
  // time rolls into the NEXT calendar day, so "expires the 31st" would
  // display and even behave as the 1st. Midnight UTC shown in any of
  // those positive-offset timezones stays on the same calendar date.
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Date invalide : "${raw}" (attendu AAAA-MM-JJ)`);
  }
  return date;
}

function printHelp(): void {
  console.log(`
Gestion des licences Scolar-Gestion (outil local, cote developpeur)
Registre : ${registryPath()}

Avant tout, enregistrez le secret du client, d'UNE DE CES DEUX FACONS :

  npm run license -- set-secret "<nom du client>" <secret>
      RECOMMANDE si l'ecole a ete creee sur /platform/ecoles : ce secret
      existe deja (pack d'installation), visible et copiable dans le
      panneau "Licence" de sa fiche (/platform/ecoles/<id>/edit). Il ne
      faut jamais en generer un autre pour cette ecole - un secret
      different ne verifierait aucun code envoye a son exe reel.

  npm run license -- new-secret "<nom du client>"
      Si vous construisez l'exe vous-meme (sans passer par
      /platform/ecoles) : genere un secret et l'enregistre. A faire UNE
      SEULE FOIS par client, avant de builder son exe (voir
      docs/deploiement-offline.md) - le secret genere est la valeur a
      coller dans le LICENSE_SECRET de son .env.

  npm run license -- generate "<nom du client>" --device <code> --expires AAAA-MM-JJ
      Genere un code d'activation/renouvellement pour ce client, en
      reutilisant son secret deja enregistre. <code> est le "code
      d'installation" affiche sur l'ecran /licence du client (visible des
      le premier lancement, meme licence bloquee). Affiche le code a lui
      communiquer (telephone, WhatsApp, email).

  npm run license -- generate --secret <hex> --device <code> --expires AAAA-MM-JJ
      Meme chose sans passer par le registre (secret fourni directement) -
      utile pour la toute premiere activation, avant que le client existe
      dans le registre, ou pour un usage ponctuel.

  npm run license -- list
      Liste les clients enregistres (jamais les secrets eux-memes).

  npm run license -- show "<nom du client>" [--reveal-secret]
      Details d'un client. N'affiche le secret que si --reveal-secret est
      passe explicitement.

  npm run license -- verify <code> --client "<nom du client>"
  npm run license -- verify <code> --secret <hex>
      Decode un code et verifie sa signature avec le secret du client -
      pour controler un code avant de l'envoyer, ou en cas de doute.
`);
}

function cmdNewSecret(args: string[]): void {
  const clientName = args[0];
  if (!clientName) {
    throw new Error('Usage : npm run license -- new-secret "<nom du client>"');
  }
  registerClientSecret(clientName, newSecret());

  const { secret } = loadRegistry().clients[clientName];
  console.log(
    `\nSecret genere pour "${clientName}" et enregistre dans ${registryPath()}\n`,
  );
  console.log('A coller dans le .env de cet exe avant de le builder :\n');
  console.log(`  LICENSE_ENFORCEMENT=on`);
  console.log(`  LICENSE_SECRET=${secret}\n`);
}

// Shared by new-secret (randomly generated) and set-secret (a known value,
// e.g. copied from /platform/ecoles' "Pack d'installation" flow - see that
// screen's Licence panel) - either way the registry only ever holds one
// secret per client name, never silently overwritten.
export function registerClientSecret(clientName: string, secret: string): void {
  const registry = loadRegistry();
  if (registry.clients[clientName]) {
    throw new Error(
      `"${clientName}" a deja un secret enregistre - supprimez-le a la main dans ${registryPath()} si vous voulez vraiment le remplacer (cela invaliderait tout code deja envoye a ce client s'il ne s'agit pas du meme secret).`,
    );
  }
  registry.clients[clientName] = {
    secret,
    createdAt: new Date().toISOString(),
    deviceCode: null,
    lastExpiresAt: null,
    notes: '',
    history: [],
  };
  saveRegistry(registry);
}

// For a client provisioned via /platform/ecoles' "Pack d'installation" -
// that flow already generates and persists its own LICENSE_SECRET (shown
// on the ecole's edit screen, in the Licence panel); this registers that
// EXACT value here instead of minting an unrelated one with new-secret,
// which would never verify against what the client's exe was actually
// built with.
function cmdSetSecret(args: string[]): void {
  const clientName = args[0];
  const secret = args[1];
  if (!clientName || !secret) {
    throw new Error(
      'Usage : npm run license -- set-secret "<nom du client>" <secret>',
    );
  }
  registerClientSecret(clientName, secret);
  console.log(
    `\nSecret enregistre pour "${clientName}" dans ${registryPath()}\n`,
  );
}

function cmdGenerate(args: string[]): void {
  const flags = parseFlags(args);
  const clientName = args[0] && !args[0].startsWith('--') ? args[0] : undefined;

  let secret = flags.secret;
  let registry: Registry | null = null;
  if (!secret) {
    if (!clientName) {
      throw new Error(
        'Indiquez soit un nom de client enregistre, soit --secret <hex> directement.',
      );
    }
    registry = loadRegistry();
    const record = registry.clients[clientName];
    if (!record) {
      throw new Error(
        `Client "${clientName}" introuvable dans le registre (${registryPath()}). Utilisez "new-secret" d'abord, ou passez --secret directement.`,
      );
    }
    secret = record.secret;
  }

  const device = flags.device;
  if (!device) {
    throw new Error(
      '--device <code> est obligatoire (le "code d\'installation" affiche sur /licence chez le client).',
    );
  }
  const expiresAt = parseExpiry(flags.expires);

  // createLicenseToken() reads its signing secret from process.env at call
  // time (see licensing.constants.ts) - this is the one place a CLI
  // juggling several clients' secrets sets it, right before signing, and
  // only for that one call.
  process.env.LICENSE_SECRET = secret;
  const token = createLicenseToken({
    ecoleId: device,
    issuedAt: new Date().toISOString(),
    expiresAt: expiresAt.toISOString(),
  });

  if (registry && clientName) {
    const record = registry.clients[clientName];
    record.deviceCode = device;
    record.lastExpiresAt = expiresAt.toISOString();
    record.history.push({
      issuedAt: new Date().toISOString(),
      expiresAt: expiresAt.toISOString(),
      deviceCode: device,
    });
    saveRegistry(registry);
  }

  console.log(
    `\nCode d'activation (valable jusqu'au ${expiresAt.toLocaleDateString('fr-FR')}) :\n`,
  );
  console.log(token);
  console.log(
    '\nA coller par le client dans Licence > "Code de renouvellement" > Appliquer le code.\n',
  );
}

function cmdList(): void {
  const registry = loadRegistry();
  const names = Object.keys(registry.clients);
  if (!names.length) {
    console.log(`Aucun client enregistre (${registryPath()}).`);
    return;
  }
  console.log(`\nClients enregistres (${registryPath()}) :\n`);
  for (const name of names) {
    const record = registry.clients[name];
    const expiry = record.lastExpiresAt
      ? new Date(record.lastExpiresAt).toLocaleDateString('fr-FR')
      : 'jamais active';
    console.log(
      `  - ${name} — expire le ${expiry} — code d'installation : ${record.deviceCode ?? 'inconnu'}`,
    );
  }
  console.log('');
}

function cmdShow(args: string[]): void {
  const flags = parseFlags(args);
  const clientName = args[0];
  if (!clientName) {
    throw new Error(
      'Usage : npm run license -- show "<nom du client>" [--reveal-secret]',
    );
  }
  const registry = loadRegistry();
  const record = registry.clients[clientName];
  if (!record) {
    throw new Error(`Client "${clientName}" introuvable.`);
  }
  console.log(`\n${clientName}`);
  console.log(
    `  cree le : ${new Date(record.createdAt).toLocaleDateString('fr-FR')}`,
  );
  console.log(`  code d'installation : ${record.deviceCode ?? 'inconnu'}`);
  console.log(
    `  expire le : ${record.lastExpiresAt ? new Date(record.lastExpiresAt).toLocaleDateString('fr-FR') : 'jamais active'}`,
  );
  if (flags['reveal-secret']) {
    console.log(`  secret : ${record.secret}`);
  }
  if (record.history.length) {
    console.log('  historique :');
    for (const entry of record.history) {
      console.log(
        `    - emis le ${new Date(entry.issuedAt).toLocaleDateString('fr-FR')}, expire le ${new Date(entry.expiresAt).toLocaleDateString('fr-FR')}`,
      );
    }
  }
  console.log('');
}

function cmdVerify(args: string[]): void {
  const flags = parseFlags(args);
  const token = args[0];
  if (!token) {
    throw new Error(
      'Usage : npm run license -- verify <code> --client "<nom>" | --secret <hex>',
    );
  }

  let secret = flags.secret;
  if (!secret && flags.client) {
    const registry = loadRegistry();
    const record = registry.clients[flags.client];
    if (!record) {
      throw new Error(`Client "${flags.client}" introuvable.`);
    }
    secret = record.secret;
  }
  if (!secret) {
    throw new Error(
      'Precisez --client "<nom>" ou --secret <hex> pour verifier la signature.',
    );
  }

  process.env.LICENSE_SECRET = secret;
  const payload = verifyLicenseToken(token);
  if (!payload) {
    console.log('\nCode invalide ou signature incorrecte pour ce secret.\n');
    process.exitCode = 1;
    return;
  }
  console.log('\nCode valide :');
  console.log(`  code d'installation : ${payload.ecoleId}`);
  console.log(
    `  emis le : ${new Date(payload.issuedAt).toLocaleString('fr-FR')}`,
  );
  console.log(
    `  expire le : ${new Date(payload.expiresAt).toLocaleString('fr-FR')}\n`,
  );
}

function main(): void {
  const [, , command, ...rest] = process.argv;
  try {
    switch (command) {
      case 'new-secret':
        return cmdNewSecret(rest);
      case 'set-secret':
        return cmdSetSecret(rest);
      case 'generate':
        return cmdGenerate(rest);
      case 'list':
        return cmdList();
      case 'show':
        return cmdShow(rest);
      case 'verify':
        return cmdVerify(rest);
      case undefined:
      case '--help':
      case '-h':
      case 'help':
        return printHelp();
      default:
        console.error(`Commande inconnue : "${command}"\n`);
        printHelp();
        process.exitCode = 1;
    }
  } catch (error) {
    console.error(
      `\nErreur : ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}
