import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { EcoleModulesModule } from '../ecole-modules/ecole-modules.module';
import { SchoolYearsModule } from '../school-years/school-years.module';
import { UsersModule } from '../users/users.module';
import { DashboardModule } from '../dashboard/dashboard.module';
import { LicensingModule } from '../licensing/licensing.module';
import { Ecole, EcoleSchema } from './schemas/ecole.schema';
import { EcolesController } from './ecoles.controller';
import { EcolesService } from './ecoles.service';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Ecole.name, schema: EcoleSchema }]),
    UsersModule,
    SchoolYearsModule,
    EcoleModulesModule,
    DashboardModule,
    LicensingModule,
  ],
  controllers: [EcolesController],
  providers: [EcolesService],
  exports: [EcolesService, MongooseModule],
})
export class EcolesModule {}
