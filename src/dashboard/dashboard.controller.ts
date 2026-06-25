import { Controller, Get, Render, UseGuards } from '@nestjs/common';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/domain.enums';
import { AuthenticatedGuard } from '../common/guards/authenticated.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { DashboardService } from './dashboard.service';

@Controller('/dashboard')
@UseGuards(AuthenticatedGuard, RolesGuard)
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get()
  @Roles(Role.SUPER_ADMIN, Role.DIRECTION, Role.SECRETARIAT, Role.COMPTABILITE, Role.AUDITEUR)
  @Render('dashboard/index')
  async index() {
    return {
      title: 'Dashboard',
      summary: await this.dashboardService.getSummary(),
    };
  }
}