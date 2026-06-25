import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { BillingModule } from './billing/billing.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { LevelsModule } from './levels/levels.module';
import { SchoolYearsModule } from './school-years/school-years.module';
import { SettingsModule } from './settings/settings.module';
import { UsersModule } from './users/users.module';
import { StudentsModule } from './students/students.module';
import { GuardiansModule } from './guardians/guardians.module';
import { EnrollmentsModule } from './enrollments/enrollments.module';
import { ArrearsModule } from './arrears/arrears.module';
import { PaymentsModule } from './payments/payments.module';
import { PromotionsModule } from './promotions/promotions.module';
import { ReportsModule } from './reports/reports.module';
import { RootController } from './root.controller';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    MongooseModule.forRootAsync({
      useFactory: () => ({
        uri: process.env.MONGODB_URI ?? 'mongodb://127.0.0.1:27017/schoolar',
      }),
    }),
    AuthModule,
    UsersModule,
    SchoolYearsModule,
    LevelsModule,
    StudentsModule,
    GuardiansModule,
    EnrollmentsModule,
    BillingModule,
    PaymentsModule,
    ArrearsModule,
    PromotionsModule,
    DashboardModule,
    ReportsModule,
    AuditModule,
    SettingsModule,
  ],
  controllers: [RootController],
})
export class AppModule {}
