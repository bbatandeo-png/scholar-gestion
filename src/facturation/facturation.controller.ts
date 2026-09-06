import { Controller, Get, Param, Render, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/domain.enums';
import { AuthenticatedGuard } from '../common/guards/authenticated.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { FacturationService } from './facturation.service';

// School-facing, read-only: the acting user's own session ecoleId scopes
// every query automatically (see ecole-scope.plugin.ts), so a school can
// never see another school's tariff or invoices through this controller.
// Not gated by @RequireModule('FINANCE'): this is the platform's own SaaS
// subscription billing (what the ecole owes the platform), unrelated to the
// Finance product module (student fees/payments/expenses) - a school with
// Finance off must still be able to see/pay its own subscription.
@Controller('/facturation')
@UseGuards(AuthenticatedGuard, RolesGuard)
@Roles(Role.SUPER_ADMIN, Role.DIRECTION, Role.COMPTABILITE, Role.AUDITEUR)
export class FacturationController {
  constructor(private readonly facturationService: FacturationService) {}

  @Get()
  @Render('facturation/index')
  async index() {
    const [parametre, factures] = await Promise.all([
      this.facturationService.getParametreActif(),
      this.facturationService.listFactures(),
    ]);

    return {
      title: 'Facturation',
      parametre,
      factures,
    };
  }

  @Get('/factures/:id/pdf')
  async downloadPdf(@Param('id') id: string, @Res() res: Response) {
    const pdf = await this.facturationService.genererFacturePdf(id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="facture.pdf"');
    return res.send(pdf);
  }
}
