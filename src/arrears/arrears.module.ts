import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuditModule } from '../audit/audit.module';
import { Arrear, ArrearSchema } from './schemas/arrear.schema';
import { ArrearsController } from './arrears.controller';
import { ArrearsService } from './arrears.service';

@Module({
	imports: [
		MongooseModule.forFeature([{ name: Arrear.name, schema: ArrearSchema }]),
		AuditModule,
	],
	controllers: [ArrearsController],
	providers: [ArrearsService],
	exports: [ArrearsService, MongooseModule],
})
export class ArrearsModule {}