import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Guardian, GuardianSchema } from './schemas/guardian.schema';
import { GuardiansService } from './guardians.service';

@Module({
	imports: [MongooseModule.forFeature([{ name: Guardian.name, schema: GuardianSchema }])],
	providers: [GuardiansService],
	exports: [GuardiansService, MongooseModule],
})
export class GuardiansModule {}