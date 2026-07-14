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
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import { EnrollmentsService } from '../enrollments/enrollments.service';
import { LevelsService } from '../levels/levels.service';
import { BillingService } from '../billing/billing.service';
import { PaymentsService } from '../payments/payments.service';
import { SchoolYearsService } from '../school-years/school-years.service';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/domain.enums';
import { AuthenticatedGuard } from '../common/guards/authenticated.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { setFlash } from '../common/utils/flash.util';
import {
  buildExcelBuffer,
  pickRowValue,
  readExcelRows,
} from '../common/utils/excel.util';
import { CreateStudentDto } from './dto/create-student.dto';
import { ReenrollStudentDto } from './dto/reenroll-student.dto';
import { SearchStudentsDto } from './dto/search-students.dto';
import { UpdateStudentDto } from './dto/update-student.dto';
import { StudentsService } from './students.service';

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
  ) {}

  @Get()
  @Roles(Role.SUPER_ADMIN, Role.DIRECTION, Role.SECRETARIAT, Role.AUDITEUR)
  @Render('students/index')
  async index(@Query() query: SearchStudentsDto) {
    const page = Math.max(1, Number(query.page ?? 1));
    const pageSize = Math.min(100, Math.max(5, Number(query.pageSize ?? 20)));
    const [result, levels, openSchoolYear] = await Promise.all([
      this.studentsService.searchPaginated(query.q, page, pageSize),
      this.levelsService.list(),
      this.schoolYearsService.findOpen(),
    ]);

    return {
      title: 'Eleves',
      students: result.items,
      levels,
      openSchoolYear,
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

  @Get('/export')
  @Roles(Role.SUPER_ADMIN, Role.DIRECTION, Role.SECRETARIAT, Role.AUDITEUR)
  async export(@Query() query: SearchStudentsDto, @Res() res: Response) {
    const students = await this.studentsService.search(query.q);
    const buffer = buildExcelBuffer(
      'Eleves',
      students.map((student: any) => ({
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

  @Post()
  @Roles(Role.SUPER_ADMIN, Role.SECRETARIAT)
  async create(
    @Body() dto: CreateStudentDto,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    try {
      const student = await this.studentsService.create(dto);
      const guardiansCount = Number((student as any).guardiansCount ?? 0);
      setFlash(
        req,
        'success',
        `Dossier eleve cree avec le matricule ${student.matricule}. Responsables enregistres: ${guardiansCount}`,
      );
    } catch (error: any) {
      setFlash(
        req,
        'error',
        error?.message ?? 'Impossible de creer le dossier eleve',
      );
    }

    return res.redirect('/students');
  }

  @Post('/import')
  @Roles(Role.SUPER_ADMIN, Role.SECRETARIAT)
  @UseInterceptors(FileInterceptor('file'))
  async importStudents(
    @UploadedFile() file: any,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    if (!file?.buffer) {
      throw new BadRequestException('Fichier Excel requis');
    }

    const rows = readExcelRows(file.buffer);
    let created = 0;
    let skipped = 0;

    for (const row of rows) {
      const dto: CreateStudentDto = {
        matricule: pickRowValue(row, ['matricule', 'code_eleve']),
        lastname: pickRowValue(row, ['lastname', 'nom']),
        firstname: pickRowValue(row, ['firstname', 'prenoms', 'prenom']),
        gender: (pickRowValue(row, ['gender', 'sexe']) || '')
          .toString()
          .trim()
          .toUpperCase(),
        birthDate: pickRowValue(row, ['birthdate', 'date_naissance']),
        birthPlace: pickRowValue(row, ['birthplace', 'lieu_naissance']),
        district: pickRowValue(row, ['district', 'quartier']),
      };

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
        continue;
      }

      try {
        await this.studentsService.create(dto);
        created += 1;
      } catch {
        skipped += 1;
      }
    }

    setFlash(
      req,
      'success',
      `Import eleves termine: ${created} crees, ${skipped} ignores`,
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
  async detail(@Param('id') id: string) {
    const detail = await this.studentsService.detail(id);
    const guardians = detail.guardians ?? [];
    const fatherGuardian =
      guardians.find((item: any) => item.type === 'father') ?? null;
    const motherGuardian =
      guardians.find((item: any) => item.type === 'mother') ?? null;
    const tutorGuardian =
      guardians.find((item: any) => item.type === 'tutor') ?? null;
    const history = await this.enrollmentsService.findStudentHistory(id);
    const invoices = await Promise.all(
      history.map((item: any) =>
        this.billingService.findInvoiceByEnrollment(String(item._id)),
      ),
    );
    const invoiceById = new Map(
      invoices
        .filter(Boolean)
        .map((invoice: any) => [String(invoice._id), invoice]),
    );
    const enrollmentByInvoiceId = new Map(
      invoices
        .map((invoice: any, index) =>
          invoice ? [String(invoice._id), history[index]] : undefined,
        )
        .filter(Boolean) as Array<[string, any]>,
    );

    const payments = await this.paymentsService.listByInvoiceIds(
      Array.from(invoiceById.keys()),
    );
    const paymentHistory = payments.map((payment: any) => {
      const invoice = invoiceById.get(String(payment.invoiceId));
      const enrollment = enrollmentByInvoiceId.get(String(payment.invoiceId));
      return {
        ...payment,
        invoice,
        enrollment,
      };
    });

    const currentEnrollment =
      history.find((item: any) => item.status === 'active') ?? history[0];

    return {
      title: 'Detail eleve',
      ...detail,
      fatherGuardian,
      motherGuardian,
      tutorGuardian,
      history,
      paymentHistory,
      currentEnrollment,
      schoolYears: await this.schoolYearsService.list(),
      levels: await this.levelsService.list(),
    };
  }

  @Get('/:id/financial-status')
  @Roles(
    Role.SUPER_ADMIN,
    Role.DIRECTION,
    Role.SECRETARIAT,
    Role.COMPTABILITE,
    Role.AUDITEUR,
  )
  async financialStatus(@Param('id') id: string) {
    const detail = await this.studentsService.detail(id);
    const history = await this.enrollmentsService.findStudentHistory(id);
    const invoices = await Promise.all(
      history.map((item: any) =>
        this.billingService.findInvoiceByEnrollment(String(item._id)),
      ),
    );
    const openArrears = await this.enrollmentsService.previewOpenArrears(id);

    const currentEnrollment =
      history.find((item: any) => item.status === 'active') ??
      history[0] ??
      null;
    const currentInvoice = currentEnrollment
      ? (invoices.find(
          (invoice: any, index: number) =>
            String(history[index]?._id) === String(currentEnrollment._id),
        ) ?? null)
      : null;

    const totalOutstandingInvoices = invoices.reduce(
      (sum: number, invoice: any) => sum + Number(invoice?.balanceDue ?? 0),
      0,
    );
    const totalOpenArrears = openArrears.reduce(
      (sum: number, item: any) => sum + Number(item.amountRemaining ?? 0),
      0,
    );
    const totalDue = totalOutstandingInvoices + totalOpenArrears;

    return {
      student: detail.student,
      currentEnrollment,
      currentInvoice,
      openArrearsCount: openArrears.length,
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
    setFlash(req, 'success', 'Dossier eleve mis a jour');
    return res.redirect(`/students/${id}`);
  }

  @Get('/:id/reenroll')
  @Roles(Role.SUPER_ADMIN, Role.SECRETARIAT)
  @Render('students/reenroll')
  async reenrollForm(@Param('id') id: string) {
    const detail = await this.studentsService.detail(id);
    const history = await this.enrollmentsService.findStudentHistory(id);
    const openArrears = await this.enrollmentsService.previewOpenArrears(id);
    return {
      title: 'Reinscription ancien eleve',
      ...detail,
      history,
      openArrears,
      schoolYears: await this.schoolYearsService.list(),
      levels: await this.levelsService.list(),
    };
  }

  @Post('/:id/reenroll')
  @Roles(Role.SUPER_ADMIN, Role.SECRETARIAT)
  async reenroll(
    @Param('id') id: string,
    @Body() dto: ReenrollStudentDto,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const result = await this.enrollmentsService.reenrollStudent(id, {
      targetSchoolYearId: dto.targetSchoolYearId,
      targetLevelId: dto.targetLevelId,
      carryOverArrears: dto.carryOverArrears !== 'false',
      reason: dto.reason,
      actorId: req.session.user?.id,
    });
    setFlash(req, 'success', 'Reinscription effectuee');
    return res.redirect(`/enrollments/${result.enrollmentId}`);
  }
}
