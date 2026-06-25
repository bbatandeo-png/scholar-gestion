import { Transform, Type } from 'class-transformer';
import { IsArray, IsBoolean, IsEnum, IsMongoId, ValidateNested } from 'class-validator';
import { FinalDecision } from '../../common/enums/domain.enums';

class PromotionDecisionDto {
  @IsMongoId()
  studentId: string;

  @IsMongoId()
  sourceEnrollmentId: string;

  @IsEnum(FinalDecision)
  decision: FinalDecision;

  @IsMongoId()
  targetLevelId: string;
}

export class ValidatePromotionsDto {
  @IsMongoId()
  sourceSchoolYearId: string;

  @IsMongoId()
  targetSchoolYearId: string;

  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  carryOverArrears: boolean;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PromotionDecisionDto)
  decisions: PromotionDecisionDto[];
}