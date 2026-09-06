import { IsEnum, IsString } from 'class-validator';
import { SubjectCategory } from '../../common/enums/domain.enums';

export class CreateSubjectDto {
  @IsString()
  label: string;

  @IsEnum(SubjectCategory)
  category: SubjectCategory;
}
