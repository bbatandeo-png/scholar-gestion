import { IsIn } from 'class-validator';

export class ToggleRegistrationPaymentRequiredDto {
  @IsIn(['true', 'false'])
  required: string;
}
