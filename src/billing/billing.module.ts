import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { LevelsModule } from '../levels/levels.module';
import { SchoolYearsModule } from '../school-years/school-years.module';
import { SettingsModule } from '../settings/settings.module';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';
import { FeeSchedule, FeeScheduleSchema } from './schemas/fee-schedule.schema';
import { Invoice, InvoiceSchema } from './schemas/invoice.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: FeeSchedule.name, schema: FeeScheduleSchema },
      { name: Invoice.name, schema: InvoiceSchema },
    ]),
    SchoolYearsModule,
    LevelsModule,
    forwardRef(() => SettingsModule),
  ],
  controllers: [BillingController],
  providers: [BillingService],
  exports: [BillingService, MongooseModule],
})
export class BillingModule {}