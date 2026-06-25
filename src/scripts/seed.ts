import { NestFactory } from '@nestjs/core';
import * as bcrypt from 'bcrypt';
import { getModelToken } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AppModule } from '../app.module';
import { BillingService } from '../billing/billing.service';
import { Level } from '../levels/schemas/level.schema';
import { Role, SchoolYearStatus } from '../common/enums/domain.enums';
import { SchoolYear } from '../school-years/schemas/school-year.schema';
import { SettingsService } from '../settings/settings.service';
import { UsersService } from '../users/users.service';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  try {
    const usersService = app.get(UsersService);
    const billingService = app.get(BillingService);
    const settingsService = app.get(SettingsService);
    const schoolYearModel = app.get<Model<SchoolYear>>(getModelToken(SchoolYear.name));
    const levelModel = app.get<Model<Level>>(getModelToken(Level.name));

    const adminPassword = process.env.ADMIN_PASSWORD ?? 'Admin123!';
    const passwordHash = await bcrypt.hash(adminPassword, 10);
    await usersService.ensureAdmin({
      name: process.env.ADMIN_NAME ?? 'Super Admin',
      email: process.env.ADMIN_EMAIL ?? 'admin@scolar-gestion.local',
      passwordHash,
      role: Role.SUPER_ADMIN,
    });

    const schoolYears = [
      { label: '2025-2026', startDate: new Date('2025-09-01'), endDate: new Date('2026-06-30'), status: SchoolYearStatus.CLOSED },
      { label: '2026-2027', startDate: new Date('2026-09-01'), endDate: new Date('2027-06-30'), status: SchoolYearStatus.OPEN },
    ];

    for (const schoolYear of schoolYears) {
      await schoolYearModel.findOneAndUpdate(
        { label: schoolYear.label },
        schoolYear,
        { upsert: true, new: true, setDefaultsOnInsert: true },
      );
    }

    const levels = [
      'CP1', 'CP2', 'CE1', 'CE2', 'CM1', 'CM2', '6EME', '5EME', '4EME', '3EME', '2NDE', '1ERE', 'TERMINALE',
    ].map((code, index) => ({ code, label: code, sortOrder: index + 1 }));

    for (const level of levels) {
      await levelModel.findOneAndUpdate(
        { code: level.code },
        level,
        { upsert: true, new: true, setDefaultsOnInsert: true },
      );
    }

    const openYear = await schoolYearModel.findOne({ label: '2026-2027' }).lean().exec();
    const storedLevels = await levelModel.find().sort({ sortOrder: 1 }).lean().exec();
    if (openYear) {
      for (const level of storedLevels.slice(0, 5)) {
        await billingService.upsertFeeSchedule({
          schoolYearId: String((openYear as any)._id),
          levelId: String((level as any)._id),
          registrationFee: 25000 + level.sortOrder * 1000,
          tuitionFee: 75000 + level.sortOrder * 5000,
        });
      }
    }

    await settingsService.setPaymentAllocationRule('arrears_first' as any);
    console.log('Seed termine.');
  } finally {
    await app.close();
  }
}

void bootstrap();