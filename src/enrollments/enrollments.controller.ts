import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  Query,
  Render,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Request, Response } from 'express';
import { StudentsService } from '../students/students.service';
import { LevelsService } from '../levels/levels.service';
import { SchoolYearsService } from '../school-years/school-years.service';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequireModule } from '../common/decorators/require-module.decorator';
import { PaymentMethod, Role } from '../common/enums/domain.enums';
import { AuthenticatedGuard } from '../common/guards/authenticated.guard';
import { ModuleGuard } from '../common/guards/module.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { setFlash } from '../common/utils/flash.util';
import { buildExcelBuffer } from '../common/utils/excel.util';
import { pickUploadedFile } from '../common/utils/multer.util';
import { lowerFirst, toDisplayString } from '../common/utils/safe-string.util';
import { formatMoney } from '../common/view-helpers/format-money';
import { CreateEnrollmentDto } from './dto/create-enrollment.dto';
import { UpdateEnrollmentDto } from './dto/update-enrollment.dto';
import { EnrollmentsService } from './enrollments.service';
import { BillingService } from '../billing/billing.service';
import { PaymentsService } from '../payments/payments.service';
import { EcoleModulesService } from '../ecole-modules/ecole-modules.service';
import { SettingsService } from '../settings/settings.service';
import { SessionUser } from '../common/types/session-user.type';

// NOTE: enrolling/updating a student is deliberately NOT gated by the
// Finance module - it's a core, everyday academic action, even though
// EnrollmentsService.createEnrollment() always creates an invoice as a
// side effect internally. Only the explicitly financial sub-action below
// (fee/discount/paid-amount adjustment) is gated.
@Controller('/enrollments')
@UseGuards(AuthenticatedGuard, RolesGuard, ModuleGuard)
export class EnrollmentsController {
  constructor(
    private readonly enrollmentsService: EnrollmentsService,
    private readonly studentsService: StudentsService,
    private readonly schoolYearsService: SchoolYearsService,
    private readonly levelsService: LevelsService,
    private readonly billingService: BillingService,
    private readonly paymentsService: PaymentsService,
    private readonly ecoleModulesService: EcoleModulesService,
    private readonly settingsService: SettingsService,
  ) {}

  @Get()
  @Roles(
    Role.SUPER_ADMIN,
    Role.DIRECTION,
    Role.SECRETARIAT,
    Role.COMPTABILITE,
    Role.AUDITEUR,
  )
  @Render('enrollments/index')
  async index(
    @Req() req: Request,
    @Query('page') pageParam?: string,
    @Query('pageSize') pageSizeParam?: string,
    @Query('q') queryParam?: string,
    @Query('studentId') studentIdParam?: string,
  ) {
    const selectedYear = await this.schoolYearsService.resolveSelected(
      req.session.selectedSchoolYearId,
    );
    const schoolYearId = String(selectedYear._id);
    const page = Math.max(1, Number(pageParam ?? 1));
    const pageSize = Math.min(100, Math.max(5, Number(pageSizeParam ?? 20)));
    const result = await this.enrollmentsService.listPaginated(
      schoolYearId,
      page,
      pageSize,
      queryParam,
    );

    // A "Payer" shortcut from the students list/detail page lands here with
    // ?studentId=... - pre-selects that student in the create/pay form
    // instead of making the desk search for them again. Any lookup failure
    // (invalid id, student gone) is silently ignored: the form just starts
    // empty, as if the param were absent.
    let preselectedStudent: { id: string; label: string } | null = null;
    if (studentIdParam && /^[a-f0-9]{24}$/i.test(studentIdParam)) {
      try {
        const student = await this.studentsService.findById(studentIdParam);
        preselectedStudent = {
          id: String(student._id),
          label: `${student.matricule} - ${student.lastname} ${student.firstname}`,
        };
      } catch {
        preselectedStudent = null;
      }
    }

    return {
      title: 'Inscriptions',
      searchQuery: (queryParam ?? '').trim(),
      enrollments: result.items,
      selectedYear,
      preselectedStudent,
      levels: await this.levelsService.listForSchoolYear(schoolYearId),
      // Fees per level, so the form can show what this enrollment costs and
      // offer to pay it in the same step.
      feesByLevel: await this.getFeesByLevel(schoolYearId),
      importPaidStudentsEnabled:
        await this.settingsService.getImportPaidStudentsEnabled(),
      pagination: {
        page: result.page,
        pageSize: result.pageSize,
        total: result.total,
        totalPages: result.totalPages,
        hasPrev: result.page > 1,
        hasNext: result.page < result.totalPages,
        prevPage: Math.max(1, result.page - 1),
        nextPage: Math.min(result.totalPages, result.page + 1),
      },
    };
  }

  private async getFeesByLevel(schoolYearId: string) {
    const schedules = await this.billingService.listFeeSchedules(schoolYearId);
    const fees: Record<
      string,
      { registrationFee: number; tuitionFee: number }
    > = {};
    for (const schedule of schedules) {
      const levelId = toDisplayString(
        schedule.levelId?._id ?? schedule.levelId,
      );
      fees[levelId] = {
        registrationFee: Number(schedule.registrationFee ?? 0),
        tuitionFee: Number(schedule.tuitionFee ?? 0),
      };
    }
    return fees;
  }

  @Get('/export')
  @Roles(
    Role.SUPER_ADMIN,
    Role.DIRECTION,
    Role.SECRETARIAT,
    Role.COMPTABILITE,
    Role.AUDITEUR,
  )
  async export(@Req() req: Request, @Res() res: Response) {
    const year = await this.schoolYearsService.resolveSelected(
      req.session.selectedSchoolYearId,
    );
    const enrollments = await this.enrollmentsService.list(String(year._id));
    const buffer = buildExcelBuffer(
      'Inscriptions',
      enrollments.map((item) => ({
        eleve:
          `${item.studentId?.lastname ?? ''} ${item.studentId?.firstname ?? ''}`.trim(),
        matricule: item.studentId?.matricule ?? '',
        annee: item.schoolYearId?.label ?? '',
        niveau: item.levelId?.label ?? '',
        type: item.type,
        statut: item.status,
        decision_finale: item.finalDecision,
      })),
    );

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="inscriptions.xlsx"',
    );
    return res.send(buffer);
  }

  @Post()
  @Roles(Role.SUPER_ADMIN, Role.SECRETARIAT)
  async create(
    @Body() dto: CreateEnrollmentDto,
    @Req() req: Request,
    @Res() res: Response,
    @CurrentUser() user: SessionUser | undefined,
  ) {
    const open = await this.schoolYearsService.requireOpen();
    const paymentAmount = Number(dto.paymentAmount ?? 0);
    const wantsPayment = paymentAmount > 0;

    // Checked before anything is created, so a refused payment never leaves
    // a half-done enrollment behind.
    const ecoleId = req.session?.user?.ecoleId;
    if (
      wantsPayment &&
      ecoleId &&
      !(await this.ecoleModulesService.isActive(ecoleId, 'FINANCE'))
    ) {
      throw new ForbiddenException(
        'Le module FINANCE est désactivé pour cette école',
      );
    }

    // This same form doubles as "record another payment" for a student
    // already enrolled this year (installments, a top-up, ...) - without
    // this check that always fell through to createEnrollment()'s duplicate
    // guard, rejecting the whole submission (payment included) with a
    // "Double inscription" error that has nothing to do with what the desk
    // was actually trying to do.
    const existingEnrollment =
      await this.enrollmentsService.findActiveEnrollment(
        dto.studentId,
        String(open._id),
      );
    if (existingEnrollment) {
      if (!wantsPayment) {
        setFlash(
          req,
          'error',
          'Cet élève est déjà inscrit cette année. Indiquez un montant à payer pour enregistrer un nouveau versement, ou ouvrez sa fiche d’inscription.',
        );
        return res.redirect(req.get('referer') || '/enrollments');
      }

      const invoice = await this.billingService.findInvoiceByEnrollment(
        String(existingEnrollment._id),
      );
      if (!invoice) {
        setFlash(
          req,
          'error',
          'Cet élève est déjà inscrit cette année, mais aucune facture n’a été trouvée pour enregistrer le paiement.',
        );
        return res.redirect(`/enrollments/${String(existingEnrollment._id)}`);
      }
      try {
        const payment = await this.paymentsService.createPayment(
          {
            invoiceId: String(invoice._id),
            amount: paymentAmount,
            method: dto.paymentMethod ?? PaymentMethod.CASH,
            reference: dto.paymentReference,
          },
          user?.id,
        );
        setFlash(
          req,
          'success',
          `Paiement de ${formatMoney(paymentAmount)} enregistré pour l'inscription existante`,
        );
        return res.redirect(`/receipts/${payment.payment._id.toString()}`);
      } catch (error) {
        setFlash(
          req,
          'error',
          `Le paiement n'a pas été enregistré : ${
            error instanceof Error
              ? lowerFirst(error.message)
              : 'erreur inconnue'
          }`,
        );
        return res.redirect(`/enrollments/${String(existingEnrollment._id)}`);
      }
    }

    const result = await this.enrollmentsService.createEnrollment(
      { ...dto, schoolYearId: String(open._id) },
      user?.id,
    );

    if (!wantsPayment) {
      setFlash(req, 'success', 'Inscription créée');
      return res.redirect(`/enrollments/${result.enrollmentId}`);
    }

    try {
      const payment = await this.paymentsService.createPayment(
        {
          invoiceId: result.invoiceId,
          amount: paymentAmount,
          method: dto.paymentMethod ?? PaymentMethod.CASH,
          reference: dto.paymentReference,
        },
        user?.id,
      );
      setFlash(
        req,
        'success',
        `Inscription créée et paiement de ${formatMoney(paymentAmount)} enregistré`,
      );
      return res.redirect(`/receipts/${payment.payment._id.toString()}`);
    } catch (error) {
      // The enrollment itself succeeded - keep it and say exactly what did
      // not, so the payment can be entered again from the enrollment page.
      setFlash(
        req,
        'error',
        `Inscription créée, mais le paiement n'a pas été enregistré : ${
          error instanceof Error ? lowerFirst(error.message) : 'erreur inconnue'
        }`,
      );
      return res.redirect(`/enrollments/${result.enrollmentId}`);
    }
  }

  // Off by default (see SettingsService.getImportPaidStudentsEnabled) - a
  // school opts in from /settings/fees before this route (and the panel
  // offering it on /enrollments) does anything. The montant_paye column is
  // recorded as-is, never recalculated against the fee schedule - meant for
  // migrating records from an older system, not everyday enrollment.
  @Get('/import-template')
  @Roles(Role.SUPER_ADMIN, Role.SECRETARIAT)
  importTemplate(@Res() res: Response) {
    const buffer = buildExcelBuffer('Eleves_payes', [
      {
        matricule: '',
        nom: 'DUPONT',
        prenoms: 'Jean',
        sexe: 'M',
        date_naissance: '15/03/2015',
        lieu_naissance: 'Lome',
        quartier: 'Agoe',
        classe: 'CP1',
        montant_paye: 25000,
        mode_paiement: 'cash',
        reference: '',
        nom_pere: 'DUPONT Pierre',
        contact_pere: '90000000',
        adresse_pere: 'Agoe',
        nom_mere: 'DUPONT Marie',
        contact_mere: '91000000',
        adresse_mere: 'Agoe',
      },
    ]);

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="modele-import-eleves-payes.xlsx"',
    );
    return res.send(buffer);
  }

  @Post('/import')
  @Roles(Role.SUPER_ADMIN, Role.SECRETARIAT)
  async importPaidStudents(
    @Req() req: Request,
    @Res() res: Response,
    @CurrentUser() user: SessionUser | undefined,
  ) {
    if (!(await this.settingsService.getImportPaidStudentsEnabled())) {
      throw new ForbiddenException(
        "L'import des élèves déjà payés n'est pas activé pour cette école",
      );
    }
    const ecoleId = req.session?.user?.ecoleId;
    if (
      ecoleId &&
      !(await this.ecoleModulesService.isActive(ecoleId, 'FINANCE'))
    ) {
      throw new ForbiddenException(
        'Le module FINANCE est désactivé pour cette école',
      );
    }
    const file = pickUploadedFile(req, 'file');
    if (!file?.buffer) {
      throw new BadRequestException('Fichier Excel requis');
    }

    const openYear = await this.schoolYearsService.requireOpen();
    const report = await this.enrollmentsService.importPaidStudents(
      file.buffer,
      String(openYear._id),
      user?.id,
    );

    const reasons: string[] = [];
    if (report.unknownClass) {
      reasons.push(`${report.unknownClass} classe introuvable ou manquante`);
    }
    if (report.missingFields) {
      reasons.push(
        `${report.missingFields} champ(s) obligatoire(s) manquant(s)`,
      );
    }
    if (report.invalidDate) {
      reasons.push(`${report.invalidDate} date de naissance illisible`);
    }
    if (report.creationFailed) {
      reasons.push(`${report.creationFailed} en échec (doublon probable)`);
    }
    const reasonSuffix = reasons.length ? ` (${reasons.join(', ')})` : '';

    setFlash(
      req,
      'success',
      `Import terminé : ${report.created} élève(s) inscrit(s), ${report.paid} paiement(s) enregistré(s), ${report.skipped} ignoré(s)${reasonSuffix}`,
    );
    return res.redirect('/enrollments');
  }

  @Get('/:id')
  @Roles(
    Role.SUPER_ADMIN,
    Role.DIRECTION,
    Role.SECRETARIAT,
    Role.COMPTABILITE,
    Role.AUDITEUR,
  )
  @Render('enrollments/detail')
  async detail(
    @Param('id') id: string,
    @Req() req: Request,
  ): Promise<Record<string, unknown>> {
    const detail = await this.enrollmentsService.findById(id);
    const selected = await this.schoolYearsService.resolveSelected(
      req.session.selectedSchoolYearId,
    );
    if (
      toDisplayString(
        detail.enrollment.schoolYearId?._id ?? detail.enrollment.schoolYearId,
      ) !== String(selected._id)
    ) {
      throw new ForbiddenException(
        'Cette inscription appartient à une autre année scolaire',
      );
    }
    return {
      title: 'Détail de l’inscription',
      ...detail,
      students: await this.studentsService.list(),
      schoolYears: [selected],
      levels: await this.levelsService.listForSchoolYear(String(selected._id)),
    };
  }

  // Direction incluse : elle seule (avec le super admin) peut changer la
  // classe d'un eleve ayant deja paye (voir EnrollmentsService.updateEnrollment).
  @Put('/:id')
  @Roles(Role.SUPER_ADMIN, Role.DIRECTION, Role.SECRETARIAT)
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateEnrollmentDto,
    @Req() req: Request,
    @Res() res: Response,
    @CurrentUser() user: SessionUser | undefined,
  ) {
    try {
      await this.enrollmentsService.updateEnrollment(
        id,
        dto,
        user?.id,
        user?.role,
      );
      setFlash(req, 'success', 'Inscription mise à jour');
    } catch (error) {
      if (!(error instanceof BadRequestException)) {
        throw error;
      }
      setFlash(req, 'error', error.message);
    }
    return res.redirect(req.get('referer') || `/enrollments/${id}`);
  }

  @Post('/:id/financial-details')
  @Roles(Role.SUPER_ADMIN, Role.COMPTABILITE)
  @RequireModule('FINANCE')
  async updateFinancialDetails(
    @Param('id') id: string,
    @Body()
    dto: {
      registrationFee?: string;
      discountAmount?: string;
      paidAmount?: string;
      reason?: string;
    },
    @Req() req: Request,
    @Res() res: Response,
    @CurrentUser() user: SessionUser | undefined,
  ) {
    const actorRole = user?.role;
    if (actorRole !== Role.SUPER_ADMIN && actorRole !== Role.COMPTABILITE) {
      throw new ForbiddenException('Accès refusé pour ce rôle');
    }

    await this.enrollmentsService.updateFinancialDetails(
      id,
      {
        registrationFee:
          dto.registrationFee !== undefined
            ? Number(dto.registrationFee)
            : undefined,
        discountAmount:
          dto.discountAmount !== undefined
            ? Number(dto.discountAmount)
            : undefined,
        paidAmount:
          dto.paidAmount !== undefined ? Number(dto.paidAmount) : undefined,
        reason: dto.reason,
      },
      user?.id,
      actorRole,
    );

    setFlash(req, 'success', 'Montants financiers mis à jour');
    return res.redirect(req.get('referer') || `/enrollments/${id}`);
  }
}
