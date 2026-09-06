import { Type } from 'class-transformer';
import { IsEnum, IsNotEmpty, IsNumber, IsString, Min } from 'class-validator';
import {
  BadRequestException,
  Body,
  Controller,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { Roles } from '../common/decorators/roles.decorator';
import {
  PaymentAllocationRule,
  ReceiptMode,
  Role,
} from '../common/enums/domain.enums';
import { AuthenticatedGuard } from '../common/guards/authenticated.guard';
import { CurrentEcole } from '../common/decorators/current-ecole.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { setFlash } from '../common/utils/flash.util';
import { SettingsService, StudentMatriculeRule } from './settings.service';
import { SchoolYearsService } from '../school-years/school-years.service';
import { EcolesService } from '../ecoles/ecoles.service';

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

class UpdateReceiptModeDto {
  @IsEnum(ReceiptMode)
  value: ReceiptMode;
}

class UpdateChefEtablissementDto {
  @IsString()
  @IsNotEmpty()
  value: string;
}

@Controller('/settings')
@UseGuards(AuthenticatedGuard, RolesGuard)
export class SettingsController {
  constructor(
    private readonly settingsService: SettingsService,
    private readonly schoolYearsService: SchoolYearsService,
    private readonly ecolesService: EcolesService,
  ) {}

  @Post('/payment-allocation')
  @Roles(Role.SUPER_ADMIN, Role.DIRECTION)
  async updatePaymentRule(
    @Body() dto: UpdatePaymentRuleDto,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const year = await this.schoolYearsService.requireOpen();
    await this.settingsService.setPaymentAllocationRule(
      dto.value,
      String(year._id),
    );
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

  @Post('/receipt-mode')
  @Roles(Role.SUPER_ADMIN, Role.DIRECTION)
  async updateReceiptMode(
    @Body() dto: UpdateReceiptModeDto,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const year = await this.schoolYearsService.requireOpen();
    await this.settingsService.setReceiptMode(dto.value, String(year._id));
    setFlash(req, 'success', 'Mode de recu mis a jour');
    return res.redirect('/settings/fees');
  }

  @Post('/chef-etablissement')
  @Roles(Role.SUPER_ADMIN, Role.DIRECTION)
  async updateChefEtablissement(
    @Body() dto: UpdateChefEtablissementDto,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    await this.settingsService.setChefEtablissementNom(dto.value);
    setFlash(req, 'success', 'Nom du chef d etablissement mis a jour');
    return res.redirect('/settings/fees');
  }

  @Post('/school-name')
  @Roles(Role.SUPER_ADMIN, Role.DIRECTION)
  async updateSchoolName(
    @Body() dto: UpdateSchoolNameDto,
    @Req() req: Request,
    @Res() res: Response,
    @CurrentEcole() ecoleId: string | null,
  ) {
    if (!ecoleId) {
      throw new BadRequestException('Aucune ecole associee a ce compte');
    }
    await this.ecolesService.update(ecoleId, { nom: dto.name });
    setFlash(req, 'success', 'Nom de l école mis a jour');
    return res.redirect('/settings/fees');
  }
}
