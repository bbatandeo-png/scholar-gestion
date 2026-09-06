import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, SchemaTypes } from 'mongoose';
import { ecoleScopePlugin } from '../../common/mongoose/ecole-scope.plugin';

export type SchoolYearLevelDocument = HydratedDocument<SchoolYearLevel>;

@Schema({ timestamps: true, collection: 'school_year_levels' })
export class SchoolYearLevel {
  @Prop({
    type: SchemaTypes.ObjectId,
    required: true,
    ref: 'SchoolYear',
    index: true,
  })
  schoolYearId: string;

  @Prop({
    type: SchemaTypes.ObjectId,
    required: true,
    ref: 'Level',
    index: true,
  })
  levelId: string;

  @Prop({ required: true, default: true })
  isEnabled: boolean;
}

export const SchoolYearLevelSchema =
  SchemaFactory.createForClass(SchoolYearLevel);
SchoolYearLevelSchema.plugin(ecoleScopePlugin);
SchoolYearLevelSchema.index(
  { ecoleId: 1, schoolYearId: 1, levelId: 1 },
  { unique: true },
);
