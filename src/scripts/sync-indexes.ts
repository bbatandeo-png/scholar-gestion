import { NestFactory } from '@nestjs/core';
import { Connection } from 'mongoose';
import { getConnectionToken } from '@nestjs/mongoose';
import { AppModule } from '../app.module';

// Mongoose's own autoIndex (on by default) only ever CREATES indexes
// missing from a collection - it never drops or replaces a legacy one with
// the same name but a stale key spec (e.g. a pre-multi-tenant unique index
// on a bare field, left over from before ecoleScopePlugin added ecoleId to
// it). That mismatch is silent until a second tenant collides with the
// first's data, surfacing as a confusing E11000 duplicate key error with no
// obvious connection to "this index is outdated" - see school_years'
// label_1 and one_open_school_year on the platform server for two real
// examples. This walks every registered model and reports (or, with
// --apply, actually drops+recreates) whatever no longer matches the
// schema's own current index declarations.
type CollectionReport = {
  collection: string;
  toDrop: string[];
  toCreate: string[];
};

export async function syncAllIndexes(
  apply = false,
): Promise<CollectionReport[]> {
  const app = await NestFactory.createApplicationContext(AppModule);
  try {
    const connection = app.get<Connection>(getConnectionToken());
    const report: CollectionReport[] = [];

    // autoIndex (on by default) runs in the background as each model
    // registers - never awaited by app bootstrap itself, so diffIndexes()
    // called too early could still see an index it's mid-creating as
    // "missing". init() resolves once a model's own autoIndex pass settles.
    await Promise.all(
      Object.values(connection.models).map((model) =>
        model.init().catch(() => undefined),
      ),
    );

    for (const modelName of Object.keys(connection.models)) {
      const model = connection.models[modelName];
      const { toDrop, toCreate } = await model.diffIndexes();
      if (toDrop.length === 0 && toCreate.length === 0) {
        continue;
      }
      report.push({
        collection: model.collection.collectionName,
        toDrop: toDrop as string[],
        toCreate: (toCreate as unknown[]).map((index) => JSON.stringify(index)),
      });
      if (apply) {
        await model.syncIndexes();
      }
    }

    return report;
  } finally {
    await app.close();
  }
}

if (require.main === module) {
  const apply = process.argv.includes('--apply');
  void syncAllIndexes(apply)
    .then((report) => {
      console.log(
        JSON.stringify({ mode: apply ? 'apply' : 'dry-run', report }, null, 2),
      );
      if (!apply && report.length > 0) {
        console.log(
          '\nDes index obsoletes ont ete trouves - relancez avec --apply pour les corriger.',
        );
      }
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    });
}
