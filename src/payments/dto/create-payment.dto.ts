import { Type } from 'class-transformer';
import { IsEnum, IsMongoId, IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { PaymentMethod } from '../../common/enums/domain.enums';

export class CreatePaymentDto {
  @IsMongoId()
  invoiceId: string;

  @Type(() => Number)
  @IsNumber()
  @Min(1)
  amount: number;

  @IsEnum(PaymentMethod)
  method: PaymentMethod;

  @IsOptional()
  @IsString()
  reference?: string;
}