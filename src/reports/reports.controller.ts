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
import { Periode, Role } from '../common/enums/domain.enums';
import { AuthenticatedGuard } from '../common/guards/authenticated.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { buildExcelBuffer } from '../common/utils/excel.util';
import { toDisplayString } from '../common/utils/safe-string.util';
import {
  EXAM_STATISTICS_LEGEND,
  GradeSheetOptions,
  ReportsService,
} from './reports.service';
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

  // How many "Note"/"Devoir"/"Interro" columns the picker form on
  // /bulletins asked for - shared by the three routes below. Defaults
  // (2 notes, 1 devoir, 2 interros) match the original fixed layout;
  // clamping itself happens in ReportsService.buildGradeSheetColumns(),
  // this just turns the raw query strings into numbers.
  private parseGradeSheetOptions(
    noteCount?: string,
    devoirCount?: string,
    interroCount?: string,
  ): GradeSheetOptions {
    return {
      noteCount: noteCount !== undefined ? Number(noteCount) : undefined,
      devoirCount: devoirCount !== undefined ? Number(devoirCount) : undefined,
      interroCount:
        interroCount !== undefined ? Number(interroCount) : undefined,
    };
  }

  // Standalone picker page - only the filter form, nothing else, so the nav
  // link lands straight on it instead of the whole /bulletins page scrolled
  // to an anchor.
  @Get('/grade-sheet')
  @Roles(Role.SUPER_ADMIN, Role.DIRECTION, Role.SECRETARIAT, Role.AUDITEUR)
  @Render('reports/grade-sheet')
  async gradeSheetPicker() {
    return {
      title: 'Fiche de notes vierge',
      levels: await this.reportsService.listLevels(),
    };
  }

  // Blank per-class mark sheet (roster pre-filled, every note column left
  // for a teacher to fill in by hand) - see ReportsService.renderGradeSheet*
  // for why this reuses getNominalRoll() as its data source.
  @Get('/grade-sheet/pdf')
  @Roles(Role.SUPER_ADMIN, Role.DIRECTION, Role.SECRETARIAT, Role.AUDITEUR)
  async gradeSheetPdf(
    @Query('levelId') levelId: string,
    @Query('noteCount') noteCount: string | undefined,
    @Query('devoirCount') devoirCount: string | undefined,
    @Query('interroCount') interroCount: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const roll = await this.reportsService.getNominalRoll(
      levelId,
      await this.selectedYearId(req),
    );
    const pdf = await this.reportsService.renderGradeSheetPdf(
      roll,
      this.parseGradeSheetOptions(noteCount, devoirCount, interroCount),
    );
    const safeLevelName = roll.levelName.replace(/[^a-zA-Z0-9_-]/g, '_');

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `inline; filename="fiche-de-notes-${safeLevelName}.pdf"`,
    );
    return res.send(pdf);
  }

  @Get('/grade-sheet/excel')
  @Roles(Role.SUPER_ADMIN, Role.DIRECTION, Role.SECRETARIAT, Role.AUDITEUR)
  async gradeSheetExcel(
    @Query('levelId') levelId: string,
    @Query('noteCount') noteCount: string | undefined,
    @Query('devoirCount') devoirCount: string | undefined,
    @Query('interroCount') interroCount: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const roll = await this.reportsService.getNominalRoll(
      levelId,
      await this.selectedYearId(req),
    );
    const buffer = await this.reportsService.renderGradeSheetExcel(
      roll,
      this.parseGradeSheetOptions(noteCount, devoirCount, interroCount),
    );
    const safeLevelName = roll.levelName.replace(/[^a-zA-Z0-9_-]/g, '_');

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="fiche-de-notes-${safeLevelName}.xlsx"`,
    );
    return res.send(buffer);
  }

  @Get('/grade-sheet/docx')
  @Roles(Role.SUPER_ADMIN, Role.DIRECTION, Role.SECRETARIAT, Role.AUDITEUR)
  async gradeSheetDocx(
    @Query('levelId') levelId: string,
    @Query('noteCount') noteCount: string | undefined,
    @Query('devoirCount') devoirCount: string | undefined,
    @Query('interroCount') interroCount: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const roll = await this.reportsService.getNominalRoll(
      levelId,
      await this.selectedYearId(req),
    );
    const buffer = await this.reportsService.renderGradeSheetDocx(
      roll,
      this.parseGradeSheetOptions(noteCount, devoirCount, interroCount),
    );
    const safeLevelName = roll.levelName.replace(/[^a-zA-Z0-9_-]/g, '_');

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="fiche-de-notes-${safeLevelName}.docx"`,
    );
    return res.send(buffer);
  }

  // Inspector-facing statistics sheet (repartition des moyennes par matiere
  // + effectifs inscrits/presents/admis par sexe) - always the OPEN school
  // year (requireOpen(), not resolveSelected()) since this is about the
  // ongoing year's results, never a historical one browsed via the header
  // selector. levelId omitted = toutes les classes confondues.
  @Get('/exam-statistics')
  @Roles(Role.SUPER_ADMIN, Role.DIRECTION, Role.SECRETARIAT, Role.AUDITEUR)
  @Render('reports/exam-statistics')
  async examStatistics(
    @Query('periode') periode?: Periode,
    @Query('levelId') levelId?: string,
  ) {
    const activeYear = await this.schoolYearsService.requireOpen();
    const report =
      periode &&
      (await this.reportsService.getExamStatistics(
        String(activeYear._id),
        periode,
        levelId || undefined,
      ));
    return {
      title: 'Statistiques de fin de période',
      legend: EXAM_STATISTICS_LEGEND,
      activeYear,
      levels: await this.reportsService.listLevels(),
      periode: periode || '',
      levelId: levelId || '',
      report: report || null,
    };
  }

  @Get('/exam-statistics/pdf')
  @Roles(Role.SUPER_ADMIN, Role.DIRECTION, Role.SECRETARIAT, Role.AUDITEUR)
  async examStatisticsPdf(
    @Query('periode') periode: Periode,
    @Query('levelId') levelId: string | undefined,
    @Res() res: Response,
  ) {
    if (!periode) {
      throw new BadRequestException('Veuillez choisir une période');
    }
    const activeYear = await this.schoolYearsService.requireOpen();
    const report = await this.reportsService.getExamStatistics(
      String(activeYear._id),
      periode,
      levelId || undefined,
    );
    const pdf = await this.reportsService.renderExamStatisticsPdf(report);
    const safeLevelName = report.levelName.replace(/[^a-zA-Z0-9_-]/g, '_');

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `inline; filename="statistiques-${safeLevelName}.pdf"`,
    );
    return res.send(pdf);
  }

  @Get('/exam-statistics/excel')
  @Roles(Role.SUPER_ADMIN, Role.DIRECTION, Role.SECRETARIAT, Role.AUDITEUR)
  async examStatisticsExcel(
    @Query('periode') periode: Periode,
    @Query('levelId') levelId: string | undefined,
    @Res() res: Response,
  ) {
    if (!periode) {
      throw new BadRequestException('Veuillez choisir une période');
    }
    const activeYear = await this.schoolYearsService.requireOpen();
    const report = await this.reportsService.getExamStatistics(
      String(activeYear._id),
      periode,
      levelId || undefined,
    );
    const buffer = await this.reportsService.renderExamStatisticsExcel(report);
    const safeLevelName = report.levelName.replace(/[^a-zA-Z0-9_-]/g, '_');

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="statistiques-${safeLevelName}.xlsx"`,
    );
    return res.send(buffer);
  }

  @Get('/exam-statistics/docx')
  @Roles(Role.SUPER_ADMIN, Role.DIRECTION, Role.SECRETARIAT, Role.AUDITEUR)
  async examStatisticsDocx(
    @Query('periode') periode: Periode,
    @Query('levelId') levelId: string | undefined,
    @Res() res: Response,
  ) {
    if (!periode) {
      throw new BadRequestException('Veuillez choisir une période');
    }
    const activeYear = await this.schoolYearsService.requireOpen();
    const report = await this.reportsService.getExamStatistics(
      String(activeYear._id),
      periode,
      levelId || undefined,
    );
    const buffer = await this.reportsService.renderExamStatisticsDocx(report);
    const safeLevelName = report.levelName.replace(/[^a-zA-Z0-9_-]/g, '_');

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="statistiques-${safeLevelName}.docx"`,
    );
    return res.send(buffer);
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
      throw new BadRequestException('Aucun élève sélectionné');
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

  @Get('/paid-students')
  @Roles(Role.SUPER_ADMIN, Role.DIRECTION, Role.COMPTABILITE, Role.AUDITEUR)
  @Render('reports/paid-students')
  async paidStudents(@Req() req: Request) {
    return {
      title: 'Élèves soldés',
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
      title: "Élèves ayant payé l'inscription",
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

  @Get('/registration-paid/export')
  @Roles(Role.SUPER_ADMIN, Role.DIRECTION, Role.COMPTABILITE, Role.AUDITEUR)
  async registrationPaidStudentsExport(
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
    const report = await this.reportsService.registrationPaidStudents(
      normalizedFilter,
      levelId,
      effectiveSchoolYearId,
    );
    const buffer = buildExcelBuffer(
      'Situation_paiements',
      report.map((item, index) => ({
        n: index + 1,
        eleve:
          `${item.enrollmentId?.studentId?.lastname ?? ''} ${item.enrollmentId?.studentId?.firstname ?? ''}`.trim(),
        sexe: item.enrollmentId?.studentId?.gender ?? '',
        matricule: item.enrollmentId?.studentId?.matricule ?? '',
        classe: item.enrollmentId?.levelId?.label ?? '',
        montant: item.amountDue,
        paye: item.amountPaid,
        reste: item.balanceDue,
      })),
    );

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="situation-paiements-${normalizedFilter}.xlsx"`,
    );
    return res.send(buffer);
  }

  @Get('/unpaid-students')
  @Roles(Role.SUPER_ADMIN, Role.DIRECTION, Role.COMPTABILITE, Role.AUDITEUR)
  @Render('reports/unpaid-students')
  async unpaidStudents(@Req() req: Request) {
    return {
      title: 'Élèves impayés',
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
      title: 'Situation financière des classes',
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
