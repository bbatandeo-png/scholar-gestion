import { NestFactory } from '@nestjs/core';
import { Connection } from 'mongoose';
import { getConnectionToken } from '@nestjs/mongoose';
import { AppModule } from '../app.module';

// Deterministic mapping from the standard French level codes this app's own
// seed.ts already uses (CP1..3EME, 2NDE..TERMINALE) to a cycle. Not a guess
// at arbitrary business data - collège vs lycée is a fixed, well-known
// convention. Any code not in this table is left unset and reported so an
// operator can configure it manually via the Levels settings screen.
const COLLEGE_CODES = new Set([
  'CP1',
  'CP2',
  'CE1',
  'CE2',
  'CM1',
  'CM2',
  '6EME',
  '5EME',
  '4EME',
  '3EME',
]);
const LYCEE_CODES = new Set(['2NDE', '1ERE', 'TERMINALE']);

function inferCycle(code: string): 1 | 2 | undefined {
  const normalized = code.trim().toUpperCase();
  if (COLLEGE_CODES.has(normalized)) {
    return 1;
  }
  if (LYCEE_CODES.has(normalized)) {
    return 2;
  }
  return undefined;
}

type MigrationReport = {
  backfilled: number;
  unrecognized: Array<{ id: string; code: string; label: string }>;
};

export async function migrateAddLevelCycle(
  apply = false,
): Promise<MigrationReport> {
  const app = await NestFactory.createApplicationContext(AppModule);
  try {
    const connection = app.get<Connection>(getConnectionToken());
    const db = connection.db;
    if (!db) {
      throw new Error('Connexion MongoDB indisponible');
    }

    const report: MigrationReport = { backfilled: 0, unrecognized: [] };

    const levels = await db
      .collection('levels')
      .find({ cycle: { $exists: false } })
      .toArray();

    for (const level of levels) {
      const cycle = inferCycle(String(level.code ?? ''));
      if (!cycle) {
        report.unrecognized.push({
          id: String(level._id),
          code: String(level.code ?? ''),
          label: String(level.label ?? ''),
        });
        continue;
      }
      report.backfilled += 1;
      if (apply) {
        await db
          .collection('levels')
          .updateOne({ _id: level._id }, { $set: { cycle } });
      }
    }

    return report;
  } finally {
    await app.close();
  }
}

if (require.main === module) {
  const apply = process.argv.includes('--apply');
  void migrateAddLevelCycle(apply)
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
