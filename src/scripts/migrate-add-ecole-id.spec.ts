import { createConnection } from 'mongoose';
import { startMongoReplSet } from '../../test/mongo-replset';
import { migrateAddEcoleId } from './migrate-add-ecole-id';

describe('migration ecoleId', () => {
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

  it('cree une ecole par defaut, backfill ecoleId partout et reste idempotente', async () => {
    const connection = await createConnection(repl.uri).asPromise();
    const db = connection.db!;

    await db.collection('settings').insertOne({
      key: 'school_name',
      value: 'Complexe Scolaire Migration',
    });
    await db.collection('students').insertOne({
      matricule: 'MIG-001',
      lastname: 'Test',
      firstname: 'Eleve',
    });
    await db.collection('levels').insertOne({
      code: 'MIG-L1',
      label: 'MIG-L1',
      sortOrder: 1,
    });
    await db.collection('payments').insertOne({
      receiptNumber: 'REC-MIG-1',
      amount: 1000,
    });
    await db.collection('users').insertOne({
      name: 'Admin Migration',
      email: 'admin-migration@example.com',
    });
    await connection.close();

    const dryRun = await migrateAddEcoleId(false);
    expect(dryRun.ecoleCreated).toBe(false);
    expect(dryRun.ecoleName).toBe('Complexe Scolaire Migration');
    expect(dryRun.duplicateConflicts).toHaveLength(0);

    const applied = await migrateAddEcoleId(true);
    expect(applied.ecoleCreated).toBe(true);
    expect(applied.ecoleId).toBeTruthy();
    expect(applied.backfilled.students).toBe(1);
    expect(applied.backfilled.levels).toBe(1);
    expect(applied.backfilled.payments).toBe(1);
    expect(applied.backfilled.users).toBe(1);
    expect(applied.backfilled.settings).toBe(1);

    const verification = await createConnection(repl.uri).asPromise();
    const vdb = verification.db!;

    const ecoles = await vdb.collection('ecoles').find().toArray();
    expect(ecoles).toHaveLength(1);
    expect(ecoles[0].nom).toBe('Complexe Scolaire Migration');

    const student = await vdb
      .collection('students')
      .findOne({ matricule: 'MIG-001' });
    expect(String(student?.ecoleId)).toBe(applied.ecoleId);

    const setting = await vdb
      .collection('settings')
      .findOne({ key: 'school_name' });
    expect(String(setting?.ecoleId)).toBe(applied.ecoleId);
    expect(setting?.value).toBe('Complexe Scolaire Migration');

    const studentIndexes = await vdb.collection('students').indexes();
    expect(
      studentIndexes.some(
        (i) =>
          i.unique &&
          JSON.stringify(i.key) === JSON.stringify({ matricule: 1 }),
      ),
    ).toBe(false);
    expect(
      studentIndexes.some(
        (i) =>
          i.unique &&
          JSON.stringify(i.key) ===
            JSON.stringify({ ecoleId: 1, matricule: 1 }),
      ),
    ).toBe(true);

    const levelIndexes = await vdb.collection('levels').indexes();
    expect(
      levelIndexes.some(
        (i) =>
          i.unique &&
          JSON.stringify(i.key) === JSON.stringify({ ecoleId: 1, code: 1 }),
      ),
    ).toBe(true);
    expect(
      levelIndexes.some(
        (i) =>
          i.unique &&
          JSON.stringify(i.key) ===
            JSON.stringify({ ecoleId: 1, sortOrder: 1 }),
      ),
    ).toBe(true);

    await verification.close();

    const second = await migrateAddEcoleId(true);
    expect(second.ecoleCreated).toBe(false);
    expect(second.backfilled.students).toBe(0);
    expect(second.backfilled.levels).toBe(0);
    expect(second.backfilled.payments).toBe(0);
    expect(second.backfilled.users).toBe(0);
    expect(second.backfilled.settings).toBe(0);

    const finalCheck = await createConnection(repl.uri).asPromise();
    expect(await finalCheck.db!.collection('ecoles').countDocuments()).toBe(1);
    await finalCheck.close();
  });
});
