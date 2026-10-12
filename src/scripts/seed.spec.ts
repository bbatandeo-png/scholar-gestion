import { createConnection, Types } from 'mongoose';
import { startMongoReplSet } from '../../test/mongo-replset';
import { createLicenseToken } from '../licensing/license-token.util';
import { runSeed, shouldRunSeed } from './seed';

describe('shouldRunSeed', () => {
  it('ne lance pas le seed en environnement de test', () => {
    expect(shouldRunSeed({ NODE_ENV: 'test' })).toBe(false);
  });

  it('lance le seed par défaut hors test', () => {
    expect(shouldRunSeed({ NODE_ENV: 'development' })).toBe(true);
  });

  it('permet de désactiver le seed via variable d’environnement', () => {
    expect(
      shouldRunSeed({
        NODE_ENV: 'development',
        SEED_ON_START: 'false',
      }),
    ).toBe(false);
  });
});

// Regression coverage for a real bug: a vendor who test-launches a freshly
// downloaded package once on their own machine before handing it to the
// client ends up with `existingEcole` truthy on every later restart - the
// LICENSE_BOOTSTRAP_TOKEN must still be (re-)applied then, not just on the
// very first boot ever, or the install silently stays unlicensed forever
// after that first test launch (exactly what happened: "licence de cette
// installation a expire" on a package whose chosen date was months away).
describe('runSeed - LICENSE_BOOTSTRAP_TOKEN applique a chaque demarrage', () => {
  let repl: Awaited<ReturnType<typeof startMongoReplSet>>;
  const previousEnv = { ...process.env };

  beforeAll(async () => {
    repl = await startMongoReplSet();
  });

  afterAll(async () => {
    process.env = { ...previousEnv };
    await repl.stop();
  });

  beforeEach(() => {
    process.env.NODE_ENV = 'test';
    process.env.MONGODB_URI = repl.uri;
    process.env.ADMIN_EMAIL = 'admin-seed-test@example.com';
  });

  it('applique le bootstrap token au premier demarrage, puis le renouvelle au redemarrage suivant (meme avec existingEcole deja present)', async () => {
    const seedEcoleId = new Types.ObjectId().toHexString();
    const licenseSecret = 'secret-de-test-seed-' + seedEcoleId;
    process.env.SEED_ECOLE_ID = seedEcoleId;
    process.env.LICENSE_SECRET = licenseSecret;

    const firstExpiresAt = new Date('2027-03-01');
    process.env.LICENSE_BOOTSTRAP_TOKEN = createLicenseToken(
      {
        ecoleId: seedEcoleId,
        issuedAt: new Date().toISOString(),
        expiresAt: firstExpiresAt.toISOString(),
      },
      licenseSecret,
    );

    await runSeed();

    const afterFirstBoot = await createConnection(repl.uri).asPromise();
    const ecoleAfterFirstBoot = await afterFirstBoot
      .db!.collection('ecoles')
      .findOne({ _id: new Types.ObjectId(seedEcoleId) });
    expect(ecoleAfterFirstBoot).toBeTruthy();
    const licenseAfterFirstBoot = (await afterFirstBoot
      .db!.collection('license_states')
      .findOne({ ecoleId: new Types.ObjectId(seedEcoleId) })) as {
      expiresAt: Date;
    } | null;
    expect(licenseAfterFirstBoot?.expiresAt?.toISOString()).toBe(
      firstExpiresAt.toISOString(),
    );
    await afterFirstBoot.close();

    // Simulates a later restart on the same machine (or a redownloaded
    // package re-signed with a renewed date) - existingEcole is now
    // truthy, which used to silently skip this entirely.
    const secondExpiresAt = new Date('2027-09-01');
    process.env.LICENSE_BOOTSTRAP_TOKEN = createLicenseToken(
      {
        ecoleId: seedEcoleId,
        issuedAt: new Date().toISOString(),
        expiresAt: secondExpiresAt.toISOString(),
      },
      licenseSecret,
    );

    await runSeed();

    const afterSecondBoot = await createConnection(repl.uri).asPromise();
    const licenseAfterSecondBoot = (await afterSecondBoot
      .db!.collection('license_states')
      .findOne({ ecoleId: new Types.ObjectId(seedEcoleId) })) as {
      expiresAt: Date;
    } | null;
    expect(licenseAfterSecondBoot?.expiresAt?.toISOString()).toBe(
      secondExpiresAt.toISOString(),
    );
    await afterSecondBoot.close();
  }, 30000);
});
