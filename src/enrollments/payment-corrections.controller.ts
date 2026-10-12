import { Controller, Get, Query, Render, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { Roles } from '../common/decorators/roles.decorator';
import { RequireModule } from '../common/decorators/require-module.decorator';
import { Role } from '../common/enums/domain.enums';
import { AuthenticatedGuard } from '../common/guards/authenticated.guard';
import { ModuleGuard } from '../common/guards/module.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { SchoolYearsService } from '../school-years/school-years.service';
import { EnrollmentsService } from './enrollments.service';

// Separate controller (rather than a route on EnrollmentsController, which
// owns '/enrollments') purely so this lives at '/payments/corrections' -
// grouped in the nav with the other Finance pages, not under "Admissions &
// paiements". Declared in EnrollmentsModule (not PaymentsModule) since it
// only needs EnrollmentsService, already provided there, and adding it to
// PaymentsModule would require a new circular import between the two
// modules for no benefit.
@Controller('/payments')
@UseGuards(AuthenticatedGuard, RolesGuard, ModuleGuard)
@RequireModule('FINANCE')
export class PaymentCorrectionsController {
  constructor(
    private readonly enrollmentsService: EnrollmentsService,
    private readonly schoolYearsService: SchoolYearsService,
  ) {}

  @Get('/corrections')
  @Roles(Role.SUPER_ADMIN, Role.DIRECTION, Role.COMPTABILITE, Role.AUDITEUR)
  @Render('payments/corrections-history')
  async index(@Req() req: Request, @Query('page') page?: string) {
    const year = await this.schoolYearsService.resolveSelected(
      req.session.selectedSchoolYearId,
    );
    const pageNumber = Math.max(1, Number(page ?? 1) || 1);
    const result = await this.enrollmentsService.getPaymentModificationsHistory(
      String(year._id),
      pageNumber,
      20,
    );

    return {
      title: 'Historique des modifications de paiement',
      selectedYear: year,
      ...result,
    };
  }
}
