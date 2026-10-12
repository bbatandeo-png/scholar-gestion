import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequireModule } from '../common/decorators/require-module.decorator';
import { Role } from '../common/enums/domain.enums';
import { AuthenticatedGuard } from '../common/guards/authenticated.guard';
import { ModuleGuard } from '../common/guards/module.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { setFlash } from '../common/utils/flash.util';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { PaymentsService } from './payments.service';
import { SettingsService } from '../settings/settings.service';
import { SchoolYearsService } from '../school-years/school-years.service';
import { EcolesService } from '../ecoles/ecoles.service';
import { SessionUser } from '../common/types/session-user.type';
import { ForbiddenException } from '@nestjs/common';

@Controller()
@UseGuards(AuthenticatedGuard, RolesGuard, ModuleGuard)
@RequireModule('FINANCE')
export class PaymentsController {
  constructor(
    private readonly paymentsService: PaymentsService,
    private readonly settingsService: SettingsService,
    private readonly schoolYearsService: SchoolYearsService,
    private readonly ecolesService: EcolesService,
  ) {}

  // Secretariat included: it can already record a payment while enrolling
  // a student (EnrollmentsController.create() calls createPayment()
  // directly) - excluding it here would only be reachable from this
  // standalone form, an inconsistent, confusing restriction on the exact
  // same action.
  @Post('/payments')
  @Roles(Role.SUPER_ADMIN, Role.SECRETARIAT, Role.COMPTABILITE)
  async create(
    @Body() dto: CreatePaymentDto,
    @Req() req: Request,
    @Res() res: Response,
    @CurrentUser() user: SessionUser | undefined,
  ) {
    const invoice = await this.paymentsService.findReceiptYearByInvoice(
      dto.invoiceId,
    );
    await this.schoolYearsService.assertWritable(invoice);
    const result = await this.paymentsService.createPayment(dto, user?.id);
    setFlash(req, 'success', 'Paiement enregistre');
    return res.redirect(`/receipts/${result.payment._id.toString()}`);
  }

  @Get('/payments/reconciliation')
  @Roles(Role.SUPER_ADMIN, Role.DIRECTION, Role.COMPTABILITE, Role.AUDITEUR)
  async reconciliation(@Req() req: Request, @Res() res: Response) {
    const year = await this.schoolYearsService.resolveSelected(
      req.session.selectedSchoolYearId,
    );
    const report = await this.paymentsService.getLedgerReconciliation(
      String(year._id),
    );
    return res.render('payments/reconciliation', {
      title: 'Coherence des paiements',
      selectedYear: year,
      rows: report.rows,
      totalDifference: report.totalDifference,
    });
  }

  @Post('/payments/reconciliation')
  @Roles(Role.SUPER_ADMIN, Role.COMPTABILITE)
  async applyReconciliation(
    @Req() req: Request,
    @Res() res: Response,
    @CurrentUser() user: SessionUser | undefined,
  ) {
    const year = await this.schoolYearsService.resolveSelected(
      req.session.selectedSchoolYearId,
    );
    await this.schoolYearsService.assertWritable(String(year._id));
    const result = await this.paymentsService.applyLedgerCorrections(
      String(year._id),
      user?.id,
    );
    setFlash(
      req,
      'success',
      result.corrected
        ? `${result.corrected} ecart(s) corrige(s) : le tableau de bord et les listes concordent maintenant.`
        : 'Aucun ecart a corriger.',
    );
    return res.redirect('/payments/reconciliation');
  }

  // Secretariat included: it can take a payment while enrolling and hands
  // the receipt over at the same desk.
  @Get('/receipts/:id')
  @Roles(
    Role.SUPER_ADMIN,
    Role.DIRECTION,
    Role.SECRETARIAT,
    Role.COMPTABILITE,
    Role.AUDITEUR,
  )
  async receipt(
    @Param('id') id: string,
    @Query('format') format: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const selected = await this.schoolYearsService.resolveSelected(
      req.session.selectedSchoolYearId,
    );
    const receiptYear = await this.paymentsService.findReceiptYear(id);
    if (String(selected._id) !== receiptYear) {
      throw new ForbiddenException(
        'Ce recu appartient a une autre annee scolaire',
      );
    }
    const receiptMode = await this.settingsService.getReceiptMode(receiptYear);
    if (format === 'pdf') {
      const pdf = await this.paymentsService.renderReceiptPdf(id, receiptMode);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader(
        'Content-Disposition',
        `inline; filename="receipt-${id}.pdf"`,
      );
      return res.send(pdf);
    }

    const receipt = await this.paymentsService.findReceiptById(id);
    const schoolName = await this.ecolesService.getCurrentSchoolName();
    const receiptSummary = this.paymentsService.getReceiptAmounts(
      receipt.invoiceId,
      receiptMode,
    );
    return res.render('payments/receipt', {
      title: 'Recu',
      receipt: {
        ...receipt,
        schoolName: schoolName || undefined,
        receiptMode,
        receiptSummary,
      },
    });
  }
}
