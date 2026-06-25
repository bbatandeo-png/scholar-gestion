import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { SchoolYear, SchoolYearSchema } from './schemas/school-year.schema';
import { SchoolYearsController } from './school-years.controller';
import { SchoolYearsService } from './school-years.service';

@Module({
  imports: [MongooseModule.forFeature([{ name: SchoolYear.name, schema: SchoolYearSchema }])],
  controllers: [SchoolYearsController],
  providers: [SchoolYearsService],
  exports: [SchoolYearsService, MongooseModule],
})
export class SchoolYearsModule {}