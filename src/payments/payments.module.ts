import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ArrearsModule } from '../arrears/arrears.module';
import { AuditModule } from '../audit/audit.module';
import { BillingModule } from '../billing/billing.module';
import { SettingsModule } from '../settings/settings.module';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { Payment, PaymentSchema } from './schemas/payment.schema';

@Module({
	imports: [
		MongooseModule.forFeature([{ name: Payment.name, schema: PaymentSchema }]),
		BillingModule,
		ArrearsModule,
		SettingsModule,
		AuditModule,
	],
	controllers: [PaymentsController],
	providers: [PaymentsService],
	exports: [PaymentsService, MongooseModule],
})
export class PaymentsModule {}