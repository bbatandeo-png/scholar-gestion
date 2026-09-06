import { Connection, Model, Schema, Types, createConnection } from 'mongoose';
import { startMongoReplSet } from '../../../test/mongo-replset';
import { ecoleScopePlugin } from './ecole-scope.plugin';
import {
  runAsPlatformAdmin,
  runScopedAsEcole,
  runWithTenant,
} from '../tenant/tenant-context';

type TestScoped = { name: string; ecoleId: Types.ObjectId };

describe('ecoleScopePlugin', () => {
  let repl: Awaited<ReturnType<typeof startMongoReplSet>>;
  let connection: Connection;
  let TestScopedModel: Model<TestScoped>;

  beforeAll(async () => {
    repl = await startMongoReplSet();
    connection = await createConnection(repl.uri).asPromise();

    const schema = new Schema<TestScoped>(
      { name: { type: String, required: true } },
      { timestamps: true },
    );
    schema.plugin(ecoleScopePlugin);
    TestScopedModel = connection.model<TestScoped>(
      'TestScoped',
      schema,
      'test_scoped',
    );
  });

  afterAll(async () => {
    await connection.close();
    await repl.stop();
  });

  afterEach(async () => {
    await runAsPlatformAdmin(() => TestScopedModel.deleteMany({}));
  });

  const ecoleA = new Types.ObjectId().toHexString();
  const ecoleB = new Types.ObjectId().toHexString();

  it('throws when no tenant context is active', async () => {
    await expect(TestScopedModel.find()).rejects.toThrow(
      'Tenant context manquant',
    );
  });

  it('throws when the context has no ecoleId and is not bypassed', async () => {
    await expect(
      runWithTenant({}, () => TestScopedModel.find()),
    ).rejects.toThrow('Tenant context incomplet');
  });

  it('stamps ecoleId on create() and scopes find()/findOne()/countDocuments()/distinct() to the current tenant', async () => {
    await runWithTenant({ ecoleId: ecoleA }, () =>
      TestScopedModel.create({ name: 'A1' }),
    );
    await runWithTenant({ ecoleId: ecoleA }, () =>
      TestScopedModel.create({ name: 'A2' }),
    );
    await runWithTenant({ ecoleId: ecoleB }, () =>
      TestScopedModel.create({ name: 'B1' }),
    );

    const foundA = await runWithTenant({ ecoleId: ecoleA }, () =>
      TestScopedModel.find(),
    );
    expect(foundA.map((d) => d.name).sort()).toEqual(['A1', 'A2']);

    const foundB = await runWithTenant({ ecoleId: ecoleB }, () =>
      TestScopedModel.find(),
    );
    expect(foundB.map((d) => d.name)).toEqual(['B1']);

    const countA = await runWithTenant({ ecoleId: ecoleA }, () =>
      TestScopedModel.countDocuments(),
    );
    expect(countA).toBe(2);

    const distinctA = await runWithTenant({ ecoleId: ecoleA }, () =>
      TestScopedModel.distinct('name'),
    );
    expect(distinctA.sort()).toEqual(['A1', 'A2']);

    const oneFromB = await runWithTenant({ ecoleId: ecoleA }, () =>
      TestScopedModel.findOne({ name: 'B1' }),
    );
    expect(oneFromB).toBeNull();
  });

  it('stamps ecoleId on insertMany() for every document', async () => {
    await runWithTenant({ ecoleId: ecoleA }, () =>
      TestScopedModel.insertMany([{ name: 'M1' }, { name: 'M2' }]),
    );

    const docs = await runWithTenant({ ecoleId: ecoleA }, () =>
      TestScopedModel.find(),
    );
    expect(docs.every((d) => d.ecoleId.toHexString() === ecoleA)).toBe(true);
    expect(docs.length).toBe(2);
  });

  it('rejects reassigning ecoleId on an existing document', async () => {
    const created = await runWithTenant({ ecoleId: ecoleA }, () =>
      TestScopedModel.create({ name: 'Immutable' }),
    );

    await expect(
      runWithTenant({ ecoleId: ecoleA }, async () => {
        created.ecoleId = new Types.ObjectId(ecoleB);
        await created.save();
      }),
    ).rejects.toThrow('ne peut pas etre modifie');
  });

  it('carries ecoleId onto documents created via upsert (updateOne / findOneAndUpdate)', async () => {
    await runWithTenant({ ecoleId: ecoleA }, () =>
      TestScopedModel.updateOne(
        { name: 'Upserted1' },
        { $set: { name: 'Upserted1' } },
        { upsert: true },
      ),
    );
    const upserted1 = await runWithTenant({ ecoleId: ecoleA }, () =>
      TestScopedModel.findOne({ name: 'Upserted1' }),
    );
    expect(upserted1?.ecoleId.toHexString()).toBe(ecoleA);

    await runWithTenant({ ecoleId: ecoleB }, () =>
      TestScopedModel.findOneAndUpdate(
        { name: 'Upserted2' },
        { $set: { name: 'Upserted2' } },
        { upsert: true, new: true },
      ),
    );
    const upserted2 = await runWithTenant({ ecoleId: ecoleB }, () =>
      TestScopedModel.findOne({ name: 'Upserted2' }),
    );
    expect(upserted2?.ecoleId.toHexString()).toBe(ecoleB);
  });

  it('prepends an ecoleId $match stage to aggregate() pipelines', async () => {
    await runWithTenant({ ecoleId: ecoleA }, () =>
      TestScopedModel.create({ name: 'Agg-A' }),
    );
    await runWithTenant({ ecoleId: ecoleB }, () =>
      TestScopedModel.create({ name: 'Agg-B' }),
    );

    const resultA = await runWithTenant({ ecoleId: ecoleA }, () =>
      TestScopedModel.aggregate([
        { $group: { _id: null, count: { $sum: 1 } } },
      ]),
    );
    expect(resultA).toEqual([{ _id: null, count: 1 }]);

    const resultB = await runWithTenant({ ecoleId: ecoleB }, () =>
      TestScopedModel.aggregate([
        { $group: { _id: null, count: { $sum: 1 } } },
      ]),
    );
    expect(resultB).toEqual([{ _id: null, count: 1 }]);
  });

  it('bypass mode (PLATFORM_ADMIN) sees all tenants unscoped', async () => {
    await runWithTenant({ ecoleId: ecoleA }, () =>
      TestScopedModel.create({ name: 'BP-A' }),
    );
    await runWithTenant({ ecoleId: ecoleB }, () =>
      TestScopedModel.create({ name: 'BP-B' }),
    );

    const all = await runAsPlatformAdmin(() => TestScopedModel.find());
    expect(all.map((d) => d.name).sort()).toEqual(['BP-A', 'BP-B']);
  });

  it('bypass mode still requires an explicit ecoleId on create()', async () => {
    await expect(
      runAsPlatformAdmin(() => TestScopedModel.create({ name: 'NoEcole' })),
    ).rejects.toThrow('doit etre fourni explicitement');
  });

  it('runScopedAsEcole narrows a bypass context to one tenant, even nested', async () => {
    await runWithTenant({ ecoleId: ecoleA }, () =>
      TestScopedModel.create({ name: 'Scoped-A' }),
    );
    await runWithTenant({ ecoleId: ecoleB }, () =>
      TestScopedModel.create({ name: 'Scoped-B' }),
    );

    await runAsPlatformAdmin(async () => {
      const scoped = await runScopedAsEcole(ecoleA, () =>
        TestScopedModel.find(),
      );
      expect(scoped.map((d) => d.name)).toEqual(['Scoped-A']);
    });
  });

  it('rejects estimatedDocumentCount() outside bypass mode', async () => {
    await expect(
      runWithTenant({ ecoleId: ecoleA }, () =>
        TestScopedModel.estimatedDocumentCount(),
      ),
    ).rejects.toThrow('ne peut pas etre scope');
  });
});
