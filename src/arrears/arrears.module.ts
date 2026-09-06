import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuditModule } from '../audit/audit.module';
import { EcoleModulesModule } from '../ecole-modules/ecole-modules.module';
import { Arrear, ArrearSchema } from './schemas/arrear.schema';
import {
  ArrearCarryForward,
  ArrearCarryForwardSchema,
} from './schemas/arrear-carry-forward.schema';
import { ArrearsController } from './arrears.controller';
import { ArrearsService } from './arrears.service';
import { SchoolYearsModule } from '../school-years/school-years.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Arrear.name, schema: ArrearSchema },
      { name: ArrearCarryForward.name, schema: ArrearCarryForwardSchema },
    ]),
    AuditModule,
    SchoolYearsModule,
    EcoleModulesModule,
  ],
  controllers: [ArrearsController],
  providers: [ArrearsService],
  exports: [ArrearsService, MongooseModule],
})
export class ArrearsModule {}
