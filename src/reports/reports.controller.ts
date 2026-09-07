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
import { Role } from '../common/enums/domain.enums';
import { AuthenticatedGuard } from '../common/guards/authenticated.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { buildExcelBuffer } from '../common/utils/excel.util';
import { toDisplayString } from '../common/utils/safe-string.util';
import { ReportsService } from './reports.service';
import { SchoolYearsService } from '../school-years/school-years.service';

// Not gated by @RequireModule('FINANCE'): every route here is read-only, and
// the Finance module guard never blocks reads - gating this controller
// would have no enforcement effect, so it's deliberately left alone.
@Controller('/reports')
@UseGuards(AuthenticatedGuard, RolesGuard)
export class ReportsController {
  constructor(
    private readonly reportsService: ReportsService,
    private readonly schoolYearsService: SchoolYearsService,
  ) {}

  private async selectedYearId(req: Request) {
    const year = await this.schoolYearsService.resolveSelected(
      req.session.selectedSchoolYearId,
    );
    return String(year._id);
  }

  @Get('/nominal-roll/pdf')
  @Roles(Role.SUPER_ADMIN, Role.DIRECTION, Role.SECRETARIAT, Role.AUDITEUR)
  async nominalRollPdf(
    @Query('levelId') levelId: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const roll = await this.reportsService.getNominalRoll(
      levelId,
      await this.selectedYearId(req),
    );
    const pdf = await this.reportsService.renderStudentListPdf(roll);
    const safeLevelName = roll.levelName.replace(/[^a-zA-Z0-9_-]/g, '_');

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `inline; filename="liste-nominative-${safeLevelName}.pdf"`,
    );
    return res.send(pdf);
  }

  @Get('/student-cards')
  @Roles(Role.SUPER_ADMIN, Role.DIRECTION, Role.SECRETARIAT, Role.AUDITEUR)
  @Render('reports/student-cards')
  async studentCards(@Req() req: Request, @Query('levelId') levelId?: string) {
    const schoolYearId = await this.selectedYearId(req);
    const roster = levelId
      ? await this.reportsService.getClassRosterForCards(levelId, schoolYearId)
      : null;
    return {
      title: 'Cartes scolaires',
      levels: await this.reportsService.listLevels(),
      levelId: levelId || '',
      roster,
    };
  }

  @Get('/student-cards/pdf')
  @Roles(Role.SUPER_ADMIN, Role.DIRECTION, Role.SECRETARIAT, Role.AUDITEUR)
  async studentCardsPdf(
    @Req() req: Request,
    @Res() res: Response,
    @Query('levelId') levelId: string,
  ) {
    const schoolYearId = await this.selectedYearId(req);
    const roster = await this.reportsService.getClassRosterForCards(
      levelId,
      schoolYearId,
    );
    const dataList = await Promise.all(
      roster.students.map((student) =>
        this.reportsService.getStudentIdCardData(student._id, schoolYearId),
      ),
    );
    const pdf = await this.reportsService.renderClassIdCardsPdf(dataList);
    const safeLevelName = roster.levelName.replace(/[^a-zA-Z0-9_-]/g, '_');

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="cartes-scolaires-${safeLevelName}.pdf"`,
    );
    return res.send(pdf);
  }

  @Post('/student-cards/selection')
  @Roles(Role.SUPER_ADMIN, Role.DIRECTION, Role.SECRETARIAT, Role.AUDITEUR)
  async studentCardsSelectionPdf(
    @Req() req: Request,
    @Res() res: Response,
    @Body('studentIds') studentIdsRaw: string | string[] | undefined,
  ) {
    const studentIds = (
      Array.isArray(studentIdsRaw)
        ? studentIdsRaw
        : studentIdsRaw
          ? [studentIdsRaw]
          : []
    ).filter(Boolean);
    if (studentIds.length === 0) {
      throw new BadRequestException('Aucun eleve selectionne');
    }

    const schoolYearId = await this.selectedYearId(req);
    const dataList = await Promise.all(
      studentIds.map((studentId) =>
        this.reportsService.getStudentIdCardData(studentId, schoolYearId),
      ),
    );
    const pdf = await this.reportsService.renderClassIdCardsPdf(dataList);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="cartes-scolaires-selection.pdf"',
    );
    return res.send(pdf);
  }

  @Get('/student-cards/:studentId/pdf')
  @Roles(Role.SUPER_ADMIN, Role.DIRECTION, Role.SECRETARIAT, Role.AUDITEUR)
  async studentCardPdf(
    @Param('studentId') studentId: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const data = await this.reportsService.getStudentIdCardData(
      studentId,
      await this.selectedYearId(req),
    );
    const pdf = await this.reportsService.renderStudentIdCardPdf(data);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `inline; filename="carte-scolaire-${data.lastname}-${data.firstname}.pdf"`,
    );
    return res.send(pdf);
  }

  @Get('/students-by-level')
  @Roles(Role.SUPER_ADMIN, Role.DIRECTION, Role.AUDITEUR)
  @Render('reports/students-by-level')
  async studentsByLevel(@Req() req: Request) {
    return {
      title: 'Rapport eleves par niveau',
      report: await this.reportsService.studentsByLevel(
        await this.selectedYearId(req),
      ),
    };
  }

  @Get('/students-by-level/export')
  @Roles(Role.SUPER_ADMIN, Role.DIRECTION, Role.AUDITEUR)
  async studentsByLevelExport(@Req() req: Request, @Res() res: Response) {
    const report = await this.reportsService.studentsByLevel(
      await this.selectedYearId(req),
    );
    const buffer = buildExcelBuffer(
      'Eleves_par_niveau',
      report.map((item) => ({
        niveau_id: toDisplayString(item._id ?? ''),
        total: item.total,
      })),
    );

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="eleves_par_niveau.xlsx"',
    );
    return res.send(buffer);
  }

  @Get('/paid-students')
  @Roles(Role.SUPER_ADMIN, Role.DIRECTION, Role.COMPTABILITE, Role.AUDITEUR)
  @Render('reports/paid-students')
  async paidStudents(@Req() req: Request) {
    return {
      title: 'Eleves soldes',
      report: await this.reportsService.paidStudents(
        await this.selectedYearId(req),
      ),
    };
  }

  @Get('/paid-students/export')
  @Roles(Role.SUPER_ADMIN, Role.DIRECTION, Role.COMPTABILITE, Role.AUDITEUR)
  async paidStudentsExport(@Req() req: Request, @Res() res: Response) {
    const report = await this.reportsService.paidStudents(
      await this.selectedYearId(req),
    );
    const buffer = buildExcelBuffer(
      'Eleves_soldes',
      report.map((item) => ({
        eleve:
          `${item.enrollmentId?.studentId?.lastname ?? ''} ${item.enrollmentId?.studentId?.firstname ?? ''}`.trim(),
        matricule: item.enrollmentId?.studentId?.matricule ?? '',
        annee: item.enrollmentId?.schoolYearId?.label ?? '',
        niveau: item.enrollmentId?.levelId?.label ?? '',
        total_du: item.totalDue,
        paye: item.paidAmount,
        reste: item.balanceDue,
      })),
    );

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="eleves_soldes.xlsx"',
    );
    return res.send(buffer);
  }

  @Get('/registration-paid')
  @Roles(Role.SUPER_ADMIN, Role.DIRECTION, Role.COMPTABILITE, Role.AUDITEUR)
  @Render('reports/registration-paid-students')
  async registrationPaidStudents(
    @Req() req: Request,
    @Query('filter') filter?: string,
    @Query('levelId') levelId?: string,
    @Query('schoolYearId') schoolYearId?: string,
  ) {
    const normalizedFilter = [
      'registration',
      'tuition',
      'full',
      'partial',
      'none',
    ].includes(filter ?? '')
      ? (filter as 'registration' | 'tuition' | 'full' | 'partial' | 'none')
      : 'registration';
    const effectiveSchoolYearId =
      schoolYearId || (await this.selectedYearId(req));

    const [report, levels, schoolYears] = await Promise.all([
      this.reportsService.registrationPaidStudents(
        normalizedFilter,
        levelId,
        effectiveSchoolYearId,
      ),
      this.reportsService.listLevels(),
      this.schoolYearsService.list(),
    ]);

    return {
      title: "Eleves ayant paye l'inscription",
      report,
      filter: normalizedFilter,
      levelId: levelId || '',
      schoolYearId: effectiveSchoolYearId,
      levels,
      schoolYears,
    };
  }

  @Get('/registration-paid/pdf')
  @Roles(Role.SUPER_ADMIN, Role.DIRECTION, Role.COMPTABILITE, Role.AUDITEUR)
  async registrationPaidStudentsPdf(
    @Req() req: Request,
    @Res() res: Response,
    @Query('filter') filter?: string,
    @Query('levelId') levelId?: string,
    @Query('schoolYearId') schoolYearId?: string,
  ) {
    const normalizedFilter = [
      'registration',
      'tuition',
      'full',
      'partial',
      'none',
    ].includes(filter ?? '')
      ? (filter as 'registration' | 'tuition' | 'full' | 'partial' | 'none')
      : 'registration';
    const effectiveSchoolYearId =
      schoolYearId || (await this.selectedYearId(req));
    const selectedYear = await this.schoolYearsService.findById(
      effectiveSchoolYearId,
    );
    const report = await this.reportsService.registrationPaidStudents(
      normalizedFilter,
      levelId,
      effectiveSchoolYearId,
    );
    const pdf = await this.reportsService.renderRegistrationPaidPdf(
      report,
      normalizedFilter,
      undefined,
      selectedYear?.label,
    );
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="registration-paid-students-${normalizedFilter}.pdf"`,
    );
    return res.send(pdf);
  }

  @Get('/unpaid-students')
  @Roles(Role.SUPER_ADMIN, Role.DIRECTION, Role.COMPTABILITE, Role.AUDITEUR)
  @Render('reports/unpaid-students')
  async unpaidStudents(@Req() req: Request) {
    return {
      title: 'Eleves impayes',
      report: await this.reportsService.unpaidStudents(
        await this.selectedYearId(req),
      ),
    };
  }

  @Get('/unpaid-students/export')
  @Roles(Role.SUPER_ADMIN, Role.DIRECTION, Role.COMPTABILITE, Role.AUDITEUR)
  async unpaidStudentsExport(@Req() req: Request, @Res() res: Response) {
    const report = await this.reportsService.unpaidStudents(
      await this.selectedYearId(req),
    );
    const buffer = buildExcelBuffer(
      'Eleves_impayes',
      report.map((item) => ({
        eleve:
          `${item.enrollmentId?.studentId?.lastname ?? ''} ${item.enrollmentId?.studentId?.firstname ?? ''}`.trim(),
        matricule: item.enrollmentId?.studentId?.matricule ?? '',
        annee: item.enrollmentId?.schoolYearId?.label ?? '',
        niveau: item.enrollmentId?.levelId?.label ?? '',
        total_du: item.totalDue,
        paye: item.paidAmount,
        reste: item.balanceDue,
        statut: item.status,
      })),
    );

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="eleves_impayes.xlsx"',
    );
    return res.send(buffer);
  }

  @Get('/class-financial-situation')
  @Roles(Role.SUPER_ADMIN, Role.DIRECTION, Role.COMPTABILITE, Role.AUDITEUR)
  @Render('reports/class-financial-situation')
  async classFinancialSituation(
    @Req() req: Request,
    @Query('levelId') levelId?: string,
  ) {
    const selectedYearId = await this.selectedYearId(req);
    const report =
      await this.reportsService.classFinancialSituation(selectedYearId);
    const filtered = levelId
      ? report.filter(
          (item) =>
            toDisplayString(
              (item.level as { _id?: unknown; id?: unknown } | null)?._id ??
                (item.level as { _id?: unknown; id?: unknown } | null)?.id ??
                '',
            ) === levelId,
        )
      : report;
    return {
      title: 'Situation financiere des classes',
      report: filtered,
      levels: await this.reportsService.listLevels(),
      levelId: levelId || '',
    };
  }

  @Get('/class-financial-situation/export')
  @Roles(Role.SUPER_ADMIN, Role.DIRECTION, Role.COMPTABILITE, Role.AUDITEUR)
  async classFinancialSituationExport(
    @Req() req: Request,
    @Query('levelId') levelId?: string,
    @Res() res?: Response,
  ) {
    const report = await this.reportsService.classFinancialSituation(
      await this.selectedYearId(req),
    );
    const filtered = levelId
      ? report.filter(
          (item) =>
            toDisplayString(
              (item.level as { _id?: unknown; id?: unknown } | null)?._id ??
                (item.level as { _id?: unknown; id?: unknown } | null)?.id ??
                '',
            ) === levelId,
        )
      : report;
    const buffer = buildExcelBuffer(
      'Situation_financiere',
      filtered.map((item) => ({
        numero: toDisplayString(item.student?.matricule ?? ''),
        nom_prenoms:
          `${toDisplayString(item.student?.lastname)} ${toDisplayString(item.student?.firstname)}`.trim(),
        sexe: toDisplayString(item.student?.gender ?? ''),
        montant_a_payer: item.totalDue,
        montant_paye: item.paidAmount,
        reste_a_payer: item.balanceDue,
        frais_inscription: item.registrationFee,
        ecolage: item.tuitionFee,
      })),
    );

    res?.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res?.setHeader(
      'Content-Disposition',
      'attachment; filename="situation_financiere.xlsx"',
    );
    return res?.send(buffer);
  }

  @Get('/class-financial-situation/pdf')
  @Roles(Role.SUPER_ADMIN, Role.DIRECTION, Role.COMPTABILITE, Role.AUDITEUR)
  async classFinancialSituationPdf(
    @Req() req: Request,
    @Res() res: Response,
    @Query('levelId') levelId?: string,
  ) {
    const selectedYearId = await this.selectedYearId(req);
    const selectedYear = await this.schoolYearsService.findById(selectedYearId);
    const report =
      await this.reportsService.classFinancialSituation(selectedYearId);
    const filtered = levelId
      ? report.filter(
          (item) =>
            toDisplayString(
              (item.level as { _id?: unknown; id?: unknown } | null)?._id ??
                (item.level as { _id?: unknown; id?: unknown } | null)?.id ??
                '',
            ) === levelId,
        )
      : report;
    const levelName = levelId
      ? await this.reportsService.findLevelName(levelId)
      : undefined;
    const pdf = await this.reportsService.renderClassFinancialSituationPdf(
      filtered,
      levelName,
      selectedYear?.label,
    );

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="situation_financiere${levelName ? `-${levelName.replace(/[^a-zA-Z0-9_-]/g, '_')}` : ''}.pdf"`,
    );
    return res.send(pdf);
  }

  @Get('/revenue')
  @Roles(Role.SUPER_ADMIN, Role.DIRECTION, Role.COMPTABILITE, Role.AUDITEUR)
  @Render('reports/revenue')
  async revenue(@Req() req: Request) {
    return {
      title: 'Recettes',
      report: await this.reportsService.revenue(await this.selectedYearId(req)),
    };
  }

  @Get('/revenue/export')
  @Roles(Role.SUPER_ADMIN, Role.DIRECTION, Role.COMPTABILITE, Role.AUDITEUR)
  async revenueExport(@Req() req: Request, @Res() res: Response) {
    const report = await this.reportsService.revenue(
      await this.selectedYearId(req),
    );
    const buffer = buildExcelBuffer('Recettes', [report]);

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="recettes.xlsx"',
    );
    return res.send(buffer);
  }
}
