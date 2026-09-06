import { IsEnum, IsMongoId, IsOptional } from 'class-validator';
import {
  BulletinStudentMatchingMode,
  Periode,
} from '../../common/enums/domain.enums';

export class CreateSessionDto {
  @IsMongoId()
  schoolYearId: string;

  @IsMongoId()
  levelId: string;

  @IsEnum(Periode)
  periode: Periode;

  @IsOptional()
  @IsEnum(BulletinStudentMatchingMode)
  studentMatchingMode?: BulletinStudentMatchingMode;
}
