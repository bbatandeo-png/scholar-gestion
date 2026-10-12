import { Transform } from 'class-transformer';
import { IsEnum, IsOptional, IsString } from 'class-validator';
import { TeacherStatus } from '../../common/enums/domain.enums';
import { emptyToUndefined } from './dto-transforms.util';

export class SearchTeachersDto {
  @IsOptional()
  @IsString()
  q?: string;

  @IsOptional()
  @Transform(emptyToUndefined)
  @IsEnum(TeacherStatus)
  status?: TeacherStatus;
}
