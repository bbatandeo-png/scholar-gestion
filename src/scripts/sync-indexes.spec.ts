import { createConnection } from 'mongoose';
import { startMongoReplSet } from '../../test/mongo-replset';
import { syncAllIndexes } from './sync-indexes';

describe('sync-indexes', () => {
  let repl: Awaited<ReturnType<typeof startMongoReplSet>>;
  const previousMongoUri = process.env.MONGODB_URI;

  beforeAll(async () => {
    repl = await startMongoReplSet();
    process.env.NODE_ENV = 'test';
    process.env.MONGODB_URI = repl.uri;
  });

  afterAll(async () => {
    if (previousMongoUri) {
      process.env.MONGODB_URI = previousMongoUri;
    } else {
      delete process.env.MONGODB_URI;
    }
    await repl.stop();
  });

  it('detecte un index obsolete (pre-multi-tenant) sur school_years en dry-run, puis le remplace par le bon index scope par ecole avec --apply', async () => {
    // Reproduit exactement le cas reel rencontre en production : un index
    // unique global sur `label` seul, d'avant l'ajout d'ecoleId au schema.
    const seed = await createConnection(repl.uri).asPromise();
    await seed
      .db!.collection('school_years')
      .createIndex({ label: 1 }, { unique: true, name: 'label_1' });
    await seed.close();

    const dryRun = await syncAllIndexes(false);
    const schoolYearsDryRun = dryRun.find(
      (item) => item.collection === 'school_years',
    );
    expect(schoolYearsDryRun).toBeDefined();
    expect(schoolYearsDryRun?.toDrop).toContain('label_1');

    // Dry-run ne doit rien changer sur la base.
    const afterDryRun = await createConnection(repl.uri).asPromise();
    const indexesAfterDryRun = await afterDryRun
      .db!.collection('school_years')
      .indexes();
    expect(indexesAfterDryRun.some((index) => index.name === 'label_1')).toBe(
      true,
    );
    await afterDryRun.close();

    const applied = await syncAllIndexes(true);
    const schoolYearsApplied = applied.find(
      (item) => item.collection === 'school_years',
    );
    expect(schoolYearsApplied?.toDrop).toContain('label_1');

    const verification = await createConnection(repl.uri).asPromise();
    const indexesAfterApply = await verification
      .db!.collection('school_years')
      .indexes();
    expect(indexesAfterApply.some((index) => index.name === 'label_1')).toBe(
      false,
    );
    const correctIndex = indexesAfterApply.find(
      (index) =>
        index.key?.ecoleId === 1 && index.key?.label === 1 && index.unique,
    );
    expect(correctIndex).toBeDefined();
    await verification.close();

    // Idempotent : plus rien a signaler une fois corrige.
    const second = await syncAllIndexes(true);
    expect(
      second.find((item) => item.collection === 'school_years'),
    ).toBeUndefined();
  });
});
