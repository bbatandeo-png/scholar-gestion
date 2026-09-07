import { NestFactory } from '@nestjs/core';
import { Connection } from 'mongoose';
import { getConnectionToken } from '@nestjs/mongoose';
import { AppModule } from '../app.module';

type IndexSpec = {
  key: Record<string, 1 | -1>;
  options?: Record<string, unknown>;
};

type IndexMigration = {
  collection: string;
  dropIndexKeys: Record<string, 1 | -1>[];
  createIndexes: IndexSpec[];
};

// One entry per collection whose uniqueness constraint moves from a global
// scope to "unique per ecole" (ecoleId prefixed). See
// src/common/mongoose/ecole-scope.plugin.ts and the schema files themselves
// for the query-time enforcement this migration's index changes support.
const INDEX_MIGRATIONS: IndexMigration[] = [
  {
    collection: 'arrears',
    dropIndexKeys: [
      { sourceEnrollmentId: 1 },
      { sourceEnrollmentId: 1, targetEnrollmentId: 1 },
    ],
    createIndexes: [
      { key: { ecoleId: 1, sourceEnrollmentId: 1 }, options: { unique: true } },
      {
        key: { ecoleId: 1, sourceEnrollmentId: 1, targetEnrollmentId: 1 },
        options: {
          unique: true,
          partialFilterExpression: { targetEnrollmentId: { $exists: true } },
        },
      },
    ],
  },
  {
    collection: 'arrear_carry_forwards',
    dropIndexKeys: [{ arrearId: 1, targetEnrollmentId: 1 }],
    createIndexes: [
      {
        key: { ecoleId: 1, arrearId: 1, targetEnrollmentId: 1 },
        options: { unique: true },
      },
    ],
  },
  {
    collection: 'fee_schedules',
    dropIndexKeys: [{ schoolYearId: 1, levelId: 1 }],
    createIndexes: [
      {
        key: { ecoleId: 1, schoolYearId: 1, levelId: 1 },
        options: { unique: true },
      },
    ],
  },
  {
    collection: 'invoices',
    dropIndexKeys: [{ enrollmentId: 1 }],
    createIndexes: [
      { key: { ecoleId: 1, enrollmentId: 1 }, options: { unique: true } },
    ],
  },
  {
    collection: 'enrollments',
    dropIndexKeys: [{ studentId: 1, schoolYearId: 1, status: 1 }],
    createIndexes: [
      {
        key: { ecoleId: 1, studentId: 1, schoolYearId: 1, status: 1 },
        options: {
          unique: true,
          partialFilterExpression: { status: 'active' },
        },
      },
    ],
  },
  {
    collection: 'expense_categories',
    dropIndexKeys: [{ name: 1 }],
    createIndexes: [
      { key: { ecoleId: 1, name: 1 }, options: { unique: true } },
    ],
  },
  {
    collection: 'levels',
    dropIndexKeys: [{ code: 1 }, { sortOrder: 1 }],
    createIndexes: [
      { key: { ecoleId: 1, code: 1 }, options: { unique: true } },
      { key: { ecoleId: 1, sortOrder: 1 }, options: { unique: true } },
    ],
  },
  {
    collection: 'school_year_levels',
    dropIndexKeys: [{ schoolYearId: 1, levelId: 1 }],
    createIndexes: [
      {
        key: { ecoleId: 1, schoolYearId: 1, levelId: 1 },
        options: { unique: true },
      },
    ],
  },
  {
    collection: 'payments',
    dropIndexKeys: [{ receiptNumber: 1 }],
    createIndexes: [
      { key: { ecoleId: 1, receiptNumber: 1 }, options: { unique: true } },
    ],
  },
  {
    collection: 'school_years',
    dropIndexKeys: [{ label: 1 }, { status: 1 }],
    createIndexes: [
      { key: { ecoleId: 1, label: 1 }, options: { unique: true } },
      {
        key: { ecoleId: 1, status: 1 },
        options: {
          unique: true,
          partialFilterExpression: { status: 'open' },
          name: 'one_open_school_year',
        },
      },
    ],
  },
  {
    collection: 'settings',
    // Old partial indexes relied on $exists, which MongoDB partial filter
    // expressions don't support for `false` - see setting.schema.ts. Legacy
    // documents that never had schoolYearId at all also predate that fix.
    dropIndexKeys: [{ key: 1, schoolYearId: 1 }, { key: 1 }],
    createIndexes: [
      {
        key: { ecoleId: 1, key: 1, schoolYearId: 1 },
        options: { unique: true },
      },
    ],
  },
  {
    collection: 'students',
    dropIndexKeys: [{ matricule: 1 }],
    createIndexes: [
      { key: { ecoleId: 1, matricule: 1 }, options: { unique: true } },
    ],
  },
];

// Collections that get an ecoleId backfill but no uniqueness change:
// audit_logs and users keep ecoleId optional/unenforced by design (see
// audit.service.ts and users/schemas/user.schema.ts), expenses/guardians
// have no natural-key uniqueness at all.
const PLAIN_BACKFILL_COLLECTIONS = [
  'audit_logs',
  'expenses',
  'guardians',
  'users',
];

type MigrationReport = {
  ecoleCreated: boolean;
  ecoleId?: string;
  ecoleName?: string;
  backfilled: Record<string, number>;
  duplicateConflicts: Array<{
    collection: string;
    key: Record<string, unknown>;
    count: number;
  }>;
  indexesDropped: Array<{ collection: string; name: string }>;
  indexesCreated: Array<{ collection: string; key: Record<string, unknown> }>;
};

function sameKey(
  a: Record<string, unknown>,
  b: Record<string, unknown>,
): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export async function migrateAddEcoleId(
  apply = false,
): Promise<MigrationReport> {
  const app = await NestFactory.createApplicationContext(AppModule);
  try {
    const connection = app.get<Connection>(getConnectionToken());
    const db = connection.db;
    if (!db) {
      throw new Error('Connexion MongoDB indisponible');
    }

    const report: MigrationReport = {
      ecoleCreated: false,
      backfilled: {},
      duplicateConflicts: [],
      indexesDropped: [],
      indexesCreated: [],
    };

    // Read regardless of ecoleId state so the resolved name (and therefore
    // idempotency below) is stable whether this is the first run or a
    // re-run after the settings collection has already been backfilled.
    const schoolNameSetting = await db
      .collection('settings')
      .findOne({ key: 'school_name' });
    const ecoleName =
      (schoolNameSetting?.value as string | undefined)?.trim() ||
      'Ecole par defaut';

    // Prefer whatever ecole already exists over matching by name: this
    // script is meant to run once against a single-tenant database, and a
    // partial prior run (e.g. an app boot that seeded a placeholder ecole
    // before crashing) must not result in a second, empty ecole here.
    let ecoleId = (
      await db
        .collection('ecoles')
        .findOne({}, { sort: { dateInscription: 1 } })
    )?._id;
    report.ecoleName = ecoleName;

    if (!ecoleId && apply) {
      const inserted = await db.collection('ecoles').insertOne({
        nom: ecoleName,
        statutCompte: 'actif',
        dateInscription: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      ecoleId = inserted.insertedId;
      report.ecoleCreated = true;
    }
    if (ecoleId) {
      report.ecoleId = String(ecoleId);
    }

    // Pre-flight: with every document about to receive the SAME ecoleId,
    // a compound-unique index only becomes violated if the field(s) it
    // shares with the old global-unique index already had duplicates -
    // which the old index should have prevented. Check anyway so a broken
    // legacy index (or manually inserted data) surfaces as a clear error
    // instead of a failed index build mid-migration.
    for (const migration of INDEX_MIGRATIONS) {
      for (const spec of migration.createIndexes) {
        if (!spec.options?.unique) {
          continue;
        }
        const groupFields = Object.keys(spec.key).filter(
          (field) => field !== 'ecoleId',
        );
        const matchStage = spec.options.partialFilterExpression
          ? [
              {
                $match: spec.options.partialFilterExpression as Record<
                  string,
                  unknown
                >,
              },
            ]
          : [];
        const groupId = Object.fromEntries(
          groupFields.map((field) => [field, `$${field}`]),
        );
        const duplicates = await db
          .collection(migration.collection)
          .aggregate([
            ...matchStage,
            { $group: { _id: groupId, count: { $sum: 1 } } },
            { $match: { count: { $gt: 1 } } },
          ])
          .toArray();
        for (const duplicate of duplicates as Array<{
          _id: Record<string, unknown>;
          count: number;
        }>) {
          report.duplicateConflicts.push({
            collection: migration.collection,
            key: duplicate._id,
            count: duplicate.count,
          });
        }
      }
    }

    if (report.duplicateConflicts.length && apply) {
      throw new Error(
        `Migration interrompue : ${report.duplicateConflicts.length} conflit(s) d'unicite detecte(s) avant application`,
      );
    }

    if (!ecoleId) {
      // Dry run with no existing ecole yet: nothing more to compute.
      return report;
    }

    const backfillCollections = [
      ...INDEX_MIGRATIONS.map((m) => m.collection),
      ...PLAIN_BACKFILL_COLLECTIONS,
    ];

    for (const collectionName of backfillCollections) {
      const filter = { ecoleId: { $exists: false } };
      const count = await db.collection(collectionName).countDocuments(filter);
      report.backfilled[collectionName] = count;
      if (apply && count > 0) {
        await db
          .collection(collectionName)
          .updateMany(filter, { $set: { ecoleId } });
      }
    }

    if (apply) {
      // Legacy "global" settings predate schoolYearId always being present
      // (see setting.schema.ts) - normalize so the new plain compound
      // unique index below can't be violated by a missing field.
      await db
        .collection('settings')
        .updateMany(
          { schoolYearId: { $exists: false } },
          { $set: { schoolYearId: null } },
        );
    }

    if (apply) {
      for (const migration of INDEX_MIGRATIONS) {
        const existing = await db.collection(migration.collection).indexes();
        for (const oldKey of migration.dropIndexKeys) {
          const match = existing.find((index) => sameKey(index.key, oldKey));
          if (match?.name) {
            await db.collection(migration.collection).dropIndex(match.name);
            report.indexesDropped.push({
              collection: migration.collection,
              name: match.name,
            });
          }
        }
        for (const spec of migration.createIndexes) {
          await db
            .collection(migration.collection)
            .createIndex(spec.key, spec.options ?? {});
          report.indexesCreated.push({
            collection: migration.collection,
            key: spec.key,
          });
        }
      }
    }

    return report;
  } finally {
    await app.close();
  }
}

if (require.main === module) {
  const apply = process.argv.includes('--apply');
  void migrateAddEcoleId(apply)
    .then((report) => {
      console.log(
        JSON.stringify(
          { mode: apply ? 'apply' : 'dry-run', ...report },
          null,
          2,
        ),
      );
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    });
}
