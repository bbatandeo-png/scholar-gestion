import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { BillingModule } from '../billing/billing.module';
import { EcolesModule } from '../ecoles/ecoles.module';
import { LevelsModule } from '../levels/levels.module';
import { SchoolYearsModule } from '../school-years/school-years.module';
import { Setting, SettingSchema } from './schemas/setting.schema';
import { SettingsController } from './settings.controller';
import { SettingsService } from './settings.service';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Setting.name, schema: SettingSchema }]),
    forwardRef(() => BillingModule),
    forwardRef(() => LevelsModule),
    SchoolYearsModule,
    EcolesModule,
  ],
  controllers: [SettingsController],
  providers: [SettingsService],
  exports: [SettingsService, MongooseModule],
})
export class SettingsModule {}
