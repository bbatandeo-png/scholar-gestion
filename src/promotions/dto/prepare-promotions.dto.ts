import { IsMongoId } from 'class-validator';

export class PreparePromotionsDto {
  @IsMongoId()
  sourceSchoolYearId: string;

  @IsMongoId()
  targetSchoolYearId: string;
}