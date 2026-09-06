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
import { ExpensesModule } from './expenses/expenses.module';
import { PromotionsModule } from './promotions/promotions.module';
import { ReportsModule } from './reports/reports.module';
import { BulletinsModule } from './bulletins/bulletins.module';
import { EcolesModule } from './ecoles/ecoles.module';
import { EcoleModulesModule } from './ecole-modules/ecole-modules.module';
import { FacturationModule } from './facturation/facturation.module';
import { LicensingModule } from './licensing/licensing.module';
import { RootController } from './root.controller';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    MongooseModule.forRootAsync({
      useFactory: () => ({
        uri: process.env.MONGODB_URI ?? 'mongodb://127.0.0.1:27017/schoolar',
        // Default is 9 attempts, 3s apart - each attempt itself waits up to
        // the driver's serverSelectionTimeoutMS (30s), so 9 attempts is
        // only ~5 minutes before Nest gives up and the whole process
        // crashes. On a school's own machine, MongoDB can easily take
        // longer than that to come up after a cold boot (service startup
        // order, a slow disk, antivirus scanning it...) - a crashed exe
        // then needs a non-technical user to notice and relaunch it
        // manually. Retrying for a very long time instead means the app
        // just waits out a slow database and connects on its own the
        // moment it's ready, with nobody having to do anything. Left at
        // the short default in tests - a genuinely broken test database
        // should still fail fast instead of hanging the suite.
        retryAttempts: process.env.NODE_ENV === 'test' ? 9 : 100000,
        retryDelay: process.env.NODE_ENV === 'test' ? 3000 : 5000,
      }),
    }),
    AuthModule,
    EcoleModulesModule,
    EcolesModule,
    UsersModule,
    SchoolYearsModule,
    LevelsModule,
    StudentsModule,
    GuardiansModule,
    EnrollmentsModule,
    BillingModule,
    PaymentsModule,
    ExpensesModule,
    ArrearsModule,
    PromotionsModule,
    DashboardModule,
    ReportsModule,
    BulletinsModule,
    AuditModule,
    SettingsModule,
    FacturationModule,
    LicensingModule,
  ],
  controllers: [RootController],
})
export class AppModule {}
