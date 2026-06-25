import { Body, Controller, Get, Post, Query, Render, Req, Res, UseGuards } from '@nestjs/common';
import { Request, Response } from 'express';
import { Roles } from '../common/decorators/roles.decorator';
import { AuditAction, Role } from '../common/enums/domain.enums';
import { AuthenticatedGuard } from '../common/guards/authenticated.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { setFlash } from '../common/utils/flash.util';
import { buildExcelBuffer } from '../common/utils/excel.util';
import { AuditService } from '../audit/audit.service';
import { CarryForwardArrearsDto } from './dto/carry-forward-arrears.dto';
import { ArrearsService } from './arrears.service';

@Controller('/arrears')
@UseGuards(AuthenticatedGuard, RolesGuard)
export class ArrearsController {
  constructor(
    private readonly arrearsService: ArrearsService,
    private readonly auditService: AuditService,
  ) {}

  @Get()
  @Roles(Role.SUPER_ADMIN, Role.DIRECTION, Role.COMPTABILITE, Role.AUDITEUR)
  @Render('arrears/index')
  async index(@Query('page') pageParam?: string, @Query('pageSize') pageSizeParam?: string) {
    const page = Math.max(1, Number(pageParam ?? 1));
    const pageSize = Math.min(100, Math.max(5, Number(pageSizeParam ?? 20)));
    const result = await this.arrearsService.listPaginated(page, pageSize);

    return {
      title: 'Impayes reportes',
      arrears: result.items,
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
  @Roles(Role.SUPER_ADMIN, Role.DIRECTION, Role.COMPTABILITE, Role.AUDITEUR)
  async export(@Res() res: Response) {
    const arrears = await this.arrearsService.list();
    const buffer = buildExcelBuffer(
      'Impayes',
      arrears.map((item: any) => ({
        eleve: `${item.studentId?.lastname ?? ''} ${item.studentId?.firstname ?? ''}`.trim(),
        matricule: item.studentId?.matricule ?? '',
        inscription_source: item.sourceEnrollmentId ?? '',
        annee_source: item.sourceSchoolYearId ?? '',
        montant_initial: item.amountInitial,
        montant_restant: item.amountRemaining,
        statut: item.status,
      })),
    );

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="impayes.xlsx"');
    return res.send(buffer);
  }

  @Post('/carry-forward')
  @Roles(Role.SUPER_ADMIN, Role.DIRECTION, Role.COMPTABILITE)
  async carryForward(
    @Body() dto: CarryForwardArrearsDto,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const result = await this.arrearsService.carryForwardToEnrollment(
      dto.studentId,
      dto.targetEnrollmentId,
      '',
    );
    await this.auditService.log({
      actorId: req.session.user?.id,
      action: AuditAction.ARREAR_CARRIED_FORWARD,
      entityType: 'Arrear',
      entityId: dto.sourceEnrollmentId,
      details: result,
    });
    setFlash(req, 'success', 'Impayes reportes');
    return res.redirect('/arrears');
  }
}