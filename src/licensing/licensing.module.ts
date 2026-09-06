import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuditModule } from '../audit/audit.module';
import { LicenseController } from './license.controller';
import { LicensingService } from './licensing.service';
import {
  LicenseState,
  LicenseStateSchema,
} from './schemas/license-state.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: LicenseState.name, schema: LicenseStateSchema },
    ]),
    AuditModule,
  ],
  controllers: [LicenseController],
  providers: [LicensingService],
  exports: [LicensingService],
})
export class LicensingModule {}
