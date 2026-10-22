import { Controller, Get, Query, Render, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/domain.enums';
import { AuthenticatedGuard } from '../common/guards/authenticated.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { DashboardService } from './dashboard.service';
import { LevelsService } from '../levels/levels.service';
import { SchoolYearsService } from '../school-years/school-years.service';

@Controller('/dashboard')
@UseGuards(AuthenticatedGuard, RolesGuard)
export class DashboardController {
  constructor(
    private readonly dashboardService: DashboardService,
    private readonly schoolYearsService: SchoolYearsService,
    private readonly levelsService: LevelsService,
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
  async index(
    @Req() req: Request,
    @Query('levelId') levelId?: string,
    @Query('dateFrom') dateFromInput?: string,
    @Query('dateTo') dateToInput?: string,
  ) {
    // A brand new tenant (or one whose only school year got closed without
    // opening a new one) has no OPEN school year yet - resolveSelected()
    // throws in that case. Show a welcome/setup empty state instead of
    // crashing the very first page a freshly onboarded admin lands on.
    const year = await this.schoolYearsService
      .resolveSelected(req.session.selectedSchoolYearId)
      .catch(() => null);

    if (!year) {
      return {
        title: 'Tableau de bord',
        summary: null,
        selectedYear: null,
      };
    }

    let datesSwapped = false;
    // <input type="date"> values (YYYY-MM-DD) - swapped as plain strings
    // (they sort lexically) before turning into UTC day boundaries, so the
    // date inputs re-rendered on the page and the range actually applied
    // never disagree.
    if (
      dateFromInput &&
      dateToInput &&
      !Number.isNaN(Date.parse(dateFromInput)) &&
      !Number.isNaN(Date.parse(dateToInput)) &&
      dateFromInput > dateToInput
    ) {
      [dateFromInput, dateToInput] = [dateToInput, dateFromInput];
      datesSwapped = true;
    }
    let dateFrom = dateFromInput
      ? new Date(`${dateFromInput}T00:00:00.000Z`)
      : undefined;
    let dateTo = dateToInput
      ? new Date(`${dateToInput}T23:59:59.999Z`)
      : undefined;
    if (dateFrom && Number.isNaN(dateFrom.getTime())) dateFrom = undefined;
    if (dateTo && Number.isNaN(dateTo.getTime())) dateTo = undefined;

    const [summary, levels, encaissements] = await Promise.all([
      this.dashboardService.getSummary(String(year._id), {
        levelId,
        dateFrom,
        dateTo,
      }),
      this.levelsService.listForSchoolYear(String(year._id)),
      this.dashboardService.getMonthlyEncaissements(String(year._id)),
    ]);

    return {
      title: 'Tableau de bord',
      summary,
      selectedYear: year,
      levels,
      encaissements,
      filters: {
        levelId: levelId ?? '',
        dateFrom: dateFromInput ?? '',
        dateTo: dateToInput ?? '',
      },
      datesSwapped,
    };
  }
}
