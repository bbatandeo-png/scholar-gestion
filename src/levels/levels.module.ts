import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Level, LevelSchema } from './schemas/level.schema';
import {
  SchoolYearLevel,
  SchoolYearLevelSchema,
} from './schemas/school-year-level.schema';
import { LevelsController } from './levels.controller';
import { LevelsService } from './levels.service';
import { SchoolYearsModule } from '../school-years/school-years.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Level.name, schema: LevelSchema },
      { name: SchoolYearLevel.name, schema: SchoolYearLevelSchema },
    ]),
    SchoolYearsModule,
  ],
  controllers: [LevelsController],
  providers: [LevelsService],
  exports: [LevelsService, MongooseModule],
})
export class LevelsModule {}
