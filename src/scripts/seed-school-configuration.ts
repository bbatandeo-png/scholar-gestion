import { INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { getModelToken } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { AppModule } from '../app.module';
import { ClassSubject } from '../bulletins/schemas/class-subject.schema';
import { Subject } from '../bulletins/schemas/subject.schema';
import { normalizeLabel } from '../bulletins/bulletins-import.util';
import { FeeSchedule } from '../billing/schemas/fee-schedule.schema';
import {
  LevelCycle,
  PaymentAllocationRule,
  ReceiptMode,
  Role,
  SchoolYearStatus,
  SettingKey,
  SubjectCategory,
} from '../common/enums/domain.enums';
import {
  runAsPlatformAdmin,
  runWithTenant,
} from '../common/tenant/tenant-context';
import { EcoleModulesService } from '../ecole-modules/ecole-modules.service';
import { Ecole } from '../ecoles/schemas/ecole.schema';
import { ExpenseCategory } from '../expenses/schemas/expense-category.schema';
import { LevelsService } from '../levels/levels.service';
import { Level } from '../levels/schemas/level.schema';
import { SchoolYear } from '../school-years/schemas/school-year.schema';
import { Setting } from '../settings/schemas/setting.schema';
import { SettingsService } from '../settings/settings.service';
import { User } from '../users/schemas/user.schema';

// Complete, ready-to-demo configuration of a school covering primaire,
// collège and lycée: every level (with its cycle and contiguous sortOrder -
// promotions rely on sortOrder + 1 being the next level, see
// LevelsService), its fees for the open school year, the subject catalog
// with per-level coefficients, expense categories and the main settings.
//
// Strictly additive and idempotent: anything the school already configured
// (a fee amount, a coefficient, a label, a setting) is never overwritten -
// only what is missing gets created. Safe to re-run on a live database.

export type Cycle = 'primaire' | 'college' | 'lycee';

type SeedLevel = {
  code: string;
  label: string;
  cycle: Cycle;
  registrationFee: number;
  tuitionFee: number;
};

// Primaire has no LevelCycle of its own: bulletins only distinguish
// trimestres (COLLEGE) from semestres (LYCEE), and the primaire works by
// trimestres - same mapping as migrate-add-level-cycle.ts.
const LEVEL_CYCLE: Record<Cycle, LevelCycle> = {
  primaire: LevelCycle.COLLEGE,
  college: LevelCycle.COLLEGE,
  lycee: LevelCycle.LYCEE,
};

export const SCHOOL_LEVELS: SeedLevel[] = [
  {
    code: 'CP1',
    label: 'CP1',
    cycle: 'primaire',
    registrationFee: 10000,
    tuitionFee: 75000,
  },
  {
    code: 'CP2',
    label: 'CP2',
    cycle: 'primaire',
    registrationFee: 10000,
    tuitionFee: 75000,
  },
  {
    code: 'CE1',
    label: 'CE1',
    cycle: 'primaire',
    registrationFee: 10000,
    tuitionFee: 80000,
  },
  {
    code: 'CE2',
    label: 'CE2',
    cycle: 'primaire',
    registrationFee: 10000,
    tuitionFee: 80000,
  },
  {
    code: 'CM1',
    label: 'CM1',
    cycle: 'primaire',
    registrationFee: 10000,
    tuitionFee: 85000,
  },
  {
    code: 'CM2',
    label: 'CM2',
    cycle: 'primaire',
    registrationFee: 10000,
    tuitionFee: 90000,
  },
  {
    code: '6EME',
    label: '6ème',
    cycle: 'college',
    registrationFee: 15000,
    tuitionFee: 120000,
  },
  {
    code: '5EME',
    label: '5ème',
    cycle: 'college',
    registrationFee: 15000,
    tuitionFee: 120000,
  },
  {
    code: '4EME',
    label: '4ème',
    cycle: 'college',
    registrationFee: 15000,
    tuitionFee: 130000,
  },
  {
    code: '3EME',
    label: '3ème',
    cycle: 'college',
    registrationFee: 15000,
    tuitionFee: 140000,
  },
  {
    code: '2NDE',
    label: 'Seconde',
    cycle: 'lycee',
    registrationFee: 20000,
    tuitionFee: 160000,
  },
  {
    code: '1ERE',
    label: 'Première',
    cycle: 'lycee',
    registrationFee: 20000,
    tuitionFee: 170000,
  },
  {
    code: 'TERMINALE',
    label: 'Terminale',
    cycle: 'lycee',
    registrationFee: 20000,
    tuitionFee: 185000,
  },
];

// Coefficient per level code (a level absent from the map doesn't get the
// subject at all).
type SeedSubject = {
  label: string;
  category: SubjectCategory;
  coefficients: Record<string, number>;
};

function sameCoef(codes: string[], coefficient: number) {
  return Object.fromEntries(codes.map((code) => [code, coefficient]));
}

const PRIMAIRE = ['CP1', 'CP2', 'CE1', 'CE2', 'CM1', 'CM2'];
const PRIMAIRE_SUP = ['CE1', 'CE2', 'CM1', 'CM2'];
const COLLEGE = ['6EME', '5EME', '4EME', '3EME'];
const LYCEE = ['2NDE', '1ERE', 'TERMINALE'];
const SECONDAIRE = [...COLLEGE, ...LYCEE];

export const SCHOOL_SUBJECTS: SeedSubject[] = [
  // Primaire
  {
    label: 'Lecture',
    category: SubjectCategory.LITTERAIRE,
    coefficients: sameCoef(PRIMAIRE, 1),
  },
  {
    label: 'Écriture',
    category: SubjectCategory.LITTERAIRE,
    coefficients: sameCoef(PRIMAIRE, 1),
  },
  {
    label: 'Dictée',
    category: SubjectCategory.LITTERAIRE,
    coefficients: sameCoef(PRIMAIRE, 1),
  },
  {
    label: 'Expression orale',
    category: SubjectCategory.LITTERAIRE,
    coefficients: sameCoef(PRIMAIRE, 1),
  },
  {
    label: 'Expression écrite',
    category: SubjectCategory.LITTERAIRE,
    coefficients: sameCoef(PRIMAIRE_SUP, 1),
  },
  {
    label: 'Calcul',
    category: SubjectCategory.SCIENTIFIQUE,
    coefficients: sameCoef(PRIMAIRE, 1),
  },
  {
    label: 'Sciences et technologie',
    category: SubjectCategory.SCIENTIFIQUE,
    coefficients: sameCoef(PRIMAIRE_SUP, 1),
  },
  // Secondaire (et matières communes)
  {
    label: 'Français',
    category: SubjectCategory.LITTERAIRE,
    coefficients: {
      '6EME': 4,
      '5EME': 4,
      '4EME': 3,
      '3EME': 3,
      '2NDE': 3,
      '1ERE': 3,
      TERMINALE: 3,
    },
  },
  {
    label: 'Mathématiques',
    category: SubjectCategory.SCIENTIFIQUE,
    coefficients: { ...sameCoef(COLLEGE, 3), ...sameCoef(LYCEE, 4) },
  },
  {
    label: 'Anglais',
    category: SubjectCategory.LITTERAIRE,
    coefficients: { CM1: 1, CM2: 1, ...sameCoef(SECONDAIRE, 2) },
  },
  {
    label: 'Histoire-Géographie',
    category: SubjectCategory.LITTERAIRE,
    coefficients: { ...sameCoef(PRIMAIRE_SUP, 1), ...sameCoef(SECONDAIRE, 2) },
  },
  {
    label: 'Sciences de la Vie et de la Terre',
    category: SubjectCategory.SCIENTIFIQUE,
    coefficients: { ...sameCoef(COLLEGE, 2), ...sameCoef(LYCEE, 3) },
  },
  {
    label: 'Physique-Chimie',
    category: SubjectCategory.SCIENTIFIQUE,
    coefficients: {
      '6EME': 1,
      '5EME': 1,
      '4EME': 2,
      '3EME': 2,
      ...sameCoef(LYCEE, 4),
    },
  },
  {
    label: 'Espagnol',
    category: SubjectCategory.LITTERAIRE,
    coefficients: { '4EME': 1, '3EME': 1, ...sameCoef(LYCEE, 2) },
  },
  {
    label: 'Philosophie',
    category: SubjectCategory.LITTERAIRE,
    coefficients: { '1ERE': 2, TERMINALE: 3 },
  },
  {
    label: 'Informatique',
    category: SubjectCategory.SCIENTIFIQUE,
    coefficients: sameCoef(SECONDAIRE, 1),
  },
  {
    label: 'Éducation aux Droits de l’Homme et à la Citoyenneté',
    category: SubjectCategory.AUTRE,
    coefficients: { ...sameCoef(PRIMAIRE, 1), ...sameCoef(SECONDAIRE, 1) },
  },
  {
    label: 'Arts plastiques',
    category: SubjectCategory.AUTRE,
    coefficients: { ...sameCoef(PRIMAIRE, 1), ...sameCoef(COLLEGE, 1) },
  },
  {
    label: 'Éducation Physique et Sportive',
    category: SubjectCategory.AUTRE,
    coefficients: { ...sameCoef(PRIMAIRE, 1), ...sameCoef(SECONDAIRE, 1) },
  },
  {
    label: 'Conduite',
    category: SubjectCategory.AUTRE,
    coefficients: sameCoef(SECONDAIRE, 1),
  },
];

export const SCHOOL_EXPENSE_CATEGORIES: Array<{
  name: string;
  description: string;
}> = [
  {
    name: 'Salaires du personnel',
    description: 'Enseignants, administration, personnel de service',
  },
  {
    name: 'Fournitures et matériel pédagogique',
    description: 'Craies, cahiers, manuels, matériel de laboratoire',
  },
  {
    name: 'Électricité et eau',
    description: 'Factures d’électricité et d’eau',
  },
  {
    name: 'Entretien et réparations',
    description: 'Bâtiments, mobilier, équipements',
  },
  { name: 'Transport', description: 'Carburant, déplacements, sorties' },
  {
    name: 'Communication et internet',
    description: 'Téléphone, internet, frais d’envoi',
  },
  { name: 'Loyer', description: 'Location des locaux' },
  {
    name: 'Examens et évaluations',
    description: 'Impression des sujets, frais d’examens blancs',
  },
  {
    name: 'Activités parascolaires',
    description: 'Fêtes, sport, culture, kermesse',
  },
  { name: 'Divers', description: 'Autres dépenses' },
];

export const ALL_MODULE_CODES = [
  'FINANCE',
  'BULLETINS',
  'DISCIPLINE',
  'STOCK',
  'ENSEIGNANTS',
];

// Above any realistic sortOrder: levels are first moved out of the way of
// the {ecoleId, sortOrder} unique index, then renumbered 1..N.
const SORT_ORDER_SHIFT = 100000;

export type SchoolConfigurationReport = {
  schoolYearLabel: string;
  levelsCreated: number;
  feeSchedulesCreated: number;
  subjectsCreated: number;
  classSubjectsCreated: number;
  expenseCategoriesCreated: number;
  settingsCreated: number;
  modulesActivated: string[];
};

export type SeedSchoolConfigurationOptions = {
  ecoleId: string;
  // Needed to activate modules (EcoleModule.activePar) - looked up among
  // the ecole's super admins when omitted.
  actorId?: string;
  activateAllModules?: boolean;
  chefEtablissementNom?: string;
};

function currentSchoolYearBounds(now = new Date()) {
  // A school year starts in September: from September on, it's
  // "<year>-<year+1>", before that it's "<year-1>-<year>".
  const startYear =
    now.getMonth() >= 8 ? now.getFullYear() : now.getFullYear() - 1;
  return {
    label: `${startYear}-${startYear + 1}`,
    startDate: new Date(`${startYear}-09-01`),
    endDate: new Date(`${startYear + 1}-06-30`),
  };
}

async function upsertedCount(
  promise: Promise<{ upsertedCount?: number }>,
): Promise<number> {
  return (await promise).upsertedCount ?? 0;
}

export async function seedSchoolConfiguration(
  app: INestApplicationContext,
  options: SeedSchoolConfigurationOptions,
): Promise<SchoolConfigurationReport> {
  const { ecoleId } = options;
  const levelsService = app.get(LevelsService);
  const settingsService = app.get(SettingsService);
  const ecoleModulesService = app.get(EcoleModulesService);
  const schoolYearModel = app.get<Model<SchoolYear>>(
    getModelToken(SchoolYear.name),
  );
  const levelModel = app.get<Model<Level>>(getModelToken(Level.name));
  const feeScheduleModel = app.get<Model<FeeSchedule>>(
    getModelToken(FeeSchedule.name),
  );
  const subjectModel = app.get<Model<Subject>>(getModelToken(Subject.name));
  const classSubjectModel = app.get<Model<ClassSubject>>(
    getModelToken(ClassSubject.name),
  );
  const expenseCategoryModel = app.get<Model<ExpenseCategory>>(
    getModelToken(ExpenseCategory.name),
  );
  const settingModel = app.get<Model<Setting>>(getModelToken(Setting.name));
  const userModel = app.get<Model<User>>(getModelToken(User.name));

  const report: SchoolConfigurationReport = {
    schoolYearLabel: '',
    levelsCreated: 0,
    feeSchedulesCreated: 0,
    subjectsCreated: 0,
    classSubjectsCreated: 0,
    expenseCategoriesCreated: 0,
    settingsCreated: 0,
    modulesActivated: [],
  };

  await runWithTenant({ ecoleId, bypass: false }, async () => {
    // --- Année scolaire ouverte -------------------------------------------
    let openYear = await schoolYearModel
      .findOne({ status: SchoolYearStatus.OPEN })
      .lean()
      .exec();
    if (!openYear) {
      const bounds = currentSchoolYearBounds();
      openYear = await schoolYearModel
        .findOneAndUpdate(
          { label: bounds.label },
          {
            $set: { status: SchoolYearStatus.OPEN },
            $setOnInsert: {
              label: bounds.label,
              startDate: bounds.startDate,
              endDate: bounds.endDate,
            },
          },
          { upsert: true, new: true, setDefaultsOnInsert: true },
        )
        .lean()
        .exec();
    }
    const schoolYearId = String(openYear._id);
    report.schoolYearLabel = openYear.label;

    // --- Niveaux ----------------------------------------------------------
    const existingLevels = await levelModel
      .find()
      .sort({ sortOrder: 1 })
      .lean()
      .exec();
    const existingByCode = new Map(existingLevels.map((l) => [l.code, l]));
    const missing = SCHOOL_LEVELS.filter((l) => !existingByCode.has(l.code));

    for (const level of SCHOOL_LEVELS) {
      const existing = existingByCode.get(level.code);
      if (existing && !existing.cycle) {
        await levelModel.updateOne(
          { _id: existing._id },
          { $set: { cycle: LEVEL_CYCLE[level.cycle] } },
        );
      }
    }

    if (missing.length > 0) {
      const canonicalCodes = new Set(SCHOOL_LEVELS.map((l) => l.code));
      const customLevels = existingLevels.filter(
        (l) => !canonicalCodes.has(l.code),
      );
      await levelModel.updateMany(
        {},
        { $inc: { sortOrder: SORT_ORDER_SHIFT } },
      );

      let sortOrder = 1;
      for (const level of SCHOOL_LEVELS) {
        const existing = existingByCode.get(level.code);
        if (existing) {
          await levelModel.updateOne(
            { _id: existing._id },
            { $set: { sortOrder } },
          );
        } else {
          await levelModel.create({
            code: level.code,
            label: level.label,
            cycle: LEVEL_CYCLE[level.cycle],
            sortOrder,
          });
          report.levelsCreated += 1;
        }
        sortOrder += 1;
      }
      // Levels the school created itself keep their relative order, after
      // the standard ones.
      for (const level of customLevels) {
        await levelModel.updateOne({ _id: level._id }, { $set: { sortOrder } });
        sortOrder += 1;
      }
    }

    const levelIdByCode = new Map(
      (await levelModel.find().lean().exec()).map((l) => [
        l.code,
        String(l._id),
      ]),
    );

    // --- Niveaux ouverts + frais de l'année -------------------------------
    for (const level of SCHOOL_LEVELS) {
      const levelId = levelIdByCode.get(level.code)!;
      await levelsService.enableForSchoolYear(schoolYearId, levelId);
      report.feeSchedulesCreated += await upsertedCount(
        feeScheduleModel.updateOne(
          { schoolYearId, levelId },
          {
            $setOnInsert: {
              schoolYearId,
              levelId,
              registrationFee: level.registrationFee,
              tuitionFee: level.tuitionFee,
            },
          },
          { upsert: true },
        ),
      );
    }

    // --- Matières et coefficients par niveau ------------------------------
    const displayOrderByLevel = new Map<string, number>();
    for (const subject of SCHOOL_SUBJECTS) {
      const labelNormalized = normalizeLabel(subject.label);
      report.subjectsCreated += await upsertedCount(
        subjectModel.updateOne(
          { labelNormalized },
          {
            $setOnInsert: {
              label: subject.label,
              labelNormalized,
              category: subject.category,
              active: true,
            },
          },
          { upsert: true },
        ),
      );
      const stored = await subjectModel
        .findOne({ labelNormalized })
        .lean()
        .exec();
      const subjectId = String(stored!._id);

      for (const [code, coefficient] of Object.entries(subject.coefficients)) {
        const levelId = levelIdByCode.get(code);
        if (!levelId) {
          continue;
        }
        const displayOrder = (displayOrderByLevel.get(code) ?? 0) + 1;
        displayOrderByLevel.set(code, displayOrder);
        report.classSubjectsCreated += await upsertedCount(
          classSubjectModel.updateOne(
            { schoolYearId, levelId, subjectId },
            {
              $setOnInsert: {
                schoolYearId,
                levelId,
                subjectId,
                coefficient,
                displayOrder,
              },
            },
            { upsert: true },
          ),
        );
      }
    }

    // --- Catégories de dépenses -------------------------------------------
    for (const category of SCHOOL_EXPENSE_CATEGORIES) {
      report.expenseCategoriesCreated += await upsertedCount(
        expenseCategoryModel.updateOne(
          { name: category.name },
          { $setOnInsert: category },
          { upsert: true },
        ),
      );
    }

    // --- Paramètres généraux (seulement ceux jamais définis) --------------
    const settingDefaults: Array<[SettingKey, () => Promise<unknown>]> = [
      [
        SettingKey.PAYMENT_ALLOCATION_RULE,
        () =>
          settingsService.setPaymentAllocationRule(
            PaymentAllocationRule.ARREARS_FIRST,
          ),
      ],
      [
        SettingKey.RECEIPT_MODE,
        () =>
          settingsService.setReceiptMode(ReceiptMode.TUITION_AND_REGISTRATION),
      ],
      [
        SettingKey.STUDENT_MATRICULE_RULE,
        () =>
          settingsService.setStudentMatriculeRule({
            prefix: 'MAT',
            separator: '-',
            padding: 4,
            startAt: 1,
          }),
      ],
      [
        SettingKey.CHEF_ETABLISSEMENT_NOM,
        () =>
          settingsService.setChefEtablissementNom(
            options.chefEtablissementNom ?? 'M. le Directeur',
          ),
      ],
    ];
    for (const [key, apply] of settingDefaults) {
      const exists = await settingModel.exists({ key, schoolYearId: null });
      if (!exists) {
        await apply();
        report.settingsCreated += 1;
      }
    }
  });

  // --- Modules ------------------------------------------------------------
  if (options.activateAllModules) {
    const actorId =
      options.actorId ??
      (await userModel
        .findOne({ ecoleId, role: Role.SUPER_ADMIN })
        .lean()
        .exec()
        .then((user) => (user ? String(user._id) : undefined)));
    if (!actorId) {
      console.warn(
        'Aucun super administrateur pour cette ecole : modules non actives',
      );
    } else {
      for (const code of ALL_MODULE_CODES) {
        const wasActive = await runAsPlatformAdmin(() =>
          ecoleModulesService.isActive(ecoleId, code),
        );
        if (!wasActive) {
          await runAsPlatformAdmin(() =>
            ecoleModulesService.activate(ecoleId, code, actorId),
          );
          report.modulesActivated.push(code);
        }
      }
    }
  }

  return report;
}

// `npm run seed:demo` - applies the full configuration to an existing
// ecole (DEMO_ECOLE_ID, or the oldest one, like seed.ts) and activates every
// module so all screens can be shown.
export async function runSeedSchoolConfiguration() {
  const app = await NestFactory.createApplicationContext(AppModule);
  try {
    const ecoleModel = app.get<Model<Ecole>>(getModelToken(Ecole.name));
    const requestedId = process.env.DEMO_ECOLE_ID;
    const ecole = await runAsPlatformAdmin(() =>
      requestedId && Types.ObjectId.isValid(requestedId)
        ? ecoleModel.findById(requestedId).lean().exec()
        : ecoleModel.findOne().sort({ dateInscription: 1 }).lean().exec(),
    );
    if (!ecole) {
      throw new Error(
        "Aucune ecole trouvee - demarrer l'application une premiere fois (seed initial) ou verifier DEMO_ECOLE_ID",
      );
    }

    const report = await seedSchoolConfiguration(app, {
      ecoleId: String(ecole._id),
      activateAllModules: true,
      chefEtablissementNom: process.env.DEMO_CHEF_ETABLISSEMENT,
    });
    console.log(`Parametrage applique a l'ecole "${ecole.nom}" :`, report);
  } finally {
    await app.close();
  }
}

if (require.main === module) {
  runSeedSchoolConfiguration().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
