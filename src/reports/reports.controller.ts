import { Controller, Get, Query, Render, Res, UseGuards } from '@nestjs/common';
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

  @Get('/registration-paid')
  @Roles(Role.SUPER_ADMIN, Role.DIRECTION, Role.COMPTABILITE, Role.AUDITEUR)
  @Render('reports/registration-paid-students')
  async registrationPaidStudents(
    @Query('filter') filter?: string,
    @Query('levelId') levelId?: string,
    @Query('schoolYearId') schoolYearId?: string,
  ) {
    const normalizedFilter = ['registration', 'tuition', 'full', 'partial', 'none'].includes(filter ?? '')
      ? (filter as 'registration' | 'tuition' | 'full' | 'partial' | 'none')
      : 'registration';

    const [report, levels, schoolYears] = await Promise.all([
      this.reportsService.registrationPaidStudents(normalizedFilter, levelId, schoolYearId),
      this.reportsService.listLevels(),
      this.reportsService.listSchoolYears(),
    ]);

    return {
      title: 'Eleves ayant paye l\'inscription',
      report,
      filter: normalizedFilter,
      levelId: levelId || '',
      schoolYearId: schoolYearId || '',
      levels,
      schoolYears,
    };
  }

  @Get('/registration-paid/pdf')
  @Roles(Role.SUPER_ADMIN, Role.DIRECTION, Role.COMPTABILITE, Role.AUDITEUR)
  async registrationPaidStudentsPdf(
    @Res() res: Response,
    @Query('filter') filter?: string,
    @Query('levelId') levelId?: string,
    @Query('schoolYearId') schoolYearId?: string,
  ) {
    const normalizedFilter = ['registration', 'tuition', 'full', 'partial', 'none'].includes(filter ?? '')
      ? (filter as 'registration' | 'tuition' | 'full' | 'partial' | 'none')
      : 'registration';
    const report = await this.reportsService.registrationPaidStudents(normalizedFilter, levelId, schoolYearId);
    const pdf = await this.reportsService.renderRegistrationPaidPdf(report, normalizedFilter);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="registration-paid-students-${normalizedFilter}.pdf"`);
    return res.send(pdf);
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

  @Get('/class-financial-situation')
  @Roles(Role.SUPER_ADMIN, Role.DIRECTION, Role.COMPTABILITE, Role.AUDITEUR)
  @Render('reports/class-financial-situation')
  async classFinancialSituation(@Query('levelId') levelId?: string) {
    const report = await this.reportsService.classFinancialSituation();
    const filtered = levelId ? report.filter((item: any) => String(item.level?._id ?? item.level?.id ?? '') === String(levelId)) : report;
    return {
      title: 'Situation financiere des classes',
      report: filtered,
      levels: await this.reportsService.listLevels(),
      levelId: levelId || '',
    };
  }

  @Get('/class-financial-situation/export')
  @Roles(Role.SUPER_ADMIN, Role.DIRECTION, Role.COMPTABILITE, Role.AUDITEUR)
  async classFinancialSituationExport(@Query('levelId') levelId?: string, @Res() res?: Response) {
    const report = await this.reportsService.classFinancialSituation();
    const filtered = levelId ? report.filter((item: any) => String(item.level?._id ?? item.level?.id ?? '') === String(levelId)) : report;
    const buffer = buildExcelBuffer(
      'Situation_financiere',
      filtered.map((item: any) => ({
        numero: item.student?.matricule ?? '',
        nom_prenoms: `${item.student?.lastname ?? ''} ${item.student?.firstname ?? ''}`.trim(),
        sexe: item.student?.gender ?? '',
        montant_a_payer: item.totalDue,
        montant_paye: item.paidAmount,
        reste_a_payer: item.balanceDue,
        frais_inscription: item.registrationFee,
        ecolage: item.tuitionFee,
      })),
    );

    res?.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res?.setHeader('Content-Disposition', 'attachment; filename="situation_financiere.xlsx"');
    return res?.send(buffer);
  }

  @Get('/class-financial-situation/pdf')
  @Roles(Role.SUPER_ADMIN, Role.DIRECTION, Role.COMPTABILITE, Role.AUDITEUR)
  async classFinancialSituationPdf(@Res() res: Response, @Query('levelId') levelId?: string) {
    const report = await this.reportsService.classFinancialSituation();
    const filtered = levelId ? report.filter((item: any) => String(item.level?._id ?? item.level?.id ?? '') === String(levelId)) : report;
    const levelName = levelId ? await this.reportsService.findLevelName(levelId) : undefined;
    const pdf = await this.reportsService.renderClassFinancialSituationPdf(filtered, levelName);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="situation_financiere${levelName ? `-${levelName.replace(/[^a-zA-Z0-9_-]/g, '_')}` : ''}.pdf"`);
    return res.send(pdf);
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