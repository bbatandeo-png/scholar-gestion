import { Controller, Get, Render, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/domain.enums';
import { AuthenticatedGuard } from '../common/guards/authenticated.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { buildExcelBuffer } from '../common/utils/excel.util';
import { ReportsService } from './reports.service';

@Controller('/reports')
@UseGuards(AuthenticatedGuard, RolesGuard)
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Get('/students-by-level')
  @Roles(Role.SUPER_ADMIN, Role.DIRECTION, Role.AUDITEUR)
  @Render('reports/students-by-level')
  async studentsByLevel() {
    return {
      title: 'Rapport eleves par niveau',
      report: await this.reportsService.studentsByLevel(),
    };
  }

  @Get('/students-by-level/export')
  @Roles(Role.SUPER_ADMIN, Role.DIRECTION, Role.AUDITEUR)
  async studentsByLevelExport(@Res() res: Response) {
    const report = await this.reportsService.studentsByLevel();
    const buffer = buildExcelBuffer(
      'Eleves_par_niveau',
      report.map((item: any) => ({
        niveau_id: String(item._id ?? ''),
        total: item.total,
      })),
    );

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="eleves_par_niveau.xlsx"');
    return res.send(buffer);
  }

  @Get('/paid-students')
  @Roles(Role.SUPER_ADMIN, Role.DIRECTION, Role.COMPTABILITE, Role.AUDITEUR)
  @Render('reports/paid-students')
  async paidStudents() {
    return {
      title: 'Eleves soldes',
      report: await this.reportsService.paidStudents(),
    };
  }

  @Get('/paid-students/export')
  @Roles(Role.SUPER_ADMIN, Role.DIRECTION, Role.COMPTABILITE, Role.AUDITEUR)
  async paidStudentsExport(@Res() res: Response) {
    const report = await this.reportsService.paidStudents();
    const buffer = buildExcelBuffer(
      'Eleves_soldes',
      report.map((item: any) => ({
        eleve: `${item.enrollmentId?.studentId?.lastname ?? ''} ${item.enrollmentId?.studentId?.firstname ?? ''}`.trim(),
        matricule: item.enrollmentId?.studentId?.matricule ?? '',
        annee: item.enrollmentId?.schoolYearId?.label ?? '',
        niveau: item.enrollmentId?.levelId?.label ?? '',
        total_du: item.totalDue,
        paye: item.paidAmount,
        reste: item.balanceDue,
      })),
    );

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="eleves_soldes.xlsx"');
    return res.send(buffer);
  }

  @Get('/unpaid-students')
  @Roles(Role.SUPER_ADMIN, Role.DIRECTION, Role.COMPTABILITE, Role.AUDITEUR)
  @Render('reports/unpaid-students')
  async unpaidStudents() {
    return {
      title: 'Eleves impayes',
      report: await this.reportsService.unpaidStudents(),
    };
  }

  @Get('/unpaid-students/export')
  @Roles(Role.SUPER_ADMIN, Role.DIRECTION, Role.COMPTABILITE, Role.AUDITEUR)
  async unpaidStudentsExport(@Res() res: Response) {
    const report = await this.reportsService.unpaidStudents();
    const buffer = buildExcelBuffer(
      'Eleves_impayes',
      report.map((item: any) => ({
        eleve: `${item.enrollmentId?.studentId?.lastname ?? ''} ${item.enrollmentId?.studentId?.firstname ?? ''}`.trim(),
        matricule: item.enrollmentId?.studentId?.matricule ?? '',
        annee: item.enrollmentId?.schoolYearId?.label ?? '',
        niveau: item.enrollmentId?.levelId?.label ?? '',
        total_du: item.totalDue,
        paye: item.paidAmount,
        reste: item.balanceDue,
        statut: item.status,
      })),
    );

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="eleves_impayes.xlsx"');
    return res.send(buffer);
  }

  @Get('/revenue')
  @Roles(Role.SUPER_ADMIN, Role.DIRECTION, Role.COMPTABILITE, Role.AUDITEUR)
  @Render('reports/revenue')
  async revenue() {
    return {
      title: 'Recettes',
      report: await this.reportsService.revenue(),
    };
  }

  @Get('/revenue/export')
  @Roles(Role.SUPER_ADMIN, Role.DIRECTION, Role.COMPTABILITE, Role.AUDITEUR)
  async revenueExport(@Res() res: Response) {
    const report = await this.reportsService.revenue();
    const buffer = buildExcelBuffer('Recettes', [report]);

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="recettes.xlsx"');
    return res.send(buffer);
  }
}