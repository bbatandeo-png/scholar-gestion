import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Render,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/domain.enums';
import { AuthenticatedGuard } from '../common/guards/authenticated.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { runScopedAsEcole } from '../common/tenant/tenant-context';
import { setFlash } from '../common/utils/flash.util';
import { EcolesService } from '../ecoles/ecoles.service';
import { ChangeParametreFacturationDto } from './dto/change-parametre-facturation.dto';
import { GenererFactureDto } from './dto/generer-facture.dto';
import { FacturationService } from './facturation.service';

// PLATFORM_ADMIN cross-tenant management: this controller's own session has
// no ecoleId (bypass mode), so every read/write below that touches a
// specific school's facturation data is explicitly narrowed via
// runScopedAsEcole(ecoleId, ...) - see common/tenant/tenant-context.ts.
@Controller('/platform/facturation')
@UseGuards(AuthenticatedGuard, RolesGuard)
@Roles(Role.PLATFORM_ADMIN)
export class PlatformFacturationController {
  constructor(
    private readonly facturationService: FacturationService,
    private readonly ecolesService: EcolesService,
  ) {}

  @Get('/:ecoleId')
  @Render('facturation/platform')
  async index(@Param('ecoleId') ecoleId: string) {
    const [ecole, parametre, factures] = await Promise.all([
      this.ecolesService.findById(ecoleId),
      runScopedAsEcole(ecoleId, () =>
        this.facturationService.getParametreActif(),
      ),
      runScopedAsEcole(ecoleId, () => this.facturationService.listFactures()),
    ]);

    return {
      title: `Facturation — ${ecole.nom}`,
      ecole,
      parametre,
      factures,
    };
  }

  @Post('/:ecoleId/parametre')
  async updateParametre(
    @Param('ecoleId') ecoleId: string,
    @Body() dto: ChangeParametreFacturationDto,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    await runScopedAsEcole(ecoleId, () =>
      this.facturationService.changeParametre(dto),
    );
    setFlash(req, 'success', 'Parametre de facturation mis a jour');
    return res.redirect(`/platform/facturation/${ecoleId}`);
  }

  @Post('/:ecoleId/factures')
  async genererFacture(
    @Param('ecoleId') ecoleId: string,
    @Body() dto: GenererFactureDto,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    try {
      await runScopedAsEcole(ecoleId, () =>
        this.facturationService.genererFacture(dto),
      );
      setFlash(req, 'success', 'Facture generee');
    } catch (error) {
      setFlash(
        req,
        'error',
        error instanceof Error
          ? error.message
          : 'Impossible de generer la facture',
      );
    }
    return res.redirect(`/platform/facturation/${ecoleId}`);
  }

  @Get('/factures/:id/pdf')
  async downloadPdf(@Param('id') id: string, @Res() res: Response) {
    const pdf = await this.facturationService.genererFacturePdf(id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="facture.pdf"');
    return res.send(pdf);
  }
}
