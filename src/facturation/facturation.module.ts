import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { EcolesModule } from '../ecoles/ecoles.module';
import { FacturationController } from './facturation.controller';
import { FacturationService } from './facturation.service';
import { PlatformFacturationController } from './platform-facturation.controller';
import { Consommation, ConsommationSchema } from './schemas/consommation.schema';
import { Facture, FactureSchema } from './schemas/facture.schema';
import {
  ParametreFacturation,
  ParametreFacturationSchema,
} from './schemas/parametre-facturation.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ParametreFacturation.name, schema: ParametreFacturationSchema },
      { name: Consommation.name, schema: ConsommationSchema },
      { name: Facture.name, schema: FactureSchema },
    ]),
    EcolesModule,
  ],
  controllers: [FacturationController, PlatformFacturationController],
  providers: [FacturationService],
  exports: [FacturationService, MongooseModule],
})
export class FacturationModule {}
