import { NestFactory } from '@nestjs/core';
import * as bcrypt from 'bcryptjs';
import { getModelToken } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AppModule } from '../app.module';
import { BillingService } from '../billing/billing.service';
import { Level } from '../levels/schemas/level.schema';
import {
  EcoleAccountStatus,
  Role,
  SchoolYearStatus,
} from '../common/enums/domain.enums';
import { Ecole, EcoleDocument } from '../ecoles/schemas/ecole.schema';
import { SchoolYear } from '../school-years/schemas/school-year.schema';
import { SettingsService } from '../settings/settings.service';
import { UsersService } from '../users/users.service';
import { LevelsService } from '../levels/levels.service';
import { runWithTenant } from '../common/tenant/tenant-context';

export function shouldRunSeed(env: NodeJS.ProcessEnv = process.env) {
  if (env.NODE_ENV === 'test') {
    return false;
  }

  return env.SEED_ON_START !== 'false';
}

export async function runSeed() {
  const app = await NestFactory.createApplicationContext(AppModule);
  try {
    const usersService = app.get(UsersService);
    const billingService = app.get(BillingService);
    const settingsService = app.get(SettingsService);
    const levelsService = app.get(LevelsService);
    const schoolYearModel = app.get<Model<SchoolYear>>(
      getModelToken(SchoolYear.name),
    );
    const levelModel = app.get<Model<Level>>(getModelToken(Level.name));
    const ecoleModel = app.get<Model<EcoleDocument>>(getModelToken(Ecole.name));

    // Prefer whatever ecole already exists (e.g. the one created by
    // migrate-add-ecole-id.ts) over matching by name - a dev/single-tenant
    // database should only ever have one, and re-seeding must reuse it
    // rather than fragment data across a second, empty ecole.
    const ecoleName = process.env.SEED_ECOLE_NAME ?? 'Ecole par defaut';
    const existingEcole = await ecoleModel
      .findOne()
      .sort({ dateInscription: 1 })
      .lean()
      .exec();
    const ecoleId = existingEcole
      ? String(existingEcole._id)
      : String(
          (
            await ecoleModel.create({
              nom: ecoleName,
              statutCompte: EcoleAccountStatus.ACTIF,
              dateInscription: new Date(),
            })
          )._id,
        );

    const adminPassword = process.env.ADMIN_PASSWORD ?? 'Admin123!';
    const passwordHash = await bcrypt.hash(adminPassword, 10);
    await usersService.ensureAdmin({
      name: process.env.ADMIN_NAME ?? 'Super Admin',
      email: process.env.ADMIN_EMAIL ?? 'admin@scolar-gestion.local',
      passwordHash,
      role: Role.SUPER_ADMIN,
      ecoleId,
    });

    // Only on the very first boot of a brand new ecole - the hardcoded
    // school years/status below are meant to bootstrap an empty database,
    // never to run again against one that already has real, ongoing data.
    // Re-running this on every startup against an existing ecole used to
    // forcibly flip its actually-open school year back to CLOSED and open a
    // fresh, empty one instead (the unique "one open year" index lets this
    // happen silently, no error) - wiping out the current roster from every
    // screen that filters by the open year, even though no data was
    // actually deleted.
    if (!existingEcole) {
      await runWithTenant({ ecoleId, bypass: false }, () =>
        seedAcademicData({
          ecoleId,
          billingService,
          settingsService,
          levelsService,
          schoolYearModel,
          levelModel,
        }),
      );
    }

    console.log('Seed termine.');
  } finally {
    await app.close();
  }
}

async function seedAcademicData(deps: {
  ecoleId: string;
  billingService: BillingService;
  settingsService: SettingsService;
  levelsService: LevelsService;
  schoolYearModel: Model<SchoolYear>;
  levelModel: Model<Level>;
}) {
  const {
    billingService,
    settingsService,
    levelsService,
    schoolYearModel,
    levelModel,
  } = deps;

  const schoolYears = [
    {
      label: '2025-2026',
      startDate: new Date('2025-09-01'),
      endDate: new Date('2026-06-30'),
      status: SchoolYearStatus.CLOSED,
    },
    {
      label: '2026-2027',
      startDate: new Date('2026-09-01'),
      endDate: new Date('2027-06-30'),
      status: SchoolYearStatus.OPEN,
    },
  ];

  for (const schoolYear of schoolYears) {
    await schoolYearModel.findOneAndUpdate(
      { label: schoolYear.label },
      schoolYear,
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
  }

  const levels = [
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
    '2NDE',
    '1ERE',
    'TERMINALE',
  ].map((code, index) => ({ code, label: code, sortOrder: index + 1 }));

  for (const level of levels) {
    await levelModel.findOneAndUpdate({ code: level.code }, level, {
      upsert: true,
      new: true,
      setDefaultsOnInsert: true,
    });
  }

  const openYear = await schoolYearModel
    .findOne({ label: '2026-2027' })
    .lean()
    .exec();
  const storedLevels = await levelModel
    .find()
    .sort({ sortOrder: 1 })
    .lean()
    .exec();
  if (openYear) {
    for (const level of storedLevels) {
      await levelsService.enableForSchoolYear(
        String((openYear as any)._id),
        String((level as any)._id),
      );
      if (level.sortOrder <= 5) {
        await billingService.upsertFeeSchedule({
          schoolYearId: String((openYear as any)._id),
          levelId: String((level as any)._id),
          registrationFee: 25000 + level.sortOrder * 1000,
          tuitionFee: 75000 + level.sortOrder * 5000,
        });
      }
    }
  }

  await settingsService.setPaymentAllocationRule('arrears_first' as any);
}

if (require.main === module) {
  void runSeed();
}
