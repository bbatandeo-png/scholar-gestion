import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ArrearsModule } from '../arrears/arrears.module';
import { AuditModule } from '../audit/audit.module';
import { BillingModule } from '../billing/billing.module';
import { EcoleModulesModule } from '../ecole-modules/ecole-modules.module';
import { EcolesModule } from '../ecoles/ecoles.module';
import { SettingsModule } from '../settings/settings.module';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { Payment, PaymentSchema } from './schemas/payment.schema';
import { SchoolYearsModule } from '../school-years/school-years.module';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Payment.name, schema: PaymentSchema }]),
    BillingModule,
    ArrearsModule,
    SettingsModule,
    AuditModule,
    SchoolYearsModule,
    EcoleModulesModule,
    EcolesModule,
  ],
  controllers: [PaymentsController],
  providers: [PaymentsService],
  exports: [PaymentsService, MongooseModule],
})
export class PaymentsModule {}
