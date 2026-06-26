import { Type } from 'class-transformer';
import { IsEnum, IsNotEmpty, IsNumber, IsString, Min } from 'class-validator';
import { Body, Controller, Post, Req, Res, UseGuards } from '@nestjs/common';
import { Request, Response } from 'express';
import { Roles } from '../common/decorators/roles.decorator';
import { PaymentAllocationRule, Role } from '../common/enums/domain.enums';
import { AuthenticatedGuard } from '../common/guards/authenticated.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { setFlash } from '../common/utils/flash.util';
import { SettingsService, StudentMatriculeRule } from './settings.service';

class UpdatePaymentRuleDto {
  @IsEnum(PaymentAllocationRule)
  value: PaymentAllocationRule;
}

class UpdateStudentMatriculeRuleDto implements StudentMatriculeRule {
  @IsString()
  prefix: string;

  @IsString()
  separator: string;

  @Type(() => Number)
  @IsNumber()
  @Min(1)
  padding: number;

  @Type(() => Number)
  @IsNumber()
  @Min(1)
  startAt: number;
}

class UpdateSchoolNameDto {
  @IsString()
  @IsNotEmpty()
  name: string;
}

@Controller('/settings')
@UseGuards(AuthenticatedGuard, RolesGuard)
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  @Post('/payment-allocation')
  @Roles(Role.SUPER_ADMIN, Role.DIRECTION)
  async updatePaymentRule(
    @Body() dto: UpdatePaymentRuleDto,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    await this.settingsService.setPaymentAllocationRule(dto.value);
    setFlash(req, 'success', 'Regle d imputation mise a jour');
    return res.redirect('/settings/fees');
  }

  @Post('/matricule-rule')
  @Roles(Role.SUPER_ADMIN, Role.DIRECTION)
  async updateStudentMatriculeRule(
    @Body() dto: UpdateStudentMatriculeRuleDto,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    await this.settingsService.setStudentMatriculeRule(dto);
    setFlash(req, 'success', 'Parametrage du matricule mis a jour');
    return res.redirect('/settings/fees');
  }

  @Post('/school-name')
  @Roles(Role.SUPER_ADMIN, Role.DIRECTION)
  async updateSchoolName(
    @Body() dto: UpdateSchoolNameDto,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    await this.settingsService.setSchoolName(dto.name);
    setFlash(req, 'success', 'Nom de l école mis a jour');
    return res.redirect('/settings/fees');
  }
}
