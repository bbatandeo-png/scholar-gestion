import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuditModule } from '../audit/audit.module';
import { EcoleModule, EcoleModuleSchema } from './schemas/ecole-module.schema';
import { EcoleModulesService } from './ecole-modules.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: EcoleModule.name, schema: EcoleModuleSchema },
    ]),
    AuditModule,
  ],
  providers: [EcoleModulesService],
  exports: [EcoleModulesService, MongooseModule],
})
export class EcoleModulesModule {}
