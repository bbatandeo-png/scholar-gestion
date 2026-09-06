import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Render,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { CurrentEcole } from '../common/decorators/current-ecole.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/domain.enums';
import { AuthenticatedGuard } from '../common/guards/authenticated.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { SessionUser } from '../common/types/session-user.type';
import { setFlash } from '../common/utils/flash.util';
import { RenewLicenseDto } from './dto/renew-license.dto';
import { LicensingService } from './licensing.service';

// Deliberately reachable even while the license is in the 'blocked' state -
// see main.ts's license-enforcement middleware, which exempts this whole
// path from the write block so a blocked school can still submit a renewal
// code.
@Controller('/licence')
@UseGuards(AuthenticatedGuard, RolesGuard)
@Roles(Role.SUPER_ADMIN, Role.DIRECTION, Role.SECRETARIAT)
export class LicenseController {
  constructor(private readonly licensingService: LicensingService) {}

  @Get()
  @Render('licence/index')
  async index(@CurrentEcole() ecoleId: string | null) {
    if (!ecoleId) {
      throw new BadRequestException('Aucune ecole associee a ce compte');
    }
    return {
      title: 'Licence',
      status: await this.licensingService.getStatus(ecoleId),
    };
  }

  @Post('/renew')
  async renew(
    @Body() dto: RenewLicenseDto,
    @Req() req: Request,
    @Res() res: Response,
    @CurrentEcole() ecoleId: string | null,
    @CurrentUser() user: SessionUser | undefined,
  ) {
    if (!ecoleId) {
      throw new BadRequestException('Aucune ecole associee a ce compte');
    }
    try {
      await this.licensingService.applyRenewalCode(
        ecoleId,
        dto.code,
        user?.id ?? '',
      );
      setFlash(req, 'success', 'Licence renouvelee avec succes');
    } catch (error) {
      setFlash(
        req,
        'error',
        error instanceof Error
          ? error.message
          : 'Code de renouvellement invalide',
      );
    }
    return res.redirect('/licence');
  }
}
