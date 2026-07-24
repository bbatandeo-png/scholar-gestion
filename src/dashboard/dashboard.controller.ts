import { Controller, Get, Render, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/domain.enums';
import { AuthenticatedGuard } from '../common/guards/authenticated.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { DashboardService } from './dashboard.service';
import { SchoolYearsService } from '../school-years/school-years.service';

@Controller('/dashboard')
@UseGuards(AuthenticatedGuard, RolesGuard)
export class DashboardController {
  constructor(
    private readonly dashboardService: DashboardService,
    private readonly schoolYearsService: SchoolYearsService,
  ) {}

  @Get()
  @Roles(
    Role.SUPER_ADMIN,
    Role.DIRECTION,
    Role.SECRETARIAT,
    Role.COMPTABILITE,
    Role.AUDITEUR,
  )
  @Render('dashboard/index')
  async index(@Req() req: Request) {
    const year = await this.schoolYearsService.resolveSelected(
      req.session.selectedSchoolYearId,
    );
    return {
      title: 'Dashboard',
      summary: await this.dashboardService.getSummary(String(year._id)),
      selectedYear: year,
    };
  }
}
