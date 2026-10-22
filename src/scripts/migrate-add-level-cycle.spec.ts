import { createConnection } from 'mongoose';
import { startMongoReplSet } from '../../test/mongo-replset';
import { migrateAddLevelCycle } from './migrate-add-level-cycle';

describe('migration level.cycle', () => {
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

  it('infere le cycle college/lycee a partir du code, reste sans effet en dry-run, ignore les codes non reconnus, est idempotente', async () => {
    const connection = await createConnection(repl.uri).asPromise();
    const db = connection.db!;

    await db.collection('levels').insertOne({
      code: '6EME',
      label: '6eme',
      sortOrder: 1,
    });
    await db.collection('levels').insertOne({
      code: '2NDE',
      label: '2nde',
      sortOrder: 2,
    });
    await db.collection('levels').insertOne({
      code: 'CLASSE-SPECIALE',
      label: 'Classe speciale',
      sortOrder: 3,
    });
    await connection.close();

    const dryRun = await migrateAddLevelCycle(false);
    expect(dryRun.backfilled).toBe(2);
    expect(dryRun.unrecognized.map((u) => u.code)).toEqual(['CLASSE-SPECIALE']);

    const verifyAfterDryRun = await createConnection(repl.uri).asPromise();
    const untouched = await verifyAfterDryRun
      .db!.collection('levels')
      .find()
      .toArray();
    expect(untouched.every((l) => l.cycle === undefined)).toBe(true);
    await verifyAfterDryRun.close();

    const applied = await migrateAddLevelCycle(true);
    expect(applied.backfilled).toBe(2);
    expect(applied.unrecognized.map((u) => u.code)).toEqual([
      'CLASSE-SPECIALE',
    ]);

    const verification = await createConnection(repl.uri).asPromise();
    const vdb = verification.db!;

    const college = await vdb.collection('levels').findOne({ code: '6EME' });
    expect(college?.cycle).toBe(1);
    const lycee = await vdb.collection('levels').findOne({ code: '2NDE' });
    expect(lycee?.cycle).toBe(2);
    const unrecognizedLevel = await vdb
      .collection('levels')
      .findOne({ code: 'CLASSE-SPECIALE' });
    expect(unrecognizedLevel?.cycle).toBeUndefined();

    await verification.close();

    const second = await migrateAddLevelCycle(true);
    expect(second.backfilled).toBe(0);
    expect(second.unrecognized.map((u) => u.code)).toEqual(['CLASSE-SPECIALE']);
  });

  // Rapport A24 : CP1 a CM2 ranges dans « Collège » (crees avant le cycle
  // Primaire) sont remis dans le bon cycle.
  it('replace les classes du primaire classees a tort en college', async () => {
    const connection = await createConnection(repl.uri).asPromise();
    await connection.db!.collection('levels').insertOne({
      code: 'CP1',
      label: 'CP1',
      sortOrder: 10,
      cycle: 1,
    });
    await connection.close();

    const applied = await migrateAddLevelCycle(true);
    expect(applied.backfilled).toBe(1);

    const verification = await createConnection(repl.uri).asPromise();
    const cp1 = await verification
      .db!.collection('levels')
      .findOne({ code: 'CP1' });
    expect(cp1?.cycle).toBe(3);
    await verification.close();
  });
});
