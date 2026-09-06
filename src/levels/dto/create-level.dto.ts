import { Transform, Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { LevelCycle } from '../../common/enums/domain.enums';

export class CreateLevelDto {
  @IsString()
  code: string;

  @IsString()
  label: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  sortOrder: number;

  @IsOptional()
  @Transform(({ value }) =>
    value === '' || value === undefined ? undefined : Number(value),
  )
  @IsIn([LevelCycle.COLLEGE, LevelCycle.LYCEE])
  cycle?: LevelCycle;
}
