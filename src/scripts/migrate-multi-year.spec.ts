import { createConnection, Types } from 'mongoose';
import { startMongoReplSet } from '../../test/mongo-replset';
import { migrateMultiYear } from './migrate-multi-year';

describe('migration multi-annees', () => {
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

  it('annualise les documents existants et reste idempotente', async () => {
    const connection = await createConnection(repl.uri).asPromise();
    const db = connection.db!;
    const yearId = new Types.ObjectId();
    const studentId = new Types.ObjectId();
    const levelId = new Types.ObjectId();
    const enrollmentId = new Types.ObjectId();
    const invoiceId = new Types.ObjectId();

    await db.collection('school_years').insertOne({
      _id: yearId,
      label: '2040-2041',
      startDate: new Date('2040-09-01'),
      endDate: new Date('2041-06-30'),
      status: 'open',
    });
    await db.collection('students').insertOne({
      _id: studentId,
      matricule: 'MIG-1',
      lastname: 'Test',
      firstname: 'Migration',
    });
    await db.collection('levels').insertOne({
      _id: levelId,
      code: 'MIG-L1',
      label: 'MIG-L1',
      sortOrder: 1,
    });
    await db.collection('enrollments').insertOne({
      _id: enrollmentId,
      studentId,
      levelId,
      schoolYearId: yearId,
      status: 'active',
    });
    await db.collection('invoices').insertOne({
      _id: invoiceId,
      enrollmentId,
      totalDue: 100,
      paidAmount: 20,
      balanceDue: 80,
    });
    await db.collection('payments').insertOne({
      invoiceId,
      amount: 20,
      paidAt: new Date('2040-10-01'),
    });
    await db.collection('expenses').insertOne({
      expenseDate: new Date('2040-11-01'),
      amount: 10,
    });
    await db.collection('expenses').insertOne({
      expenseDate: new Date('2040-07-09'),
      amount: 15,
    });
    await connection.close();

    const first = await migrateMultiYear(true);
    const second = await migrateMultiYear(true);

    const verification = await createConnection(repl.uri).asPromise();
    expect(first.invoicesBackfilled).toBe(1);
    expect(first.paymentsBackfilled).toBe(1);
    expect(first.expensesBackfilled).toBe(2);
    expect(first.ambiguousExpenses).toHaveLength(1);
    expect(second.invoicesBackfilled).toBe(0);
    expect(second.paymentsBackfilled).toBe(0);
    expect(second.expensesBackfilled).toBe(0);
    expect(
      await verification
        .db!.collection('invoices')
        .countDocuments({ schoolYearId: yearId }),
    ).toBe(1);
    expect(
      await verification
        .db!.collection('payments')
        .countDocuments({ schoolYearId: yearId }),
    ).toBe(1);
    expect(
      await verification
        .db!.collection('expenses')
        .countDocuments({ schoolYearId: yearId }),
    ).toBe(2);
    await verification.close();
  });
});
