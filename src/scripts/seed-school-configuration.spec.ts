import { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { Model, Types } from 'mongoose';
import { startMongoReplSet } from '../../test/mongo-replset';
import { AppModule } from '../app.module';
import { FeeSchedule } from '../billing/schemas/fee-schedule.schema';
import { ClassSubject } from '../bulletins/schemas/class-subject.schema';
import { Subject } from '../bulletins/schemas/subject.schema';
import { LevelCycle, SchoolYearStatus } from '../common/enums/domain.enums';
import { runWithTenant } from '../common/tenant/tenant-context';
import { ExpenseCategory } from '../expenses/schemas/expense-category.schema';
import { Level } from '../levels/schemas/level.schema';
import { SchoolYear } from '../school-years/schemas/school-year.schema';
import { SettingsService } from '../settings/settings.service';
import {
  SCHOOL_EXPENSE_CATEGORIES,
  SCHOOL_LEVELS,
  SCHOOL_SUBJECTS,
  seedSchoolConfiguration,
} from './seed-school-configuration';

describe('seedSchoolConfiguration', () => {
  let repl: Awaited<ReturnType<typeof startMongoReplSet>>;
  let app: INestApplication;
  let levelModel: Model<Level>;
  let schoolYearModel: Model<SchoolYear>;
  let feeScheduleModel: Model<FeeSchedule>;
  let subjectModel: Model<Subject>;
  let classSubjectModel: Model<ClassSubject>;
  let expenseCategoryModel: Model<ExpenseCategory>;
  let settingsService: SettingsService;

  beforeAll(async () => {
    repl = await startMongoReplSet();
    process.env.NODE_ENV = 'test';
    process.env.MONGODB_URI = repl.uri;
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    await app.init();
    levelModel = app.get(getModelToken(Level.name));
    schoolYearModel = app.get(getModelToken(SchoolYear.name));
    feeScheduleModel = app.get(getModelToken(FeeSchedule.name));
    subjectModel = app.get(getModelToken(Subject.name));
    classSubjectModel = app.get(getModelToken(ClassSubject.name));
    expenseCategoryModel = app.get(getModelToken(ExpenseCategory.name));
    settingsService = app.get(SettingsService);
    await Promise.all([levelModel.init(), schoolYearModel.init()]);
  }, 60000);

  afterAll(async () => {
    await app.close();
    await repl.stop();
  });

  it('remplit tout le parametrage (primaire, college, lycee) d une ecole vide et ouvre une annee', async () => {
    const ecoleId = new Types.ObjectId().toHexString();

    const report = await seedSchoolConfiguration(app, { ecoleId });

    expect(report.levelsCreated).toBe(SCHOOL_LEVELS.length);
    expect(report.feeSchedulesCreated).toBe(SCHOOL_LEVELS.length);
    expect(report.subjectsCreated).toBe(SCHOOL_SUBJECTS.length);
    expect(report.expenseCategoriesCreated).toBe(
      SCHOOL_EXPENSE_CATEGORIES.length,
    );

    await runWithTenant({ ecoleId }, async () => {
      const levels = await levelModel.find().sort({ sortOrder: 1 }).lean();
      expect(levels.map((l) => l.code)).toEqual(
        SCHOOL_LEVELS.map((l) => l.code),
      );
      expect(levels.map((l) => l.sortOrder)).toEqual(
        SCHOOL_LEVELS.map((_, index) => index + 1),
      );
      expect(levels.find((l) => l.code === 'CP1')?.cycle).toBe(
        LevelCycle.COLLEGE,
      );
      expect(levels.find((l) => l.code === 'TERMINALE')?.cycle).toBe(
        LevelCycle.LYCEE,
      );

      const openYear = await schoolYearModel
        .findOne({ status: SchoolYearStatus.OPEN })
        .lean();
      expect(openYear).toBeTruthy();

      // Chaque niveau a au moins une matiere configuree avec coefficient.
      for (const level of levels) {
        const count = await classSubjectModel.countDocuments({
          schoolYearId: openYear!._id,
          levelId: level._id,
        });
        expect(count).toBeGreaterThan(0);
      }

      expect(await settingsService.getChefEtablissementNom()).not.toBe('');
    });
  }, 60000);

  it('est idempotent et ne remplace jamais ce que l ecole a deja configure', async () => {
    const ecoleId = new Types.ObjectId().toHexString();

    const { customLevelId, yearId } = await runWithTenant(
      { ecoleId },
      async () => {
        const year = await schoolYearModel.create({
          label: 'SEED-CONF-2050-2051',
          startDate: new Date('2050-09-01'),
          endDate: new Date('2051-06-30'),
          status: SchoolYearStatus.OPEN,
        });
        // Une ecole qui a deja une maternelle a elle et un CP1 mal place.
        const custom = await levelModel.create({
          code: 'PS',
          label: 'Petite section',
          sortOrder: 1,
        });
        const cp1 = await levelModel.create({
          code: 'CP1',
          label: 'Cours preparatoire 1',
          sortOrder: 2,
        });
        await feeScheduleModel.create({
          schoolYearId: year._id,
          levelId: cp1._id,
          registrationFee: 1,
          tuitionFee: 2,
        });
        await settingsService.setChefEtablissementNom('Mme Directrice');
        return { customLevelId: custom._id, yearId: year._id };
      },
    );

    const first = await seedSchoolConfiguration(app, { ecoleId });
    expect(first.schoolYearLabel).toBe('SEED-CONF-2050-2051');
    expect(first.levelsCreated).toBe(SCHOOL_LEVELS.length - 1);

    const second = await seedSchoolConfiguration(app, { ecoleId });
    expect(second).toEqual({
      schoolYearLabel: 'SEED-CONF-2050-2051',
      levelsCreated: 0,
      feeSchedulesCreated: 0,
      subjectsCreated: 0,
      classSubjectsCreated: 0,
      expenseCategoriesCreated: 0,
      settingsCreated: 0,
      modulesActivated: [],
    });

    await runWithTenant({ ecoleId }, async () => {
      const levels = await levelModel.find().sort({ sortOrder: 1 }).lean();
      // Niveaux standards 1..N, puis le niveau propre a l'ecole a la suite.
      expect(levels.map((l) => l.code)).toEqual([
        ...SCHOOL_LEVELS.map((l) => l.code),
        'PS',
      ]);
      expect(String(levels[levels.length - 1]._id)).toBe(String(customLevelId));
      const cp1 = levels.find((l) => l.code === 'CP1')!;
      expect(cp1.label).toBe('Cours preparatoire 1');
      expect(cp1.cycle).toBe(LevelCycle.COLLEGE);

      const cp1Fees = await feeScheduleModel
        .findOne({ schoolYearId: yearId, levelId: cp1._id })
        .lean();
      expect(cp1Fees).toMatchObject({ registrationFee: 1, tuitionFee: 2 });
      expect(await settingsService.getChefEtablissementNom()).toBe(
        'Mme Directrice',
      );
      expect(await expenseCategoryModel.countDocuments({})).toBe(
        SCHOOL_EXPENSE_CATEGORIES.length,
      );
      expect(await subjectModel.countDocuments({})).toBe(
        SCHOOL_SUBJECTS.length,
      );
    });
  }, 60000);
});
