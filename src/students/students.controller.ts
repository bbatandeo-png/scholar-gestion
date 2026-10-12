import {
  Body,
  BadRequestException,
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
import { Request, Response } from 'express';
import { EnrollmentsService } from '../enrollments/enrollments.service';
import { LevelsService } from '../levels/levels.service';
import { BillingService } from '../billing/billing.service';
import { PaymentsService } from '../payments/payments.service';
import { SchoolYearsService } from '../school-years/school-years.service';
import { SettingsService } from '../settings/settings.service';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import {
  EnrollmentType,
  GuardianType,
  PaymentMethod,
  Role,
} from '../common/enums/domain.enums';
import { EcoleModulesService } from '../ecole-modules/ecole-modules.service';
import { AuthenticatedGuard } from '../common/guards/authenticated.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { setFlash } from '../common/utils/flash.util';
import {
  buildExcelBuffer,
  parseExcelDate,
  pickRowValue,
  readExcelRows,
} from '../common/utils/excel.util';
import { pickUploadedFile } from '../common/utils/multer.util';
import { toDisplayString } from '../common/utils/safe-string.util';
import { PopulatedEnrollmentLean } from '../common/types/populated-refs.types';
import { CreateStudentDto } from './dto/create-student.dto';
import { ReenrollStudentDto } from './dto/reenroll-student.dto';
import { SearchStudentsDto } from './dto/search-students.dto';
import { UpdateStudentDto } from './dto/update-student.dto';
import { StudentsService } from './students.service';
import { SessionUser } from '../common/types/session-user.type';

@Controller('/students')
@UseGuards(AuthenticatedGuard, RolesGuard)
export class StudentsController {
  constructor(
    private readonly studentsService: StudentsService,
    private readonly enrollmentsService: EnrollmentsService,
    private readonly schoolYearsService: SchoolYearsService,
    private readonly levelsService: LevelsService,
    private readonly billingService: BillingService,
    private readonly paymentsService: PaymentsService,
    private readonly ecoleModulesService: EcoleModulesService,
    private readonly settingsService: SettingsService,
  ) {}

  @Get()
  @Roles(Role.SUPER_ADMIN, Role.DIRECTION, Role.SECRETARIAT, Role.AUDITEUR)
  @Render('students/index')
  async index(@Query() query: SearchStudentsDto, @Req() req: Request) {
    const year = await this.schoolYearsService.resolveSelected(
      req.session.selectedSchoolYearId,
    );
    // ?schoolYearId= (no UI control for it anymore, but still honoured -
    // see the student-search bug's e2e coverage) searches a different year
    // than the one selected for the rest of the app - never changes that
    // selection, only which year's enrollments this one list looks at.
    const filterSchoolYearId = query.schoolYearId ?? String(year._id);
    const page = Math.max(1, Number(query.page ?? 1));
    const pageSize = Math.min(100, Math.max(5, Number(query.pageSize ?? 20)));
    const result = await this.studentsService.searchPaginated(
      query.q,
      page,
      pageSize,
      filterSchoolYearId,
      {
        levelId: query.levelId,
        status: query.status,
        matricule: query.matricule,
      },
    );

    return {
      title: 'Eleves',
      students: result.items,
      // For "Creer un eleve" / "Liste nominative" below: always the truly
      // selected year, never the (now UI-less, but still query-param
      // addressable) year this search happens to filter on.
      levels: await this.levelsService.listForSchoolYear(String(year._id)),
      // So "Creer un eleve" can show what enrolling into each class costs -
      // see create()'s auto-enrollment, which targets the truly open year;
      // this reads the same one whenever it matches the selected year (the
      // normal case) and simply shows no fee hint otherwise.
      feesByLevel: await this.getFeesByLevel(String(year._id)),
      registrationPaymentRequired:
        await this.settingsService.getRegistrationPaymentRequired(),
      openSchoolYear: year,
      query: query.q ?? '',
      filters: {
        levelId: query.levelId ?? '',
        status: query.status ?? '',
        matricule: query.matricule ?? '',
        schoolYearId: query.schoolYearId ?? '',
      },
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
  @Roles(Role.SUPER_ADMIN, Role.DIRECTION, Role.SECRETARIAT, Role.AUDITEUR)
  async export(
    @Query() query: SearchStudentsDto,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const year = await this.schoolYearsService.resolveSelected(
      req.session.selectedSchoolYearId,
    );
    const students = await this.studentsService.search(
      query.q,
      query.schoolYearId ?? String(year._id),
      {
        levelId: query.levelId,
        status: query.status,
        matricule: query.matricule,
      },
    );
    const buffer = buildExcelBuffer(
      'Eleves',
      students.map((student) => ({
        matricule: student.matricule,
        nom: student.lastname,
        prenoms: student.firstname,
        sexe: student.gender,
        date_naissance: student.birthDate,
        lieu_naissance: student.birthPlace,
        quartier: student.district,
        statut: student.status,
      })),
    );

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader('Content-Disposition', 'attachment; filename="eleves.xlsx"');
    return res.send(buffer);
  }

  @Get('/autocomplete')
  @Roles(
    Role.SUPER_ADMIN,
    Role.DIRECTION,
    Role.SECRETARIAT,
    Role.COMPTABILITE,
    Role.AUDITEUR,
  )
  async autocomplete(
    @Query('q') query = '',
    @Query('limit') limitParam?: string,
  ) {
    const limit = Math.min(30, Math.max(1, Number(limitParam ?? 25) || 25));
    const items = await this.studentsService.autocomplete(query, limit);

    return {
      items: items.map((student) => ({
        id: String(student._id),
        matricule: student.matricule,
        lastname: student.lastname,
        firstname: student.firstname,
        label: `${student.matricule} - ${student.lastname} ${student.firstname}`,
      })),
    };
  }

  @Get('/search')
  @Roles(Role.SUPER_ADMIN, Role.DIRECTION, Role.SECRETARIAT, Role.AUDITEUR)
  @Render('students/search')
  async search(@Query() query: SearchStudentsDto) {
    const page = Math.max(1, Number(query.page ?? 1));
    const pageSize = Math.min(100, Math.max(5, Number(query.pageSize ?? 20)));
    const result = await this.studentsService.searchPaginated(
      query.q,
      page,
      pageSize,
    );

    return {
      title: 'Recherche ancien eleve',
      students: result.items,
      query: query.q ?? '',
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

  // JSON, appele par le script de la page "Creer un eleve" juste avant la
  // soumission du formulaire - voir students/index.njk. Jamais bloquant en
  // soi (deux eleves peuvent reellement porter le meme nom), juste de quoi
  // demander confirmation.
  @Get('/check-duplicate')
  @Roles(Role.SUPER_ADMIN, Role.DIRECTION, Role.SECRETARIAT, Role.AUDITEUR)
  async checkDuplicateName(
    @Query('lastname') lastname = '',
    @Query('firstname') firstname = '',
  ) {
    if (!lastname.trim() || !firstname.trim()) {
      return { matches: [] };
    }
    const matches = await this.studentsService.checkDuplicateName(
      lastname,
      firstname,
    );
    return {
      matches: matches.map((student) => ({
        matricule: student.matricule,
        status: student.status,
      })),
    };
  }

  @Get('/duplicates')
  @Roles(Role.SUPER_ADMIN, Role.DIRECTION, Role.SECRETARIAT, Role.AUDITEUR)
  @Render('students/duplicates')
  async duplicates() {
    const groups = await this.studentsService.findDuplicateGroups();
    const studentIds = groups.flatMap((group) =>
      group.students.map((student) => String(student._id)),
    );
    const financials =
      await this.studentsService.getFinancialSummaries(studentIds);
    const groupsWithFinancials = groups.map((group) => ({
      ...group,
      students: group.students.map((student) => ({
        ...student,
        financial: financials.get(String(student._id)) ?? {
          totalPaid: 0,
          balanceDue: 0,
        },
      })),
    }));
    return {
      title: 'Doublons de noms',
      groups: groupsWithFinancials,
    };
  }

  @Post()
  @Roles(Role.SUPER_ADMIN, Role.SECRETARIAT)
  async create(
    @Body() dto: CreateStudentDto,
    @Req() req: Request,
    @Res() res: Response,
    @CurrentUser() user: SessionUser | undefined,
  ) {
    // Checked before creating anything: some schools require the
    // registration payment up front (Ecole.registrationPaymentRequired, set
    // on /platform/ecoles and baked into this install's own Settings at
    // first boot - see scripts/seed.ts). Only applicable when a class is
    // being chosen at all (the Paiement a l'inscription panel is itself only
    // shown then) and when FINANCE is active (same gate the panel's own
    // visibility already uses - nothing to enforce otherwise).
    if (dto.levelId && Number(dto.paymentAmount ?? 0) <= 0) {
      const ecoleId = req.session?.user?.ecoleId;
      const financeActive =
        !!ecoleId &&
        (await this.ecoleModulesService.isActive(ecoleId, 'FINANCE'));
      if (
        financeActive &&
        (await this.settingsService.getRegistrationPaymentRequired())
      ) {
        setFlash(
          req,
          'error',
          "Le paiement a l'inscription est obligatoire pour cette ecole - indiquez un montant et un mode de paiement.",
        );
        return res.redirect('/students');
      }
    }

    let student: Awaited<ReturnType<StudentsService['create']>>;
    try {
      student = await this.studentsService.create(dto);
      await this.studentsService.savePhoto(
        String(student._id),
        pickUploadedFile(req, 'photo'),
      );
    } catch (error) {
      const isDuplicateKey =
        typeof error === 'object' &&
        error !== null &&
        (error as { code?: number }).code === 11000;
      setFlash(
        req,
        'error',
        isDuplicateKey
          ? 'Ce matricule est deja utilise - reessayez'
          : error instanceof Error
            ? error.message
            : 'Impossible de creer le dossier eleve',
      );
      return res.redirect('/students');
    }

    // Most schools never create a student without immediately enrolling and
    // collecting something - the class chosen above (mandatory on this
    // form) doubles as "enroll them now" instead of leaving that for a
    // separate trip through /enrollments. A failure here (no open school
    // year, payment refused, ...) never hides that the student record
    // itself was created successfully.
    if (dto.levelId) {
      try {
        const openYear = await this.schoolYearsService.requireOpen();
        const paymentAmount = Number(dto.paymentAmount ?? 0);
        const wantsPayment = paymentAmount > 0;

        if (wantsPayment) {
          const ecoleId = req.session?.user?.ecoleId;
          if (
            ecoleId &&
            !(await this.ecoleModulesService.isActive(ecoleId, 'FINANCE'))
          ) {
            setFlash(
              req,
              'error',
              `Dossier eleve cree (matricule ${student.matricule}), mais le module FINANCE est desactive : ni l'inscription ni le paiement n'ont ete enregistres.`,
            );
            return res.redirect('/students');
          }
        }

        const result = await this.enrollmentsService.createEnrollment(
          {
            studentId: String(student._id),
            schoolYearId: String(openYear._id),
            levelId: dto.levelId,
            type: EnrollmentType.INITIAL,
          },
          user?.id,
        );

        if (!wantsPayment) {
          setFlash(
            req,
            'success',
            `Dossier eleve cree avec le matricule ${student.matricule} et inscrit en ${openYear.label}. Responsables enregistres : ${student.guardiansCount}`,
          );
          return res.redirect('/students');
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
            `Dossier eleve cree (matricule ${student.matricule}), inscrit en ${openYear.label} et paiement de ${paymentAmount} enregistre`,
          );
          return res.redirect(`/receipts/${payment.payment._id.toString()}`);
        } catch (error) {
          setFlash(
            req,
            'error',
            `Dossier eleve cree et inscrit, mais le paiement n'a pas ete enregistre : ${
              error instanceof Error ? error.message : 'erreur inconnue'
            }`,
          );
          return res.redirect('/students');
        }
      } catch (error) {
        setFlash(
          req,
          'error',
          `Dossier eleve cree avec le matricule ${student.matricule}, mais l'inscription n'a pas ete effectuee : ${
            error instanceof Error ? error.message : 'erreur inconnue'
          }`,
        );
        return res.redirect('/students');
      }
    }

    setFlash(
      req,
      'success',
      `Dossier eleve cree avec le matricule ${student.matricule}. Responsables enregistres: ${student.guardiansCount}`,
    );
    return res.redirect('/students');
  }

  @Get('/import-template')
  @Roles(Role.SUPER_ADMIN, Role.SECRETARIAT)
  importTemplate(@Res() res: Response) {
    const buffer = buildExcelBuffer('Eleves', [
      {
        matricule: '',
        nom: 'DUPONT',
        prenoms: 'Jean',
        sexe: 'M',
        date_naissance: '15/03/2015',
        lieu_naissance: 'Lome',
        quartier: 'Agoe',
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
      'attachment; filename="modele-import-eleves.xlsx"',
    );
    return res.send(buffer);
  }

  @Post('/import')
  @Roles(Role.SUPER_ADMIN, Role.SECRETARIAT)
  async importStudents(@Req() req: Request, @Res() res: Response) {
    const file = pickUploadedFile(req, 'file');
    if (!file?.buffer) {
      throw new BadRequestException('Fichier Excel requis');
    }

    const rows = readExcelRows(file.buffer);
    let created = 0;
    let skipped = 0;
    let invalidDate = 0;
    let missingFields = 0;
    let creationFailed = 0;

    for (const row of rows) {
      const rawBirthDate = pickRowValue(row, ['birthdate', 'date_naissance']);
      const parsedBirthDate = rawBirthDate
        ? parseExcelDate(rawBirthDate)
        : null;
      // Guardians are optional per row and per parent - a row only gets a
      // father/mother entry when its "nom_pere"/"nom_mere" column is
      // actually filled in, matching how the create-student form only
      // saves a guardian block when its name field was entered.
      const guardians: CreateStudentDto['guardians'] = [];
      const pereFullname = pickRowValue(row, [
        'nom_pere',
        'pere',
        'nom_complet_pere',
      ]);
      if (pereFullname) {
        guardians.push({
          type: GuardianType.FATHER,
          fullname: pereFullname,
          phone: pickRowValue(row, [
            'contact_pere',
            'telephone_pere',
            'tel_pere',
          ]),
          address: pickRowValue(row, ['adresse_pere']),
        });
      }
      const mereFullname = pickRowValue(row, [
        'nom_mere',
        'mere',
        'nom_complet_mere',
      ]);
      if (mereFullname) {
        guardians.push({
          type: GuardianType.MOTHER,
          fullname: mereFullname,
          phone: pickRowValue(row, [
            'contact_mere',
            'telephone_mere',
            'tel_mere',
          ]),
          address: pickRowValue(row, ['adresse_mere']),
        });
      }

      const dto: CreateStudentDto = {
        matricule: pickRowValue(row, ['matricule', 'code_eleve']),
        lastname: pickRowValue(row, ['lastname', 'nom']),
        firstname: pickRowValue(row, ['firstname', 'prenoms', 'prenom']),
        gender: (pickRowValue(row, ['gender', 'sexe']) || '')
          .toString()
          .trim()
          .toUpperCase(),
        birthDate: parsedBirthDate ?? '',
        birthPlace: pickRowValue(row, ['birthplace', 'lieu_naissance']),
        district: pickRowValue(row, ['district', 'quartier']),
        guardians: guardians.length ? guardians : undefined,
      };

      if (rawBirthDate && !parsedBirthDate) {
        skipped += 1;
        invalidDate += 1;
        continue;
      }

      if (
        !dto.lastname ||
        !dto.firstname ||
        !dto.gender ||
        !['M', 'F'].includes(dto.gender) ||
        !dto.birthDate ||
        !dto.birthPlace ||
        !dto.district
      ) {
        skipped += 1;
        missingFields += 1;
        continue;
      }

      try {
        await this.studentsService.create(dto);
        created += 1;
      } catch {
        skipped += 1;
        creationFailed += 1;
      }
    }

    const reasons: string[] = [];
    if (missingFields) {
      reasons.push(`${missingFields} champ(s) obligatoire(s) manquant(s)`);
    }
    if (invalidDate) {
      reasons.push(`${invalidDate} date de naissance illisible`);
    }
    if (creationFailed) {
      reasons.push(`${creationFailed} en echec (doublon probable)`);
    }
    const reasonSuffix = reasons.length ? ` (${reasons.join(', ')})` : '';

    setFlash(
      req,
      'success',
      `Import eleves termine: ${created} crees, ${skipped} ignores${reasonSuffix}`,
    );
    return res.redirect('/students');
  }

  @Get('/:id')
  @Roles(
    Role.SUPER_ADMIN,
    Role.DIRECTION,
    Role.SECRETARIAT,
    Role.COMPTABILITE,
    Role.AUDITEUR,
  )
  @Render('students/detail')
  async detail(
    @Param('id') id: string,
    @Req() req: Request,
  ): Promise<Record<string, unknown>> {
    const selectedYear = await this.schoolYearsService.resolveSelected(
      req.session.selectedSchoolYearId,
    );
    const detail = await this.studentsService.detail(id);
    const guardians = detail.guardians ?? [];
    const fatherGuardian =
      guardians.find((item) => item.type === GuardianType.FATHER) ?? null;
    const motherGuardian =
      guardians.find((item) => item.type === GuardianType.MOTHER) ?? null;
    const tutorGuardian =
      guardians.find((item) => item.type === GuardianType.TUTOR) ?? null;
    const history = await this.enrollmentsService.findStudentHistory(id);
    const invoices = await Promise.all(
      history.map((item) =>
        this.billingService.findInvoiceByEnrollment(String(item._id)),
      ),
    );
    const invoiceById = new Map(
      invoices
        .filter((invoice) => Boolean(invoice))
        .map((invoice) => [String(invoice?._id), invoice]),
    );
    const enrollmentByInvoiceId = new Map(
      invoices
        .map((invoice, index) =>
          invoice
            ? ([String(invoice._id), history[index]] as const)
            : undefined,
        )
        .filter((entry): entry is readonly [string, PopulatedEnrollmentLean] =>
          Boolean(entry),
        ),
    );

    const payments = await this.paymentsService.listByInvoiceIds(
      Array.from(invoiceById.keys()),
    );
    const paymentHistory = payments.map((payment) => {
      const invoice = invoiceById.get(String(payment.invoiceId));
      const enrollment = enrollmentByInvoiceId.get(String(payment.invoiceId));
      return {
        ...payment,
        invoice,
        enrollment,
      };
    });

    const currentEnrollment = history.find(
      (item) =>
        toDisplayString(item.schoolYearId?._id ?? item.schoolYearId) ===
        String(selectedYear._id),
    );

    return {
      title: 'Detail eleve',
      ...detail,
      fatherGuardian,
      motherGuardian,
      tutorGuardian,
      history,
      paymentHistory,
      currentEnrollment,
      studentClass: await this.studentsService.getClassInfo(id),
      selectedYear,
      schoolYears: [selectedYear],
      levels: await this.levelsService.listForSchoolYear(
        String(selectedYear._id),
      ),
    };
  }

  // Not gated by @RequireModule('FINANCE'): read-only, lives on the core
  // Students controller which must stay reachable regardless of module state.
  @Get('/:id/financial-status')
  @Roles(
    Role.SUPER_ADMIN,
    Role.DIRECTION,
    Role.SECRETARIAT,
    Role.COMPTABILITE,
    Role.AUDITEUR,
  )
  async financialStatus(@Param('id') id: string, @Req() req: Request) {
    const selectedYear = await this.schoolYearsService.resolveSelected(
      req.session.selectedSchoolYearId,
    );
    const detail = await this.studentsService.detail(id);
    const studentClass = await this.studentsService.getClassInfo(id);
    const history = await this.enrollmentsService.findStudentHistory(
      id,
      String(selectedYear._id),
    );
    const invoices = await Promise.all(
      history.map((item) =>
        this.billingService.findInvoiceByEnrollment(String(item._id)),
      ),
    );
    const currentEnrollment = history[0] ?? null;
    const currentInvoice = currentEnrollment
      ? (invoices.find(
          (_invoice, index) =>
            String(history[index]?._id) === String(currentEnrollment._id),
        ) ?? null)
      : null;

    const totalOutstandingInvoices = Number(currentInvoice?.balanceDue ?? 0);
    const totalOpenArrears = Number(currentInvoice?.arrearsAmount ?? 0);
    const totalDue = totalOutstandingInvoices;

    return {
      student: detail.student,
      studentClass,
      currentEnrollment,
      currentInvoice,
      openArrearsCount: totalOpenArrears > 0 ? 1 : 0,
      openArrearsAmount: totalOpenArrears,
      outstandingInvoicesAmount: totalOutstandingInvoices,
      totalDue,
      isSettled: totalDue === 0,
    };
  }

  @Put('/:id')
  @Roles(Role.SUPER_ADMIN, Role.SECRETARIAT)
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateStudentDto,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    await this.studentsService.update(id, dto);
    await this.studentsService.savePhoto(id, pickUploadedFile(req, 'photo'));
    setFlash(req, 'success', 'Dossier eleve mis a jour');
    return res.redirect(`/students/${id}`);
  }

  @Get('/:id/reenroll')
  @Roles(Role.SUPER_ADMIN, Role.SECRETARIAT)
  @Render('students/reenroll')
  async reenrollForm(@Param('id') id: string) {
    const openYear = await this.schoolYearsService.requireOpen();
    const detail = await this.studentsService.detail(id);
    const history = await this.enrollmentsService.findStudentHistory(id);
    const openArrears = await this.enrollmentsService.previewOpenArrears(id);
    return {
      title: 'Reinscription ancien eleve',
      ...detail,
      history,
      openArrears,
      schoolYears: [openYear],
      levels: await this.levelsService.listForSchoolYear(String(openYear._id)),
    };
  }

  @Post('/:id/reenroll')
  @Roles(Role.SUPER_ADMIN, Role.SECRETARIAT)
  async reenroll(
    @Param('id') id: string,
    @Body() dto: ReenrollStudentDto,
    @Req() req: Request,
    @Res() res: Response,
    @CurrentUser() user: SessionUser | undefined,
  ) {
    const open = await this.schoolYearsService.requireOpen();
    const result = await this.enrollmentsService.reenrollStudent(id, {
      targetSchoolYearId: String(open._id),
      targetLevelId: dto.targetLevelId,
      carryOverArrears: dto.carryOverArrears !== 'false',
      reason: dto.reason,
      actorId: user?.id,
    });
    setFlash(req, 'success', 'Reinscription effectuee');
    return res.redirect(`/enrollments/${result.enrollmentId}`);
  }
}
