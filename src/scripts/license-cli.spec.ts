import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  loadRegistry,
  parseExpiry,
  parseFlags,
  registerClientSecret,
  registryPath,
} from './license-cli';

describe('license-cli parseExpiry', () => {
  it('refuse une date absente', () => {
    expect(() => parseExpiry(undefined)).toThrow(/obligatoire/);
  });

  it('refuse une date mal formee (seul AAAA-MM-JJ est accepte)', () => {
    expect(() => parseExpiry('31-01-2027')).toThrow(/invalide/);
    expect(() => parseExpiry('pas-une-date')).toThrow(/invalide/);
  });

  // Regression: the first version of this CLI set the expiry at
  // 23:59:59.999Z ("end of that calendar day"). Every real client of this
  // app is in a positive-UTC-offset timezone (Europe, Afrique de l'Ouest),
  // so toLocaleDateString('fr-FR') on that timestamp rolled into the NEXT
  // day - "--expires 2027-01-31" displayed (and, on /licence, would have
  // been read back) as "01/02/2027". Caught by generating a real code and
  // reading the printed date back during manual verification, not by this
  // test alone - this test exists so it can never silently regress again.
  it("n'avance jamais la date affichee au jour suivant dans un fuseau horaire positif (Europe/Afrique de l'Ouest)", () => {
    const date = parseExpiry('2027-01-31');
    // A fixed, explicit positive offset (UTC+2, the worst case among this
    // app's real client timezones) rather than relying on the test
    // runner's own system timezone - this must hold regardless of where
    // the suite happens to run.
    const UTC_PLUS_2_MS = 2 * 60 * 60 * 1000;
    const localInUtcPlus2 = new Date(date.getTime() + UTC_PLUS_2_MS);
    expect(localInUtcPlus2.getUTCDate()).toBe(31);
    expect(localInUtcPlus2.getUTCMonth()).toBe(0); // January
  });

  it('parse comme minuit UTC, sans heure fournie', () => {
    const date = parseExpiry('2026-12-25');
    expect(date.toISOString()).toBe('2026-12-25T00:00:00.000Z');
  });
});

describe('license-cli parseFlags', () => {
  it('associe chaque --flag a la valeur qui le suit', () => {
    expect(
      parseFlags(['--device', 'ABC123', '--expires', '2027-01-31']),
    ).toEqual({ device: 'ABC123', expires: '2027-01-31' });
  });

  it('traite un flag sans valeur suivante comme un booleen', () => {
    expect(parseFlags(['--reveal-secret'])).toEqual({
      'reveal-secret': 'true',
    });
  });

  it('ignore les arguments positionnels (nom du client)', () => {
    expect(parseFlags(['Mon Ecole', '--device', 'XYZ'])).toEqual({
      device: 'XYZ',
    });
  });
});

describe('license-cli registre local (registerClientSecret / loadRegistry)', () => {
  let originalEnv: string | undefined;
  let tempFile: string;

  beforeEach(() => {
    originalEnv = process.env.SCOLAR_LICENSE_REGISTRY;
    tempFile = path.join(
      os.tmpdir(),
      `scolar-license-registry-spec-${Date.now()}-${Math.random()}.json`,
    );
    process.env.SCOLAR_LICENSE_REGISTRY = tempFile;
  });

  afterEach(() => {
    try {
      fs.unlinkSync(tempFile);
    } catch {
      // Already absent - fine.
    }
    if (originalEnv === undefined) {
      delete process.env.SCOLAR_LICENSE_REGISTRY;
    } else {
      process.env.SCOLAR_LICENSE_REGISTRY = originalEnv;
    }
  });

  it("enregistre un secret et le retrouve via loadRegistry, a l'emplacement attendu", () => {
    registerClientSecret('Ecole Spec', 'le-secret-de-test');

    expect(registryPath()).toBe(tempFile);
    const registry = loadRegistry();
    expect(registry.clients['Ecole Spec'].secret).toBe('le-secret-de-test');
    expect(registry.clients['Ecole Spec'].history).toEqual([]);
  });

  // Regression guard for set-secret: importing the real secret already
  // baked into a client's shipped .env (see /platform/ecoles' Licence
  // panel) must never be silently clobbered by a second, unrelated call -
  // a mismatched secret would make every future generated code fail to
  // verify against that client's real, already-deployed exe.
  it("refuse d'ecraser silencieusement le secret existant d'un client", () => {
    registerClientSecret('Ecole Spec', 'premier-secret');
    expect(() =>
      registerClientSecret('Ecole Spec', 'secret-different'),
    ).toThrow(/deja un secret enregistre/);

    expect(loadRegistry().clients['Ecole Spec'].secret).toBe('premier-secret');
  });

  it('retourne un registre vide quand le fichier n existe pas encore', () => {
    expect(loadRegistry()).toEqual({ clients: {} });
  });
});
