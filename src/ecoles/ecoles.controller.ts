import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Render,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Role } from '../common/enums/domain.enums';
import { AuthenticatedGuard } from '../common/guards/authenticated.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { setFlash } from '../common/utils/flash.util';
import { pickUploadedFile } from '../common/utils/multer.util';
import { runScopedAsEcole } from '../common/tenant/tenant-context';
import { EcoleModulesService } from '../ecole-modules/ecole-modules.service';
import { UsersService } from '../users/users.service';
import { CreateEcoleDto } from './dto/create-ecole.dto';
import { ToggleEcoleModuleDto } from '../ecole-modules/dto/toggle-ecole-module.dto';
import { ToggleRegistrationPaymentRequiredDto } from './dto/toggle-registration-payment-required.dto';
import { UpdateEcoleDto } from './dto/update-ecole.dto';
import { UpdateEcoleStatusDto } from './dto/update-ecole-status.dto';
import { EcolesService } from './ecoles.service';
import { SessionUser } from '../common/types/session-user.type';
import { DashboardService } from '../dashboard/dashboard.service';
import { SchoolYearsService } from '../school-years/school-years.service';

@Controller('/platform/ecoles')
@UseGuards(AuthenticatedGuard, RolesGuard)
@Roles(Role.PLATFORM_ADMIN)
export class EcolesController {
  constructor(
    private readonly ecolesService: EcolesService,
    private readonly usersService: UsersService,
    private readonly ecoleModulesService: EcoleModulesService,
    private readonly dashboardService: DashboardService,
    private readonly schoolYearsService: SchoolYearsService,
  ) {}

  @Get()
  @Render('ecoles/index')
  async index() {
    return {
      title: 'Ecoles',
      ecoles: await this.ecolesService.list(),
    };
  }

  @Post()
  async create(
    @Body() dto: CreateEcoleDto,
    @Req() req: Request,
    @Res() res: Response,
    @CurrentUser() user: SessionUser | undefined,
  ) {
    const actorId = user?.id;
    if (!actorId) {
      setFlash(req, 'error', 'Utilisateur non authentifie');
      return res.redirect('/platform/ecoles');
    }
    try {
      const { ecole, admin, tempPassword } =
        await this.ecolesService.onboardNewEcole(dto, actorId);
      await this.ecolesService.saveLogo(
        String(ecole._id),
        pickUploadedFile(req, 'logo'),
      );
      req.session.lastCreatedCredentials = {
        email: admin.email,
        tempPassword,
      };
      setFlash(
        req,
        'success',
        'Ecole creee. Notez les identifiants du compte administrateur ci-dessous - ils ne seront plus affiches.',
      );
      return res.redirect(`/platform/ecoles/${String(ecole._id)}/edit`);
    } catch (error) {
      setFlash(
        req,
        'error',
        error instanceof Error ? error.message : 'Echec de la creation',
      );
      return res.redirect('/platform/ecoles');
    }
  }

  @Get('/:id/edit')
  @Render('ecoles/index')
  async edit(@Param('id') id: string, @Req() req: Request) {
    const [
      ecoles,
      editEcole,
      ecoleAdmins,
      activeModules,
      provisioningLicenseSecret,
    ] = await Promise.all([
      this.ecolesService.list(),
      this.ecolesService.findById(id),
      this.usersService.list(id),
      this.ecoleModulesService.listForEcole(id),
      this.ecolesService.getProvisioningLicenseSecret(id),
    ]);
    const newCredentials = req.session.lastCreatedCredentials;
    delete req.session.lastCreatedCredentials;
    const activeModuleCodes = activeModules.map((m) => m.code);
    return {
      title: 'Modifier ecole',
      ecoles,
      editEcole,
      ecoleAdmins,
      newCredentials,
      moduleStatus: {
        finance: activeModuleCodes.includes('FINANCE'),
        bulletins: activeModuleCodes.includes('BULLETINS'),
        discipline: activeModuleCodes.includes('DISCIPLINE'),
        stock: activeModuleCodes.includes('STOCK'),
        enseignants: activeModuleCodes.includes('ENSEIGNANTS'),
      },
      releaseAssetsConfigured: this.ecolesService.isReleaseAssetsConfigured(),
      provisioningLicenseSecret,
      registrationPaymentRequired: Boolean(
        editEcole.registrationPaymentRequired,
      ),
      // Min bound for the "Date d'expiration" field on the download form -
      // picking a past date would ship an install already in its grace
      // period (or already blocked).
      today: new Date().toISOString().slice(0, 10),
    };
  }

  // PLATFORM_ADMIN read-only view of one ecole's own dashboard, without
  // logging out and back in as that ecole's admin - this session's tenant
  // context has no ecoleId (bypass mode), so every query the dashboard
  // makes is explicitly narrowed via runScopedAsEcole, same pattern as
  // PlatformFacturationController.
  @Get('/:id/dashboard')
  @Render('dashboard/index')
  async dashboard(@Param('id') id: string) {
    const ecole = await this.ecolesService.findById(id);
    const year = await runScopedAsEcole(id, () =>
      this.schoolYearsService.resolveSelected(undefined).catch(() => null),
    );
    if (!year) {
      return {
        title: `Tableau de bord — ${ecole.nom}`,
        summary: null,
        selectedYear: null,
        platformViewEcole: ecole,
      };
    }
    const summary = await runScopedAsEcole(id, () =>
      this.dashboardService.getSummary(String(year._id)),
    );
    return {
      title: `Tableau de bord — ${ecole.nom}`,
      summary,
      selectedYear: year,
      platformViewEcole: ecole,
    };
  }

  @Post('/:id/modules/toggle')
  async toggleModule(
    @Param('id') id: string,
    @Body() dto: ToggleEcoleModuleDto,
    @Req() req: Request,
    @Res() res: Response,
    @CurrentUser() user: SessionUser | undefined,
  ) {
    const actorId = user?.id;
    if (!actorId) {
      setFlash(req, 'error', 'Utilisateur non authentifie');
      return res.redirect(`/platform/ecoles/${id}/edit`);
    }
    try {
      if (dto.active === 'true') {
        await this.ecoleModulesService.activate(id, dto.code, actorId);
      } else {
        await this.ecoleModulesService.deactivate(id, dto.code, actorId);
      }
      setFlash(req, 'success', `Module ${dto.code} mis a jour`);
    } catch (error) {
      setFlash(
        req,
        'error',
        error instanceof Error
          ? error.message
          : 'Echec de la mise a jour du module',
      );
    }
    return res.redirect(`/platform/ecoles/${id}/edit`);
  }

  @Post('/:id/registration-payment-required/toggle')
  async toggleRegistrationPaymentRequired(
    @Param('id') id: string,
    @Body() dto: ToggleRegistrationPaymentRequiredDto,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    try {
      await this.ecolesService.setRegistrationPaymentRequired(
        id,
        dto.required === 'true',
      );
      setFlash(req, 'success', "Paiement a l'inscription mis a jour");
    } catch (error) {
      setFlash(
        req,
        'error',
        error instanceof Error
          ? error.message
          : 'Echec de la mise a jour du reglage',
      );
    }
    return res.redirect(`/platform/ecoles/${id}/edit`);
  }

  @Post('/:id/users/:userId/reset-password')
  async resetAdminPassword(
    @Param('id') id: string,
    @Param('userId') userId: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    try {
      const { email, tempPassword } =
        await this.ecolesService.resetAdminPassword(id, userId);
      req.session.lastCreatedCredentials = { email, tempPassword };
      setFlash(
        req,
        'success',
        'Mot de passe reinitialise. Notez les identifiants ci-dessous - ils ne seront plus affiches.',
      );
    } catch (error) {
      setFlash(
        req,
        'error',
        error instanceof Error ? error.message : 'Echec de la reinitialisation',
      );
    }
    return res.redirect(`/platform/ecoles/${id}/edit`);
  }

  @Post('/:id')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateEcoleDto,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    await this.ecolesService.update(id, dto);
    await this.ecolesService.saveLogo(id, pickUploadedFile(req, 'logo'));
    setFlash(req, 'success', 'Ecole mise a jour');
    return res.redirect('/platform/ecoles');
  }

  @Get('/:id/installation-package')
  async downloadInstallationPackage(
    @Param('id') id: string,
    @Query('expiresAt') expiresAt: string | undefined,
    @Res() res: Response,
  ) {
    let parsedExpiresAt: Date | undefined;
    if (expiresAt) {
      parsedExpiresAt = new Date(expiresAt);
      if (Number.isNaN(parsedExpiresAt.getTime())) {
        throw new BadRequestException("Date d'expiration invalide");
      }
    }
    await this.ecolesService.streamInstallationPackage(
      id,
      parsedExpiresAt,
      res,
    );
  }

  @Post('/:id/status')
  async updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateEcoleStatusDto,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    await this.ecolesService.updateStatus(id, dto.statutCompte);
    setFlash(req, 'success', 'Statut du compte mis a jour');
    return res.redirect('/platform/ecoles');
  }
}
