/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument */
// One-off migration script working directly against the MongoDB driver
// (db.collection(...)), not Mongoose models - documents are plain,
// schema-less objects across 7+ collections here. Modeling each collection's
// shape just for this single-use script isn't worth it; the explicit
// optional-chaining and orphan/ambiguous-record checks throughout already
// guard the actual runtime behavior.
import { NestFactory } from '@nestjs/core';
import { Connection } from 'mongoose';
import { getConnectionToken } from '@nestjs/mongoose';
import { AppModule } from '../app.module';

type MigrationReport = {
  invoicesBackfilled: number;
  paymentsBackfilled: number;
  expensesBackfilled: number;
  yearLevelsCreated: number;
  carryForwardsCreated: number;
  ambiguousExpenses: Array<{ id: string; expenseDate?: Date }>;
  orphanInvoices: string[];
  orphanPayments: string[];
};

export async function migrateMultiYear(
  apply = false,
  ambiguousExpenseSchoolYearId?: string,
): Promise<MigrationReport> {
  const app = await NestFactory.createApplicationContext(AppModule);
  try {
    const connection = app.get<Connection>(getConnectionToken());
    const db = connection.db;
    if (!db) {
      throw new Error('Connexion MongoDB indisponible');
    }

    const report: MigrationReport = {
      invoicesBackfilled: 0,
      paymentsBackfilled: 0,
      expensesBackfilled: 0,
      yearLevelsCreated: 0,
      carryForwardsCreated: 0,
      ambiguousExpenses: [],
      orphanInvoices: [],
      orphanPayments: [],
    };

    const years = await db
      .collection('school_years')
      .find()
      .sort({ startDate: 1 })
      .toArray();
    const openYears = years.filter((year) => year.status === 'open');
    const openYear = openYears.length === 1 ? openYears[0] : undefined;

    const expensePreflight = await db
      .collection('expenses')
      .find({
        $or: [{ schoolYearId: { $exists: false } }, { schoolYearId: null }],
      })
      .toArray();
    for (const expense of expensePreflight) {
      const expenseDate = expense.expenseDate
        ? new Date(expense.expenseDate)
        : undefined;
      const matches = expenseDate
        ? years.filter(
            (year) =>
              expenseDate >= new Date(year.startDate) &&
              expenseDate <= new Date(year.endDate),
          )
        : [];
      if (matches.length !== 1) {
        report.ambiguousExpenses.push({ id: String(expense._id), expenseDate });
      }
    }
    if (
      ambiguousExpenseSchoolYearId &&
      !years.some((year) => String(year._id) === ambiguousExpenseSchoolYearId)
    ) {
      throw new Error(
        'L annee fournie pour les depenses ambiguës est introuvable',
      );
    }
    if (
      report.ambiguousExpenses.length &&
      !ambiguousExpenseSchoolYearId &&
      !openYear
    ) {
      throw new Error(
        `Migration interrompue : ${report.ambiguousExpenses.length} depense(s) necessitent une unique annee active`,
      );
    }

    if (apply) {
      const settingsExists = await db
        .listCollections({ name: 'settings' }, { nameOnly: true })
        .hasNext();
      const settingIndexes = settingsExists
        ? await db.collection('settings').indexes()
        : [];
      const legacyKeyIndex = settingIndexes.find(
        (index) =>
          index.unique &&
          JSON.stringify(index.key) === JSON.stringify({ key: 1 }),
      );
      if (legacyKeyIndex?.name) {
        await db.collection('settings').dropIndex(legacyKeyIndex.name);
      }
    }

    const legacyEnrollments = await db
      .collection('enrollments')
      .find({
        $or: [
          { studentSnapshot: { $exists: false } },
          { levelSnapshot: { $exists: false } },
        ],
      })
      .toArray();
    for (const enrollment of legacyEnrollments) {
      const [student, level] = await Promise.all([
        db.collection('students').findOne({ _id: enrollment.studentId }),
        db.collection('levels').findOne({ _id: enrollment.levelId }),
      ]);
      if (apply) {
        await db.collection('enrollments').updateOne(
          { _id: enrollment._id },
          {
            $set: {
              ...(student
                ? {
                    studentSnapshot: {
                      matricule: student.matricule,
                      lastname: student.lastname,
                      firstname: student.firstname,
                      gender: student.gender,
                      birthDate: student.birthDate,
                      birthPlace: student.birthPlace,
                      district: student.district,
                    },
                  }
                : {}),
              ...(level
                ? {
                    levelSnapshot: {
                      code: level.code,
                      label: level.label,
                      sortOrder: level.sortOrder,
                    },
                  }
                : {}),
            },
          },
        );
      }
    }

    const invoices = await db
      .collection('invoices')
      .find({
        $or: [{ schoolYearId: { $exists: false } }, { schoolYearId: null }],
      })
      .toArray();
    for (const invoice of invoices) {
      const enrollment = await db
        .collection('enrollments')
        .findOne({ _id: invoice.enrollmentId });
      if (!enrollment?.schoolYearId) {
        report.orphanInvoices.push(String(invoice._id));
        continue;
      }
      report.invoicesBackfilled += 1;
      if (apply) {
        await db
          .collection('invoices')
          .updateOne(
            { _id: invoice._id },
            { $set: { schoolYearId: enrollment.schoolYearId } },
          );
      }
    }

    const payments = await db
      .collection('payments')
      .find({
        $or: [{ schoolYearId: { $exists: false } }, { schoolYearId: null }],
      })
      .toArray();
    for (const payment of payments) {
      const invoice = await db
        .collection('invoices')
        .findOne({ _id: payment.invoiceId });
      let schoolYearId = invoice?.schoolYearId;
      if (!schoolYearId && invoice?.enrollmentId) {
        const enrollment = await db
          .collection('enrollments')
          .findOne({ _id: invoice.enrollmentId });
        schoolYearId = enrollment?.schoolYearId;
      }
      if (!schoolYearId) {
        report.orphanPayments.push(String(payment._id));
        continue;
      }
      report.paymentsBackfilled += 1;
      if (apply) {
        await db
          .collection('payments')
          .updateOne({ _id: payment._id }, { $set: { schoolYearId } });
      }
    }

    const expenses = await db
      .collection('expenses')
      .find({
        $or: [{ schoolYearId: { $exists: false } }, { schoolYearId: null }],
      })
      .toArray();
    for (const expense of expenses) {
      const expenseDate = expense.expenseDate
        ? new Date(expense.expenseDate)
        : undefined;
      const matches = expenseDate
        ? years.filter(
            (year) =>
              expenseDate >= new Date(year.startDate) &&
              expenseDate <= new Date(year.endDate),
          )
        : [];
      const selectedYear =
        matches.length === 1
          ? matches[0]
          : (years.find(
              (year) => String(year._id) === ambiguousExpenseSchoolYearId,
            ) ?? openYear);
      if (!selectedYear) {
        if (
          !report.ambiguousExpenses.some(
            (item) => item.id === String(expense._id),
          )
        ) {
          report.ambiguousExpenses.push({
            id: String(expense._id),
            expenseDate,
          });
        }
        continue;
      }
      report.expensesBackfilled += 1;
      if (apply) {
        await db
          .collection('expenses')
          .updateOne(
            { _id: expense._id },
            { $set: { schoolYearId: selectedYear._id } },
          );
      }
    }

    const yearLevelPairs = new Map<
      string,
      { schoolYearId: unknown; levelId: unknown }
    >();
    for (const collectionName of ['enrollments', 'fee_schedules']) {
      const rows = await db
        .collection(collectionName)
        .find({
          schoolYearId: { $exists: true },
          levelId: { $exists: true },
        })
        .project({ schoolYearId: 1, levelId: 1 })
        .toArray();
      for (const row of rows) {
        yearLevelPairs.set(
          `${String(row.schoolYearId)}:${String(row.levelId)}`,
          { schoolYearId: row.schoolYearId, levelId: row.levelId },
        );
      }
    }
    if (openYear) {
      const levels = await db
        .collection('levels')
        .find()
        .project({ _id: 1 })
        .toArray();
      for (const level of levels) {
        yearLevelPairs.set(`${String(openYear._id)}:${String(level._id)}`, {
          schoolYearId: openYear._id,
          levelId: level._id,
        });
      }
    }
    for (const pair of yearLevelPairs.values()) {
      const exists = await db.collection('school_year_levels').findOne(pair);
      if (!exists) {
        report.yearLevelsCreated += 1;
        if (apply) {
          await db
            .collection('school_year_levels')
            .insertOne({ ...pair, isEnabled: true });
        }
      }
    }

    const legacyArrears = await db
      .collection('arrears')
      .find({
        targetEnrollmentId: { $exists: true, $ne: null },
        targetSchoolYearId: { $exists: true, $ne: null },
      })
      .toArray();
    for (const arrear of legacyArrears) {
      const criteria = {
        arrearId: arrear._id,
        targetEnrollmentId: arrear.targetEnrollmentId,
      };
      if (await db.collection('arrear_carry_forwards').findOne(criteria)) {
        continue;
      }
      report.carryForwardsCreated += 1;
      if (apply) {
        await db.collection('arrear_carry_forwards').insertOne({
          ...criteria,
          sourceSchoolYearId: arrear.sourceSchoolYearId,
          targetSchoolYearId: arrear.targetSchoolYearId,
          amountCarried: arrear.amountRemaining ?? arrear.amountInitial ?? 0,
          carriedAt: arrear.updatedAt ?? arrear.createdAt ?? new Date(),
        });
      }
    }

    if (
      apply &&
      (report.orphanInvoices.length || report.orphanPayments.length)
    ) {
      throw new Error(
        'Migration interrompue : des donnees ambiguës ou orphelines doivent etre corrigees',
      );
    }

    return report;
  } finally {
    await app.close();
  }
}

if (require.main === module) {
  const apply = process.argv.includes('--apply');
  const expenseYearArg = process.argv.find((arg) =>
    arg.startsWith('--expense-year='),
  );
  const expenseYearId = expenseYearArg?.slice('--expense-year='.length);
  void migrateMultiYear(apply, expenseYearId)
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
