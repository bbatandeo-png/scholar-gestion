import {
  IsEnum,
  IsISO8601,
  IsMongoId,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { DisciplineRecordType } from '../../common/enums/domain.enums';

// No schoolYearId here on purpose: the record is always attached to the
// school's current open year, resolved server-side in
// DisciplineController.create() - never trusted from the client, so a
// staff member browsing a past year can't backdate an entry into it.
export class CreateDisciplineRecordDto {
  @IsMongoId()
  studentId: string;

  @IsEnum(DisciplineRecordType)
  type: DisciplineRecordType;

  @IsISO8601()
  date: string;

  @IsString()
  @MaxLength(2000)
  motif: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  mesure?: string;
}
