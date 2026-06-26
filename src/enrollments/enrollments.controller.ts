import { Body, Controller, Get, Param, Post, Put, Query, Render, Req, Res, UseGuards } from '@nestjs/common';
import { ForbiddenException } from '@nestjs/common';
import { Request, Response } from 'express';
import { StudentsService } from '../students/students.service';
import { LevelsService } from '../levels/levels.service';
import { SchoolYearsService } from '../school-years/school-years.service';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/domain.enums';
import { AuthenticatedGuard } from '../common/guards/authenticated.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { setFlash } from '../common/utils/flash.util';
import { buildExcelBuffer } from '../common/utils/excel.util';
import { CreateEnrollmentDto } from './dto/create-enrollment.dto';
import { EnrollmentsService } from './enrollments.service';

@Controller('/enrollments')
@UseGuards(AuthenticatedGuard, RolesGuard)
export class EnrollmentsController {
  constructor(
    private readonly enrollmentsService: EnrollmentsService,
    private readonly studentsService: StudentsService,
    private readonly schoolYearsService: SchoolYearsService,
    private readonly levelsService: LevelsService,
  ) {}

  @Get()
  @Roles(Role.SUPER_ADMIN, Role.DIRECTION, Role.SECRETARIAT, Role.COMPTABILITE, Role.AUDITEUR)
  @Render('enrollments/index')
  async index(@Query('page') pageParam?: string, @Query('pageSize') pageSizeParam?: string) {
    const page = Math.max(1, Number(pageParam ?? 1));
    const pageSize = Math.min(100, Math.max(5, Number(pageSizeParam ?? 20)));
    const result = await this.enrollmentsService.listPaginated(page, pageSize);

    return {
      title: 'Inscriptions',
      enrollments: result.items,
      students: await this.studentsService.list(),
      schoolYears: await this.schoolYearsService.list(),
      levels: await this.levelsService.list(),
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
  @Roles(Role.SUPER_ADMIN, Role.DIRECTION, Role.SECRETARIAT, Role.COMPTABILITE, Role.AUDITEUR)
  async export(@Res() res: Response) {
    const enrollments = await this.enrollmentsService.list();
    const buffer = buildExcelBuffer(
      'Inscriptions',
      enrollments.map((item: any) => ({
        eleve: `${item.studentId?.lastname ?? ''} ${item.studentId?.firstname ?? ''}`.trim(),
        matricule: item.studentId?.matricule ?? '',
        annee: item.schoolYearId?.label ?? '',
        niveau: item.levelId?.label ?? '',
        type: item.type,
        statut: item.status,
        decision_finale: item.finalDecision,
      })),
    );

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="inscriptions.xlsx"');
    return res.send(buffer);
  }

  @Post()
  @Roles(Role.SUPER_ADMIN, Role.SECRETARIAT)
  async create(@Body() dto: CreateEnrollmentDto, @Req() req: Request, @Res() res: Response) {
    const result = await this.enrollmentsService.createEnrollment(dto, req.session.user?.id);
    setFlash(req, 'success', 'Inscription creee');
    return res.redirect(`/enrollments/${result.enrollmentId}`);
  }

  @Get('/:id')
  @Roles(Role.SUPER_ADMIN, Role.DIRECTION, Role.SECRETARIAT, Role.COMPTABILITE, Role.AUDITEUR)
  @Render('enrollments/detail')
  async detail(@Param('id') id: string): Promise<{
    title: string;
    enrollment: any;
    invoice: any;
    auditLogs: any[];
    students: any[];
    schoolYears: any[];
    levels: any[];
  }> {
    const detail = await this.enrollmentsService.findById(id);
    return {
      title: 'Detail inscription',
      ...detail,
      students: await this.studentsService.list(),
      schoolYears: await this.schoolYearsService.list(),
      levels: await this.levelsService.list(),
    };
  }

  @Put('/:id')
  @Roles(Role.SUPER_ADMIN, Role.SECRETARIAT)
  async update(@Param('id') id: string, @Body() dto: CreateEnrollmentDto, @Req() req: Request, @Res() res: Response) {
    await this.enrollmentsService.updateEnrollment(id, dto, req.session.user?.id);
    setFlash(req, 'success', 'Inscription mise a jour');
    return res.redirect(req.get('referer') || `/enrollments/${id}`);
  }

  @Post('/:id/financial-details')
  @Roles(Role.SUPER_ADMIN, Role.COMPTABILITE)
  async updateFinancialDetails(
    @Param('id') id: string,
    @Body() dto: { registrationFee?: string; discountAmount?: string; paidAmount?: string; reason?: string },
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const actorRole = req.session?.user?.role;
    if (actorRole !== Role.SUPER_ADMIN && actorRole !== Role.COMPTABILITE) {
      throw new ForbiddenException('Acces refuse pour ce role');
    }

    await this.enrollmentsService.updateFinancialDetails(
      id,
      {
        registrationFee: dto.registrationFee !== undefined ? Number(dto.registrationFee) : undefined,
        discountAmount: dto.discountAmount !== undefined ? Number(dto.discountAmount) : undefined,
        paidAmount: dto.paidAmount !== undefined ? Number(dto.paidAmount) : undefined,
        reason: dto.reason,
      },
      req.session.user?.id,
      actorRole,
    );

    setFlash(req, 'success', 'Montants financiers mis a jour');
    return res.redirect(req.get('referer') || `/enrollments/${id}`);
  }
}